"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "../theme";
import { usePhantomWallet } from "../wallet";
import {
  SilenceDevnetClient,
  SILENCE_DEVNET_RPC,
  shortenAddress,
} from "@silence/sdk";
import type { PayrollPayoutRecord, PayrollRun } from "@silence/shared";

type LoadState = "idle" | "loading" | "ready" | "error";

interface PaystubEntry {
  run: PayrollRun;
  payout: PayrollPayoutRecord;
}

function statusLabel(status: PayrollPayoutRecord["status"]) {
  switch (status) {
    case "Pending":  return "Pending seal";
    case "Sealing":  return "Sealing";
    case "Ready":    return "Sealed";
    case "Paid":     return "Paid";
    case "Failed":   return "Failed";
    default:         return status;
  }
}

function formatDate(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return iso; }
}

export function EmployeeExperience() {
  const searchParams = useSearchParams();
  const { connected, connecting, publicKey, wallet, error: walletError, connect, disconnect } = usePhantomWallet();
  const { theme, toggle: toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paystubs, setPaystubs] = useState<PaystubEntry[]>([]);
  const [orgInput, setOrgInput] = useState(searchParams.get("org") ?? "");
  const [activeOrg, setActiveOrg] = useState(searchParams.get("org") ?? "");

  const client = useMemo(
    () => (wallet ? new SilenceDevnetClient(wallet, { rpcUrl: SILENCE_DEVNET_RPC }) : null),
    [wallet]
  );

  const load = useCallback(
    async (org: string) => {
      if (!client || !publicKey || !org) return;
      setLoadState("loading");
      setError(null);
      try {
        const runs = await client.listPayrollRuns(org);
        const walletStr = publicKey.toBase58();
        const entries: PaystubEntry[] = runs
          .flatMap((run) => run.payouts.map((payout) => ({ run, payout })))
          .filter(({ payout }) => payout.employeeWallet === walletStr)
          .sort((a, b) => new Date(b.run.periodStart).getTime() - new Date(a.run.periodStart).getTime());
        setPaystubs(entries);
        setLoadState("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load paystubs from devnet.");
        setLoadState("error");
      }
    },
    [client, publicKey]
  );

  useEffect(() => {
    if (connected && activeOrg) load(activeOrg);
  }, [connected, activeOrg, load]);

  function handleOrgSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = orgInput.trim();
    if (trimmed) setActiveOrg(trimmed);
  }

  // ── Not connected ────────────────────────────────────────

  if (!connected) {
    return (
      <main className="gate-page">
        <section className="gate-panel">
          <div className="brand-lockup">
            <span>SILENCE</span>
          </div>
          <h1>Employee portal</h1>
          <p>Connect your Solana devnet wallet to view your sealed paystubs.</p>
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

  // ── Connected ────────────────────────────────────────────

  return (
    <main className="app-shell">
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
            <Link href="/" onClick={() => setMenuOpen(false)}>Home</Link>
            <div className="mobile-menu-divider" />
            <button onClick={toggleTheme}>{theme === "dark" ? "Light mode" : "Dark mode"}</button>
            <button onClick={() => { disconnect(); setMenuOpen(false); }}>Disconnect</button>
          </nav>
        </div>
      )}

      <nav className="app-nav">
        <Link className="brand-lockup" href="/">
          <span>SILENCE</span>
        </Link>
        <div className="app-nav-actions">
          <span className="status-pill">Employee portal</span>
          <span className="status-pill">Devnet</span>
          <span className="status-pill">{shortenAddress(publicKey!.toBase58())}</span>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="button dark compact" onClick={disconnect}>
            Disconnect
          </button>
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

      <section className="app-hero">
        <div>
          <p className="hero-kicker">Employee portal / Devnet</p>
          <h1>Your paystubs</h1>
          <p>
            Your net pay is encrypted inside Arcium's MXE and sealed to your wallet. Amounts are private and
            never appear in plaintext on-chain.
          </p>
        </div>
        <div className="grid-portal" aria-hidden="true" />
      </section>

      {error ? <div className="alert">{error}</div> : null}

      <section className="app-grid">
        {/* ── Org lookup ── */}
        <article className="glass-panel span-2">
          <div className="panel-heading">
            <div>
              <h2>Organization</h2>
              <p>
                {activeOrg
                  ? `Showing paystubs for ${shortenAddress(activeOrg)}.`
                  : "Enter the organization address your employer shared with you."}
              </p>
            </div>
          </div>
          <form className="form-grid" onSubmit={handleOrgSubmit}>
            <label className="field">
              <span>Organization PDA</span>
              <input
                value={orgInput}
                onChange={(e) => setOrgInput(e.target.value)}
                placeholder="Paste organization address (e.g. 4XQX...gAyV)"
                required
              />
            </label>
            <button className="button neon" type="submit" disabled={loadState === "loading"}>
              {loadState === "loading" ? "Loading..." : "Load paystubs"}
            </button>
          </form>
          {activeOrg ? (
            <p className="employee-portal-share-hint">
              Share this link with employees:{" "}
              <span className="tx-link">
                {typeof window !== "undefined" ? `${window.location.origin}/employee?org=${activeOrg}` : `/employee?org=${activeOrg}`}
              </span>
            </p>
          ) : null}
        </article>

        {/* ── Paystub list ── */}
        <article className="glass-panel span-2">
          <div className="panel-heading">
            <div>
              <h2>Paystub history</h2>
              <p>
                {loadState === "ready"
                  ? paystubs.length
                    ? `${paystubs.length} paystub${paystubs.length === 1 ? "" : "s"} found for your wallet.`
                    : "No paystubs found for your wallet in this organization."
                  : loadState === "loading"
                  ? "Loading from devnet..."
                  : "Enter an organization address above to load your paystubs."}
              </p>
            </div>
          </div>

          {loadState === "loading" ? (
            <p className="loading-row">Loading real devnet state...</p>
          ) : null}

          <div className="record-list">
            {paystubs.map(({ run, payout }) => (
              <div className="record-stack" key={payout.id}>
                <div className="record-row">
                  <span>
                    {formatDate(run.periodStart)} — {formatDate(run.periodEnd)}
                  </span>
                  <strong className={
                    payout.status === "Paid" ? "success-line" :
                    payout.status === "Failed" ? "alert-inline" :
                    payout.status === "Ready" ? "success-line" : ""
                  }>
                    {statusLabel(payout.status)}
                  </strong>
                </div>
                <div className="facts-grid">
                  <div>
                    <span>Payroll run</span>
                    <strong title={run.id}>{shortenAddress(run.id)}</strong>
                  </div>
                  <div>
                    <span>Run status</span>
                    <strong>{run.status}</strong>
                  </div>
                  <div>
                    <span>Net pay</span>
                    <strong className="paystub-sealed">
                      {payout.encryptedNetPay ? "🔒 Sealed by Arcium" : "Pending"}
                    </strong>
                  </div>
                  {payout.status === "Paid" ? (
                    <div>
                      <span>Payment</span>
                      <strong className="success-line">Tokens transferred</strong>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {loadState === "ready" && paystubs.length === 0 && activeOrg ? (
            <p className="muted" style={{ padding: "16px 0" }}>
              Your wallet ({shortenAddress(publicKey!.toBase58())}) has no payroll records in this organization yet.
              Check the address is correct or ask your employer to add you as an employee.
            </p>
          ) : null}
        </article>
      </section>
    </main>
  );
}
