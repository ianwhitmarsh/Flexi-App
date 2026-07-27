/**
 * Race-mode offer behaviour (BIG-38).
 *
 * The demo backend is the one we can exercise end to end here; the live
 * backend gets the same guarantees from `accept_offer` in db/schema.sql
 * (`select ... for update` plus `unique (shift_id)` on bookings, and
 * `bookings_no_worker_overlap` for one worker's overlapping shifts — BIG-58).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MockBackend } from '../mockBackend';
import { SupabaseBackend } from '../supabaseBackend';
import type { Backend } from '../backend';
import type { Shift } from '../types';

// Push is native-only and irrelevant to the accept logic.
jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BUSINESS = { email: 'biz@test.dev', password: 'pw' };
const WORKER_A = { email: 'a@test.dev', password: 'pw' };
const WORKER_B = { email: 'b@test.dev', password: 'pw' };
const WORKER_C = { email: 'c@test.dev', password: 'pw' };

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

async function signUpWorker(backend: MockBackend, creds: typeof WORKER_A, name: string) {
  const session = await backend.signUp(creds.email, creds.password);
  await backend.saveWorkerProfile({
    fullName: name,
    headline: 'Barista',
    bio: '',
    city: 'Oakland, CA',
    skills: [],
    yearsExperience: 2,
    availability: [],
  });
  return session.userId;
}

/** A business with one race-mode shift and two interested workers. */
async function setupOfferedShift() {
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

  const workerA = await signUpWorker(backend, WORKER_A, 'Ada Worker');
  await backend.swipeShift(shift.id, 'like');
  const workerB = await signUpWorker(backend, WORKER_B, 'Ben Worker');
  await backend.swipeShift(shift.id, 'like');

  await backend.signIn(BUSINESS.email, BUSINESS.password);
  const batch = await backend.sendOffers(shift.id, [workerA, workerB]);

  const offerA = batch.offers.find((o) => o.workerId === workerA)!;
  const offerB = batch.offers.find((o) => o.workerId === workerB)!;
  return { backend, shift, workerA, workerB, batch, offerA, offerB };
}

describe('sendOffers', () => {
  it('creates one batch and one sent offer per worker', async () => {
    const { batch, shift, offerA, offerB } = await setupOfferedShift();

    expect(batch.shiftId).toBe(shift.id);
    expect(batch.offers).toHaveLength(2);
    expect(offerA.status).toBe('sent');
    expect(offerB.status).toBe('sent');
    expect(offerA.batchId).toBe(batch.id);
    expect(offerB.batchId).toBe(batch.id);
  });

  it('rejects more than ten workers in one batch', async () => {
    const { backend, shift } = await setupOfferedShift();
    const tooMany = Array.from({ length: 11 }, (_, i) => `worker_${i}`);
    await expect(backend.sendOffers(shift.id, tooMany)).rejects.toThrow(/at most 10/);
  });

  it('shows the offer to the offered worker with shift details and pay', async () => {
    const { backend, shift } = await setupOfferedShift();
    await backend.signIn(WORKER_A.email, WORKER_A.password);

    const offers = await backend.listMyOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0].shift?.title).toBe(shift.title);
    expect(offers[0].shift?.payRate).toBe(24);
    expect(offers[0].shift?.business?.companyName).toBe('Blue Harbor Coffee');
  });
});

describe('acceptOffer', () => {
  it('books the accepting worker and fills the sibling offer', async () => {
    const { backend, offerA } = await setupOfferedShift();
    await backend.signIn(WORKER_A.email, WORKER_A.password);

    const res = await backend.acceptOffer(offerA.id);
    expect(res.status).toBe('accepted');
    expect(res.booking?.workerId).toBe(offerA.workerId);
    expect(await backend.listMyOffers()).toHaveLength(0);

    await backend.signIn(WORKER_B.email, WORKER_B.password);
    expect(await backend.listMyOffers()).toHaveLength(0);
  });

  it('two simultaneous accepts produce exactly one booking and one filled', async () => {
    const { backend, offerA, offerB, workerA, workerB } = await setupOfferedShift();

    // Fire both before either resolves. acceptOffer captures the caller
    // synchronously, so each call keeps its own worker.
    await backend.signIn(WORKER_A.email, WORKER_A.password);
    const pendingA = backend.acceptOffer(offerA.id);
    await backend.signIn(WORKER_B.email, WORKER_B.password);
    const pendingB = backend.acceptOffer(offerB.id);

    const results = await Promise.all([pendingA, pendingB]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['accepted', 'filled']);

    const bookings = results.filter((r) => r.booking).map((r) => r.booking!);
    expect(bookings).toHaveLength(1);

    // And only one worker ends up holding a booking.
    await backend.signIn(WORKER_A.email, WORKER_A.password);
    const bookedA = await backend.listMyBookings();
    await backend.signIn(WORKER_B.email, WORKER_B.password);
    const bookedB = await backend.listMyBookings();
    expect(bookedA.length + bookedB.length).toBe(1);
    expect([workerA, workerB]).toContain(bookings[0].workerId);
  });

  it('reports filled when the shift was already taken', async () => {
    const { backend, offerA, offerB } = await setupOfferedShift();

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    await backend.acceptOffer(offerA.id);

    await backend.signIn(WORKER_B.email, WORKER_B.password);
    const res = await backend.acceptOffer(offerB.id);
    expect(res.status).toBe('filled');
    expect(res.booking).toBeUndefined();
    expect(await backend.listMyBookings()).toHaveLength(0);
  });

  it('refuses an accept that overlaps an existing booking', async () => {
    const { backend, shift, workerA } = await setupOfferedShift();

    // A second race-mode shift on the same day, overlapping 09:00–17:00.
    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const clashing = await backend.createShift(
      shiftInput({ title: 'Afternoon Barista', startTime: '16:00', endTime: '20:00' }),
    );
    const second = await backend.sendOffers(clashing.id, [workerA]);

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    const first = await backend.listMyOffers();
    const forOriginal = first.find((o) => o.shiftId === shift.id)!;
    expect((await backend.acceptOffer(forOriginal.id)).status).toBe('accepted');

    const res = await backend.acceptOffer(second.offers[0].id);
    expect(res.status).toBe('overlap');
    expect(res.booking).toBeUndefined();
    expect(await backend.listMyBookings()).toHaveLength(1);
  });

  // BIG-58. The demo backend serialises every accept through one queue, so the
  // concurrent case reduces to the sequential one above. The live backend locks
  // per shift and cannot, which is why it also carries
  // `bookings_no_worker_overlap` in db/schema.sql.
  it('refuses the loser when one worker accepts two overlapping shifts at once', async () => {
    const { backend, shift, workerA } = await setupOfferedShift();

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const clashing = await backend.createShift(
      shiftInput({ title: 'Afternoon Barista', startTime: '16:00', endTime: '20:00' }),
    );
    const second = await backend.sendOffers(clashing.id, [workerA]);

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    const forOriginal = (await backend.listMyOffers()).find((o) => o.shiftId === shift.id)!;

    // Both in flight before either resolves.
    const results = await Promise.all([
      backend.acceptOffer(forOriginal.id),
      backend.acceptOffer(second.offers[0].id),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual(['accepted', 'overlap']);
    expect(results.filter((r) => r.booking)).toHaveLength(1);
    expect(await backend.listMyBookings()).toHaveLength(1);
  });

  it('allows a booking on the same day that does not overlap', async () => {
    const { backend, shift, workerA } = await setupOfferedShift();

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const evening = await backend.createShift(
      shiftInput({ title: 'Evening Barista', startTime: '17:00', endTime: '21:00' }),
    );
    const second = await backend.sendOffers(evening.id, [workerA]);

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    const forOriginal = (await backend.listMyOffers()).find((o) => o.shiftId === shift.id)!;
    await backend.acceptOffer(forOriginal.id);

    expect((await backend.acceptOffer(second.offers[0].id)).status).toBe('accepted');
    expect(await backend.listMyBookings()).toHaveLength(2);
  });
});

// BIG-59.
describe('acceptOffer preconditions', () => {
  it('closes the shift, so other workers stop seeing it in the deck', async () => {
    const { backend, shift, offerA } = await setupOfferedShift();

    // A third worker, never offered the shift and never having swiped it, is
    // the one this criterion is about — A and B already swiped it away.
    await signUpWorker(backend, WORKER_C, 'Cal Worker');
    expect((await backend.workerDeck()).map((s) => s.id)).toContain(shift.id);

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    expect((await backend.acceptOffer(offerA.id)).status).toBe('accepted');

    await backend.signIn(WORKER_C.email, WORKER_C.password);
    expect((await backend.workerDeck()).map((s) => s.id)).not.toContain(shift.id);
  });

  it('rejects an offer whose shift the employer has since closed', async () => {
    const { backend, shift, offerA } = await setupOfferedShift();

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    await backend.closeShift(shift.id);

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    await expect(backend.acceptOffer(offerA.id)).rejects.toThrow(/no longer open/);
    expect(await backend.listMyBookings()).toHaveLength(0);
  });

  /**
   * Nothing in either backend writes `declined`, and the other non-`sent`
   * statuses only exist once a booking does — which the `filled` branch answers
   * first. So the guard is unreachable through the API and the state has to be
   * seeded to exercise it at all.
   */
  it('rejects an offer that is not sent', async () => {
    const { backend, offerA } = await setupOfferedShift();

    const db = JSON.parse((await AsyncStorage.getItem('shiftmatch.db.v1'))!);
    db.offers.find((o: any) => o.id === offerA.id).status = 'declined';
    await AsyncStorage.setItem('shiftmatch.db.v1', JSON.stringify(db));

    const fresh = new MockBackend();
    await fresh.signIn(WORKER_A.email, WORKER_A.password);
    await expect(fresh.acceptOffer(offerA.id)).rejects.toThrow(/no longer available/);
    expect(await fresh.listMyBookings()).toHaveLength(0);
  });

  it('still answers filled to the loser rather than a precondition error', async () => {
    const { backend, offerA, offerB } = await setupOfferedShift();

    await backend.signIn(WORKER_A.email, WORKER_A.password);
    await backend.acceptOffer(offerA.id);

    // B's offer is now `filled` and the shift `closed` — both preconditions
    // fail — but the friendly answer has to win.
    await backend.signIn(WORKER_B.email, WORKER_B.password);
    expect((await backend.acceptOffer(offerB.id)).status).toBe('filled');
  });
});

describe('backend parity', () => {
  const OFFER_METHODS = [
    'interestedWorkers',
    'sendOffers',
    'listMyOffers',
    'acceptOffer',
    'listMyBookings',
    'registerPushToken',
  ] as const;

  it('both backends implement every offer method', () => {
    for (const name of OFFER_METHODS) {
      expect(typeof (MockBackend.prototype as any)[name]).toBe('function');
      expect(typeof (SupabaseBackend.prototype as any)[name]).toBe('function');
    }
  });

  it('both backends return the same shapes for the three offer methods', async () => {
    const { backend: mock, shift, workerA } = await setupOfferedShift();
    await mock.signIn(WORKER_A.email, WORKER_A.password);
    const mockOffers = await mock.listMyOffers();
    const mockAccept = await mock.acceptOffer(mockOffers[0].id);

    const live = new SupabaseBackend();
    const asUser = stubSupabase(live, shift, workerA);
    asUser('biz');
    const liveBatch = await live.sendOffers(shift.id, [workerA]);
    asUser(workerA);
    const liveOffers = await live.listMyOffers();
    const liveAccept = await live.acceptOffer(liveOffers[0].id);

    await mock.signIn(BUSINESS.email, BUSINESS.password);
    const mockBatch = await mock.sendOffers(shift.id, [workerA]);

    expect(keysOf(liveBatch)).toEqual(keysOf(mockBatch));
    expect(keysOf(liveBatch.offers[0])).toEqual(keysOf(mockBatch.offers[0]));
    expect(keysOf(liveOffers[0])).toEqual(keysOf(mockOffers[0]));
    expect(keysOf(liveAccept)).toEqual(keysOf(mockAccept));
    expect(keysOf(liveAccept.booking!)).toEqual(keysOf(mockAccept.booking!));
    expect(liveOffers[0].shift && keysOf(liveOffers[0].shift)).toEqual(
      mockOffers[0].shift && keysOf(mockOffers[0].shift),
    );
  });
});

/**
 * Fields actually carrying a value. Explicit `undefined` is ignored because
 * JSON persistence drops it, so it can't be part of the contract either way.
 */
function keysOf(o: object): string[] {
  return Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => k)
    .sort();
}

/**
 * Minimal stand-in for the Supabase client: enough of the chainable query
 * builder to drive the offer methods and compare their output shapes.
 * Returns a setter for the signed-in user id.
 */
function stubSupabase(backend: SupabaseBackend, shift: Shift, workerId: string) {
  const shiftRow = {
    id: shift.id,
    business_id: 'biz',
    title: shift.title,
    role: shift.role,
    pay_rate: shift.payRate,
    pay_type: shift.payType,
    date: shift.date,
    start_time: shift.startTime,
    end_time: shift.endTime,
    location: shift.location,
    description: shift.description,
    requirements: shift.requirements,
    status: 'open',
    fill_mode: 'race',
    created_at: shift.createdAt,
    businesses: {
      id: 'biz',
      company_name: 'Blue Harbor Coffee',
      category: 'Café',
      city: 'Oakland, CA',
      about: '',
      contact_name: 'Dana',
      logo_url: null,
    },
  };
  const batchRow = {
    id: 'batch_1',
    shift_id: shift.id,
    business_id: 'biz',
    created_at: shift.createdAt,
  };
  const offerRow = {
    id: 'offer_1',
    batch_id: batchRow.id,
    shift_id: shift.id,
    worker_id: workerId,
    status: 'sent',
    created_at: shift.createdAt,
    responded_at: null,
    shifts: shiftRow,
  };
  const bookingRow = {
    id: 'booking_1',
    shift_id: shift.id,
    worker_id: workerId,
    business_id: 'biz',
    offer_id: offerRow.id,
    status: 'confirmed',
    created_at: shift.createdAt,
  };

  const rowsFor: Record<string, any[]> = {
    shifts: [shiftRow],
    offer_batches: [batchRow],
    offers: [offerRow],
    bookings: [bookingRow],
    push_tokens: [],
  };

  // Every builder method returns `this`; awaiting it yields the table's rows.
  const builder = (table: string) => {
    const rows = rowsFor[table] ?? [];
    const self: any = {
      select: () => self,
      insert: () => self,
      upsert: () => self,
      update: () => self,
      eq: () => self,
      neq: () => self,
      in: () => self,
      order: () => self,
      single: async () => ({ data: rows[0], error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    return self;
  };

  let currentUser = workerId;
  Object.defineProperty(backend, 'sb', {
    get: () => ({
      auth: { getUser: async () => ({ data: { user: { id: currentUser } } }) },
      from: (table: string) => builder(table),
      rpc: async () => ({ data: { status: 'accepted', bookingId: bookingRow.id }, error: null }),
    }),
  });

  return (userId: string) => {
    currentUser = userId;
  };
}
