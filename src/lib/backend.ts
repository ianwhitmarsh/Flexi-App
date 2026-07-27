/**
 * Backend abstraction. The app talks to this interface only; the concrete
 * implementation is chosen at runtime by `getBackend()` based on whether
 * Supabase credentials are configured.
 */

import type {
  Account,
  Business,
  InterestedWorker,
  Match,
  Message,
  ResumeFile,
  Role,
  Session,
  Shift,
  SwipeDirection,
  SwipeResult,
  WorkerProfile,
} from './types';

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

  // ---- matches + chat ----
  listMatches(): Promise<Match[]>;
  getMatch(matchId: string): Promise<Match | null>;
  listMessages(matchId: string): Promise<Message[]>;
  sendMessage(matchId: string, body: string): Promise<Message>;
  /** Subscribe to new messages on a match. Returns an unsubscribe fn. */
  subscribeMessages(matchId: string, onMessage: (m: Message) => void): () => void;
}
