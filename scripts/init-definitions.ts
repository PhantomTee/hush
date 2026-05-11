/**
 * Platform bootstrap: initialize Arcium computation definitions, upload circuit
 * files, and finalize so employers can queue payroll computations.
 *
 * Must be run with the MXE authority keypair (deployer wallet).
 * After this runs once, any employer wallet can use the app normally.
 *
 * Usage (from WSL):
 *   npx tsx scripts/init-definitions.ts
 *   npx tsx scripts/init-definitions.ts /path/to/custom-keypair.json
 */

import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { uploadCircuit } from "@arcium-hq/client";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { SilenceDevnetClient, SILENCE_DEVNET_RPC, SILENCE_PROGRAM_ID } from "@silence/sdk";

// Use a less rate-limited RPC for the high-volume circuit upload (1200+ txs)
const UPLOAD_RPC = "https://rpc.ankr.com/solana_devnet";

// ── Keypair ────────────────────────────────────────────────────────────────

const keypairPath = process.argv[2] ?? join(homedir(), ".config", "solana", "id.json");

if (!existsSync(keypairPath)) {
  console.error(`Keypair file not found: ${keypairPath}`);
  process.exit(1);
}

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf-8")) as number[])
);

// ── Anchor provider ────────────────────────────────────────────────────────

const connection = new Connection(SILENCE_DEVNET_RPC, "confirmed");
const anchorWallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, anchorWallet, { commitment: "confirmed" });

// Wrap keypair as a BrowserWallet-compatible signer for SilenceDevnetClient
const wallet = {
  publicKey: keypair.publicKey,
  signTransaction: async (tx: any) => { tx.sign(keypair); return tx; },
  signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.sign(keypair)); return txs; },
};

const programId = new PublicKey(SILENCE_PROGRAM_ID);
const client = new SilenceDevnetClient(wallet as any, { rpcUrl: SILENCE_DEVNET_RPC });

// ── Circuit files ──────────────────────────────────────────────────────────

const circuits = [
  "prepare_payroll_run",
  "validate_payroll_run",
  "seal_employee_paystub",
] as const;

const buildDir = resolve(process.cwd(), "build");

console.log(`Wallet  : ${keypair.publicKey.toBase58()}`);
console.log(`RPC     : ${SILENCE_DEVNET_RPC}`);
console.log(`Program : ${SILENCE_PROGRAM_ID}`);
console.log("");

async function main() {
  // ── Step 1: Initialize computation definition accounts ─────────────────

  const status = await client.getArciumDefinitionsStatus();

  if (!status.initialized) {
    console.log("Step 1/2  Initializing computation definition accounts...");
    const result = await client.initializeArciumDefinitions();
    if (result) {
      console.log(`          Signature : ${result.signature}`);
      console.log(`          Explorer  : ${result.explorerUrl}`);
    } else {
      console.log("          Accounts already existed.");
    }
  } else {
    console.log("Step 1/2  Definition accounts already initialized — skipping.");
  }

  console.log("");

  // ── Step 2: Upload + finalize circuit bytes ────────────────────────────

  console.log("Step 2/2  Uploading and finalizing circuit files...");

  for (const circuit of circuits) {
    const arcisPath = join(buildDir, `${circuit}.arcis`);

    if (!existsSync(arcisPath)) {
      console.error(`          ERROR: ${arcisPath} not found. Run the Arcium build first.`);
      process.exit(1);
    }

    const rawCircuit = new Uint8Array(readFileSync(arcisPath));
    console.log(`          ${circuit} (${rawCircuit.length} bytes)...`);

    // chunkSize=1: send one tx at a time — avoids 429 rate limits on public devnet RPC
    const sigs = await uploadCircuit(provider, circuit, programId, rawCircuit, true, 1);

    if (sigs.length === 0) {
      console.log(`          Already finalized — skipped.`);
    } else {
      console.log(`          Done. ${sigs.length} transaction(s).`);
      console.log(`          Last: https://explorer.solana.com/tx/${sigs[sigs.length - 1]}?cluster=devnet`);
    }
  }

  console.log("");
  console.log("Bootstrap complete.");
  console.log("Any employer wallet can now create an organization and run payroll computations.");
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
