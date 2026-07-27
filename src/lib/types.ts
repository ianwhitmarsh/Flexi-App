/** Domain model for ShiftMatch. */

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

export interface Business {
  id: string;
  companyName: string;
  /** e.g. "Restaurant", "Retail", "Warehouse". */
  category: string;
  city: string;
  about: string;
  contactName: string;
  logoUrl?: string;
}

export type ShiftStatus = 'open' | 'closed';

/**
 * How the employer wants the shift filled. `standard` is the original
 * swipe-and-match flow; `race` sends batch offers where the first worker to
 * accept books the shift.
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

/** A card in the business deck: a worker who liked one of my shifts. */
export interface InterestedWorker {
  shift: Shift;
  worker: WorkerProfile;
  swipedAt: string;
}

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

export interface SwipeResult {
  matched: boolean;
  match?: Match;
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
