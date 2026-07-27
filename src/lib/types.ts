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

export interface ResumeFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}
