"use client";

import Link from "next/link";
import { ARCIUM_DEVNET_CLUSTER_OFFSET, SILENCE_PROGRAM_ID, shortenAddress } from "./config";
import { usePhantomWallet } from "./wallet";

export default function LandingPage() {
  const { connected, connecting, publicKey, error, connect } = usePhantomWallet();

  return (
    <main className="landing-shell">
      <section className="landing-frame">
        <nav className="landing-nav" aria-label="Primary">
          <div className="brand-lockup">
            <span className="brand-glyph" aria-hidden="true">
              S
            </span>
            <span>SILENCE</span>
          </div>
          <div className="landing-links">
            <a href="#program">Program</a>
            <a href="#price">Devnet</a>
            <a href="#about">About</a>
          </div>
          {connected ? (
            <Link className="nav-cta" href="/app">
              Log in
            </Link>
          ) : (
            <button className="nav-cta" onClick={connect} disabled={connecting}>
              Log in
            </button>
          )}
        </nav>

        <section className="hero-stage">
          <div className="hero-copy-block">
            <p className="hero-kicker">Solana devnet / Arcium MXE active</p>
            <h1>
              PRIVATE
              <span>PAYROLL</span>
              ONCHAIN
            </h1>
            <div className="hero-slash one" aria-hidden="true" />
            <div className="hero-slash two" aria-hidden="true" />
            <p className="hero-copy">
              Wallet-gated payroll with encrypted compensation logic, real devnet settlement, and no demo records.
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
              <a className="video-link" href="#program">
                <span>Play</span>
                Watch flow
              </a>
            </div>
          </div>

          <div className="hero-tunnel" aria-hidden="true">
            <div />
          </div>
        </section>

        {error ? <p className="landing-error">{error}</p> : null}
      </section>

      <section className="landing-info" id="program">
        <div>
          <h2>Encrypted records</h2>
          <p>Amounts are submitted as encrypted references and hashes; the interface starts empty until real devnet data exists.</p>
        </div>
        <div id="about">
          <h2>Wallet gated</h2>
          <p>{connected && publicKey ? `Connected as ${shortenAddress(publicKey.toBase58())}.` : "Connect Phantom on devnet to enter the app."}</p>
        </div>
        <div id="price">
          <h2>Live devnet</h2>
          <p>
            Program {shortenAddress(SILENCE_PROGRAM_ID)} / Arcium offset {ARCIUM_DEVNET_CLUSTER_OFFSET}.
          </p>
        </div>
      </section>
    </main>
  );
}
