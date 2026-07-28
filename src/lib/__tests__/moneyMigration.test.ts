/**
 * Rates already on a device, stored as dollars (BIG-88).
 *
 * `MockBackend` persists to AsyncStorage, so anyone with the app installed has
 * shifts written under the old `payRate` key. This is the counterpart of the
 * `pay_rate` → `pay_rate_cents` migration in `schema.sql`.
 *
 * It is here because the browser found it and the test suite did not: every
 * other fixture constructs a shift fresh, already in cents, so nothing exercised
 * the one path that matters — real prior state. Untouched, every card in the app
 * rendered `$NaN/hour`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DB_KEY, MockBackend } from '../mockBackend';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

/** A stored database with rates in dollars, as an existing install has. */
async function installWithDollarRates() {
  await AsyncStorage.clear();
  const backend = new MockBackend();
  await backend.signUp('employer@example.com', 'pw');

  const db = JSON.parse((await AsyncStorage.getItem(DB_KEY))!);
  for (const shift of db.shifts) {
    shift.payRate = shift.payRateCents / 100;
    delete shift.payRateCents;
  }
  for (const account of Object.values<any>(db.accounts)) {
    if (!account.worker?.desiredRateCents) continue;
    account.worker.desiredRate = account.worker.desiredRateCents / 100;
    delete account.worker.desiredRateCents;
  }
  await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));
  return db;
}

const readDb = async () => JSON.parse((await AsyncStorage.getItem(DB_KEY))!);

describe('a device holding rates in dollars', () => {
  it('converts every shift to cents on load', async () => {
    const before = await installWithDollarRates();
    const dollars: Record<string, number> = Object.fromEntries(
      before.shifts.map((s: any) => [s.id, s.payRate]),
    );
    expect(Object.values(dollars).length).toBeGreaterThan(0);

    await new MockBackend().signIn('employer@example.com', 'pw');

    const after = await readDb();
    for (const shift of after.shifts) {
      expect(shift.payRateCents).toBe(Math.round(dollars[shift.id] * 100));
      expect(shift).not.toHaveProperty('payRate');
    }
  });

  it('converts a worker desired rate too', async () => {
    await installWithDollarRates();
    const before = await readDb();
    const withRate = Object.values<any>(before.accounts).find((a) => a.worker?.desiredRate);
    expect(withRate).toBeDefined();
    const dollars = withRate.worker.desiredRate;

    await new MockBackend().signIn('employer@example.com', 'pw');

    const after = await readDb();
    const account = Object.values<any>(after.accounts).find((a) => a.worker?.id === withRate.worker.id);
    expect(account.worker.desiredRateCents).toBe(Math.round(dollars * 100));
    expect(account.worker).not.toHaveProperty('desiredRate');
  });

  it('does not multiply a rate that is already in cents', async () => {
    // The migration keys on the old field being present, so a second load —
    // or an install that never held dollars — leaves the value alone. Getting
    // this wrong turns $22 into $2,200 on the second open.
    await installWithDollarRates();
    await new MockBackend().signIn('employer@example.com', 'pw');
    const once = await readDb();

    await new MockBackend().signIn('employer@example.com', 'pw');
    const twice = await readDb();

    expect(twice.shifts.map((s: any) => s.payRateCents)).toEqual(
      once.shifts.map((s: any) => s.payRateCents),
    );
  });
});
