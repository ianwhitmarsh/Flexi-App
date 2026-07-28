/**
 * Shifts that are over (BIG-80).
 *
 * Nothing used to look at the clock, so a shift stayed in every deck forever
 * and could still be offered and accepted long after it finished. "Ended" is
 * derived, never written: no status changes, so an employer's `closed` and a
 * worker's `filled` keep their own meanings.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MockBackend } from '../mockBackend';
import { hasShiftEnded, shiftEndsAt } from '../util';
import type { Backend } from '../backend';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BIZ = { email: 'biz@test.dev', password: 'pw' };
const WORKER = { email: 'w@test.dev', password: 'pw' };

type ShiftInput = Parameters<Backend['createShift']>[0];

/** `days` from today, as the local `yyyy-mm-dd` the app stores. */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftInput(over: Partial<ShiftInput> = {}): ShiftInput {
  return {
    title: 'Weekend Barista',
    role: 'Barista',
    payRateCents: 2400,
    payType: 'hour',
    date: isoDay(1),
    startTime: '09:00',
    endTime: '17:00',
    location: 'Oakland, CA',
    description: '',
    requirements: [],
    fillMode: 'race',
    ...over,
  };
}

async function setup() {
  await AsyncStorage.clear();
  const backend = new MockBackend();

  await backend.signUp(BIZ.email, BIZ.password);
  await backend.saveBusinessProfile({
    companyName: 'Blue Harbor Coffee',
    category: 'Café',
    city: 'Oakland, CA',
    about: '',
    contactName: 'Dana',
  });
  return { backend };
}

async function signUpWorker(backend: MockBackend) {
  const session = await backend.signUp(WORKER.email, WORKER.password);
  await backend.saveWorkerProfile({
    fullName: 'Ada Worker',
    headline: 'Barista',
    bio: '',
    city: 'Oakland, CA',
    skills: [],
    yearsExperience: 2,
    availability: [],
  });
  return session.userId;
}

describe('hasShiftEnded', () => {
  it('is true once the end time has passed', () => {
    expect(hasShiftEnded({ date: isoDay(-1), startTime: '09:00', endTime: '17:00' })).toBe(true);
  });

  it('is false for a shift still to come', () => {
    expect(hasShiftEnded({ date: isoDay(1), startTime: '09:00', endTime: '17:00' })).toBe(false);
  });

  it('is false for a shift that has started but not finished', () => {
    const now = new Date(2026, 6, 27, 12, 0);
    expect(hasShiftEnded({ date: '2026-07-27', startTime: '09:00', endTime: '17:00' }, now)).toBe(
      false,
    );
  });

  it('carries an overnight end into the next day', () => {
    const overnight = { date: '2026-07-27', startTime: '22:00', endTime: '06:00' };

    // 02:00 the following morning: still running.
    expect(hasShiftEnded(overnight, new Date(2026, 6, 28, 2, 0))).toBe(false);
    // 07:00: over.
    expect(hasShiftEnded(overnight, new Date(2026, 6, 28, 7, 0))).toBe(true);
    expect(shiftEndsAt(overnight).getDate()).toBe(28);
  });

  it('reads the stored date as local, not UTC', () => {
    // Built at local midnight + minutes, so the calendar day never shifts under
    // a non-zero UTC offset the way a `Date.parse(...Z)` would.
    const end = shiftEndsAt({ date: '2026-07-27', startTime: '09:00', endTime: '17:00' });
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(6);
    expect(end.getDate()).toBe(27);
    expect(end.getHours()).toBe(17);
  });
});

describe('a shift that has ended', () => {
  it('is gone from the worker deck', async () => {
    const { backend } = await setup();
    const ended = await backend.createShift(shiftInput({ title: 'Yesterday', date: isoDay(-1) }));
    const live = await backend.createShift(shiftInput({ title: 'Tomorrow', date: isoDay(1) }));

    await signUpWorker(backend);
    const deck = (await backend.workerDeck()).map((s) => s.id);

    expect(deck).toContain(live.id);
    expect(deck).not.toContain(ended.id);
  });

  it('cannot be offered', async () => {
    const { backend } = await setup();
    const ended = await backend.createShift(shiftInput({ date: isoDay(-1) }));
    const worker = await signUpWorker(backend);

    await backend.signIn(BIZ.email, BIZ.password);
    await expect(backend.sendOffers(ended.id, [worker])).rejects.toThrow(/already ended/);
  });

  it('cannot be accepted, even with a live offer already in hand', async () => {
    const { backend } = await setup();
    // Offer it while it is still live, then let it pass.
    const shift = await backend.createShift(shiftInput({ date: isoDay(1) }));
    const worker = await signUpWorker(backend);
    await backend.signIn(BIZ.email, BIZ.password);
    const batch = await backend.sendOffers(shift.id, [worker]);

    // Move the shift into the past behind the offer's back.
    const db = JSON.parse((await AsyncStorage.getItem('flexi.db.v1'))!);
    db.shifts.find((s: { id: string }) => s.id === shift.id).date = isoDay(-1);
    await AsyncStorage.setItem('flexi.db.v1', JSON.stringify(db));

    const fresh = new MockBackend();
    await fresh.signIn(WORKER.email, WORKER.password);
    await expect(fresh.acceptOffer(batch.offers[0].id)).rejects.toThrow(/already ended/);
    expect(await fresh.listMyBookings()).toHaveLength(0);
  });

  it('is not shown as a live offer to the worker', async () => {
    const { backend } = await setup();
    const shift = await backend.createShift(shiftInput({ date: isoDay(1) }));
    const worker = await signUpWorker(backend);
    await backend.signIn(BIZ.email, BIZ.password);
    await backend.sendOffers(shift.id, [worker]);

    await backend.signIn(WORKER.email, WORKER.password);
    expect(await backend.listMyOffers()).toHaveLength(1);

    const db = JSON.parse((await AsyncStorage.getItem('flexi.db.v1'))!);
    db.shifts.find((s: { id: string }) => s.id === shift.id).date = isoDay(-1);
    await AsyncStorage.setItem('flexi.db.v1', JSON.stringify(db));

    const fresh = new MockBackend();
    await fresh.signIn(WORKER.email, WORKER.password);
    expect(await fresh.listMyOffers()).toHaveLength(0);
  });

  it('drops out of the employer Interested queue', async () => {
    const { backend } = await setup();
    const shift = await backend.createShift(shiftInput({ date: isoDay(1) }));
    await signUpWorker(backend);
    await backend.swipeShift(shift.id, 'like');

    // Posting a shift also seeds demo interest, so count rather than assume.
    await backend.signIn(BIZ.email, BIZ.password);
    expect((await backend.listInterested()).length).toBeGreaterThan(0);
    expect((await backend.interestedWorkers(shift.id)).length).toBeGreaterThan(0);

    const db = JSON.parse((await AsyncStorage.getItem('flexi.db.v1'))!);
    db.shifts.find((s: { id: string }) => s.id === shift.id).date = isoDay(-1);
    await AsyncStorage.setItem('flexi.db.v1', JSON.stringify(db));

    const fresh = new MockBackend();
    await fresh.signIn(BIZ.email, BIZ.password);
    expect(await fresh.listInterested()).toHaveLength(0);
    expect(await fresh.interestedWorkers(shift.id)).toHaveLength(0);
  });

  it('keeps its stored status — ended is derived, never written', async () => {
    const { backend } = await setup();
    const ended = await backend.createShift(shiftInput({ date: isoDay(-1) }));

    // NG-5: the employer still sees it in their own list, unchanged.
    const mine = (await backend.myShifts()).find((s) => s.id === ended.id);
    expect(mine?.status).toBe('open');
  });
});

describe('a shift that has started but not finished', () => {
  it('is still discoverable, offerable and acceptable', async () => {
    const { backend } = await setup();
    // Runs until nearly midnight tonight, so it is live whenever this runs
    // except in the last minute of the day.
    const live = await backend.createShift(
      shiftInput({ date: isoDay(0), startTime: '00:01', endTime: '23:59' }),
    );
    const worker = await signUpWorker(backend);

    expect((await backend.workerDeck()).map((s) => s.id)).toContain(live.id);

    await backend.signIn(BIZ.email, BIZ.password);
    const batch = await backend.sendOffers(live.id, [worker]);

    // Payroll-ready first: this test is about a shift that has started but not
    // finished, not about the payroll gate (BIG-73).
    await backend.signIn(WORKER.email, WORKER.password);
    await backend.startPayrollSetup();
    await backend.refreshPayrollStatus();
    expect((await backend.acceptOffer(batch.offers[0].id)).status).toBe('accepted');
  });
});
