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
            <span>Silence</span>
          </div>
          <div className="landing-links">
            <a href="#about">Who we are</a>
            <a href="#program">Our work</a>
            <a href="#price">What we do</a>
            <a href="#why-us">Why us</a>
          </div>
          {connected ? (
            <Link className="nav-cta" href="/app">
              Enter app
            </Link>
          ) : (
            <button className="nav-cta" onClick={connect} disabled={connecting}>
              {connecting ? "Connecting" : "Connect"}
            </button>
          )}
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
            Amounts are submitted as encrypted references and hashes.
            The interface starts empty until real devnet data exists.
          </p>
        </div>
        <div id="about">
          <h2>Wallet gated</h2>
          <p>
            {connected && publicKey
              ? `Connected as ${shortenAddress(publicKey.toBase58())}.`
              : "Connect Phantom on devnet to enter the app."}
          </p>
        </div>
        <div id="price">
          <h2>Live devnet</h2>
          <p>
            Program {shortenAddress(SILENCE_PROGRAM_ID)} on Arcium offset {ARCIUM_DEVNET_CLUSTER_OFFSET}.
          </p>
        </div>
        <div id="why-us">
          <h2>No demo layer</h2>
          <p>
            Every dashboard state is fetched from devnet or created by a signed wallet transaction.
          </p>
        </div>
      </section>
    </main>
  );
}
