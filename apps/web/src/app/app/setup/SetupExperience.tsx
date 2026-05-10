"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "../../theme";
import {
  ARCIUM_DEVNET_CLUSTER_OFFSET,
  SILENCE_DEVNET_RPC,
  SILENCE_PROGRAM_ID,
  SilenceDevnetClient,
  shortenAddress,
  type ExplorerTransaction
} from "@silence/sdk";
import type { Organization } from "@silence/shared";
import { usePhantomWallet } from "../../wallet";

type SetupStep = "mint" | "organization" | "definitions" | "deposit" | "complete";
type LoadState = "idle" | "loading" | "ready" | "error";

interface SetupState {
  organizationAddress: string;
  vaultAddress: string;
  organization: Organization | null;
  tokenBalance: number | null;
  arciumDefinitionsReady: boolean;
}

const setupRoutes: Record<Exclude<SetupStep, "complete">, string> = {
  mint: "/app/setup/mint",
  organization: "/app/setup/organization",
  definitions: "/app/setup/definitions",
  deposit: "/app/setup/deposit"
};

const emptySetupState: SetupState = {
  organizationAddress: "",
  vaultAddress: "",
  organization: null,
  tokenBalance: null,
  arciumDefinitionsReady: false
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function formatTokenBalance(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "0.000";
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function readAmount(form: FormData, key: string) {
  const value = Number(form.get(key) ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a valid positive number.`);
  }
  return value;
}

export function SetupExperience({ requestedStep }: { requestedStep?: Exclude<SetupStep, "complete"> }) {
  const router = useRouter();
  const { connected, connecting, publicKey, wallet, error: walletError, connect, disconnect } = usePhantomWallet();
  const { theme, toggle: toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [state, setState] = useState<SetupState>(emptySetupState);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [latestTx, setLatestTx] = useState<ExplorerTransaction | null>(null);
  const [createdMint, setCreatedMint] = useState<{ mint: string; adminTokenAccount: string; amountUi: number } | null>(null);
  const [mxeAuthority, setMxeAuthority] = useState<string | null>(null);

  const client = useMemo(() => (wallet ? new SilenceDevnetClient(wallet, { rpcUrl: SILENCE_DEVNET_RPC }) : null), [wallet]);
  const setupStorageKey = publicKey ? `silence:setup:${publicKey.toBase58()}` : "silence:setup";
  const legacyStorageKey = publicKey ? `silence:onboarding:${publicKey.toBase58()}` : "silence:onboarding";

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoadState("loading");
    setError(null);
    try {
      const [organizationState, authority] = await Promise.all([
        client.getOrganization(),
        client.getMxeAuthority().then(pk => pk?.toBase58() ?? null).catch(() => null)
      ]);
      setMxeAuthority(authority);
      const [tokenBalance, definitionsStatus] = organizationState.account
        ? await Promise.all([client.getAdminTokenBalance(organizationState.account.usdcMint), client.getArciumDefinitionsStatus()])
        : [null, { initialized: false }];
      setState({
        organizationAddress: organizationState.address,
        vaultAddress: organizationState.vault,
        organization: organizationState.account,
        tokenBalance,
        arciumDefinitionsReady: definitionsStatus.initialized
      });
      setLoadState("ready");
    } catch (loadError) {
      setLoadState("error");
      setError(loadError instanceof Error ? loadError.message : "Unable to load setup state from devnet.");
    }
  }, [client]);

  useEffect(() => {
    if (!connected || !publicKey) return;
    const savedMint = window.localStorage.getItem(setupStorageKey) ?? window.localStorage.getItem(legacyStorageKey);
    if (!savedMint) {
      setCreatedMint(null);
      return;
    }

    try {
      const parsed = JSON.parse(savedMint) as { mint?: string; adminTokenAccount?: string; amountUi?: number };
      if (parsed.mint && parsed.adminTokenAccount && Number.isFinite(parsed.amountUi)) {
        setCreatedMint({ mint: parsed.mint, adminTokenAccount: parsed.adminTokenAccount, amountUi: parsed.amountUi ?? 0 });
      } else {
        window.localStorage.removeItem(setupStorageKey);
        window.localStorage.removeItem(legacyStorageKey);
        setCreatedMint(null);
      }
    } catch {
      window.localStorage.removeItem(setupStorageKey);
      window.localStorage.removeItem(legacyStorageKey);
      setCreatedMint(null);
    }
  }, [connected, legacyStorageKey, publicKey, setupStorageKey]);

  useEffect(() => {
    if (connected && client) {
      refresh();
    } else {
      setState(emptySetupState);
      setLoadState("idle");
      setLatestTx(null);
      setNotice(null);
    }
  }, [client, connected, refresh]);

  // The definitions step is a one-time platform-level action that only the deployer
  // wallet (MXE authority) can sign. Once completed it applies to everyone.
  // Non-deployer wallets skip it — they go straight to deposit once their org is created.
  const isDeployer = !!(mxeAuthority && publicKey && publicKey.toBase58() === mxeAuthority);

  const currentStep: SetupStep = !state.organization
    ? createdMint
      ? "organization"
      : "mint"
    : !state.arciumDefinitionsReady && isDeployer
      ? "definitions"
      : state.tokenBalance !== null && state.tokenBalance <= 0
        ? "deposit"
        : "complete";

  useEffect(() => {
    if (!connected || loadState !== "ready") return;
    if (currentStep === "complete") {
      router.replace("/app");
      return;
    }
    if (!requestedStep || requestedStep !== currentStep) {
      router.replace(setupRoutes[currentStep]);
    }
  }, [connected, currentStep, loadState, requestedStep, router]);

  async function runSetupAction(label: string, action: () => Promise<ExplorerTransaction | null>, next?: string) {
    setBusyAction(label);
    setError(null);
    setNotice(null);
    try {
      const tx = await action();
      if (tx) setLatestTx(tx);
      await refresh();
      if (next) router.push(next);
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Setup action failed.";
      setError(message);
      if (message.includes("already initialized")) await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function createMint() {
    if (!client) return;
    await runSetupAction(
      "mint",
      async () => {
        const result = await client.createTestMint();
        const mintState = { mint: result.mint, adminTokenAccount: result.adminTokenAccount, amountUi: result.amountUi };
        setCreatedMint(mintState);
        window.localStorage.setItem(setupStorageKey, JSON.stringify(mintState));
        window.localStorage.removeItem(legacyStorageKey);
        return result;
      },
      setupRoutes.organization
    );
  }

  async function initializeOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const mint = String(form.get("mint") ?? "").trim();
    await runSetupAction(
      "organization",
      async () => {
        const result = await client.initializeOrganization(name, mint);
        window.localStorage.removeItem(setupStorageKey);
        window.localStorage.removeItem(legacyStorageKey);
        setCreatedMint(null);
        return result;
      },
      setupRoutes.definitions
    );
  }

  async function initializeArciumDefinitions() {
    if (!client) return;
    await runSetupAction(
      "definitions",
      async () => {
        const result = await client.initializeArciumDefinitions();
        setNotice(result ? "Arcium payroll definitions initialized." : "Arcium payroll definitions were already initialized.");
        return result;
      },
      setupRoutes.deposit
    );
  }

  async function depositVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !state.organization) return;
    const form = new FormData(event.currentTarget);
    await runSetupAction(
      "deposit",
      () =>
        client.depositVault({
          organization: state.organizationAddress,
          mint: state.organization!.usdcMint,
          vault: state.vaultAddress,
          amountUi: readAmount(form, "amount")
        }),
      "/app"
    );
  }

  if (!connected) {
    return (
      <main className="gate-page">
        <section className="gate-panel">
          <div className="brand-lockup">
            <span>SILENCE</span>
          </div>
          <h1>Connect to continue</h1>
          <p>Setup resumes from your wallet state. If you already minted or initialized, the next page appears after connection.</p>
          <div className="gate-actions">
            <button className="button neon" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting" : "Connect Phantom"}
            </button>
            <Link className="button dark" href="/">
              Back home
            </Link>
          </div>
          {walletError ? <p className="error-line">{walletError}</p> : null}
        </section>
      </main>
    );
  }

  const shownStep = requestedStep ?? currentStep;
  const stepNumber = shownStep === "mint" ? "01" : shownStep === "organization" ? "02" : shownStep === "definitions" ? "03" : "04";

  return (
    <main className="app-shell setup-shell">
      {menuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="mobile-menu-header" onClick={(e) => e.stopPropagation()}>
            <Link className="brand-lockup" href="/" onClick={() => setMenuOpen(false)}>
              <span>SILENCE</span>
            </Link>
            <button className="mobile-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              ✕
            </button>
          </div>
          <nav className="mobile-menu-links" onClick={(e) => e.stopPropagation()}>
            <Link href="/app" onClick={() => setMenuOpen(false)}>Dashboard</Link>
            <div className="mobile-menu-divider" />
            <button onClick={toggleTheme}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button onClick={() => { disconnect(); setMenuOpen(false); }}>
              Disconnect
            </button>
          </nav>
        </div>
      )}

      <nav className="app-nav">
        <Link className="brand-lockup" href="/">
          <span>SILENCE</span>
        </Link>
        <div className="app-nav-actions">
          <Link className="status-pill" href="/app">Dashboard</Link>
          <span className="status-pill">Devnet</span>
          <span className="status-pill">Tokens {formatTokenBalance(state.tokenBalance)}</span>
          <span className="status-pill">{publicKey ? shortenAddress(publicKey.toBase58()) : "Wallet"}</span>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="button dark compact" onClick={disconnect}>Disconnect</button>
        </div>
        <button
          className={`hamburger-btn${menuOpen ? " open" : ""}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <span className="bar" />
          <span className="bar" />
          <span className="bar" />
        </button>
      </nav>

      <section className="setup-page">
        <div className="setup-rail">
          <p className="hero-kicker">Setup step {stepNumber} / 04</p>
          <h1>Payroll setup</h1>
          <div className="setup-steps">
            {(["mint", "organization", "definitions", "deposit"] as const).map((step, index) => {
              const isAdminStep = step === "definitions" && !isDeployer;
              return (
                <Link
                  className={`${currentStep === step ? "active" : ""} ${isAdminStep ? "step-admin" : ""}`}
                  href={setupRoutes[step]}
                  key={step}
                  tabIndex={isAdminStep ? -1 : undefined}
                >
                  {String(index + 1).padStart(2, "0")} {step}{isAdminStep ? " (platform)" : ""}
                </Link>
              );
            })}
          </div>
        </div>

        <section className="setup-card">
          {loadState === "loading" ? <p className="loading-row">Loading setup state...</p> : null}
          {error ? <p className="alert">{error}</p> : null}
          {notice ? <p className="alert neutral">{notice}</p> : null}
          {latestTx ? (
            <a className="tx-link" href={latestTx.explorerUrl} rel="noreferrer" target="_blank">
              Latest transaction {shortenAddress(latestTx.signature)}
            </a>
          ) : null}

          {shownStep === "mint" ? (
            <div className="setup-stage">
              <p className="hero-kicker">Create SPL test supply</p>
              <h2>Create payroll token supply</h2>
              <p className="muted">This creates a devnet SPL test mint and mints 100,000 payroll tokens to the connected admin wallet.</p>
              <button className="button neon" type="button" onClick={createMint} disabled={busyAction === "mint" || currentStep !== "mint"}>
                {busyAction === "mint" ? "Waiting for signature" : "Create test mint"}
              </button>
            </div>
          ) : null}

          {shownStep === "organization" ? (
            <form className="setup-stage" onSubmit={initializeOrganization}>
              <p className="hero-kicker">Create organization PDA</p>
              <h2>Initialize workspace</h2>
              <p className="muted">This creates the organization and vault accounts on-chain using the mint from step one.</p>
              <Field label="Organization name">
                <input name="name" required placeholder="SILENCE Ops" maxLength={48} defaultValue="SILENCE Ops" />
              </Field>
              <Field label="SPL test mint">
                <input name="mint" required defaultValue={createdMint?.mint ?? ""} placeholder="Paste the devnet mint address" />
              </Field>
              {createdMint ? <p className="success-line">Minted {createdMint.amountUi.toLocaleString()} tokens.</p> : null}
              <button className="button neon" disabled={busyAction === "organization" || currentStep !== "organization"}>
                {busyAction === "organization" ? "Waiting for signature" : "Initialize organization"}
              </button>
            </form>
          ) : null}

          {shownStep === "definitions" ? (
            <div className="setup-stage">
              <p className="hero-kicker">Prepare Arcium circuits</p>
              <h2>Initialize computation definitions</h2>
              <p className="muted">This initializes the prepare, validate, and paystub sealing definitions for program {shortenAddress(SILENCE_PROGRAM_ID)} on Arcium offset {ARCIUM_DEVNET_CLUSTER_OFFSET}.</p>
              {mxeAuthority ? (
                <div className="facts-grid">
                  <div>
                    <span>Required wallet</span>
                    <strong title={mxeAuthority}>{shortenAddress(mxeAuthority)}</strong>
                  </div>
                  <div>
                    <span>Connected wallet</span>
                    <strong className={publicKey && publicKey.toBase58() === mxeAuthority ? "success-line" : "alert-inline"}>
                      {publicKey ? shortenAddress(publicKey.toBase58()) : "N/A"}
                      {publicKey && publicKey.toBase58() !== mxeAuthority ? " ✗ wrong wallet" : publicKey ? " ✓" : ""}
                    </strong>
                  </div>
                </div>
              ) : null}
              {mxeAuthority && publicKey && publicKey.toBase58() !== mxeAuthority ? (
                <p className="alert">
                  Switch Phantom to the deployer wallet ({shortenAddress(mxeAuthority)}) to complete this step.
                  This is the wallet that deployed the SILENCE program and registered its Arcium MXE.
                </p>
              ) : null}
              <button
                className="button neon"
                type="button"
                onClick={initializeArciumDefinitions}
                disabled={
                  busyAction === "definitions" ||
                  currentStep !== "definitions" ||
                  (mxeAuthority !== null && publicKey !== null && publicKey.toBase58() !== mxeAuthority)
                }
              >
                {busyAction === "definitions" ? "Waiting for signature" : "Initialize definitions"}
              </button>
            </div>
          ) : null}

          {shownStep === "deposit" && !state.arciumDefinitionsReady && !isDeployer ? (
            <p className="alert neutral">
              Arcium computation definitions have not been initialized yet. You can complete setup
              and deposit funds, but payroll computations will not run until the platform deployer
              initializes the Arcium circuits (step 03).
            </p>
          ) : null}

          {shownStep === "deposit" ? (
            <form className="setup-stage" onSubmit={depositVault}>
              <p className="hero-kicker">Fund payroll vault</p>
              <h2>Deposit test tokens</h2>
              <p className="muted">Move test payroll tokens from your admin token account into the organization vault before creating payroll runs.</p>
              <div className="facts-grid">
                <div>
                  <span>Organization</span>
                  <strong>{state.organizationAddress ? shortenAddress(state.organizationAddress) : "Pending"}</strong>
                </div>
                <div>
                  <span>Vault</span>
                  <strong>{state.vaultAddress ? shortenAddress(state.vaultAddress) : "Pending"}</strong>
                </div>
              </div>
              <Field label="Deposit amount">
                <input name="amount" min="0" step="0.000001" type="number" placeholder="50000" required />
              </Field>
              <button className="button neon" disabled={busyAction === "deposit" || currentStep !== "deposit"}>
                {busyAction === "deposit" ? "Waiting for signature" : "Deposit to vault"}
              </button>
            </form>
          ) : null}
        </section>
      </section>
    </main>
  );
}
