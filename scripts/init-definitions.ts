/**
 * One-off platform bootstrap: initialize Arcium computation definitions.
 *
 * Must be run with the MXE authority keypair (deployer wallet).
 * After this runs once, any employer wallet can use the app normally.
 *
 * Usage (from WSL):
 *   npx tsx scripts/init-definitions.ts
 *   npx tsx scripts/init-definitions.ts /path/to/custom-keypair.json
 */

import { Keypair } from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { SilenceDevnetClient, SILENCE_DEVNET_RPC } from "@silence/sdk";

// Load keypair — defaults to ~/.config/solana/id.json (WSL deployer wallet)
const keypairPath = process.argv[2] ?? join(homedir(), ".config", "solana", "id.json");

if (!existsSync(keypairPath)) {
  console.error(`Keypair file not found: ${keypairPath}`);
  console.error(`Pass a custom path as the first argument, e.g.:`);
  console.error(`  npx tsx scripts/init-definitions.ts ~/my-wallet.json`);
  process.exit(1);
}

const keypair = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf-8")) as number[])
);

// Wrap keypair as a BrowserWallet-compatible signer
const wallet = {
  publicKey: keypair.publicKey,
  signTransaction: async (tx: any) => {
    tx.sign(keypair);
    return tx;
  },
  signAllTransactions: async (txs: any[]) => {
    txs.forEach((tx) => tx.sign(keypair));
    return txs;
  },
};

console.log(`Wallet : ${keypair.publicKey.toBase58()}`);
console.log(`RPC    : ${SILENCE_DEVNET_RPC}`);
console.log("");

const client = new SilenceDevnetClient(wallet as any, { rpcUrl: SILENCE_DEVNET_RPC });

async function main() {
  // Quick check first — skip everything if already done
  const status = await client.getArciumDefinitionsStatus();
  if (status.initialized) {
    console.log("Arcium definitions already initialized. Nothing to do.");
    return;
  }

  console.log("Initializing Arcium computation definitions...");
  const result = await client.initializeArciumDefinitions();

  if (result) {
    console.log("\nDone!");
    console.log(`Signature : ${result.signature}`);
    console.log(`Explorer  : ${result.explorerUrl}`);
    console.log("");
    console.log("Any employer wallet can now create an organization and run payroll.");
  } else {
    console.log("All definitions already existed. Nothing to do.");
  }
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
