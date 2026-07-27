/**
 * Payroll abstraction.
 *
 * Flexi is the W-2 employer of record, so a worker has to be legally onboarded
 * — W-4 withholding, I-9 eligibility, direct deposit, state tax setup — before
 * they can be booked onto a shift. That work belongs to an embedded payroll
 * provider; the app only ever holds a status and an opaque employee id.
 *
 * The app talks to this interface only, exactly as it talks to `Backend`. The
 * concrete implementation is chosen at runtime by `getPayroll()`. Check is the
 * intended live provider, but swapping to Zeal or Gusto Embedded should be one
 * new file and one line in `getPayroll.ts`.
 *
 * **Nothing sensitive passes through here.** No SSN, bank account, or I-9
 * document is a parameter of any method below, and none is stored by the app.
 * The provider's hosted flow collects them directly from the worker.
 */

/**
 * How far a worker is through payroll onboarding.
 *  - `not_started` — nothing attempted yet; the default for a new worker.
 *  - `in_progress` — the hosted flow was opened but is not finished.
 *  - `blocked`     — the provider rejected something and a human must resolve it.
 *  - `ready`       — legally onboarded and payable. Only this state can be booked.
 */
export type PayrollStatus = 'not_started' | 'in_progress' | 'blocked' | 'ready';

/** The one status that may take a shift. */
export const PAYROLL_READY: PayrollStatus = 'ready';

/**
 * Shown when a worker who is not `ready` tries to accept an offer. Exported so
 * both backends and their tests use the same string rather than three copies
 * that can drift.
 */
export const PAYROLL_NOT_READY_MESSAGE = 'Finish your payroll setup to take shifts';

/** What the app knows about a worker's payroll record. Deliberately thin. */
export interface PayrollEmployee {
  /** Provider-side id. Opaque to Flexi; never parsed. */
  employeeId: string;
  status: PayrollStatus;
}

/** Enough to open a payroll record. Identity details go to the hosted flow. */
export interface CreateEmployeeInput {
  workerId: string;
  fullName: string;
  email: string;
  /** Two-letter work state, which decides the tax setup the provider needs. */
  workState?: string;
}

/** One shift's worth of pay, handed to the provider for withholding. */
export interface PayrollItemInput {
  employeeId: string;
  bookingId: string;
  minutesWorked: number;
  /** Gross pay in whole cents. Integer cents, never floating dollars. */
  grossCents: number;
}

export interface PayrollProvider {
  /** True when backed by a real provider rather than the in-memory demo. */
  readonly isLive: boolean;

  /** Open a payroll record. Idempotent per worker. */
  createEmployee(input: CreateEmployeeInput): Promise<PayrollEmployee>;

  /** Current status, re-read from the provider. */
  getEmployeeStatus(employeeId: string): Promise<PayrollStatus>;

  /**
   * URL of the provider's hosted onboarding flow — W-4, I-9 and direct
   * deposit. The worker completes it outside the app so none of that data
   * touches Flexi.
   */
  getOnboardingUrl(employeeId: string): Promise<string>;

  /** Record pay for one completed shift. Used by the payout flow (BIG-53). */
  createPayrollItem(input: PayrollItemInput): Promise<{ itemId: string }>;

  /** Same-day payout for one recorded item. Used by BIG-53. */
  triggerSameDayPayout(itemId: string): Promise<{ payoutId: string }>;
}
