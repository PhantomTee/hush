import { AnchorProvider, BN, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import {
  awaitComputationFinalization,
  deserializeLE,
  getClockAccAddress,
  getClusterAccAddress,
  getArciumProgram,
  getArciumProgramId,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getLookupTableAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
  getMXEPublicKey,
  RescueCipher
} from "@arcium-hq/client";
import { x25519 } from "@noble/curves/ed25519";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import {
  Connection,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  type Signer,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  type TransactionSignature
} from "@solana/web3.js";
import type { EmployeeRecord, Organization, PayrollPayoutRecord, PayrollRun, PayrollRunStatus, PublicKeyString } from "@silence/shared";

export const SILENCE_PROGRAM_ID = "FdBmwEbm8MbJZnuFEEvtdbZDGh4vrthsLhFaZ6eFmGsb";
export const SILENCE_DEVNET_RPC = "https://api.devnet.solana.com";
export const SILENCE_DEVNET_WS = "wss://api.devnet.solana.com";
export const ARCIUM_DEVNET_CLUSTER_OFFSET = 456;

export interface BrowserWallet {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  signAllTransactions(transactions: Transaction[]): Promise<Transaction[]>;
}

export interface DevnetClientConfig {
  rpcUrl?: string;
  wsUrl?: string;
  programId?: PublicKeyString;
}

export interface ExplorerTransaction {
  signature: TransactionSignature;
  explorerUrl: string;
}

export interface OrganizationState {
  address: string;
  vault: string;
  account: Organization | null;
}

export interface TokenMintResult extends ExplorerTransaction {
  mint: string;
  adminTokenAccount: string;
  amountUi: number;
}

export interface InitializeOrganizationResult extends ExplorerTransaction {
  organization: string;
  vault: string;
}

export interface EmployeeResult extends ExplorerTransaction {
  employee: string;
}

export interface PayrollRunResult extends ExplorerTransaction {
  payrollRun: string;
  batchSeed: string;
}

export interface QueuePayrollComputationInput {
  organization: string;
  payrollRun: string;
  batchHash: string;
  grossPayUi: number;
  bonusUi: number;
  deductionsUi: number;
  adjustmentsUi: number;
  decimals?: number;
}

export interface QueuePayrollComputationResult extends ExplorerTransaction {
  computationAccount: string;
  computationOffset: string;
}

export interface CreatePayrollPayoutResult extends ExplorerTransaction {
  payout: string;
}

export interface PayrollFinalizationResult {
  signature: TransactionSignature;
  explorerUrl: string;
  payrollRun: PayrollRun;
}

export interface ActionUnavailable {
  available: false;
  reason: string;
}

export function explorerUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function shortenAddress(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function unixSeconds(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error("Date must be a valid ISO date.");
  }
  return Math.floor(ms / 1000);
}

async function sha256Bytes(value: string, length: 16 | 32 = 32) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, length);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function hexFromBytes(value: Iterable<number>) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value: string, expectedLength: number) {
  const clean = value.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length !== expectedLength * 2) {
    throw new Error(`Expected a ${expectedLength}-byte hex value.`);
  }
  const bytes = [];
  for (let index = 0; index < clean.length; index += 2) {
    bytes.push(Number.parseInt(clean.slice(index, index + 2), 16));
  }
  return bytes;
}

function readU32LE(bytes: Uint8Array) {
  if (bytes.length < 4) throw new Error("Expected at least four bytes.");
  return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
}

function uiAmountToTokenUnits(value: number, decimals = 6) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Payroll amount must be a non-negative number.");
  }
  const raw = Math.round(value * 10 ** decimals);
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new Error("Payroll amount is too large for a devnet token transaction.");
  }
  return BigInt(raw);
}

function uiAmountToRawString(value: number, decimals = 6) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Amount must be a valid positive number.");
  }
  const raw = Math.round(value * 10 ** decimals);
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error("Amount is too large for a devnet token transaction.");
  }
  return raw.toString();
}

function boundedU32(value: number, label: string) {
  if (!Number.isInteger(value) || value <= 0 || value > 4_294_967_295) {
    throw new Error(`${label} must be a positive whole number.`);
  }
  return value;
}

function randomComputationOffset() {
  const bytes = randomBytes(4);
  const value = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  return new BN(value || 1);
}

function devnetWsEndpoint(rpcUrl: string) {
  if (rpcUrl === SILENCE_DEVNET_RPC) return SILENCE_DEVNET_WS;
  if (rpcUrl.startsWith("https://")) return `wss://${rpcUrl.slice("https://".length)}`;
  if (rpcUrl.startsWith("http://")) return `ws://${rpcUrl.slice("http://".length)}`;
  return SILENCE_DEVNET_WS;
}

function isBlockhashExpiry(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("block height exceeded") || message.includes("blockhash") || message.includes("expired");
}

async function sendWithFreshBlockhash(
  connection: Connection,
  wallet: BrowserWallet,
  transaction: Transaction,
  signers: Signer[] = []
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  if (signers.length) transaction.partialSign(...signers);

  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    maxRetries: 5,
    preflightCommitment: "confirmed",
    skipPreflight: false
  });

  try {
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  } catch (error) {
    if (isBlockhashExpiry(error)) {
      throw new Error(
        "The transaction expired before devnet confirmed it. Nothing was finalized; please retry the action and approve Phantom promptly."
      );
    }
    throw error;
  }

  return signature;
}

function mapStatus(status: unknown): PayrollRunStatus {
  if (!status || typeof status !== "object") return "Draft";
  const key = Object.keys(status as Record<string, unknown>)[0] ?? "draft";
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return label as PayrollRunStatus;
}

function toOrganization(address: PublicKey, raw: any): Organization {
  return {
    id: address.toBase58(),
    name: raw.name,
    admin: raw.admin.toBase58(),
    usdcMint: raw.usdcMint.toBase58(),
    vault: raw.vault.toBase58(),
    vaultBalance: 0,
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString()
  };
}

function readI64LE(bytes: Uint8Array, offset: number) {
  return Number(new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getBigInt64(0, true));
}

function readU32LEFromBytes(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function decodeOrganizationAccount(address: PublicKey, data: Uint8Array): Organization | null {
  const discriminator = [145, 38, 152, 251, 91, 57, 118, 160];
  if (data.length < 113 || !discriminator.every((byte, index) => data[index] === byte)) return null;

  let offset = 8;
  const admin = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const usdcMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const vault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const nameLength = readU32LEFromBytes(data, offset);
  offset += 4;
  if (offset + nameLength + 9 > data.length) return null;
  const name = new TextDecoder().decode(data.slice(offset, offset + nameLength));
  offset += nameLength;
  offset += 1;
  const createdAt = readI64LE(data, offset);

  return {
    id: address.toBase58(),
    name,
    admin: admin.toBase58(),
    usdcMint: usdcMint.toBase58(),
    vault: vault.toBase58(),
    vaultBalance: 0,
    createdAt: new Date(createdAt * 1000).toISOString()
  };
}

function toEmployee(address: PublicKey, raw: any): EmployeeRecord {
  return {
    id: address.toBase58(),
    wallet: raw.wallet.toBase58(),
    status: mapStatus(raw.status) as EmployeeRecord["status"],
    metadataHash: hexFromBytes(raw.metadataHash),
    departmentHash: hexFromBytes(raw.departmentHash),
    roleHash: hexFromBytes(raw.roleHash),
    encryptedCompensationRef: {
      owner: raw.encryptedCompensationRef.owner.shared !== undefined ? "Shared" : "Mxe",
      nonce: hexFromBytes(raw.encryptedCompensationRef.nonce),
      ciphertext: hexFromBytes(raw.encryptedCompensationRef.ciphertextHash),
      encoding: "arcium"
    },
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString(),
    updatedAt: new Date(Number(raw.updatedAt) * 1000).toISOString()
  };
}

function toPayrollRun(address: PublicKey, raw: any): PayrollRun {
  const computationId =
    raw.computationAccount?.toBase58?.() ??
    raw.prepareComputationAccount?.toBase58?.() ??
    raw.validateComputationAccount?.toBase58?.() ??
    raw.sealComputationAccount?.toBase58?.();
  return {
    id: address.toBase58(),
    organizationId: raw.organization.toBase58(),
    periodStart: new Date(Number(raw.periodStart) * 1000).toISOString(),
    periodEnd: new Date(Number(raw.periodEnd) * 1000).toISOString(),
    batchHash: hexFromBytes(raw.batchHash),
    employeeCount: raw.employeeCount,
    status: mapStatus(raw.status),
    encryptedAggregateNetPay: undefined,
    computationId,
    callbackSignature: raw.callbackSignature ? hexFromBytes(raw.callbackSignature) : undefined,
    payouts: [],
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString(),
    updatedAt: new Date(Number(raw.updatedAt) * 1000).toISOString()
  };
}

function sharedEncryptedToField(raw: any) {
  if (!raw) return undefined;
  const owner = raw.owner?.shared !== undefined ? "Shared" : "Mxe";
  return {
    owner: owner as "Shared" | "Mxe",
    nonce: Number(raw.nonce).toString(16),
    ciphertext: hexFromBytes(raw.ciphertextHashes?.[0] ?? []),
    encoding: "arcium" as const
  };
}

function toPayout(address: PublicKey, raw: any): PayrollPayoutRecord {
  return {
    id: address.toBase58(),
    payrollRunId: raw.payrollRun.toBase58(),
    employeeId: raw.employee.toBase58(),
    employeeWallet: raw.employeeWallet.toBase58(),
    encryptedNetPay: sharedEncryptedToField(raw.encryptedNetPay),
    status: mapStatus(raw.status) as PayrollPayoutRecord["status"],
    signature: raw.signature ? hexFromBytes(raw.signature) : undefined,
    createdAt: raw.createdAt ? new Date(Number(raw.createdAt) * 1000).toISOString() : undefined,
    updatedAt: raw.updatedAt ? new Date(Number(raw.updatedAt) * 1000).toISOString() : undefined
  };
}

function arciumAccounts(programId: PublicKey, computationOffset: BN, circuitName: string) {
  const compDefOffset = readU32LE(getCompDefAccOffset(circuitName));
  return {
    mxeAccount: getMXEAccAddress(programId),
    mempoolAccount: getMempoolAccAddress(ARCIUM_DEVNET_CLUSTER_OFFSET),
    executingPool: getExecutingPoolAccAddress(ARCIUM_DEVNET_CLUSTER_OFFSET),
    computationAccount: getComputationAccAddress(ARCIUM_DEVNET_CLUSTER_OFFSET, computationOffset),
    compDefAccount: getCompDefAccAddress(programId, compDefOffset),
    clusterAccount: getClusterAccAddress(ARCIUM_DEVNET_CLUSTER_OFFSET),
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
    systemProgram: SystemProgram.programId
  };
}

function arciumCompDefAccount(programId: PublicKey, circuitName: string) {
  return getCompDefAccAddress(programId, readU32LE(getCompDefAccOffset(circuitName)));
}

function toBn(value: unknown) {
  if (BN.isBN(value)) return value;
  if (typeof value === "number") return new BN(value);
  if (typeof value === "bigint") return new BN(value.toString());
  if (value && typeof value === "object" && "toString" in value) return new BN(value.toString());
  return new BN(0);
}

async function arciumDefinitionAccounts(provider: AnchorProvider, programId: PublicKey, circuitName: string) {
  const arcium = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(programId);
  const mxe = (await arcium.account.mxeAccount.fetch(mxeAccount)) as any;
  const lutOffsetSlot = toBn(mxe.lutOffsetSlot ?? mxe.lut_offset_slot);
  return {
    mxeAccount,
    compDefAccount: arciumCompDefAccount(programId, circuitName),
    addressLookupTable: getLookupTableAddress(programId, lutOffsetSlot),
    lutProgram: AddressLookupTableProgram.programId,
    arciumProgram: getArciumProgramId(),
    systemProgram: SystemProgram.programId
  };
}

function encryptValues(values: bigint[], mxePublicKey: Uint8Array) {
  const clientPrivateKey = x25519.utils.randomSecretKey();
  const clientPublicKey = x25519.getPublicKey(clientPrivateKey);
  const cipher = new RescueCipher(x25519.getSharedSecret(clientPrivateKey, mxePublicKey));
  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt(values, nonce);
  return { clientPublicKey, nonce, ciphertext };
}

async function getMXEPublicKeyWithRetry(provider: AnchorProvider, programId: PublicKey) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const key = await getMXEPublicKey(provider, programId);
    if (key) return key;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Unable to fetch the Arcium MXE public key from devnet.");
}

export class SilenceDevnetClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  private programPromise: Promise<Program> | null = null;

  constructor(
    private readonly wallet: BrowserWallet,
    config: DevnetClientConfig = {}
  ) {
    const rpcUrl = config.rpcUrl ?? SILENCE_DEVNET_RPC;
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: config.wsUrl ?? devnetWsEndpoint(rpcUrl)
    });
    this.programId = new PublicKey(config.programId ?? SILENCE_PROGRAM_ID);
  }

  static organizationPda(admin: PublicKey, programId = new PublicKey(SILENCE_PROGRAM_ID)) {
    return PublicKey.findProgramAddressSync([new TextEncoder().encode("organization"), admin.toBytes()], programId);
  }

  static vaultPda(organization: PublicKey, programId = new PublicKey(SILENCE_PROGRAM_ID)) {
    return PublicKey.findProgramAddressSync([new TextEncoder().encode("vault"), organization.toBytes()], programId);
  }

  static employeePda(organization: PublicKey, employeeWallet: PublicKey, programId = new PublicKey(SILENCE_PROGRAM_ID)) {
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("employee"), organization.toBytes(), employeeWallet.toBytes()],
      programId
    );
  }

  static payrollRunPda(organization: PublicKey, batchSeed: PublicKey, programId = new PublicKey(SILENCE_PROGRAM_ID)) {
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("payroll_run"), organization.toBytes(), batchSeed.toBytes()],
      programId
    );
  }

  static payoutPda(payrollRun: PublicKey, employee: PublicKey, programId = new PublicKey(SILENCE_PROGRAM_ID)) {
    return PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("payout"), payrollRun.toBytes(), employee.toBytes()],
      programId
    );
  }

  provider() {
    return new AnchorProvider(this.connection, this.wallet as unknown as Wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed"
    });
  }

  async program() {
    if (!this.programPromise) {
      this.programPromise = (async () => {
        const idl = await Program.fetchIdl(this.programId, this.provider());
        if (!idl) {
          throw new Error("Unable to fetch SILENCE IDL from devnet.");
        }
        return new Program(idl as Idl, this.provider());
      })();
    }
    return this.programPromise;
  }

  async getSolBalance() {
    return (await this.connection.getBalance(this.wallet.publicKey, "confirmed")) / 1_000_000_000;
  }

  async getAdminTokenBalance(mint: string, decimals = 6) {
    try {
      const adminTokenAccount = getAssociatedTokenAddressSync(new PublicKey(mint), this.wallet.publicKey);
      const account = await this.connection.getAccountInfo(adminTokenAccount, "confirmed");
      if (!account) return 0;
      const balance = await this.connection.getTokenAccountBalance(adminTokenAccount, "confirmed");
      const amount = Number(balance.value.amount) / 10 ** decimals;
      return Number.isFinite(amount) ? amount : 0;
    } catch {
      return 0;
    }
  }

  async getArciumDefinitionsStatus() {
    const circuits = ["prepare_payroll_run", "validate_payroll_run", "seal_employee_paystub"];
    const states = await Promise.all(
      circuits.map(async (circuit) => {
        const account = arciumCompDefAccount(this.programId, circuit);
        return { circuit, exists: Boolean(await this.connection.getAccountInfo(account, "confirmed")) };
      })
    );
    return {
      initialized: states.every((state) => state.exists),
      missing: states.filter((state) => !state.exists).map((state) => state.circuit)
    };
  }

  async getOrganization(): Promise<OrganizationState> {
    const program = await this.program();
    const [organization] = SilenceDevnetClient.organizationPda(this.wallet.publicKey, this.programId);
    const [vault] = SilenceDevnetClient.vaultPda(organization, this.programId);
    let raw: any = null;
    try {
      raw = await (program.account as any).organization.fetchNullable(organization);
    } catch {
      raw = null;
    }
    const account = raw ? toOrganization(organization, raw) : null;
    if (!account) {
      const accountInfo = await this.connection.getAccountInfo(organization, "confirmed");
      if (accountInfo?.owner.equals(this.programId)) {
        const decoded = decodeOrganizationAccount(organization, accountInfo.data);
        if (decoded) {
          return {
            address: organization.toBase58(),
            vault: vault.toBase58(),
            account: decoded
          };
        }
      }
    }
    return {
      address: organization.toBase58(),
      vault: vault.toBase58(),
      account
    };
  }

  async listEmployees(organization: string): Promise<EmployeeRecord[]> {
    const program = await this.program();
    const accounts = await (program.account as any).employee.all([
      {
        memcmp: {
          offset: 8,
          bytes: organization
        }
      }
    ]);
    return accounts.map((entry: any) => toEmployee(entry.publicKey, entry.account));
  }

  async listPayrollRuns(organization: string): Promise<PayrollRun[]> {
    const program = await this.program();
    const accounts = await (program.account as any).payrollRun.all([
      {
        memcmp: {
          offset: 8,
          bytes: organization
        }
      }
    ]);
    const runs = accounts.map((entry: any) => toPayrollRun(entry.publicKey, entry.account));
    const payoutsByRun = await Promise.all(runs.map((run: PayrollRun) => this.listPayouts(run.id)));
    return runs.map((run: PayrollRun, index: number) => ({ ...run, payouts: payoutsByRun[index] }));
  }

  async listPayouts(payrollRun: string): Promise<PayrollPayoutRecord[]> {
    const program = await this.program();
    const accounts = await (program.account as any).payrollPayout.all([
      {
        memcmp: {
          offset: 8,
          bytes: payrollRun
        }
      }
    ]);
    return accounts.map((entry: any) => toPayout(entry.publicKey, entry.account));
  }

  async getPayrollRun(payrollRun: string): Promise<PayrollRun | null> {
    const program = await this.program();
    const address = new PublicKey(payrollRun);
    const raw = await (program.account as any).payrollRun.fetchNullable(address);
    if (!raw) return null;
    return { ...toPayrollRun(address, raw), payouts: await this.listPayouts(payrollRun) };
  }

  async createTestMint(amountUi = 100_000, decimals = 6): Promise<TokenMintResult> {
    if (!Number.isFinite(amountUi) || amountUi <= 0) {
      throw new Error("Mint amount must be a valid positive number.");
    }
    const mint = Keypair.generate();
    const lamports = await this.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const adminTokenAccount = getAssociatedTokenAddressSync(mint.publicKey, this.wallet.publicKey);
    const amount = BigInt(uiAmountToRawString(amountUi, decimals));

    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: this.wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID
      }),
      createInitializeMintInstruction(mint.publicKey, decimals, this.wallet.publicKey, this.wallet.publicKey),
      createAssociatedTokenAccountInstruction(this.wallet.publicKey, adminTokenAccount, this.wallet.publicKey, mint.publicKey),
      createMintToInstruction(mint.publicKey, adminTokenAccount, this.wallet.publicKey, amount)
    );

    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction, [mint]);

    return {
      signature,
      explorerUrl: explorerUrl(signature),
      mint: mint.publicKey.toBase58(),
      adminTokenAccount: adminTokenAccount.toBase58(),
      amountUi
    };
  }

  async initializeOrganization(name: string, mint: string): Promise<InitializeOrganizationResult> {
    const existing = await this.getOrganization();
    if (existing.account) {
      throw new Error("Organization is already initialized. Refresh or resume the next initialization step.");
    }
    const program = await this.program();
    const [organization, bump] = SilenceDevnetClient.organizationPda(this.wallet.publicKey, this.programId);
    const [vault] = SilenceDevnetClient.vaultPda(organization, this.programId);
    const transaction = await (program.methods as any)
      .initializeOrganization(name, bump)
      .accountsStrict({
        admin: this.wallet.publicKey,
        usdcMint: new PublicKey(mint),
        organization,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);

    return {
      signature,
      explorerUrl: explorerUrl(signature),
      organization: organization.toBase58(),
      vault: vault.toBase58()
    };
  }

  async addEmployee(input: {
    organization: string;
    employeeWallet: string;
    metadata: string;
    department: string;
    role: string;
    compensationReference: string;
  }): Promise<EmployeeResult> {
    const program = await this.program();
    const organization = new PublicKey(input.organization);
    const employeeWallet = new PublicKey(input.employeeWallet);
    const [employee] = SilenceDevnetClient.employeePda(organization, employeeWallet, this.programId);
    const encryptedCompensationRef = {
      owner: { shared: {} },
      nonce: await sha256Bytes(`nonce:${input.compensationReference}`, 16),
      ciphertextHash: await sha256Bytes(input.compensationReference, 32)
    };
    const transaction = await (program.methods as any)
      .addEmployee(
        await sha256Bytes(input.metadata, 32),
        await sha256Bytes(input.department, 32),
        await sha256Bytes(input.role, 32),
        encryptedCompensationRef
      )
      .accountsStrict({
        admin: this.wallet.publicKey,
        employeeWallet,
        organization,
        employee,
        systemProgram: SystemProgram.programId
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);

    return {
      signature,
      explorerUrl: explorerUrl(signature),
      employee: employee.toBase58()
    };
  }

  async createPayrollRun(input: {
    organization: string;
    periodStart: string;
    periodEnd: string;
    batchReference: string;
    employeeCount: number;
  }): Promise<PayrollRunResult> {
    const program = await this.program();
    const organization = new PublicKey(input.organization);
    const batchSeed = Keypair.generate().publicKey;
    const [payrollRun] = SilenceDevnetClient.payrollRunPda(organization, batchSeed, this.programId);
    const transaction = await (program.methods as any)
      .createPayrollRun(
        new BN(unixSeconds(input.periodStart)),
        new BN(unixSeconds(input.periodEnd)),
        await sha256Bytes(input.batchReference, 32),
        boundedU32(input.employeeCount, "Employee count")
      )
      .accountsStrict({
        admin: this.wallet.publicKey,
        organization,
        payrollRun,
        batchSeed,
        systemProgram: SystemProgram.programId
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);

    return {
      signature,
      explorerUrl: explorerUrl(signature),
      payrollRun: payrollRun.toBase58(),
      batchSeed: batchSeed.toBase58()
    };
  }

  async depositVault(input: { organization: string; mint: string; vault: string; amountUi: number; decimals?: number }) {
    const program = await this.program();
    const decimals = input.decimals ?? 6;
    if (!Number.isFinite(input.amountUi) || input.amountUi <= 0) {
      throw new Error("Deposit amount must be a valid positive number.");
    }
    const amount = new BN(uiAmountToRawString(input.amountUi, decimals));
    const adminTokenAccount = getAssociatedTokenAddressSync(new PublicKey(input.mint), this.wallet.publicKey);
    const transaction = await (program.methods as any)
      .depositVault(amount)
      .accountsStrict({
        admin: this.wallet.publicKey,
        organization: new PublicKey(input.organization),
        adminTokenAccount,
        vault: new PublicKey(input.vault),
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    return { signature, explorerUrl: explorerUrl(signature) };
  }

  async initializeArciumDefinitions(): Promise<ExplorerTransaction | null> {
    const program = await this.program();
    const provider = this.provider();
    const definitions = [
      ["prepare_payroll_run", "initPreparePayrollRunCompDef"],
      ["validate_payroll_run", "initValidatePayrollRunCompDef"],
      ["seal_employee_paystub", "initSealEmployeePaystubCompDef"]
    ] as const;

    let latestSignature: TransactionSignature | null = null;
    for (const [circuitName, methodName] of definitions) {
      const accounts = await arciumDefinitionAccounts(provider, this.programId, circuitName);
      const existing = await this.connection.getAccountInfo(accounts.compDefAccount, "confirmed");
      if (existing) continue;

      const transaction = await (program.methods as any)
        [methodName]()
        .accountsStrict({
          payer: this.wallet.publicKey,
          ...accounts
        })
        .transaction();
      latestSignature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    }

    return latestSignature ? { signature: latestSignature, explorerUrl: explorerUrl(latestSignature) } : null;
  }

  private async ensureArciumDefinition(circuitName: string) {
    const account = arciumCompDefAccount(this.programId, circuitName);
    const existing = await this.connection.getAccountInfo(account, "confirmed");
    if (existing) return;
    await this.initializeArciumDefinitions();
  }

  async queuePayrollComputation(input: QueuePayrollComputationInput): Promise<QueuePayrollComputationResult> {
    await this.ensureArciumDefinition("prepare_payroll_run");
    const program = await this.program();
    const provider = this.provider();
    const mxePublicKey = await getMXEPublicKeyWithRetry(provider, this.programId);
    const encrypted = encryptValues(
      [
        uiAmountToTokenUnits(input.grossPayUi, input.decimals),
        uiAmountToTokenUnits(input.bonusUi, input.decimals),
        uiAmountToTokenUnits(input.deductionsUi, input.decimals),
        uiAmountToTokenUnits(input.adjustmentsUi, input.decimals)
      ],
      mxePublicKey
    );
    const computationOffset = randomComputationOffset();
    const accounts = arciumAccounts(this.programId, computationOffset, "prepare_payroll_run");
    const transaction = await (program.methods as any)
      .queuePayrollComputation(
        computationOffset,
        bytesFromHex(input.batchHash, 32),
        Array.from(encrypted.ciphertext[0]),
        Array.from(encrypted.ciphertext[1]),
        Array.from(encrypted.ciphertext[2]),
        Array.from(encrypted.ciphertext[3]),
        Array.from(encrypted.clientPublicKey),
        new BN(deserializeLE(encrypted.nonce).toString())
      )
      .accountsPartial({
        admin: this.wallet.publicKey,
        organization: new PublicKey(input.organization),
        payrollRun: new PublicKey(input.payrollRun),
        ...accounts
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    return {
      signature,
      explorerUrl: explorerUrl(signature),
      computationAccount: accounts.computationAccount.toBase58(),
      computationOffset: computationOffset.toString()
    };
  }

  async queueValidatePayrollRun(input: { organization: string; payrollRun: string; vault: string }): Promise<QueuePayrollComputationResult> {
    await this.ensureArciumDefinition("validate_payroll_run");
    const program = await this.program();
    const provider = this.provider();
    const mxePublicKey = await getMXEPublicKeyWithRetry(provider, this.programId);
    const vaultBalance = await this.connection.getTokenAccountBalance(new PublicKey(input.vault), "confirmed");
    const encrypted = encryptValues([BigInt(vaultBalance.value.amount)], mxePublicKey);
    const computationOffset = randomComputationOffset();
    const accounts = arciumAccounts(this.programId, computationOffset, "validate_payroll_run");
    const transaction = await (program.methods as any)
      .queueValidatePayrollRun(
        computationOffset,
        Array.from(encrypted.clientPublicKey),
        new BN(deserializeLE(encrypted.nonce).toString()),
        Array.from(encrypted.ciphertext[0])
      )
      .accountsPartial({
        admin: this.wallet.publicKey,
        organization: new PublicKey(input.organization),
        payrollRun: new PublicKey(input.payrollRun),
        ...accounts
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    return {
      signature,
      explorerUrl: explorerUrl(signature),
      computationAccount: accounts.computationAccount.toBase58(),
      computationOffset: computationOffset.toString()
    };
  }

  async createPayrollPayout(input: { organization: string; payrollRun: string; employee: string }): Promise<CreatePayrollPayoutResult> {
    const program = await this.program();
    const payrollRun = new PublicKey(input.payrollRun);
    const employee = new PublicKey(input.employee);
    const [payout] = SilenceDevnetClient.payoutPda(payrollRun, employee, this.programId);
    const transaction = await (program.methods as any)
      .createPayrollPayout()
      .accountsStrict({
        admin: this.wallet.publicKey,
        organization: new PublicKey(input.organization),
        payrollRun,
        employee,
        payout,
        systemProgram: SystemProgram.programId
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    return { signature, explorerUrl: explorerUrl(signature), payout: payout.toBase58() };
  }

  async queueSealEmployeePaystub(input: {
    organization: string;
    payrollRun: string;
    payout: string;
  }): Promise<QueuePayrollComputationResult> {
    await this.ensureArciumDefinition("seal_employee_paystub");
    const program = await this.program();
    const computationOffset = randomComputationOffset();
    const accounts = arciumAccounts(this.programId, computationOffset, "seal_employee_paystub");
    const transaction = await (program.methods as any)
      .queueSealEmployeePaystub(computationOffset)
      .accountsPartial({
        admin: this.wallet.publicKey,
        organization: new PublicKey(input.organization),
        payrollRun: new PublicKey(input.payrollRun),
        payout: new PublicKey(input.payout),
        ...accounts
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    return {
      signature,
      explorerUrl: explorerUrl(signature),
      computationAccount: accounts.computationAccount.toBase58(),
      computationOffset: computationOffset.toString()
    };
  }

  async awaitPayrollFinalization(input: { payrollRun: string; computationOffset: string }): Promise<PayrollFinalizationResult> {
    const signature = await awaitComputationFinalization(
      this.provider(),
      new BN(input.computationOffset),
      this.programId,
      "confirmed",
      180_000
    );
    const payrollRun = await this.getPayrollRun(input.payrollRun);
    if (!payrollRun) {
      throw new Error("Payroll run was not found after Arcium finalization.");
    }
    return {
      signature,
      explorerUrl: explorerUrl(signature),
      payrollRun
    };
  }

  async executePayroll(input: { organization: string; payrollRun: string; vault: string }) {
    const program = await this.program();
    const transaction = await (program.methods as any)
      .executePayroll()
      .accountsStrict({
        admin: this.wallet.publicKey,
        organization: new PublicKey(input.organization),
        payrollRun: new PublicKey(input.payrollRun),
        vault: new PublicKey(input.vault),
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .transaction();
    const signature = await sendWithFreshBlockhash(this.connection, this.wallet, transaction);
    return { signature, explorerUrl: explorerUrl(signature) };
  }
}
