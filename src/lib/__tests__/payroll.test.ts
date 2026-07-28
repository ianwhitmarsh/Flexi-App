/**
 * The payroll gate (BIG-73).
 *
 * Flexi is the W-2 employer of record, so a worker has to be legally onboarded
 * before they can be booked. `acceptOffer` is the only place a shift becomes
 * committed work, so it is the only place this rule has to hold — everything
 * else a worker does stays open to them.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DB_KEY, MockBackend } from '../mockBackend';
import { PAYROLL_NOT_READY_MESSAGE } from '../payroll';
import type { Backend } from '../backend';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BUSINESS = { email: 'biz@test.dev', password: 'pw' };
const WORKER = { email: 'w@test.dev', password: 'pw' };

type ShiftInput = Parameters<Backend['createShift']>[0];

function shiftInput(over: Partial<ShiftInput> = {}): ShiftInput {
  return {
    title: 'Weekend Barista',
    role: 'Barista',
    payRate: 24,
    payType: 'hour',
    date: '2026-08-01',
    startTime: '09:00',
    endTime: '17:00',
    location: 'Oakland, CA',
    description: '',
    requirements: [],
    fillMode: 'race',
    ...over,
  };
}

/** A business, one race shift, and one worker who has NOT done payroll setup. */
async function setupUnonboardedWorker() {
  await AsyncStorage.clear();
  const backend = new MockBackend();

  await backend.signUp(BUSINESS.email, BUSINESS.password);
  await backend.saveBusinessProfile({
    companyName: 'Blue Harbor Coffee',
    category: 'Café',
    city: 'Oakland, CA',
    about: '',
    contactName: 'Dana',
  });
  const shift = await backend.createShift(shiftInput());

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
  const workerId = session.userId;

  await backend.signIn(BUSINESS.email, BUSINESS.password);
  const batch = await backend.sendOffers(shift.id, [workerId]);

  await backend.signIn(WORKER.email, WORKER.password);
  return { backend, shift, workerId, offer: batch.offers[0] };
}

describe('payroll status', () => {
  it('starts a newly signed-up worker at not_started', async () => {
    const { backend } = await setupUnonboardedWorker();
    expect((await backend.getAccount())?.worker?.payrollStatus).toBe('not_started');
  });

  it('has seeded demo workers already onboarded, so the demo works end to end', async () => {
    await AsyncStorage.clear();
    const backend = new MockBackend();
    await backend.signIn('wk_jordan@demo.flexi', 'demo');

    expect((await backend.getAccount())?.worker?.payrollStatus).toBe('ready');
  });

  it('readies seeded workers in a database saved before payroll existed', async () => {
    await AsyncStorage.clear();
    const backend = new MockBackend();
    await backend.signIn('wk_jordan@demo.flexi', 'demo');

    // Rewind: a demo install from before this change has no status on anyone.
    const db = JSON.parse((await AsyncStorage.getItem(DB_KEY))!);
    for (const account of Object.values<any>(db.accounts)) {
      if (account.worker) delete account.worker.payrollStatus;
    }
    await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));

    const reopened = new MockBackend();
    await reopened.signIn('wk_jordan@demo.flexi', 'demo');
    expect((await reopened.getAccount())?.worker?.payrollStatus).toBe('ready');
  });

  it('does not ready a real signed-up worker on migration', async () => {
    const { backend } = await setupUnonboardedWorker();

    const reopened = new MockBackend();
    await reopened.signIn(WORKER.email, WORKER.password);
    expect((await reopened.getAccount())?.worker?.payrollStatus).toBe('not_started');
    void backend;
  });

  it('does not reset payroll progress when the profile is edited', async () => {
    const { backend } = await setupUnonboardedWorker();
    await backend.startPayrollSetup();
    await backend.refreshPayrollStatus();
    expect((await backend.getAccount())?.worker?.payrollStatus).toBe('ready');

    await backend.saveWorkerProfile({
      fullName: 'Ada Worker',
      headline: 'Senior Barista',
      bio: 'Updated',
      city: 'Oakland, CA',
      skills: ['Espresso'],
      yearsExperience: 3,
      availability: [],
    });

    expect((await backend.getAccount())?.worker?.payrollStatus).toBe('ready');
  });
});

describe('the accept gate', () => {
  it('refuses to book a worker who has not finished payroll setup', async () => {
    const { backend, offer } = await setupUnonboardedWorker();

    const res = await backend.acceptOffer(offer.id);

    expect(res.status).toBe('payroll_not_ready');
    expect(res.booking).toBeUndefined();
    expect(await backend.listMyBookings()).toHaveLength(0);
  });

  it('leaves the shift open and the offer live, so it can be taken after setup', async () => {
    const { backend, shift, offer } = await setupUnonboardedWorker();

    await backend.acceptOffer(offer.id);

    // Nothing about the race was consumed by the refusal.
    expect((await backend.listMyOffers()).map((o) => o.id)).toContain(offer.id);
    await backend.signIn(BUSINESS.email, BUSINESS.password);
    expect((await backend.myShifts()).find((s) => s.id === shift.id)?.status).toBe('open');
  });

  it('books the same worker once setup is finished', async () => {
    const { backend, offer } = await setupUnonboardedWorker();
    expect((await backend.acceptOffer(offer.id)).status).toBe('payroll_not_ready');

    await backend.startPayrollSetup();
    await backend.refreshPayrollStatus();

    const res = await backend.acceptOffer(offer.id);
    expect(res.status).toBe('accepted');
    expect(res.booking).toBeDefined();
    expect(await backend.listMyBookings()).toHaveLength(1);
  });

  it('blocks only accepting — browsing, interest and offers all still work', async () => {
    const { backend, shift, offer } = await setupUnonboardedWorker();

    // The deck still shows the shift.
    expect((await backend.workerDeck()).map((s) => s.id)).toContain(shift.id);

    // Interest still registers and still opens a conversation.
    const swipe = await backend.swipeShift(shift.id, 'like');
    expect(swipe.interested).toBe(true);
    expect(swipe.thread).toBeDefined();

    // Messaging still works.
    const sent = await backend.sendMessage(swipe.thread!.id, 'Can I still take this?');
    expect((await backend.listMessages(swipe.thread!.id)).map((m) => m.id)).toContain(sent.id);

    // The offer still arrives.
    expect((await backend.listMyOffers()).map((o) => o.id)).toContain(offer.id);
  });
});

describe('the demo payroll provider', () => {
  it('issues no network request for any payroll operation', async () => {
    const { backend, offer } = await setupUnonboardedWorker();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await backend.startPayrollSetup();
    await backend.refreshPayrollStatus();
    await backend.acceptOffer(offer.id);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('hands back a hosted onboarding URL rather than collecting details itself', async () => {
    const { backend } = await setupUnonboardedWorker();

    const { onboardingUrl } = await backend.startPayrollSetup();

    expect(onboardingUrl).toMatch(/^https:\/\//);
    // Nothing sensitive is stored on the profile — only a status and an
    // opaque provider id.
    const worker = (await backend.getAccount())?.worker as unknown as Record<string, unknown>;
    for (const key of Object.keys(worker)) {
      expect(key).not.toMatch(/ssn|social|bank|routing|account_number|i9/i);
    }
  });
});

describe('gate ordering', () => {
  it('tells a worker the shift is gone before telling them to fix payroll', async () => {
    const { backend, offer, shift } = await setupUnonboardedWorker();

    // A second, payroll-ready worker takes the shift first.
    const other = await backend.signUp('other@test.dev', 'pw');
    await backend.saveWorkerProfile({
      fullName: 'Ben Worker',
      headline: 'Barista',
      bio: '',
      city: 'Oakland, CA',
      skills: [],
      yearsExperience: 4,
      availability: [],
    });
    await backend.startPayrollSetup();
    await backend.refreshPayrollStatus();

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const batch = await backend.sendOffers(shift.id, [other.userId]);
    await backend.signIn('other@test.dev', 'pw');
    expect((await backend.acceptOffer(batch.offers[0].id)).status).toBe('accepted');

    // The un-onboarded worker gets the accurate answer: it is gone, not "go
    // fix your payroll" for a shift they could never have had.
    await backend.signIn(WORKER.email, WORKER.password);
    expect((await backend.acceptOffer(offer.id)).status).toBe('filled');
  });
});

describe('the refusal copy', () => {
  it('is one exported constant, so the backends and the UI cannot drift', () => {
    expect(PAYROLL_NOT_READY_MESSAGE).toBe('Finish your payroll setup to take shifts');
  });
});
