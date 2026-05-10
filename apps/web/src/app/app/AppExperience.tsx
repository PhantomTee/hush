"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import {
  ARCIUM_DEVNET_CLUSTER_OFFSET,
  SILENCE_DEVNET_RPC,
  SILENCE_PROGRAM_ID,
  SilenceDevnetClient,
  shortenAddress,
  type ExplorerTransaction,
  type QueuePayrollComputationResult
} from "@silence/sdk";
import type { EmployeeRecord, Organization, PayrollRun } from "@silence/shared";
import { usePhantomWallet } from "../wallet";

type LoadState = "idle" | "loading" | "ready" | "error";
type AppView = "dashboard" | "employees" | "payroll" | "activity";

interface AppState {
  organizationAddress: string;
  vaultAddress: string;
  organization: Organization | null;
  employees: EmployeeRecord[];
  payrollRuns: PayrollRun[];
  tokenBalance: number | null;
  arciumDefinitionsReady: boolean;
}

const emptyState: AppState = {
  organizationAddress: "",
  vaultAddress: "",
  organization: null,
  employees: [],
  payrollRuns: [],
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

function TxLink({ tx }: { tx: ExplorerTransaction }) {
  return (
    <a className="tx-link" href={tx.explorerUrl} rel="noreferrer" target="_blank">
      {shortenAddress(tx.signature)}
    </a>
  );
}

function readAmount(form: FormData, key: string) {
  const value = Number(form.get(key) ?? 0);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a valid non-negative number.`);
  }
  return value;
}

function formatTokenBalance(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "0.000";
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

const appNavItems: Array<{ href: string; label: string; view: AppView }> = [
  { href: "/app", label: "Overview", view: "dashboard" },
  { href: "/app/employees", label: "Employees", view: "employees" },
  { href: "/app/payroll", label: "Payroll", view: "payroll" },
  { href: "/app/activity", label: "Activity", view: "activity" }
];

export function AppExperience({ view }: { view: AppView }) {
  const { connected, connecting, publicKey, wallet, error: walletError, connect, disconnect } = usePhantomWallet();
  const [state, setState] = useState<AppState>(emptyState);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ExplorerTransaction[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [createdMint, setCreatedMint] = useState<{ mint: string; adminTokenAccount: string; amountUi: number } | null>(null);
  const [queuedComputations, setQueuedComputations] = useState<Record<string, QueuePayrollComputationResult>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const client = useMemo(() => (wallet ? new SilenceDevnetClient(wallet, { rpcUrl: SILENCE_DEVNET_RPC }) : null), [wallet]);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoadState("loading");
    setError(null);
    try {
      const organizationState = await client.getOrganization();
      const employees = organizationState.account ? await client.listEmployees(organizationState.address) : [];
      const payrollRuns = organizationState.account ? await client.listPayrollRuns(organizationState.address) : [];
      const [tokenBalance, definitionsStatus] = organizationState.account
        ? await Promise.all([client.getAdminTokenBalance(organizationState.account.usdcMint), client.getArciumDefinitionsStatus()])
        : [null, { initialized: false }];
      setState({
        organizationAddress: organizationState.address,
        vaultAddress: organizationState.vault,
        organization: organizationState.account,
        employees,
        payrollRuns,
        tokenBalance,
        arciumDefinitionsReady: definitionsStatus.initialized
      });
      setLoadState("ready");
    } catch (loadError) {
      setLoadState("error");
      setError(loadError instanceof Error ? loadError.message : "Unable to load devnet state.");
    }
  }, [client]);

  const setupStorageKey = publicKey ? `silence:onboarding:${publicKey.toBase58()}` : "silence:onboarding";
  const dismissStorageKey = `${setupStorageKey}:dismissed`;

  useEffect(() => {
    if (!connected || !publicKey) return;
    setCreatedMint(null);
    setQueuedComputations({});
    const savedMint = window.localStorage.getItem(setupStorageKey);
    if (savedMint) {
      try {
        const parsed = JSON.parse(savedMint) as { mint?: string; adminTokenAccount?: string; amountUi?: number };
        if (parsed.mint && parsed.adminTokenAccount && Number.isFinite(parsed.amountUi)) {
          setCreatedMint({ mint: parsed.mint, adminTokenAccount: parsed.adminTokenAccount, amountUi: parsed.amountUi ?? 0 });
        } else {
          window.localStorage.removeItem(setupStorageKey);
        }
      } catch {
        window.localStorage.removeItem(setupStorageKey);
      }
    }
    setOnboardingDismissed(window.localStorage.getItem(dismissStorageKey) === "true");
  }, [connected, dismissStorageKey, publicKey, setupStorageKey]);

  useEffect(() => {
    if (connected && client) {
      refresh();
    } else {
      setState(emptyState);
      setLoadState("idle");
      setCreatedMint(null);
      setQueuedComputations({});
      setOnboardingOpen(false);
      setOnboardingDismissed(false);
    }
  }, [client, connected, refresh]);

  const onboardingStep = !state.organization
    ? createdMint
      ? "organization"
      : "mint"
    : !state.arciumDefinitionsReady
      ? "definitions"
      : state.tokenBalance !== null && state.tokenBalance <= 0
        ? "deposit"
        : null;
  const onboardingIncomplete = onboardingStep !== null;

  useEffect(() => {
    if (connected && onboardingIncomplete && !onboardingDismissed) {
      setOnboardingOpen(true);
    }
  }, [connected, onboardingDismissed, onboardingIncomplete]);

  function dismissOnboarding() {
    setOnboardingOpen(false);
    setOnboardingDismissed(true);
    window.localStorage.setItem(dismissStorageKey, "true");
  }

  function resumeOnboarding() {
    setOnboardingDismissed(false);
    window.localStorage.removeItem(dismissStorageKey);
    setOnboardingOpen(true);
  }

  async function runAction(label: string, action: () => Promise<ExplorerTransaction | null>) {
    setBusyAction(label);
    setError(null);
    setNotice(null);
    try {
      const tx = await action();
      if (tx) setTransactions((items) => [tx, ...items]);
      await refresh();
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Action failed.";
      setError(message);
      if (message.includes("already initialized")) {
        await refresh();
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function createMint() {
    if (!client) return;
    await runAction("mint", async () => {
      const result = await client.createTestMint();
      const mintState = { mint: result.mint, adminTokenAccount: result.adminTokenAccount, amountUi: result.amountUi };
      setCreatedMint(mintState);
      window.localStorage.setItem(setupStorageKey, JSON.stringify(mintState));
      return result;
    });
  }

  async function initializeOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const mint = String(form.get("mint") ?? "").trim();
    await runAction("organization", async () => {
      const result = await client.initializeOrganization(name, mint);
      window.localStorage.removeItem(setupStorageKey);
      return result;
    });
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !state.organization) return;
    const form = new FormData(event.currentTarget);
    await runAction("employee", async () =>
      client.addEmployee({
        organization: state.organizationAddress,
        employeeWallet: String(form.get("employeeWallet") ?? "").trim(),
        metadata: String(form.get("metadata") ?? "").trim(),
        department: String(form.get("department") ?? "").trim(),
        role: String(form.get("role") ?? "").trim(),
        compensationReference: String(form.get("compensationReference") ?? "").trim()
      })
    );
  }

  async function createPayrollRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !state.organization) return;
    const form = new FormData(event.currentTarget);
    await runAction("payroll", async () =>
      client.createPayrollRun({
        organization: state.organizationAddress,
        periodStart: String(form.get("periodStart") ?? ""),
        periodEnd: String(form.get("periodEnd") ?? ""),
        batchReference: String(form.get("batchReference") ?? "").trim(),
        employeeCount: readAmount(form, "employeeCount")
      })
    );
  }

  async function depositVault(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !state.organization) return;
    const form = new FormData(event.currentTarget);
    await runAction("deposit", async () =>
      client.depositVault({
        organization: state.organizationAddress,
        mint: state.organization!.usdcMint,
        vault: state.vaultAddress,
        amountUi: readAmount(form, "amount")
      })
    );
  }

  async function initializeArciumDefinitions() {
    if (!client) return;
    await runAction("definitions", async () => {
      const result = await client.initializeArciumDefinitions();
      setNotice(result ? "Arcium payroll definitions initialized." : "Arcium payroll definitions are already initialized.");
      return result;
    });
  }

  async function queuePayrollComputation(event: FormEvent<HTMLFormElement>, run: PayrollRun) {
    event.preventDefault();
    if (!client || !state.organization) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await runAction("queue", async () => {
      const result = await client.queuePayrollComputation({
        organization: state.organizationAddress,
        payrollRun: run.id,
        batchHash: run.batchHash,
        grossPayUi: readAmount(form, "grossPay"),
        bonusUi: readAmount(form, "bonus"),
        deductionsUi: readAmount(form, "deductions"),
        adjustmentsUi: readAmount(form, "adjustments")
      });
      setQueuedComputations((items) => ({ ...items, [`prepare:${run.id}`]: result }));
      setNotice(`Queued prepare computation ${shortenAddress(result.computationAccount)}. Await finalization next.`);
      return result;
    });
    formElement.reset();
  }

  async function queueValidation(run: PayrollRun) {
    if (!client || !state.organization) return;
    await runAction("validate", async () => {
      const result = await client.queueValidatePayrollRun({
        organization: state.organizationAddress,
        payrollRun: run.id,
        vault: state.vaultAddress
      });
      setQueuedComputations((items) => ({ ...items, [`validate:${run.id}`]: result }));
      setNotice(`Queued validation computation ${shortenAddress(result.computationAccount)}.`);
      return result;
    });
  }

  async function createPayout(employeeId: string, run: PayrollRun) {
    if (!client || !state.organization) return;
    await runAction("payout", async () =>
      client.createPayrollPayout({
        organization: state.organizationAddress,
        payrollRun: run.id,
        employee: employeeId
      })
    );
  }

  async function queueSeal(run: PayrollRun, payoutId: string) {
    if (!client || !state.organization) return;
    await runAction("seal", async () => {
      const result = await client.queueSealEmployeePaystub({
        organization: state.organizationAddress,
        payrollRun: run.id,
        payout: payoutId
      });
      setQueuedComputations((items) => ({ ...items, [`seal:${payoutId}`]: result }));
      setNotice(`Queued paystub seal computation ${shortenAddress(result.computationAccount)}.`);
      return result;
    });
  }

  async function awaitFinalization(run: PayrollRun, stage: string) {
    if (!client) return;
    const queued = queuedComputations[stage];
    if (!queued) {
      setNotice("This computation was not queued in this browser session, so its offset is unavailable here. Queue the next stage from this session or use the transaction logs.");
      return;
    }
    setBusyAction(`finalize:${stage}`);
    setError(null);
    setNotice("Waiting for Arcium finalization. This can take a minute on devnet.");
    try {
      const result = await client.awaitPayrollFinalization({
        payrollRun: run.id,
        computationOffset: queued.computationOffset
      });
      setTransactions((items) => [{ signature: result.signature, explorerUrl: result.explorerUrl }, ...items]);
      setNotice(`Arcium finalized this stage. Payroll run is now ${result.payrollRun.status}.`);
      await refresh();
    } catch (finalizeError) {
      setError(finalizeError instanceof Error ? finalizeError.message : "Unable to await Arcium finalization.");
    } finally {
      setBusyAction(null);
    }
  }

  async function executePayroll(run: PayrollRun) {
    if (!client || !state.organization) return;
    await runAction("execute", async () =>
      client.executePayroll({
        organization: state.organizationAddress,
        payrollRun: run.id,
        vault: state.vaultAddress
      })
    );
  }

  if (!connected) {
    return (
      <main className="gate-page">
        <section className="gate-panel">
          <div className="brand-lockup">
            <span className="brand-glyph">S</span>
            <span>SILENCE</span>
          </div>
          <h1>Wallet required</h1>
          <p>The payroll app only loads real devnet state after a wallet connects. No demo records are shown.</p>
          <div className="gate-actions">
            <button className="button neon" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting" : "Connect Phantom"}
            </button>
            <Link className="button dark" href="/">
              Back to landing
            </Link>
          </div>
          {walletError ? <p className="error-line">{walletError}</p> : null}
        </section>
      </main>
    );
  }

  const showDashboard = view === "dashboard";
  const showEmployees = view === "dashboard" || view === "employees";
  const showPayroll = view === "dashboard" || view === "payroll";
  const showActivity = view === "dashboard" || view === "activity";
  const pageTitle =
    view === "employees"
      ? "Private workforce registry"
      : view === "payroll"
        ? "Encrypted payroll pipeline"
        : view === "activity"
          ? "Devnet transaction ledger"
          : "Encrypted payroll control room";
  const pageCopy =
    view === "employees"
      ? "Add employees with hashed metadata and encrypted compensation references. The chain never receives plaintext payroll profiles."
      : view === "payroll"
        ? "Create runs, queue Arcium stages, validate vault funding, seal paystubs, and execute only after the private pipeline completes."
        : view === "activity"
          ? "Review the real signatures produced in this browser session and keep a tight eye on deployed devnet state."
          : "Every number below is loaded from devnet or entered for a real transaction. Empty means no on-chain state exists yet.";

  return (
    <main className="app-shell">
      {onboardingOpen && onboardingIncomplete ? (
        <section className="onboarding-backdrop" onMouseDown={dismissOnboarding}>
          <div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-topline">
              <span>Initialization</span>
              <button type="button" onClick={dismissOnboarding}>
                Close
              </button>
            </div>
            {onboardingStep === "mint" ? (
              <div className="modal-stage">
                <p className="hero-kicker">Step 1 / Test mint</p>
                <h2 id="onboarding-title">Create payroll token supply</h2>
                <p className="muted">This creates a devnet SPL test mint and mints 100,000 payroll tokens to your connected wallet.</p>
                <button className="button neon" type="button" onClick={createMint} disabled={busyAction === "mint"}>
                  {busyAction === "mint" ? "Waiting for signature" : "Create test mint"}
                </button>
              </div>
            ) : null}
            {onboardingStep === "organization" ? (
              <form className="modal-stage" onSubmit={initializeOrganization}>
                <p className="hero-kicker">Step 2 / Organization</p>
                <h2 id="onboarding-title">Initialize the payroll workspace</h2>
                <p className="muted">The organization and vault are created on-chain using the mint from the previous step.</p>
                <Field label="Organization name">
                  <input name="name" required placeholder="SILENCE Ops" maxLength={48} defaultValue="SILENCE Ops" />
                </Field>
                <Field label="SPL test mint">
                  <input name="mint" required defaultValue={createdMint?.mint ?? ""} placeholder="Paste the devnet mint address" />
                </Field>
                {createdMint ? <p className="success-line">Minted {createdMint.amountUi.toLocaleString()} tokens.</p> : null}
                <button className="button neon" disabled={busyAction === "organization"}>
                  {busyAction === "organization" ? "Waiting for signature" : "Initialize organization"}
                </button>
              </form>
            ) : null}
            {onboardingStep === "definitions" ? (
              <div className="modal-stage">
                <p className="hero-kicker">Step 3 / Arcium</p>
                <h2 id="onboarding-title">Initialize computation definitions</h2>
                <p className="muted">This prepares the payroll circuits for prepare, validation, and paystub sealing on the deployed MXE.</p>
                <button className="button neon" type="button" onClick={initializeArciumDefinitions} disabled={busyAction === "definitions"}>
                  {busyAction === "definitions" ? "Waiting for signature" : "Initialize Arcium definitions"}
                </button>
              </div>
            ) : null}
            {onboardingStep === "deposit" ? (
              <form className="modal-stage" onSubmit={depositVault}>
                <p className="hero-kicker">Step 4 / Vault</p>
                <h2 id="onboarding-title">Fund the payroll vault</h2>
                <p className="muted">Move test payroll tokens from your wallet into the organization vault before creating real payroll runs.</p>
                <Field label="Deposit amount">
                  <input name="amount" min="0" step="0.000001" type="number" placeholder="50000" required />
                </Field>
                <button className="button neon" disabled={busyAction === "deposit"}>
                  {busyAction === "deposit" ? "Waiting for signature" : "Deposit to vault"}
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
      <nav className="app-nav">
        <Link className="brand-lockup" href="/">
          <span className="brand-glyph">S</span>
          <span>SILENCE</span>
        </Link>
        <div className="app-nav-actions">
          <div className="app-page-tabs" aria-label="App sections">
            {appNavItems.map((item) => (
              <Link className={item.view === view ? "active" : ""} href={item.href} key={item.href}>
                {item.label}
              </Link>
            ))}
          </div>
          <span className="status-pill">
            Devnet
          </span>
          <span className="status-pill">
            Tokens {formatTokenBalance(state.tokenBalance)}
          </span>
          <span className="status-pill">
            {publicKey ? shortenAddress(publicKey.toBase58()) : "Wallet"}
          </span>
          <button className="icon-action" onClick={refresh} title="Refresh devnet state">
            <RefreshCcw aria-hidden="true" size={18} />
            <span>Refresh</span>
          </button>
          <button className="button dark compact" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </nav>

      <section className="app-hero">
        <div>
          <p className="hero-kicker">Program {shortenAddress(SILENCE_PROGRAM_ID)} / Arcium {ARCIUM_DEVNET_CLUSTER_OFFSET}</p>
          <h1>{pageTitle}</h1>
          <p>{pageCopy}</p>
          {onboardingIncomplete ? (
            <button className="button neon hero-resume" type="button" onClick={resumeOnboarding}>
              Resume initialization
            </button>
          ) : null}
        </div>
        <div className="grid-portal" aria-hidden="true">
        </div>
      </section>

      {error ? (
        <div className="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="alert neutral">
          {notice}
        </div>
      ) : null}

      {loadState === "loading" ? (
        <div className="loading-row">
          Loading real devnet state...
        </div>
      ) : null}

      <section className="app-grid">
        {showDashboard ? (
        <article className="glass-panel span-2">
          <div className="panel-heading">
            <div>
              <h2>Organization</h2>
              <p>{state.organization ? "Loaded from the deployed program." : "No organization found. Initialize one to continue."}</p>
            </div>
          </div>

          {state.organization ? (
            <div className="form-grid">
              <div className="facts-grid">
                <div>
                  <span>Name</span>
                  <strong>{state.organization.name}</strong>
                </div>
                <div>
                  <span>Organization PDA</span>
                  <strong>{shortenAddress(state.organizationAddress)}</strong>
                </div>
                <div>
                  <span>Vault PDA</span>
                  <strong>{shortenAddress(state.vaultAddress)}</strong>
                </div>
                <div>
                  <span>Mint</span>
                  <strong>{shortenAddress(state.organization.usdcMint)}</strong>
                </div>
              </div>
              {!state.arciumDefinitionsReady ? (
                <button className="button dark" type="button" onClick={resumeOnboarding}>
                  Resume initialization
                </button>
              ) : null}
            </div>
          ) : (
            <div className="empty-action">
              <p className="muted">The setup flow is guided in one popup so the workspace stays clean.</p>
              <button className="button neon" type="button" onClick={resumeOnboarding}>
                Start initialization
              </button>
            </div>
          )}
        </article>
        ) : null}

        {showDashboard ? (
        <article className="glass-panel">
          <div className="panel-heading">
            <div>
              <h2>Vault</h2>
              <p>{state.organization ? "Deposit test tokens from the connected admin ATA." : "Initialize organization before vault deposits."}</p>
            </div>
          </div>
          <div className="facts-grid single">
            <div>
              <span>Admin token balance</span>
              <strong>{formatTokenBalance(state.tokenBalance)}</strong>
            </div>
          </div>
          {state.organization && state.tokenBalance !== null && state.tokenBalance <= 0 ? (
            <button className="button dark" type="button" onClick={resumeOnboarding}>
              Resume funding
            </button>
          ) : null}
        </article>
        ) : null}

        {showEmployees ? (
        <article className={view === "employees" ? "glass-panel span-2" : "glass-panel"}>
          <div className="panel-heading">
            <div>
              <h2>Employees</h2>
              <p>{state.employees.length ? `${state.employees.length} employees found.` : "No employees on-chain yet. Add an employee."}</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={addEmployee}>
            <Field label="Employee wallet">
              <input name="employeeWallet" required placeholder="Devnet wallet address" disabled={!state.organization} />
            </Field>
            <Field label="Metadata">
              <input name="metadata" required placeholder="Private metadata reference" disabled={!state.organization} />
            </Field>
            <div className="split-fields">
              <Field label="Department">
                <input name="department" required placeholder="Department reference" disabled={!state.organization} />
              </Field>
              <Field label="Role">
                <input name="role" required placeholder="Role reference" disabled={!state.organization} />
              </Field>
            </div>
            <Field label="Encrypted compensation reference seed">
              <input name="compensationReference" required placeholder="Reference, never plaintext salary" disabled={!state.organization} />
            </Field>
            <button className="button neon" disabled={!state.organization || busyAction === "employee"}>
              Add employee
            </button>
          </form>
          <div className="record-list">
            {state.employees.map((employee) => (
              <div className="record-row" key={employee.id}>
                <span>{shortenAddress(employee.wallet)}</span>
                <strong>{employee.status}</strong>
              </div>
            ))}
          </div>
        </article>
        ) : null}

        {showPayroll ? (
        <article className={view === "payroll" ? "glass-panel span-3" : "glass-panel span-2"}>
          <div className="panel-heading">
            <div>
              <h2>Payroll runs</h2>
              <p>{state.payrollRuns.length ? `${state.payrollRuns.length} runs found.` : "No payroll runs found. Create a run after adding employees."}</p>
            </div>
          </div>
          <form className="form-grid" onSubmit={createPayrollRun}>
            <div className="split-fields">
              <Field label="Period start">
                <input name="periodStart" required type="date" disabled={!state.organization} />
              </Field>
              <Field label="Period end">
                <input name="periodEnd" required type="date" disabled={!state.organization} />
              </Field>
            </div>
            <div className="split-fields">
              <Field label="Batch reference">
                <input name="batchReference" required placeholder="Encrypted batch reference/hash input" disabled={!state.organization} />
              </Field>
              <Field label="Employee count">
                <input name="employeeCount" required min="1" type="number" defaultValue={state.employees.length || 1} disabled={!state.organization} />
              </Field>
            </div>
            <div className="button-row">
              <button className="button neon" disabled={!state.organization || busyAction === "payroll"}>
                Create payroll run
              </button>
            </div>
          </form>
          <div className="record-list">
            {state.payrollRuns.map((run) => (
              <div className="record-stack" key={run.id}>
                <div className="record-row">
                  <span>{shortenAddress(run.id)}</span>
                  <strong>{run.status}</strong>
                </div>
                {run.computationId ? <p className="muted">Computation {shortenAddress(run.computationId)}</p> : null}
                {run.status === "Draft" ? (
                  <form className="form-grid compact-form" onSubmit={(event) => queuePayrollComputation(event, run)}>
                    <div className="split-fields">
                      <Field label="Gross pay">
                        <input name="grossPay" required min="0" step="0.000001" type="number" placeholder="1000" />
                      </Field>
                      <Field label="Bonus">
                        <input name="bonus" required min="0" step="0.000001" type="number" placeholder="0" />
                      </Field>
                    </div>
                    <div className="split-fields">
                      <Field label="Deductions">
                        <input name="deductions" required min="0" step="0.000001" type="number" placeholder="0" />
                      </Field>
                      <Field label="Adjustments">
                        <input name="adjustments" required min="0" step="0.000001" type="number" placeholder="0" />
                      </Field>
                    </div>
                    <button className="button neon" disabled={busyAction === "queue"}>
                      Queue Arcium computation
                    </button>
                  </form>
                ) : null}
                {run.status === "Preparing" ? (
                  <button className="button dark" type="button" disabled={busyAction === `finalize:prepare:${run.id}`} onClick={() => awaitFinalization(run, `prepare:${run.id}`)}>
                    Await prepare finalization
                  </button>
                ) : null}
                {run.status === "Prepared" ? (
                  <button className="button neon" type="button" disabled={busyAction === "validate"} onClick={() => queueValidation(run)}>
                    Queue validation
                  </button>
                ) : null}
                {run.status === "Validating" ? (
                  <button className="button dark" type="button" disabled={busyAction === `finalize:validate:${run.id}`} onClick={() => awaitFinalization(run, `validate:${run.id}`)}>
                    Await validation finalization
                  </button>
                ) : null}
                {run.status === "Validated" ? (
                  <div className="button-row">
                    {state.employees.map((employee) => (
                      <button className="button dark" key={employee.id} type="button" disabled={busyAction === "payout"} onClick={() => createPayout(employee.id, run)}>
                        Create payout {shortenAddress(employee.wallet)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {run.payouts.map((payout) => (
                  <div className="record-stack" key={payout.id}>
                    <div className="record-row">
                      <span>Payout {shortenAddress(payout.employeeWallet)}</span>
                      <strong>{payout.status}</strong>
                    </div>
                    {payout.status === "Pending" ? (
                      <button className="button neon" type="button" disabled={busyAction === "seal"} onClick={() => queueSeal(run, payout.id)}>
                        Queue paystub seal
                      </button>
                    ) : null}
                    {payout.status === "Sealing" ? (
                      <button className="button dark" type="button" disabled={busyAction === `finalize:seal:${payout.id}`} onClick={() => awaitFinalization(run, `seal:${payout.id}`)}>
                        Await paystub finalization
                      </button>
                    ) : null}
                  </div>
                ))}
                {run.status === "ReadyToPay" ? (
                  <button className="button neon" type="button" disabled={busyAction === "execute"} onClick={() => executePayroll(run)}>
                    Execute payroll
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </article>
        ) : null}

        {showActivity ? (
        <article className={view === "activity" ? "glass-panel span-2" : "glass-panel"}>
          <div className="panel-heading">
            <div>
              <h2>Transactions</h2>
              <p>{transactions.length ? "Real signatures from this session." : "No transactions sent this session."}</p>
            </div>
          </div>
          <div className="tx-list">
            {transactions.map((tx) => (
              <TxLink key={tx.signature} tx={tx} />
            ))}
          </div>
        </article>
        ) : null}
      </section>
    </main>
  );
}
