"use client";

import Link from "next/link";
import { useState } from "react";
import { ARCIUM_DEVNET_CLUSTER_OFFSET, SILENCE_PROGRAM_ID, shortenAddress } from "./config";
import { usePhantomWallet } from "./wallet";
import { useTheme } from "./theme";

export default function LandingPage() {
  const { connected, connecting, publicKey, error, connect } = usePhantomWallet();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className="landing-shell">
      {menuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMenuOpen(false)}>
          <div className="mobile-menu-header" onClick={(e) => e.stopPropagation()}>
            <div className="brand-lockup">
              <span>Silence</span>
            </div>
            <button className="mobile-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
              ✕
            </button>
          </div>
          <nav className="mobile-menu-links" onClick={(e) => e.stopPropagation()}>
            <a href="#program" onClick={() => setMenuOpen(false)}>Who we are</a>
            <a href="#about" onClick={() => setMenuOpen(false)}>Our work</a>
            <a href="#price" onClick={() => setMenuOpen(false)}>What we do</a>
            <a href="#why-us" onClick={() => setMenuOpen(false)}>Why us</a>
            <div className="mobile-menu-divider" />
            {connected ? (
              <Link href="/app" onClick={() => setMenuOpen(false)}>Enter app</Link>
            ) : (
              <button onClick={() => { connect(); setMenuOpen(false); }} disabled={connecting}>
                {connecting ? "Connecting" : "Connect wallet"}
              </button>
            )}
            <button onClick={toggle}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </nav>
        </div>
      )}

      <section className="landing-frame">
        <nav className="landing-nav" aria-label="Primary">
          <div className="brand-lockup">
            <span>Silence</span>
          </div>
          <div className="landing-links">
            <a href="#about">Who we are</a>
            <a href="#program">Our work</a>
            <a href="#price">What we do</a>
            <a href="#why-us">Why us</a>
          </div>
          <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          {connected ? (
            <Link className="nav-cta" href="/app">
              Enter app
            </Link>
          ) : (
            <button className="nav-cta" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting" : "Connect"}
            </button>
          )}
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

        <section className="hero-stage">
          <div className="hero-copy-block">
            <p className="hero-kicker">Solana devnet / Arcium MXE active</p>
            <h1>
              Private<br />
              Payroll<br />
              Onchain.
            </h1>
          </div>

          <div className="hero-bottom">
            <div>
              <p className="hero-copy">
                Private payroll infrastructure shaping how teams pay people onchain.
                Encrypted records, wallet-gated access, and zero demo layer.
              </p>
              <div className="hero-inline-actions">
                {connected ? (
                  <Link className="button neon" href="/app">
                    Enter app
                  </Link>
                ) : (
                  <button className="button neon" onClick={connect} disabled={connecting}>
                    {connecting ? "Connecting" : "Connect wallet"}
                  </button>
                )}
                <a className="button dark" href="#program">
                  See how it works
                </a>
              </div>
            </div>

            <div className="hero-card" aria-hidden="true">
              <span className="hero-card-label">Live devnet</span>
              <p className="hero-card-title">
                Arcium<br />
                MXE Active
              </p>
              <p className="hero-card-meta">
                {shortenAddress(SILENCE_PROGRAM_ID)}<br />
                Arcium offset {ARCIUM_DEVNET_CLUSTER_OFFSET}
              </p>
            </div>
          </div>
        </section>

        {error ? <p className="landing-error">{error}</p> : null}
      </section>

      <section className="landing-info" id="program">
        <div>
          <h2>Encrypted records</h2>
          <p>
            Gross pay, bonuses, and deductions are processed inside Arcium's MXE secure enclaves.
            Salary amounts never appear in plaintext on-chain. Only cryptographic commitments and
            sealed paystubs reach the Solana ledger, verifiable by authorized parties and invisible
            to everyone else.
          </p>
        </div>
        <div id="about">
          <h2>Wallet gated</h2>
          <p>
            {connected && publicKey
              ? `Connected as ${shortenAddress(publicKey.toBase58())}. Your wallet is the admin authority for this organization. Employees are on-chain records tied to their own Solana wallets, with no email, no password, and no custodian.`
              : "Your Phantom wallet on Solana devnet is the admin key. No usernames or passwords. Every sensitive action requires a signed transaction from the wallet that owns the organization PDA."}
          </p>
        </div>
        <div id="price">
          <h2>Live devnet</h2>
          <p>
            Program {shortenAddress(SILENCE_PROGRAM_ID)} is deployed to Solana devnet with the
            Arcium MXE live at cluster offset {ARCIUM_DEVNET_CLUSTER_OFFSET}. Every payroll run
            queues a real off-chain computation that commits its sealed result back to the chain.
          </p>
        </div>
        <div id="why-us">
          <h2>No demo layer</h2>
          <p>
            There are no seeded records, mock balances, or placeholder states. If the dashboard
            looks empty, it means no on-chain data exists yet. Every employee, payroll run, and
            vault deposit is the result of a real signed transaction confirmed on Solana devnet.
          </p>
        </div>
      </section>
    </main>
  );
}
