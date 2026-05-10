export type PublicKeyString = string;
export type Base64String = string;

export type EmployeeStatus = "Active" | "Suspended" | "Terminated";

export type PayrollRunStatus =
  | "Draft"
  | "Preparing"
  | "Prepared"
  | "Validating"
  | "Queued"
  | "Computing"
  | "Validated"
  | "SealingPaystubs"
  | "ReadyToPay"
  | "Paid"
  | "Failed"
  | "Cancelled";

export type PayoutStatus = "Pending" | "Sealing" | "Ready" | "Paid" | "Failed";

export interface EncryptedField {
  ciphertext: Base64String;
  nonce: Base64String;
  owner: "Shared" | "Mxe";
  encoding: "aes-gcm-dev" | "arcium";
}

export interface Organization {
  id: string;
  name: string;
  admin: PublicKeyString;
  usdcMint: PublicKeyString;
  vault: PublicKeyString;
  vaultBalance: number;
  createdAt: string;
}

export interface EmployeeRecord {
  id: string;
  wallet: PublicKeyString;
  status: EmployeeStatus;
  departmentHash: string;
  roleHash: string;
  metadataHash: string;
  encryptedCompensationRef: EncryptedField;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollLineInput {
  employeeId: string;
  employeeWallet: PublicKeyString;
  grossPay: number;
  bonus: number;
  deductions: number;
  adjustments: number;
}

export interface EncryptedPayrollLine {
  employeeId: string;
  employeeWallet: PublicKeyString;
  encryptedGrossPay: EncryptedField;
  encryptedBonus: EncryptedField;
  encryptedDeductions: EncryptedField;
  encryptedAdjustments: EncryptedField;
}

export interface EncryptedPayrollBatch {
  batchHash: string;
  employeeCount: number;
  totalGrossPreview: number;
  encryptedLines: EncryptedPayrollLine[];
  createdAt: string;
}

export interface PayrollPayoutRecord {
  id: string;
  payrollRunId: string;
  employeeId: string;
  employeeWallet: PublicKeyString;
  encryptedNetPay?: EncryptedField;
  status: PayoutStatus;
  signature?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PayrollRun {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  batchHash: string;
  employeeCount: number;
  status: PayrollRunStatus;
  encryptedAggregateNetPay?: EncryptedField;
  computationId?: string;
  callbackSignature?: string;
  payouts: PayrollPayoutRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PayrollReport {
  organizationName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  rows: Array<{
    employeeId: string;
    employeeWallet: PublicKeyString;
    grossPay: number;
    bonus: number;
    deductions: number;
    adjustments: number;
    netPay: number;
  }>;
  totals: {
    grossPay: number;
    bonus: number;
    deductions: number;
    adjustments: number;
    netPay: number;
  };
}

export function calculateNetPay(line: Pick<PayrollLineInput, "grossPay" | "bonus" | "deductions" | "adjustments">) {
  return line.grossPay + line.bonus + line.adjustments - line.deductions;
}

export function assertValidPayrollLine(line: PayrollLineInput) {
  if (!line.employeeId || !line.employeeWallet) {
    throw new Error("Payroll line requires an employee id and wallet.");
  }

  for (const [label, value] of Object.entries({
    grossPay: line.grossPay,
    bonus: line.bonus,
    deductions: line.deductions,
    adjustments: line.adjustments
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} must be a non-negative number.`);
    }
  }

  if (calculateNetPay(line) < 0) {
    throw new Error("Net pay cannot be negative.");
  }
}

export function assertPayrollTransition(from: PayrollRunStatus, to: PayrollRunStatus) {
  const allowed: Record<PayrollRunStatus, PayrollRunStatus[]> = {
    Draft: ["Preparing", "Cancelled"],
    Preparing: ["Prepared", "Failed", "Cancelled"],
    Prepared: ["Validating", "Cancelled"],
    Validating: ["Validated", "Failed", "Cancelled"],
    Queued: ["Computing", "Failed", "Cancelled"],
    Computing: ["Validated", "Failed"],
    Validated: ["SealingPaystubs", "Cancelled"],
    SealingPaystubs: ["ReadyToPay", "Failed", "Cancelled"],
    ReadyToPay: ["Paid", "Cancelled"],
    Paid: [],
    Failed: [],
    Cancelled: []
  };

  if (!allowed[from].includes(to)) {
    throw new Error(`Invalid payroll transition: ${from} -> ${to}`);
  }
}
