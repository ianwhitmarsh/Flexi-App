/**
 * In-memory payroll provider for demo mode.
 *
 * Runs entirely in process — no network call is issued from any method here,
 * which is what lets the whole app be explored with no credentials at all.
 *
 * The one thing it cannot honestly simulate is a worker filling in a hosted
 * W-4 and I-9. So it treats *requesting* the onboarding URL as completing the
 * flow: `getOnboardingUrl` marks the employee `ready`. A live provider would
 * instead stay `in_progress` until the worker actually finished and a later
 * `getEmployeeStatus` (or webhook, BIG-41) reported otherwise. Callers do the
 * same two steps either way — open the flow, then re-read the status — so the
 * demo exercises the real call sequence rather than a shortcut.
 */

import type {
  CreateEmployeeInput,
  PayrollEmployee,
  PayrollItemInput,
  PayrollProvider,
  PayrollStatus,
} from './payroll';

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${(seq += 1).toString(36)}${Date.now().toString(36)}`;

export class MockPayrollProvider implements PayrollProvider {
  readonly isLive = false;

  /** employeeId -> status. Process-local; the durable copy is on the profile. */
  private status = new Map<string, PayrollStatus>();
  /** workerId -> employeeId, so `createEmployee` is idempotent per worker. */
  private byWorker = new Map<string, string>();

  async createEmployee(input: CreateEmployeeInput): Promise<PayrollEmployee> {
    const existing = this.byWorker.get(input.workerId);
    if (existing) {
      return { employeeId: existing, status: this.status.get(existing) ?? 'in_progress' };
    }
    const employeeId = nextId('payemp');
    this.byWorker.set(input.workerId, employeeId);
    this.status.set(employeeId, 'in_progress');
    return { employeeId, status: 'in_progress' };
  }

  async getEmployeeStatus(employeeId: string): Promise<PayrollStatus> {
    return this.status.get(employeeId) ?? 'not_started';
  }

  async getOnboardingUrl(employeeId: string): Promise<string> {
    // See the file comment: there is no hosted form to fill in, so opening it
    // is what "completing it" means in demo mode.
    this.status.set(employeeId, 'ready');
    return `https://demo.flexi.invalid/payroll/${employeeId}`;
  }

  async createPayrollItem(input: PayrollItemInput): Promise<{ itemId: string }> {
    // Recorded but not acted on: paying anyone is BIG-53, and this provider
    // moves no money by construction.
    return { itemId: nextId('payitem') };
  }

  async triggerSameDayPayout(itemId: string): Promise<{ payoutId: string }> {
    return { payoutId: nextId('payout') };
  }
}
