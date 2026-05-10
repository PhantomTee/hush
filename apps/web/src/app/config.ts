export const SILENCE_PROGRAM_ID = "FdBmwEbm8MbJZnuFEEvtdbZDGh4vrthsLhFaZ6eFmGsb";
export const SILENCE_DEVNET_RPC = "https://api.devnet.solana.com";
export const ARCIUM_DEVNET_CLUSTER_OFFSET = 456;

export function shortenAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
