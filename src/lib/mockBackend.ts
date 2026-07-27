/**
 * In-memory demo backend, persisted to AsyncStorage. Implements the full
 * Flexi flow (auth, profiles, swiping, mutual matches, chat) with no
 * external services, so the app is fully usable out of the box.
 *
 * Demo conventions (documented in the README):
 *  - A worker "liking" a shift creates a match immediately — the seeded
 *    business is treated as having already liked the worker. In the live
 *    Supabase backend a match requires both real swipes.
 *  - Seeded workers arrive having already liked specific shifts, so a new
 *    business account has applicants to review right away.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MAX_OFFERS_PER_BATCH, type Backend } from './backend';
import { presentOfferNotificationLocally } from './push';
import { SEED_BUSINESSES, SEED_SHIFTS, SEED_WORKERS } from './seed';
import type {
  AcceptOfferResult,
  Account,
  Booking,
  Business,
  InterestedWorker,
  Match,
  Message,
  Offer,
  OfferBatch,
  ResumeFile,
  Role,
  Session,
  Shift,
  SwipeDirection,
  SwipeResult,
  WorkerProfile,
} from './types';
import { hasShiftEnded, minutesOfDay, uid } from './util';

interface StoredAccount {
  userId: string;
  email: string;
  password: string;
  role: Role | null;
  worker?: WorkerProfile;
  business?: Business;
}

interface Swipe {
  id: string;
  swiperId: string;
  role: Role;
  shiftId: string;
  workerId: string;
  direction: SwipeDirection;
  createdAt: string;
}

interface DB {
  version: number;
  accounts: Record<string, StoredAccount>;
  shifts: Shift[];
  swipes: Swipe[];
  matches: Match[];
  messages: Message[];
  offerBatches: OfferBatch[];
  offers: Offer[];
  bookings: Booking[];
  pushTokens: Record<string, string[]>;
}

export const DB_KEY = 'flexi.db.v1';
export const SESSION_KEY = 'flexi.session.v1';

/** Pre-rename keys. Read once on load, then removed. See `adoptLegacyKeys`. */
const LEGACY_DB_KEY = 'shiftmatch.db.v1';
const LEGACY_SESSION_KEY = 'shiftmatch.session.v1';

/**
 * Fill in anything a DB persisted by an older build is missing, so upgrading
 * doesn't wipe someone's demo state.
 */
/**
 * Move a demo database written under the pre-rename keys across, once.
 *
 * Without this the rename reads as data loss: nothing lives at the new key, so
 * `load` re-seeds and a returning demo user silently loses their account,
 * shifts, matches and bookings. Only moves when the new key is empty, so it can
 * never clobber newer data, and clears the old key so it runs at most once.
 */
async function adoptLegacyKeys(): Promise<void> {
  const [legacyDb, currentDb] = await Promise.all([
    AsyncStorage.getItem(LEGACY_DB_KEY),
    AsyncStorage.getItem(DB_KEY),
  ]);
  if (legacyDb == null || currentDb != null) return;

  const legacySession = await AsyncStorage.getItem(LEGACY_SESSION_KEY);
  await AsyncStorage.setItem(DB_KEY, legacyDb);
  if (legacySession != null) await AsyncStorage.setItem(SESSION_KEY, legacySession);
  await AsyncStorage.multiRemove([LEGACY_DB_KEY, LEGACY_SESSION_KEY]);
}

/**
 * Returns the migrated database and whether anything actually changed. The
 * caller has to persist when it did: `backfillThreads` mints ids, so leaving
 * the result in memory would hand out different thread ids on every load and
 * break any link into a conversation.
 */
function migrate(db: DB): { db: DB; changed: boolean } {
  db.offerBatches ??= [];
  db.offers ??= [];
  db.bookings ??= [];
  db.pushTokens ??= {};
  for (const s of db.shifts) s.fillMode ??= 'standard';
  const opened = backfillThreads(db);
  return { db, changed: opened > 0 };
}

/**
 * Threads used to open only on a mutual like, so likes saved before that
 * changed have none — leaving the employer's Message action with nowhere to go.
 * Open one per outstanding like, mirroring the `on_swipe` trigger. Existing
 * threads and their messages are untouched. Returns how many it opened.
 */
function backfillThreads(db: DB): number {
  let opened = 0;
  const existing = new Set(db.matches.map((m) => `${m.shiftId}:${m.workerId}`));
  for (const swipe of db.swipes) {
    if (swipe.role !== 'worker' || swipe.direction === 'pass') continue;
    const key = `${swipe.shiftId}:${swipe.workerId}`;
    if (existing.has(key)) continue;
    const shift = db.shifts.find((s) => s.id === swipe.shiftId);
    if (!shift) continue;
    existing.add(key);
    opened += 1;
    db.matches.push({
      id: uid('match'),
      shiftId: shift.id,
      workerId: swipe.workerId,
      businessId: shift.businessId,
      createdAt: swipe.createdAt,
    });
  }
  return opened;
}

function seedDB(): DB {
  const accounts: Record<string, StoredAccount> = {};

  for (const b of SEED_BUSINESSES) {
    accounts[b.id] = {
      userId: b.id,
      email: `${b.id}@demo.flexi`,
      password: 'demo',
      role: 'business',
      business: b,
    };
  }

  const swipes: Swipe[] = [];
  for (const w of SEED_WORKERS) {
    const { likedShiftIds, ...worker } = w;
    accounts[w.id] = {
      userId: w.id,
      email: `${w.id}@demo.flexi`,
      password: 'demo',
      role: 'worker',
      worker,
    };
    for (const shiftId of likedShiftIds) {
      swipes.push({
        id: uid('swipe'),
        swiperId: w.id,
        role: 'worker',
        shiftId,
        workerId: w.id,
        direction: 'like',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return {
    version: 1,
    accounts,
    shifts: SEED_SHIFTS.map((s) => ({ ...s })),
    swipes,
    matches: [],
    messages: [],
    offerBatches: [],
    offers: [],
    bookings: [],
    pushTokens: {},
  };
}

/** Simple in-process event bus for realtime message subscriptions. */
type MsgListener = (m: Message) => void;
/**
 * A shift's window in absolute minutes, mirroring `shift_slot` in
 * db/schema.sql. An end that is not after the start means the shift runs past
 * midnight, so the end belongs to the following day — which is why this returns
 * an absolute span rather than two times to compare within one date.
 */
function shiftSpan(shift: Shift): [number, number] {
  const day = Date.parse(`${shift.date}T00:00:00Z`) / 60_000;
  const start = minutesOfDay(shift.startTime);
  const end = minutesOfDay(shift.endTime);
  return [day + start, day + (end > start ? end : end + 24 * 60)];
}

const listeners = new Map<string, Set<MsgListener>>();
function emit(matchId: string, m: Message) {
  listeners.get(matchId)?.forEach((cb) => cb(m));
}

export class MockBackend implements Backend {
  readonly isLive = false;
  private db: DB | null = null;
  private currentUserId: string | null = null;
  private loaded = false;
  /** Serialises offer accepts, standing in for the live backend's row lock. */
  private acceptQueue: Promise<unknown> = Promise.resolve();

  // ---- persistence ----
  private async load() {
    if (this.loaded) return;
    await adoptLegacyKeys();
    const [rawDb, rawSession] = await Promise.all([
      AsyncStorage.getItem(DB_KEY),
      AsyncStorage.getItem(SESSION_KEY),
    ]);
    const migrated = migrate(rawDb ? (JSON.parse(rawDb) as DB) : seedDB());
    this.db = migrated.db;
    this.currentUserId = rawSession || null;
    this.loaded = true;
    if (!rawDb || migrated.changed) await this.persist();
  }

  private async persist() {
    if (this.db) await AsyncStorage.setItem(DB_KEY, JSON.stringify(this.db));
  }

  private async setSession(userId: string | null) {
    this.currentUserId = userId;
    if (userId) await AsyncStorage.setItem(SESSION_KEY, userId);
    else await AsyncStorage.removeItem(SESSION_KEY);
  }

  private get data(): DB {
    if (!this.db) throw new Error('Backend not loaded');
    return this.db;
  }

  private me(): StoredAccount {
    if (!this.currentUserId) throw new Error('Not signed in');
    const acc = this.data.accounts[this.currentUserId];
    if (!acc) throw new Error('Account not found');
    return acc;
  }

  // ---- hydration ----
  private hydrateShift(s: Shift): Shift {
    return { ...s, business: this.data.accounts[s.businessId]?.business };
  }

  private hydrateMatch(m: Match): Match {
    return {
      ...m,
      shift: this.data.shifts.find((s) => s.id === m.shiftId),
      worker: this.data.accounts[m.workerId]?.worker,
      business: this.data.accounts[m.businessId]?.business,
    };
  }

  // ---- auth ----
  async getSession(): Promise<Session | null> {
    await this.load();
    if (!this.currentUserId) return null;
    const acc = this.data.accounts[this.currentUserId];
    return acc ? { userId: acc.userId, email: acc.email } : null;
  }

  async signUp(email: string, password: string): Promise<Session> {
    await this.load();
    const normalized = email.trim().toLowerCase();
    const exists = Object.values(this.data.accounts).find((a) => a.email === normalized);
    if (exists) throw new Error('An account with that email already exists.');
    const userId = uid('user');
    this.data.accounts[userId] = { userId, email: normalized, password, role: null };
    await this.persist();
    await this.setSession(userId);
    return { userId, email: normalized };
  }

  async signIn(email: string, password: string): Promise<Session> {
    await this.load();
    const normalized = email.trim().toLowerCase();
    const acc = Object.values(this.data.accounts).find((a) => a.email === normalized);
    if (!acc || acc.password !== password) throw new Error('Invalid email or password.');
    await this.setSession(acc.userId);
    return { userId: acc.userId, email: acc.email };
  }

  async signOut(): Promise<void> {
    await this.setSession(null);
  }

  // ---- account / profile ----
  async getAccount(): Promise<Account | null> {
    await this.load();
    if (!this.currentUserId) return null;
    const acc = this.data.accounts[this.currentUserId];
    if (!acc) return null;
    return {
      session: { userId: acc.userId, email: acc.email },
      role: acc.role,
      worker: acc.worker,
      business: acc.business,
    };
  }

  async setRole(role: Role): Promise<void> {
    this.me().role = role;
    await this.persist();
  }

  async saveWorkerProfile(data: Omit<WorkerProfile, 'id'>): Promise<WorkerProfile> {
    const acc = this.me();
    const worker: WorkerProfile = { ...acc.worker, ...data, id: acc.userId };
    acc.worker = worker;
    acc.role = 'worker';
    await this.persist();
    return worker;
  }

  async saveBusinessProfile(data: Omit<Business, 'id'>): Promise<Business> {
    const acc = this.me();
    const business: Business = {
      ...acc.business,
      ...data,
      id: acc.userId,
      // `{}` rather than undefined when the voice step is skipped, so readers
      // never have to tell "skipped" from "not asked yet". Matches the column
      // default in db/schema.sql.
      aiProfile: data.aiProfile ?? acc.business?.aiProfile ?? {},
    };
    acc.business = business;
    acc.role = 'business';
    await this.persist();
    return business;
  }

  async uploadResume(file: ResumeFile): Promise<{ url: string; name: string }> {
    // Demo: we just keep the local uri/name. Live backend uploads to Storage.
    const acc = this.me();
    if (acc.worker) {
      acc.worker.resumeUrl = file.uri;
      acc.worker.resumeName = file.name;
      await this.persist();
    }
    return { url: file.uri, name: file.name };
  }

  async resolveResumeUrl(ref: string): Promise<string | null> {
    // Demo résumés are device-local URIs. Nothing to sign, and deliberately no
    // network call — the demo has to work with no project configured.
    return ref || null;
  }

  // ---- shifts ----
  async workerDeck(): Promise<Shift[]> {
    await this.load();
    const meId = this.me().userId;
    const swiped = new Set(
      this.data.swipes.filter((s) => s.swiperId === meId).map((s) => s.shiftId),
    );
    return this.data.shifts
      // A shift that is over cannot be worked, so it leaves the deck without
      // anyone having to close it. Derived from the clock, never written.
      .filter((s) => s.status === 'open' && !swiped.has(s.id) && !hasShiftEnded(s))
      .map((s) => this.hydrateShift(s));
  }

  async myShifts(): Promise<Shift[]> {
    await this.load();
    const meId = this.me().userId;
    return this.data.shifts
      .filter((s) => s.businessId === meId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => this.hydrateShift(s));
  }

  async createShift(
    data: Omit<Shift, 'id' | 'businessId' | 'status' | 'createdAt' | 'business'>,
  ): Promise<Shift> {
    const acc = this.me();
    const shift: Shift = {
      ...data,
      id: uid('shift'),
      businessId: acc.userId,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    this.data.shifts.unshift(shift);
    this.seedApplicants(shift);
    await this.persist();
    return this.hydrateShift(shift);
  }

  /**
   * Demo nicety: when a business posts a shift, have a couple of seeded workers
   * "like" it so the Interested queue has people in it right away. (No-op in
   * the live backend, where interest comes from real worker swipes.)
   */
  private seedApplicants(shift: Shift) {
    const seededWorkers = Object.values(this.data.accounts).filter(
      (a) => a.role === 'worker' && a.userId.startsWith('wk_') && a.worker,
    );
    const roleLc = shift.role.toLowerCase();
    const relevant = seededWorkers.filter((a) =>
      a.worker!.headline.toLowerCase().includes(roleLc.split(' ')[0]),
    );
    const pick = (relevant.length ? relevant : seededWorkers).slice(0, 2);
    for (const a of pick) {
      this.data.swipes.push({
        id: uid('swipe'),
        swiperId: a.userId,
        role: 'worker',
        shiftId: shift.id,
        workerId: a.userId,
        direction: 'like',
        createdAt: new Date().toISOString(),
      });
      // A like opens a thread, so the employer's Message action works on
      // seeded interest exactly as it does on real interest.
      this.openThread(shift, a.userId);
    }
  }

  async closeShift(shiftId: string): Promise<void> {
    const shift = this.data.shifts.find((s) => s.id === shiftId);
    if (shift) shift.status = 'closed';
    await this.persist();
  }

  // ---- swiping ----
  private findThread(shiftId: string, workerId: string): Match | undefined {
    return this.data.matches.find((m) => m.shiftId === shiftId && m.workerId === workerId);
  }

  /** Mirrors the `on_swipe` trigger: idempotent per (shift, worker). */
  private openThread(shift: Shift, workerId: string): Match {
    const existing = this.findThread(shift.id, workerId);
    if (existing) return existing;
    const match: Match = {
      id: uid('match'),
      shiftId: shift.id,
      workerId,
      businessId: shift.businessId,
      createdAt: new Date().toISOString(),
    };
    this.data.matches.unshift(match);
    // Nothing is written into the thread. It used to seed a greeting with
    // `senderId` set to the business, which meant the worker read a message
    // the employer never wrote and never saw. The employer gets a draft
    // opener in the thread instead, and only they can see it (BIG-79).
    return match;
  }

  async swipeShift(shiftId: string, direction: SwipeDirection): Promise<SwipeResult> {
    const acc = this.me();
    const shift = this.data.shifts.find((s) => s.id === shiftId);
    if (!shift) return { interested: false };
    this.data.swipes.push({
      id: uid('swipe'),
      swiperId: acc.userId,
      role: 'worker',
      shiftId,
      workerId: acc.userId,
      direction,
      createdAt: new Date().toISOString(),
    });
    let result: SwipeResult = { interested: false };
    if (direction !== 'pass') {
      // A like registers interest and opens a thread. Nothing is booked here.
      const thread = this.openThread(shift, acc.userId);
      result = { interested: true, thread: this.hydrateMatch(thread) };
    }
    await this.persist();
    return result;
  }

  async listInterested(): Promise<InterestedWorker[]> {
    await this.load();
    const meId = this.me().userId;
    const myShiftIds = new Set(
      this.data.shifts
        .filter((s) => s.businessId === meId && s.status === 'open' && !hasShiftEnded(s))
        .map((s) => s.id),
    );
    // One row per worker per shift: a worker who swipes the same shift twice is
    // still one interested person.
    const seen = new Set<string>();
    const cards: InterestedWorker[] = [];
    for (const swipe of this.data.swipes) {
      if (swipe.role !== 'worker' || swipe.direction === 'pass') continue;
      if (!myShiftIds.has(swipe.shiftId)) continue;
      const key = `${swipe.shiftId}:${swipe.workerId}`;
      if (seen.has(key)) continue;
      const worker = this.data.accounts[swipe.workerId]?.worker;
      const shift = this.data.shifts.find((s) => s.id === swipe.shiftId);
      if (!worker || !shift) continue;
      seen.add(key);
      cards.push({
        worker,
        shift: this.hydrateShift(shift),
        swipedAt: swipe.createdAt,
        threadId: this.findThread(swipe.shiftId, swipe.workerId)?.id,
      });
    }
    return cards.sort((a, b) => b.swipedAt.localeCompare(a.swipedAt));
  }

  async getWorkerProfile(workerId: string): Promise<WorkerProfile | null> {
    await this.load();
    const acc = this.me();
    // Workers never browse each other. Only an employer asking about someone
    // connected to their own shifts gets an answer.
    if (acc.role !== 'business') return null;

    const myShiftIds = new Set(
      this.data.shifts.filter((s) => s.businessId === acc.userId).map((s) => s.id),
    );
    const connected =
      this.data.swipes.some(
        (s) =>
          s.role === 'worker' &&
          s.direction !== 'pass' &&
          s.workerId === workerId &&
          myShiftIds.has(s.shiftId),
      ) ||
      this.data.offers.some((o) => o.workerId === workerId && myShiftIds.has(o.shiftId)) ||
      this.data.bookings.some((b) => b.workerId === workerId && myShiftIds.has(b.shiftId));

    return connected ? this.data.accounts[workerId]?.worker ?? null : null;
  }

  // ---- race-mode offers ----
  async interestedWorkers(shiftId: string): Promise<InterestedWorker[]> {
    await this.load();
    const shift = this.data.shifts.find((s) => s.id === shiftId);
    if (!shift || shift.businessId !== this.me().userId) return [];
    // Nobody can be offered work that is already over.
    if (hasShiftEnded(shift)) return [];
    const hydrated = this.hydrateShift(shift);
    const seen = new Set<string>();
    const cards: InterestedWorker[] = [];
    for (const swipe of this.data.swipes) {
      if (swipe.role !== 'worker' || swipe.direction === 'pass') continue;
      if (swipe.shiftId !== shiftId || seen.has(swipe.workerId)) continue;
      const worker = this.data.accounts[swipe.workerId]?.worker;
      if (!worker) continue;
      seen.add(swipe.workerId);
      cards.push({ worker, shift: hydrated, swipedAt: swipe.createdAt });
    }
    return cards.sort((a, b) => a.swipedAt.localeCompare(b.swipedAt));
  }

  async sendOffers(shiftId: string, workerIds: string[]): Promise<OfferBatch> {
    await this.load();
    const acc = this.me();
    const shift = this.data.shifts.find((s) => s.id === shiftId);
    if (!shift) throw new Error('Shift not found.');
    if (shift.businessId !== acc.userId) throw new Error('That is not your shift.');
    if (shift.status !== 'open') throw new Error('This shift is no longer open.');
    if (hasShiftEnded(shift)) throw new Error('This shift has already ended.');

    const unique = [...new Set(workerIds)];
    if (unique.length === 0) throw new Error('Pick at least one worker.');
    if (unique.length > MAX_OFFERS_PER_BATCH) {
      throw new Error(`You can offer a shift to at most ${MAX_OFFERS_PER_BATCH} workers at once.`);
    }

    const now = new Date().toISOString();
    const batch: OfferBatch = {
      id: uid('batch'),
      shiftId,
      businessId: acc.userId,
      createdAt: now,
      offers: unique.map((workerId) => ({
        id: uid('offer'),
        batchId: '',
        shiftId,
        workerId,
        status: 'sent' as const,
        createdAt: now,
      })),
    };
    for (const o of batch.offers) o.batchId = batch.id;

    this.data.offerBatches.unshift(batch);
    this.data.offers.unshift(...batch.offers);
    await this.persist();

    // Demo: every "worker" is this same device, so notify locally (AC-3).
    await presentOfferNotificationLocally(this.hydrateShift(shift));

    return { ...batch, offers: batch.offers.map((o) => this.hydrateOffer(o)) };
  }

  async listMyOffers(): Promise<Offer[]> {
    await this.load();
    const meId = this.me().userId;
    return this.data.offers
      .filter((o) => o.workerId === meId && o.status === 'sent')
      .map((o) => this.hydrateOffer(o))
      // A live offer for a shift that has ended is not actionable, so it is not
      // shown. The offer row is left alone — expiring it is BIG-50/54's job.
      .filter((o) => !o.shift || !hasShiftEnded(o.shift))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Deliberately not `async`: the caller's identity is captured synchronously,
   * so two accepts fired back to back from different sessions each keep their
   * own worker. The queue then runs them one at a time, standing in for the
   * live backend's `select ... for update` on the shift row.
   */
  acceptOffer(offerId: string): Promise<AcceptOfferResult> {
    const meId = this.currentUserId;
    if (!meId) return Promise.reject(new Error('Not signed in'));
    const run = this.acceptQueue.then(
      () => this.acceptOfferLocked(offerId, meId),
      () => this.acceptOfferLocked(offerId, meId),
    );
    this.acceptQueue = run.catch(() => undefined);
    return run;
  }

  private async acceptOfferLocked(offerId: string, meId: string): Promise<AcceptOfferResult> {
    await this.load();
    const offer = this.data.offers.find((o) => o.id === offerId);
    if (!offer || offer.workerId !== meId) throw new Error('Offer not found.');
    const shift = this.data.shifts.find((s) => s.id === offer.shiftId);
    if (!shift) throw new Error('Shift not found.');

    const now = new Date().toISOString();

    // Someone already won this shift.
    if (this.data.bookings.some((b) => b.shiftId === offer.shiftId)) {
      for (const o of this.data.offers) {
        if (o.shiftId === offer.shiftId && o.status === 'sent') {
          o.status = 'filled';
          o.respondedAt = now;
        }
      }
      await this.persist();
      return { status: 'filled' };
    }

    // Preconditions, checked after the booking test above so a worker who lost
    // the race still gets `filled` rather than one of these.
    if (offer.status !== 'sent') throw new Error('This offer is no longer available.');
    if (shift.status !== 'open') throw new Error('This shift is no longer open.');
    // Booking work that is already over would put a booking behind a payout.
    if (hasShiftEnded(shift)) throw new Error('This shift has already ended.');

    if (this.hasOverlappingBooking(meId, shift)) return { status: 'overlap' };

    const booking: Booking = {
      id: uid('booking'),
      shiftId: offer.shiftId,
      workerId: meId,
      businessId: shift.businessId,
      offerId: offer.id,
      status: 'confirmed',
      createdAt: now,
    };
    this.data.bookings.unshift(booking);

    offer.status = 'accepted';
    offer.respondedAt = now;
    for (const o of this.data.offers) {
      if (o.shiftId === offer.shiftId && o.id !== offer.id && o.status === 'sent') {
        o.status = 'filled';
        o.respondedAt = now;
      }
    }

    // The shift is taken. `workerDeck` selects on 'open', so this is what stops
    // workers who were never offered it from swiping something already gone.
    // `filled`, not `closed`: the work is covered rather than called off, and
    // later policy has to be able to tell those apart.
    shift.status = 'filled';

    await this.persist();
    return { status: 'accepted', booking };
  }

  async declineOffer(offerId: string): Promise<void> {
    await this.load();
    const meId = this.me().userId;
    const offer = this.data.offers.find((o) => o.id === offerId);
    if (!offer || offer.workerId !== meId) throw new Error('Offer not found.');
    // Only a live offer can be turned down. Once it is accepted or filled the
    // race is already decided, and declining must not rewrite that.
    if (offer.status !== 'sent') throw new Error('This offer is no longer available.');

    offer.status = 'declined';
    offer.respondedAt = new Date().toISOString();
    await this.persist();
  }

  async listMyBookings(): Promise<Booking[]> {
    await this.load();
    const meId = this.me().userId;
    return this.data.bookings
      .filter((b) => b.workerId === meId && b.status === 'confirmed')
      .map((b) => {
        const shift = this.data.shifts.find((s) => s.id === b.shiftId);
        return { ...b, shift: shift ? this.hydrateShift(shift) : undefined };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async registerPushToken(token: string): Promise<void> {
    await this.load();
    const meId = this.me().userId;
    const tokens = this.data.pushTokens[meId] ?? [];
    if (!tokens.includes(token)) {
      this.data.pushTokens[meId] = [...tokens, token];
      await this.persist();
    }
  }

  private hydrateOffer(o: Offer): Offer {
    const shift = this.data.shifts.find((s) => s.id === o.shiftId);
    return { ...o, shift: shift ? this.hydrateShift(shift) : undefined };
  }

  /** True when the worker already has a confirmed booking clashing with `shift`. */
  private hasOverlappingBooking(workerId: string, shift: Shift): boolean {
    const [start, end] = shiftSpan(shift);
    return this.data.bookings.some((b) => {
      if (b.workerId !== workerId || b.status !== 'confirmed') return false;
      const other = this.data.shifts.find((s) => s.id === b.shiftId);
      if (!other) return false;
      const [otherStart, otherEnd] = shiftSpan(other);
      return otherStart < end && otherEnd > start;
    });
  }

  // ---- matches + chat ----
  async listMatches(): Promise<Match[]> {
    await this.load();
    const meId = this.me().userId;
    return this.data.matches
      .filter((m) => m.workerId === meId || m.businessId === meId)
      .map((m) => this.hydrateMatch(m))
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  }

  async getMatch(matchId: string): Promise<Match | null> {
    await this.load();
    const m = this.data.matches.find((x) => x.id === matchId);
    return m ? this.hydrateMatch(m) : null;
  }

  async listMessages(matchId: string): Promise<Message[]> {
    await this.load();
    return this.data.messages
      .filter((m) => m.matchId === matchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async sendMessage(matchId: string, body: string): Promise<Message> {
    const acc = this.me();
    const msg: Message = {
      id: uid('msg'),
      matchId,
      senderId: acc.userId,
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
    this.data.messages.push(msg);
    const match = this.data.matches.find((m) => m.id === matchId);
    if (match) {
      match.lastMessage = msg.body;
      match.lastMessageAt = msg.createdAt;
    }
    await this.persist();
    emit(matchId, msg);
    return msg;
  }

  subscribeMessages(matchId: string, onMessage: (m: Message) => void): () => void {
    let set = listeners.get(matchId);
    if (!set) {
      set = new Set();
      listeners.set(matchId, set);
    }
    set.add(onMessage);
    return () => {
      set?.delete(onMessage);
    };
  }

  async dismissOpenerDraft(matchId: string): Promise<void> {
    await this.load();
    const meId = this.me().userId;
    const thread = this.data.matches.find((m) => m.id === matchId);
    // Only the employer is ever offered the draft, so only they can discard it.
    if (!thread || thread.businessId !== meId) return;
    thread.openerDismissedAt = new Date().toISOString();
    await this.persist();
  }
}
