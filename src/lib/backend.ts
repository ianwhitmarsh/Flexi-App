/**
 * Backend abstraction. The app talks to this interface only; the concrete
 * implementation is chosen at runtime by `getBackend()` based on whether
 * Supabase credentials are configured.
 */

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

/** Most workers an employer can put in one offer batch (AC-2). */
export const MAX_OFFERS_PER_BATCH = 10;

export interface Backend {
  /** True when backed by a real Supabase project (vs. the in-memory demo). */
  readonly isLive: boolean;

  // ---- auth ----
  getSession(): Promise<Session | null>;
  signUp(email: string, password: string): Promise<Session>;
  signIn(email: string, password: string): Promise<Session>;
  signOut(): Promise<void>;

  // ---- account / profile ----
  getAccount(): Promise<Account | null>;
  setRole(role: Role): Promise<void>;
  saveWorkerProfile(data: Omit<WorkerProfile, 'id'>): Promise<WorkerProfile>;
  saveBusinessProfile(data: Omit<Business, 'id'>): Promise<Business>;
  uploadResume(file: ResumeFile): Promise<{ url: string; name: string }>;

  // ---- shifts ----
  /** Open shifts the current worker hasn't swiped yet (their deck). */
  workerDeck(): Promise<Shift[]>;
  /** Shifts owned by the current business. */
  myShifts(): Promise<Shift[]>;
  createShift(
    data: Omit<Shift, 'id' | 'businessId' | 'status' | 'createdAt' | 'business'>,
  ): Promise<Shift>;
  closeShift(shiftId: string): Promise<void>;

  // ---- swiping ----
  swipeShift(shiftId: string, direction: SwipeDirection): Promise<SwipeResult>;
  /** Workers who liked one of my shifts and that I haven't reviewed yet. */
  businessDeck(): Promise<InterestedWorker[]>;
  swipeWorker(
    shiftId: string,
    workerId: string,
    direction: SwipeDirection,
  ): Promise<SwipeResult>;

  // ---- race-mode offers ----
  /** Everyone who liked this shift, for the employer's Interested queue. */
  interestedWorkers(shiftId: string): Promise<InterestedWorker[]>;
  /**
   * Offer one shift to several workers at once. Creates one batch and one
   * `sent` offer per worker, then pushes each of them a notification.
   * Rejects more than `MAX_OFFERS_PER_BATCH` workers.
   */
  sendOffers(shiftId: string, workerIds: string[]): Promise<OfferBatch>;
  /** Live (`sent`) offers for the current worker, newest first. */
  listMyOffers(): Promise<Offer[]>;
  /** Take an offer. First accept for a shift wins; see `AcceptOfferResult`. */
  acceptOffer(offerId: string): Promise<AcceptOfferResult>;
  /**
   * Turn down an offer. Affects only the caller's own offer — siblings stay
   * live and the shift stays open, so somebody else can still take it.
   */
  declineOffer(offerId: string): Promise<void>;
  /** Confirmed bookings for the current worker, newest first. */
  listMyBookings(): Promise<Booking[]>;
  /** Store an Expo push token for the signed-in user. */
  registerPushToken(token: string): Promise<void>;

  // ---- matches + chat ----
  listMatches(): Promise<Match[]>;
  getMatch(matchId: string): Promise<Match | null>;
  listMessages(matchId: string): Promise<Message[]>;
  sendMessage(matchId: string, body: string): Promise<Message>;
  /** Subscribe to new messages on a match. Returns an unsubscribe fn. */
  subscribeMessages(matchId: string, onMessage: (m: Message) => void): () => void;
}
