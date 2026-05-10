"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { BrowserWallet } from "@silence/sdk";

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  isConnected?: boolean;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  signAllTransactions?(transactions: Transaction[]): Promise<Transaction[]>;
  on?(event: "connect" | "disconnect" | "accountChanged", handler: (...args: unknown[]) => void): void;
  off?(event: "connect" | "disconnect" | "accountChanged", handler: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

export function usePhantomWallet() {
  const [provider, setProvider] = useState<PhantomProvider | null>(null);
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const syncProvider = useCallback((nextProvider: PhantomProvider | null) => {
    setProvider(nextProvider);
    if (nextProvider?.publicKey) {
      setPublicKey(new PublicKey(nextProvider.publicKey.toString()));
    } else {
      setPublicKey(null);
    }
  }, []);

  useEffect(() => {
    const nextProvider = typeof window !== "undefined" ? window.solana ?? null : null;
    syncProvider(nextProvider);
    if (!nextProvider) return;

    nextProvider.connect({ onlyIfTrusted: true }).then(
      (result) => setPublicKey(new PublicKey(result.publicKey.toString())),
      () => undefined
    );

    const handleConnect = () => {
      if (nextProvider.publicKey) setPublicKey(new PublicKey(nextProvider.publicKey.toString()));
    };
    const handleDisconnect = () => setPublicKey(null);
    const handleAccountChanged = () => {
      if (nextProvider.publicKey) {
        setPublicKey(new PublicKey(nextProvider.publicKey.toString()));
      } else {
        setPublicKey(null);
      }
    };

    nextProvider.on?.("connect", handleConnect);
    nextProvider.on?.("disconnect", handleDisconnect);
    nextProvider.on?.("accountChanged", handleAccountChanged);
    return () => {
      nextProvider.off?.("connect", handleConnect);
      nextProvider.off?.("disconnect", handleDisconnect);
      nextProvider.off?.("accountChanged", handleAccountChanged);
    };
  }, [syncProvider]);

  const connect = useCallback(async () => {
    const nextProvider = typeof window !== "undefined" ? window.solana ?? null : null;
    syncProvider(nextProvider);
    if (!nextProvider) {
      setError("Phantom wallet was not found. Install Phantom and switch it to devnet.");
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      const result = await nextProvider.connect();
      setPublicKey(new PublicKey(result.publicKey.toString()));
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  }, [syncProvider]);

  const disconnect = useCallback(async () => {
    await provider?.disconnect();
    setPublicKey(null);
  }, [provider]);

  const wallet = useMemo<BrowserWallet | null>(() => {
    if (!provider || !publicKey) return null;
    return {
      publicKey,
      signTransaction: (transaction) => provider.signTransaction(transaction),
      signAllTransactions: async (transactions) => {
        if (provider.signAllTransactions) return provider.signAllTransactions(transactions);
        const signed: Transaction[] = [];
        for (const transaction of transactions) {
          signed.push(await provider.signTransaction(transaction));
        }
        return signed;
      }
    };
  }, [provider, publicKey]);

  return {
    provider,
    publicKey,
    wallet,
    connecting,
    connected: Boolean(publicKey),
    error,
    connect,
    disconnect
  };
}
