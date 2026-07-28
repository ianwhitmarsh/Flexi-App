/**
 * Picks the live payroll provider when configured, else the demo one.
 * Mirrors `getBackend.ts` so the two seams are read the same way.
 *
 * There is no live provider yet — the Check implementation is BIG-41 — so this
 * always returns the mock today. The selection point exists now so that adding
 * `checkPayroll.ts` is one import and one branch, and so nothing downstream has
 * to know which provider it is talking to.
 */

import { isPayrollConfigured } from './config';
import { MockPayrollProvider } from './mockPayroll';
import type { PayrollProvider } from './payroll';

let instance: PayrollProvider | null = null;

export function getPayroll(): PayrollProvider {
  if (!instance) {
    if (isPayrollConfigured) {
      // BIG-41 lands `CheckPayrollProvider` here. Until then, being configured
      // is not enough to be usable, and silently running the demo provider
      // against real credentials would be worse than saying so.
      throw new Error(
        'A payroll provider is configured but not implemented yet (see BIG-41). ' +
          'Unset EXPO_PUBLIC_PAYROLL_PROVIDER to use the demo provider.',
      );
    }
    instance = new MockPayrollProvider();
  }
  return instance;
}

/** Test seam: drops the cached provider so a fresh one is built. */
export function resetPayrollForTests() {
  instance = null;
}
