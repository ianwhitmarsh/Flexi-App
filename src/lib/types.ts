/** Domain model for Flexi. */

export type Role = 'worker' | 'business';
export type SwipeDirection = 'like' | 'pass' | 'super';

export interface Session {
  userId: string;
  email: string;
}

export interface WorkerProfile {
  id: string;
  fullName: string;
  /** Short tagline, e.g. "Barista · Line Cook". */
  headline: string;
  bio: string;
  city: string;
  skills: string[];
  yearsExperience: number;
  /** Desired hourly rate in dollars. */
  desiredRate?: number;
  /** Availability tags, e.g. ["Weekends", "Evenings"]. */
  availability: string[];
  avatarUrl?: string;
  resumeUrl?: string;
  resumeName?: string;
}

export type AiTone = 'casual' | 'professional' | 'warm';

export interface AiFaq {
  question: string;
  answer: string;
}

/**
 * Structured context about how a business talks and what it expects, captured
 * once during onboarding. It is prompt material for the opener Flexi will send
 * on the employer's behalf — nothing here is sent to a model yet.
 */
export interface AiProfile {
  tone?: AiTone;
  dressCode?: string;
  arrivalInstructions?: string;
  parkingNotes?: string;
  whatMakesUsDifferent?: string;
  faqs?: AiFaq[];
}

export interface Business {
  id: string;
  companyName: string;
  /** e.g. "Restaurant", "Retail", "Warehouse". */
  category: string;
  city: string;
  about: string;
  contactName: string;
  logoUrl?: string;
  /** Always an object once saved — empty rather than absent when skipped. */
  aiProfile?: AiProfile;
}

/**
 * `filled` and `closed` both take a shift out of every deck; they differ in
 * why. `filled` means a worker accepted an offer and the work is covered;
 * `closed` means the employer called it off. Downstream policy — no-shows,
 * show-up rate, timesheet approval — has to tell those apart.
 */
export type ShiftStatus = 'open' | 'filled' | 'closed';

/**
 * How the employer wants the shift filled.
 *
 * `race` sends batch offers where the first worker to accept books the shift,
 * and is the only mode implemented. `standard` is reserved for one-at-a-time
 * exclusive offers (BIG-47) and is **not selectable** in the app: nothing
 * enforces `fill_mode`, so a shift marked `standard` behaves as `race`.
 * Existing `standard` rows are kept and behave that way; the value is not
 * removed so BIG-47 has somewhere to land.
 */
export type FillMode = 'standard' | 'race';

export interface Shift {
  id: string;
  businessId: string;
  title: string;
  role: string;
  payRate: number;
  payType: 'hour' | 'shift';
  /** ISO date string (yyyy-mm-dd). */
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  requirements: string[];
  status: ShiftStatus;
  fillMode: FillMode;
  createdAt: string;
  /** Hydrated for deck/match views. */
  business?: Business;
}

/** A full account record: auth + role + the role-specific profile. */
export interface Account {
  session: Session;
  role: Role | null;
  worker?: WorkerProfile;
  business?: Business;
}

/** A worker who registered interest in one of my shifts. */
export interface InterestedWorker {
  shift: Shift;
  worker: WorkerProfile;
  swipedAt: string;
  /**
   * The conversation thread the worker's like opened, so the employer's
   * "Message" action has somewhere to go. Optional only to tolerate rows
   * created before threads opened on first like.
   */
  threadId?: string;
}

/**
 * A conversation thread between one worker and one business about one shift.
 *
 * Still called `Match` (and stored in the `matches` table) because renaming
 * would orphan every existing `messages.match_id`. It no longer means the two
 * sides agreed anything — a worker's like alone opens it. Nothing is agreed
 * until an offer is sent and accepted.
 */
export interface Match {
  id: string;
  shiftId: string;
  workerId: string;
  businessId: string;
  createdAt: string;
  lastMessage?: string;
  lastMessageAt?: string;
  /** Hydrated for list/detail views. */
  shift?: Shift;
  worker?: WorkerProfile;
  business?: Business;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

/**
 * Outcome of a worker swiping a shift. A like registers interest and opens a
 * conversation thread; it never books anything and never means both sides
 * agreed. `interested` is false for a pass.
 */
export interface SwipeResult {
  interested: boolean;
  thread?: Match;
}

// ---- race-mode offers ----

export type OfferStatus = 'sent' | 'accepted' | 'filled' | 'declined';

/** One shift offered to one worker as part of a batch. */
export interface Offer {
  id: string;
  batchId: string;
  shiftId: string;
  workerId: string;
  status: OfferStatus;
  createdAt: string;
  respondedAt?: string;
  /** Hydrated for the worker's offer cards. */
  shift?: Shift;
}

/** One "Send offer" action: the same shift sent to several workers at once. */
export interface OfferBatch {
  id: string;
  shiftId: string;
  businessId: string;
  createdAt: string;
  offers: Offer[];
}

export interface Booking {
  id: string;
  shiftId: string;
  workerId: string;
  businessId: string;
  offerId?: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
  /** Hydrated for the worker's booked list. */
  shift?: Shift;
}

/**
 * Outcome of accepting an offer.
 *  - `accepted` — this worker won; `booking` is set.
 *  - `filled`   — another worker got there first.
 *  - `overlap`  — the worker already has a booking during this window.
 */
export type AcceptOfferStatus = 'accepted' | 'filled' | 'overlap';

export interface AcceptOfferResult {
  status: AcceptOfferStatus;
  booking?: Booking;
}

export interface ResumeFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}
