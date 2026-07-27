/**
 * Swiping registers interest, not agreement (BIG-40).
 *
 * A worker's like writes a swipe and opens a conversation thread. It must not
 * book anything: booking has exactly one commit point, `acceptOffer`. The live
 * backend gets the same guarantee from the `on_swipe` trigger in db/schema.sql,
 * which inserts into `matches` only — never into `bookings`.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DB_KEY, MockBackend } from '../mockBackend';
import type { Backend } from '../backend';

// Push is native-only and irrelevant to swiping.
jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BUSINESS = { email: 'biz@test.dev', password: 'pw' };
const WORKER_A = { email: 'a@test.dev', password: 'pw' };
const WORKER_B = { email: 'b@test.dev', password: 'pw' };

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
    fillMode: 'standard',
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
    yearsExperience: 3,
    availability: [],
  });
  return session.userId;
}

/** A business with two open shifts and nobody interested yet. */
async function setupBusiness() {
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
  const shiftOne = await backend.createShift(shiftInput({ title: 'Morning Bar' }));
  const shiftTwo = await backend.createShift(shiftInput({ title: 'Evening Bar' }));
  return { backend, shiftOne, shiftTwo };
}

describe('swipeShift', () => {
  it('a like registers interest and opens a thread, booking nothing', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');

    const res = await backend.swipeShift(shiftOne.id, 'like');

    expect(res.interested).toBe(true);
    expect(res.thread?.shiftId).toBe(shiftOne.id);
    // The one thing a swipe must never do.
    expect(await backend.listMyBookings()).toHaveLength(0);
  });

  it('a pass registers no interest and opens no thread', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');

    const res = await backend.swipeShift(shiftOne.id, 'pass');

    expect(res.interested).toBe(false);
    expect(res.thread).toBeUndefined();
    expect(await backend.listMatches()).toHaveLength(0);
  });

  it('does not need the employer to like back — the thread opens on the first like', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');

    await backend.swipeShift(shiftOne.id, 'like');

    // No reciprocal action of any kind has happened.
    expect(await backend.listMatches()).toHaveLength(1);
  });

  it('swiping the same shift twice reuses the one thread', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');

    const first = await backend.swipeShift(shiftOne.id, 'like');
    const second = await backend.swipeShift(shiftOne.id, 'like');

    expect(second.thread?.id).toBe(first.thread?.id);
    expect(await backend.listMatches()).toHaveLength(1);
  });
});

describe('listInterested', () => {
  it('lists every interested worker once, grouped-ready and newest first', async () => {
    const { backend, shiftOne, shiftTwo } = await setupBusiness();

    const ada = await signUpWorker(backend, WORKER_A, 'Ada Worker');
    await backend.swipeShift(shiftOne.id, 'like');
    await backend.swipeShift(shiftTwo.id, 'like');
    // A second like on a shift she already wants must not duplicate her row.
    await backend.swipeShift(shiftOne.id, 'like');

    const ben = await signUpWorker(backend, WORKER_B, 'Ben Worker');
    await backend.swipeShift(shiftOne.id, 'like');

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const rows = await backend.listInterested();
    // Posting a shift seeds demo interest from the sample workers, so scope the
    // count to the two workers this test signed up.
    const mine = rows.filter((r) => r.worker.id === ada || r.worker.id === ben);

    expect(mine).toHaveLength(3);
    const forShiftOne = mine.filter((r) => r.shift.id === shiftOne.id);
    expect(forShiftOne.map((r) => r.worker.id).sort()).toEqual([ada, ben].sort());
    expect(mine.filter((r) => r.shift.id === shiftTwo.id).map((r) => r.worker.id)).toEqual([ada]);

    // Newest first across the whole queue, so fresh interest is at the top.
    const times = rows.map((r) => r.swipedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('carries the thread id so the Message action has a destination', async () => {
    const { backend, shiftOne } = await setupBusiness();
    const ada = await signUpWorker(backend, WORKER_A, 'Ada Worker');
    const swipe = await backend.swipeShift(shiftOne.id, 'like');

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const rows = await backend.listInterested();
    const row = rows.find((r) => r.worker.id === ada)!;

    expect(row.threadId).toBe(swipe.thread?.id);
    expect(await backend.getMatch(row.threadId!)).not.toBeNull();
    // Seeded interest carries a thread too, so no row has a dead Message action.
    expect(rows.every((r) => !!r.threadId)).toBe(true);
  });

  it('excludes workers who passed, and shifts belonging to another business', async () => {
    const { backend, shiftOne } = await setupBusiness();

    const ada = await signUpWorker(backend, WORKER_A, 'Ada Worker');
    await backend.swipeShift(shiftOne.id, 'pass');

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const rows = await backend.listInterested();
    expect(rows.map((r) => r.worker.id)).not.toContain(ada);

    // A different employer sees none of this shift's interest.
    await backend.signUp('other@test.dev', 'pw');
    await backend.saveBusinessProfile({
      companyName: 'Rival Roasters',
      category: 'Café',
      city: 'Oakland, CA',
      about: '',
      contactName: 'Sam',
    });
    expect(await backend.listInterested()).toHaveLength(0);
  });

  it('drops a shift from the queue once it is closed', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');
    await backend.swipeShift(shiftOne.id, 'like');

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const forShift = async () =>
      (await backend.listInterested()).filter((r) => r.shift.id === shiftOne.id);
    expect((await forShift()).length).toBeGreaterThan(0);

    await backend.closeShift(shiftOne.id);
    expect(await forShift()).toHaveLength(0);
  });
});

describe('thread backfill', () => {
  it('opens threads for likes saved before threads opened on first like', async () => {
    const { backend, shiftOne, shiftTwo } = await setupBusiness();
    const ada = await signUpWorker(backend, WORKER_A, 'Ada Worker');
    await backend.swipeShift(shiftOne.id, 'like');

    // Rewind to the old world: the likes survive, the threads do not.
    const db = JSON.parse((await AsyncStorage.getItem(DB_KEY))!);
    type Swipe = { role: string; direction: string; shiftId: string; workerId: string };
    // One thread per interested worker per shift, however often they swiped.
    // Scoped to this employer's shifts — the seed ships other businesses too.
    const mineIds = [shiftOne.id, shiftTwo.id];
    const pairs = new Set(
      (db.swipes as Swipe[])
        .filter((s) => s.role === 'worker' && s.direction !== 'pass')
        .filter((s) => mineIds.includes(s.shiftId))
        .map((s) => `${s.shiftId}:${s.workerId}`),
    );
    expect(pairs.size).toBeGreaterThan(0);
    db.matches = [];
    await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));

    // Loading migrates: one thread per outstanding like, and Message works again.
    const reopened = new MockBackend();
    await reopened.signIn(BUSINESS.email, BUSINESS.password);
    const rows = await reopened.listInterested();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !!r.threadId)).toBe(true);
    expect(rows.some((r) => r.worker.id === ada)).toBe(true);
    // Exactly one thread per outstanding like on this employer's shifts.
    expect(await reopened.listMatches()).toHaveLength(pairs.size);
  });

  it('keeps backfilled thread ids stable across reloads', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');
    await backend.swipeShift(shiftOne.id, 'like');

    const db = JSON.parse((await AsyncStorage.getItem(DB_KEY))!);
    db.matches = [];
    await AsyncStorage.setItem(DB_KEY, JSON.stringify(db));

    // The backfill mints ids, so it has to be written back — otherwise every
    // reload hands out new ones and any link into a conversation goes dead.
    const first = new MockBackend();
    await first.signIn(BUSINESS.email, BUSINESS.password);
    const idsFirst = (await first.listInterested()).map((r) => r.threadId);

    const second = new MockBackend();
    await second.signIn(BUSINESS.email, BUSINESS.password);
    const idsSecond = (await second.listInterested()).map((r) => r.threadId);

    expect(idsFirst.every(Boolean)).toBe(true);
    expect(idsSecond).toEqual(idsFirst);
    // And the thread each id names is really there.
    for (const id of idsFirst) expect(await second.getMatch(id!)).not.toBeNull();
  });

  it('leaves existing threads and their messages alone', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');
    const { thread } = await backend.swipeShift(shiftOne.id, 'like');
    const sent = await backend.sendMessage(thread!.id, 'Still here?');

    // Re-open the app: migration runs again over a database that needs nothing.
    const reopened = new MockBackend();
    await reopened.signIn(WORKER_A.email, WORKER_A.password);

    const threads = await reopened.listMatches();
    expect(threads.map((t) => t.id)).toContain(thread!.id);
    expect((await reopened.listMessages(thread!.id)).map((m) => m.id)).toContain(sent.id);
  });
});

describe('conversation threads', () => {
  it('keeps existing messages readable after the thread opens', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');
    const { thread } = await backend.swipeShift(shiftOne.id, 'like');

    const sent = await backend.sendMessage(thread!.id, 'Is parking available?');
    const messages = await backend.listMessages(thread!.id);

    expect(messages.map((m) => m.id)).toContain(sent.id);
    expect(messages.at(-1)?.body).toBe('Is parking available?');
  });

  it('the employer sees the same thread the worker opened', async () => {
    const { backend, shiftOne } = await setupBusiness();
    await signUpWorker(backend, WORKER_A, 'Ada Worker');
    const { thread } = await backend.swipeShift(shiftOne.id, 'like');

    await backend.signIn(BUSINESS.email, BUSINESS.password);
    const threads = await backend.listMatches();

    // Demo seeding opens its own threads, so assert presence rather than count.
    expect(threads.map((t) => t.id)).toContain(thread!.id);
  });
});
