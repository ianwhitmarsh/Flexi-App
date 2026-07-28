/**
 * Live backend backed by Supabase (Postgres + Auth + Storage + Realtime).
 * Matches are created server-side by the `on_swipe` trigger (see db/schema.sql),
 * so a match only appears once BOTH sides have liked.
 */

import { decode as decodeBase64 } from 'base64-arraybuffer';

import { MAX_OFFERS_PER_BATCH, type Backend } from './backend';
import { RESUME_BUCKET } from './config';
import { getPayroll } from './getPayroll';
import type { PayrollStatus } from './payroll';
import { sendOfferPush } from './push';
import { getSupabase } from './supabaseClient';
import { hasShiftEnded } from './util';
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

/** How long a signed résumé link stays valid. Long enough to open, not to keep. */
const RESUME_URL_TTL_SECONDS = 300;

/**
 * The storage path for a stored résumé reference.
 *
 * New rows hold the path already. Rows written while the bucket was public
 * hold a full URL like `https://<project>/storage/v1/object/public/resumes/
 * <uid>/<file>`; the path is everything after the bucket name, so those keep
 * opening even though their old public URL no longer resolves.
 */
export function resumePathFrom(ref: string): string | null {
  if (!ref) return null;
  if (!/^https?:\/\//i.test(ref)) return ref;
  const marker = `/${RESUME_BUCKET}/`;
  const at = ref.indexOf(marker);
  if (at === -1) return null;
  return ref.slice(at + marker.length).split('?')[0] || null;
}

// ---- row <-> domain mappers ----
function toShift(row: any): Shift {
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    role: row.role,
    payRateCents: Number(row.pay_rate_cents),
    payType: row.pay_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    description: row.description ?? '',
    requirements: row.requirements ?? [],
    status: row.status,
    fillMode: row.fill_mode ?? 'standard',
    timezone: row.timezone ?? undefined,
    createdAt: row.created_at,
    business: row.businesses ? toBusiness(row.businesses) : undefined,
  };
}

function toOffer(row: any): Offer {
  return {
    id: row.id,
    batchId: row.batch_id,
    shiftId: row.shift_id,
    workerId: row.worker_id,
    status: row.status,
    createdAt: row.created_at,
    respondedAt: row.responded_at ?? undefined,
    shift: row.shifts ? toShift(row.shifts) : undefined,
  };
}

function toBooking(row: any): Booking {
  return {
    id: row.id,
    shiftId: row.shift_id,
    workerId: row.worker_id,
    businessId: row.business_id,
    offerId: row.offer_id ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toBusiness(row: any): Business {
  return {
    id: row.id,
    companyName: row.company_name,
    category: row.category,
    city: row.city,
    about: row.about ?? '',
    contactName: row.contact_name ?? '',
    logoUrl: row.logo_url ?? undefined,
    aiProfile: row.ai_profile ?? {},
  };
}

function toWorker(row: any): WorkerProfile {
  return {
    id: row.id,
    fullName: row.full_name,
    headline: row.headline ?? '',
    bio: row.bio ?? '',
    city: row.city ?? '',
    skills: row.skills ?? [],
    yearsExperience: row.years_experience ?? 0,
    desiredRateCents: row.desired_rate_cents != null ? Number(row.desired_rate_cents) : undefined,
    availability: row.availability ?? [],
    avatarUrl: row.avatar_url ?? undefined,
    resumeUrl: row.resume_url ?? undefined,
    resumeName: row.resume_name ?? undefined,
    payrollStatus: (row.payroll_status ?? 'not_started') as PayrollStatus,
    payrollEmployeeId: row.payroll_employee_id ?? undefined,
  };
}

function toMatch(row: any): Match {
  return {
    id: row.id,
    shiftId: row.shift_id,
    workerId: row.worker_id,
    businessId: row.business_id,
    createdAt: row.created_at,
    lastMessage: row.last_message ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    openerDismissedAt: row.opener_dismissed_at ?? undefined,
    shift: row.shifts ? toShift(row.shifts) : undefined,
    worker: row.worker_profiles ? toWorker(row.worker_profiles) : undefined,
    business: row.businesses ? toBusiness(row.businesses) : undefined,
  };
}

function toMessage(row: any): Message {
  return {
    id: row.id,
    matchId: row.match_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export class SupabaseBackend implements Backend {
  readonly isLive = true;
  private get sb() {
    return getSupabase();
  }

  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) throw new Error('Not signed in');
    return data.user.id;
  }

  // ---- auth ----
  async getSession(): Promise<Session | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    return u ? { userId: u.id, email: u.email ?? '' } : null;
  }

  async signUp(email: string, password: string): Promise<Session> {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    const u = data.user;
    if (!u) throw new Error('Check your email to confirm your account, then sign in.');
    // Create the profile row (id == auth uid).
    await this.sb.from('profiles').upsert({ id: u.id, email: u.email, role: null });
    return { userId: u.id, email: u.email ?? email };
  }

  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const u = data.user;
    // An auth user created outside the app — from the dashboard, or predating
    // the table — has no profile row, and without one `setRole` matches nothing
    // and onboarding loops. `ignoreDuplicates` makes this a no-op for everyone
    // else: it must never clear a role that has already been chosen.
    const { error: profileErr } = await this.sb
      .from('profiles')
      .upsert({ id: u.id, email: u.email }, { onConflict: 'id', ignoreDuplicates: true });
    if (profileErr) throw profileErr;
    return { userId: u.id, email: u.email ?? email };
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  // ---- account / profile ----
  async getAccount(): Promise<Account | null> {
    const session = await this.getSession();
    if (!session) return null;
    const { data: profile } = await this.sb
      .from('profiles')
      .select('*')
      .eq('id', session.userId)
      .maybeSingle();
    const role: Role | null = profile?.role ?? null;
    const account: Account = { session, role };
    if (role === 'worker') {
      const { data } = await this.sb
        .from('worker_profiles')
        .select('*')
        .eq('id', session.userId)
        .maybeSingle();
      if (data) account.worker = toWorker(data);
    } else if (role === 'business') {
      const { data } = await this.sb
        .from('businesses')
        .select('*')
        .eq('id', session.userId)
        .maybeSingle();
      if (data) account.business = toBusiness(data);
    }
    return account;
  }

  async setRole(role: Role): Promise<void> {
    const id = await this.uid();
    // `select()` so a missing profile row is a zero-row result rather than a
    // silent success — that is what left the app looping on role selection.
    const { data, error } = await this.sb
      .from('profiles')
      .update({ role })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('Your profile is missing. Sign out and sign in again.');
  }

  async saveWorkerProfile(data: Omit<WorkerProfile, 'id'>): Promise<WorkerProfile> {
    const id = await this.uid();
    const row = {
      id,
      full_name: data.fullName,
      headline: data.headline,
      bio: data.bio,
      city: data.city,
      skills: data.skills,
      years_experience: data.yearsExperience,
      desired_rate_cents: data.desiredRateCents ?? null,
      availability: data.availability,
      avatar_url: data.avatarUrl ?? null,
      resume_url: data.resumeUrl ?? null,
      resume_name: data.resumeName ?? null,
      // `payroll_status` and `payroll_employee_id` are deliberately absent.
      // `upsert` only SETs the columns present in the row, so leaving them out
      // preserves whatever the provider flow already recorded — editing a
      // profile must never reset payroll progress.
    };
    const { data: saved, error } = await this.sb
      .from('worker_profiles')
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    await this.sb.from('profiles').update({ role: 'worker' }).eq('id', id);
    return toWorker(saved);
  }

  async saveBusinessProfile(data: Omit<Business, 'id'>): Promise<Business> {
    const id = await this.uid();
    const row: Record<string, unknown> = {
      id,
      company_name: data.companyName,
      category: data.category,
      city: data.city,
      about: data.about,
      contact_name: data.contactName,
      logo_url: data.logoUrl ?? null,
    };
    // Omitted entirely when the caller does not supply one. `upsert` only SETs
    // the columns present in the row, so leaving the key out preserves whatever
    // is stored — which is what `MockBackend` does. Sending `{}` here instead
    // would blank an employer's voice profile every time they edited their
    // plain profile, since `BusinessProfileForm` is the only caller that
    // supplies it.
    if (data.aiProfile !== undefined) row.ai_profile = data.aiProfile;
    const { data: saved, error } = await this.sb
      .from('businesses')
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    await this.sb.from('profiles').update({ role: 'business' }).eq('id', id);
    return toBusiness(saved);
  }

  async uploadResume(file: ResumeFile): Promise<{ url: string; name: string }> {
    const id = await this.uid();
    // Read the picked file as base64 and upload its bytes.
    const res = await fetch(file.uri);
    const blob = await res.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1] ?? '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const path = `${id}/${Date.now()}-${file.name}`;
    const { error } = await this.sb.storage
      .from(RESUME_BUCKET)
      .upload(path, decodeBase64(base64), {
        contentType: file.mimeType ?? 'application/octet-stream',
        upsert: true,
      });
    if (error) throw error;
    // The PATH, not a URL. The bucket is private, so a permanent URL would
    // either not work or — as before this change — work for everybody forever.
    return { url: path, name: file.name };
  }

  async resolveResumeUrl(ref: string): Promise<string | null> {
    if (!ref) return null;
    const path = resumePathFrom(ref);
    if (!path) return null;

    // Signing is authorised by the storage read policy, so an employer with no
    // connection to this worker gets an error rather than a URL.
    const { data, error } = await this.sb.storage
      .from(RESUME_BUCKET)
      .createSignedUrl(path, RESUME_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  // ---- shifts ----
  async workerDeck(): Promise<Shift[]> {
    const id = await this.uid();
    const { data: swipes } = await this.sb.from('swipes').select('shift_id').eq('swiper_id', id);
    const seen = new Set((swipes ?? []).map((s) => s.shift_id));
    // `gte(date, yesterday)` is a cheap server-side floor — yesterday rather
    // than today so an overnight shift that started yesterday and runs past
    // midnight survives. `hasShiftEnded` then decides precisely, because the
    // end time is wall clock and not something PostgREST can compare.
    const floor = new Date();
    floor.setDate(floor.getDate() - 1);
    const { data, error } = await this.sb
      .from('shifts')
      .select('*, businesses(*)')
      .eq('status', 'open')
      .gte('date', floor.toISOString().slice(0, 10))
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .filter((s) => !seen.has(s.id))
      .map(toShift)
      .filter((s) => !hasShiftEnded(s));
  }

  async myShifts(): Promise<Shift[]> {
    const id = await this.uid();
    const { data, error } = await this.sb
      .from('shifts')
      .select('*, businesses(*)')
      .eq('business_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toShift);
  }

  async createShift(
    data: Omit<Shift, 'id' | 'businessId' | 'status' | 'createdAt' | 'business'>,
  ): Promise<Shift> {
    const id = await this.uid();
    const row = {
      business_id: id,
      title: data.title,
      role: data.role,
      pay_rate_cents: data.payRateCents,
      pay_type: data.payType,
      date: data.date,
      start_time: data.startTime,
      end_time: data.endTime,
      location: data.location,
      description: data.description,
      requirements: data.requirements,
      status: 'open',
      fill_mode: data.fillMode,
      timezone: data.timezone ?? null,
    };
    const { data: saved, error } = await this.sb
      .from('shifts')
      .insert(row)
      .select('*, businesses(*)')
      .single();
    if (error) throw error;
    return toShift(saved);
  }

  async closeShift(shiftId: string): Promise<void> {
    const { error } = await this.sb.from('shifts').update({ status: 'closed' }).eq('id', shiftId);
    if (error) throw error;
  }

  // ---- swiping ----
  async swipeShift(shiftId: string, direction: SwipeDirection): Promise<SwipeResult> {
    const id = await this.uid();
    const { error } = await this.sb.from('swipes').insert({
      swiper_id: id,
      role: 'worker',
      shift_id: shiftId,
      worker_id: id,
      direction,
    });
    if (error) throw error;
    if (direction === 'pass') return { interested: false };
    return this.threadFor(shiftId, id);
  }

  async listInterested(): Promise<InterestedWorker[]> {
    const id = await this.uid();
    // Everyone interested in any of my open shifts, newest first.
    const { data, error } = await this.sb
      .from('swipes')
      .select('shift_id, worker_id, created_at, shifts!inner(*, businesses(*)), worker_profiles!swipes_worker_id_fkey(*)')
      .eq('role', 'worker')
      .neq('direction', 'pass')
      .eq('shifts.business_id', id)
      .eq('shifts.status', 'open')
      .order('created_at', { ascending: false });
    if (error) throw error;

    // The thread each like opened, so the Message action has a destination.
    const { data: threads } = await this.sb
      .from('matches')
      .select('id, shift_id, worker_id')
      .eq('business_id', id);
    const threadId = new Map(
      (threads ?? []).map((t) => [`${t.shift_id}:${t.worker_id}`, t.id as string]),
    );

    // One row per worker per shift, keeping the newest like.
    const seen = new Set<string>();
    const cards: InterestedWorker[] = [];
    for (const row of data ?? []) {
      const key = `${row.shift_id}:${row.worker_id}`;
      if (seen.has(key)) continue;
      if (!row.worker_profiles || !row.shifts) continue;
      seen.add(key);
      const shift = toShift(row.shifts);
      if (hasShiftEnded(shift)) continue;
      cards.push({
        shift,
        worker: toWorker(row.worker_profiles),
        swipedAt: row.created_at,
        threadId: threadId.get(key),
      });
    }
    return cards;
  }

  /** Look up the conversation thread the `on_swipe` trigger just opened. */
  private async threadFor(shiftId: string, workerId: string): Promise<SwipeResult> {
    const { data } = await this.sb
      .from('matches')
      .select('*, shifts(*, businesses(*)), worker_profiles(*), businesses(*)')
      .eq('shift_id', shiftId)
      .eq('worker_id', workerId)
      .maybeSingle();
    return data ? { interested: true, thread: toMatch(data) } : { interested: true };
  }

  async getWorkerProfile(workerId: string): Promise<WorkerProfile | null> {
    const id = await this.uid();

    // `workers readable` would hand this to any signed-in user, so the
    // connection check is enforced here rather than leaned on from RLS. Three
    // cheap existence probes, each scoped to shifts this caller owns; a worker
    // asking owns no shifts, so every one of them comes back empty.
    const [interest, offered, booked] = await Promise.all([
      this.sb
        .from('swipes')
        .select('id, shifts!inner(business_id)')
        .eq('role', 'worker')
        .neq('direction', 'pass')
        .eq('worker_id', workerId)
        .eq('shifts.business_id', id)
        .limit(1),
      this.sb
        .from('offers')
        .select('id, shifts!inner(business_id)')
        .eq('worker_id', workerId)
        .eq('shifts.business_id', id)
        .limit(1),
      this.sb
        .from('bookings')
        .select('id')
        .eq('worker_id', workerId)
        .eq('business_id', id)
        .limit(1),
    ]);
    const connected =
      (interest.data?.length ?? 0) > 0 ||
      (offered.data?.length ?? 0) > 0 ||
      (booked.data?.length ?? 0) > 0;
    if (!connected) return null;

    const { data, error } = await this.sb
      .from('worker_profiles')
      .select('*')
      .eq('id', workerId)
      .maybeSingle();
    if (error) throw error;
    return data ? toWorker(data) : null;
  }

  // ---- race-mode offers ----
  async interestedWorkers(shiftId: string): Promise<InterestedWorker[]> {
    const id = await this.uid();
    const { data, error } = await this.sb
      .from('swipes')
      .select('worker_id, created_at, shifts!inner(*, businesses(*)), worker_profiles!swipes_worker_id_fkey(*)')
      .eq('role', 'worker')
      .neq('direction', 'pass')
      .eq('shift_id', shiftId)
      .eq('shifts.business_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const seen = new Set<string>();
    const cards: InterestedWorker[] = [];
    for (const row of data ?? []) {
      if (!row.worker_profiles || !row.shifts || seen.has(row.worker_id)) continue;
      const shift = toShift(row.shifts);
      if (hasShiftEnded(shift)) continue;
      seen.add(row.worker_id);
      cards.push({
        shift,
        worker: toWorker(row.worker_profiles),
        swipedAt: row.created_at,
      });
    }
    return cards;
  }

  async sendOffers(shiftId: string, workerIds: string[]): Promise<OfferBatch> {
    const id = await this.uid();
    const unique = [...new Set(workerIds)];
    if (unique.length === 0) throw new Error('Pick at least one worker.');
    if (unique.length > MAX_OFFERS_PER_BATCH) {
      throw new Error(`You can offer a shift to at most ${MAX_OFFERS_PER_BATCH} workers at once.`);
    }

    const { data: shiftRow, error: shiftErr } = await this.sb
      .from('shifts')
      .select('*, businesses(*)')
      .eq('id', shiftId)
      .maybeSingle();
    if (shiftErr) throw shiftErr;
    if (!shiftRow) throw new Error('Shift not found.');
    if (shiftRow.business_id !== id) throw new Error('That is not your shift.');
    if (shiftRow.status !== 'open') throw new Error('This shift is no longer open.');
    const shift = toShift(shiftRow);
    if (hasShiftEnded(shift)) throw new Error('This shift has already ended.');

    const { data: batchRow, error: batchErr } = await this.sb
      .from('offer_batches')
      .insert({ shift_id: shiftId, business_id: id })
      .select()
      .single();
    if (batchErr) throw batchErr;

    const { data: offerRows, error: offerErr } = await this.sb
      .from('offers')
      .insert(
        unique.map((workerId) => ({
          batch_id: batchRow.id,
          shift_id: shiftId,
          worker_id: workerId,
          status: 'sent',
        })),
      )
      .select();
    if (offerErr) throw offerErr;

    await this.pushOfferTo(unique, shift);

    return {
      id: batchRow.id,
      shiftId: batchRow.shift_id,
      businessId: batchRow.business_id,
      createdAt: batchRow.created_at,
      offers: (offerRows ?? []).map((r) => ({ ...toOffer(r), shift })),
    };
  }

  /** Look up the recipients' device tokens and hand them to Expo. */
  private async pushOfferTo(workerIds: string[], shift: Shift): Promise<void> {
    const { data } = await this.sb
      .from('push_tokens')
      .select('token')
      .in('user_id', workerIds);
    await sendOfferPush((data ?? []).map((r) => r.token), shift);
  }

  async listMyOffers(): Promise<Offer[]> {
    const id = await this.uid();
    const { data, error } = await this.sb
      .from('offers')
      .select('*, shifts(*, businesses(*))')
      .eq('worker_id', id)
      .eq('status', 'sent')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // An offer for a shift that has ended is not actionable, so it is not
    // shown. The row is left alone — expiring offers belongs to BIG-50/54.
    return (data ?? []).map(toOffer).filter((o) => !o.shift || !hasShiftEnded(o.shift));
  }

  async acceptOffer(offerId: string): Promise<AcceptOfferResult> {
    // The ended check has to happen here rather than in `accept_offer`: the
    // shift's date and times are a local wall clock with no zone stored, so the
    // database cannot compare them to a real instant. See the note in
    // db/schema.sql. This costs one extra read before the transaction.
    const { data: offerRow } = await this.sb
      .from('offers')
      .select('shifts(date, start_time, end_time)')
      .eq('id', offerId)
      .maybeSingle();
    const row = (offerRow as any)?.shifts;
    if (
      row &&
      hasShiftEnded({ date: row.date, startTime: row.start_time, endTime: row.end_time })
    ) {
      throw new Error('This shift has already ended.');
    }

    // All of the first-accept-wins logic lives in the `accept_offer` function
    // so the shift row lock and the booking insert share one transaction.
    const { data, error } = await this.sb.rpc('accept_offer', { p_offer_id: offerId });
    if (error) throw error;
    const status = (data as any)?.status as AcceptOfferResult['status'];
    if (status !== 'accepted') return { status };

    const { data: bookingRow } = await this.sb
      .from('bookings')
      .select('*')
      .eq('id', (data as any).bookingId)
      .maybeSingle();
    return { status, booking: bookingRow ? toBooking(bookingRow) : undefined };
  }

  async declineOffer(offerId: string): Promise<void> {
    const id = await this.uid();
    // Scoped by worker and by `sent` so an accepted or filled offer cannot be
    // rewritten, and `select` so a no-op update surfaces instead of passing
    // silently. RLS enforces the same two conditions server-side.
    const { data, error } = await this.sb
      .from('offers')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', offerId)
      .eq('worker_id', id)
      .eq('status', 'sent')
      .select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('This offer is no longer available.');
  }

  async listMyBookings(): Promise<Booking[]> {
    const id = await this.uid();
    const { data, error } = await this.sb
      .from('bookings')
      .select('*, shifts(*, businesses(*))')
      .eq('worker_id', id)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      ...toBooking(row),
      shift: row.shifts ? toShift(row.shifts) : undefined,
    }));
  }

  async registerPushToken(token: string): Promise<void> {
    const id = await this.uid();
    const { error } = await this.sb
      .from('push_tokens')
      .upsert({ user_id: id, token, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  // ---- payroll onboarding ----
  async startPayrollSetup(): Promise<{ status: PayrollStatus; onboardingUrl: string }> {
    const id = await this.uid();
    const { data: profile, error } = await this.sb
      .from('worker_profiles')
      .select('full_name, city, payroll_employee_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!profile) throw new Error('Finish your worker profile first.');

    const payroll = getPayroll();
    const employee = await payroll.createEmployee({
      workerId: id,
      fullName: profile.full_name,
      email: (await this.getSession())?.email ?? '',
      workState: (profile.city ?? '').split(',').pop()?.trim(),
    });
    const onboardingUrl = await payroll.getOnboardingUrl(employee.employeeId);

    const { error: saveErr } = await this.sb
      .from('worker_profiles')
      .update({ payroll_employee_id: employee.employeeId, payroll_status: employee.status })
      .eq('id', id);
    if (saveErr) throw saveErr;
    return { status: employee.status, onboardingUrl };
  }

  async refreshPayrollStatus(): Promise<PayrollStatus> {
    const id = await this.uid();
    const { data: profile } = await this.sb
      .from('worker_profiles')
      .select('payroll_employee_id, payroll_status')
      .eq('id', id)
      .maybeSingle();
    const employeeId = profile?.payroll_employee_id;
    if (!employeeId) return (profile?.payroll_status ?? 'not_started') as PayrollStatus;

    const status = await getPayroll().getEmployeeStatus(employeeId);
    const { error } = await this.sb
      .from('worker_profiles')
      .update({ payroll_status: status })
      .eq('id', id);
    if (error) throw error;
    return status;
  }

  // ---- matches + chat ----
  async listMatches(): Promise<Match[]> {
    const id = await this.uid();
    const { data, error } = await this.sb
      .from('matches')
      .select('*, shifts(*, businesses(*)), worker_profiles(*), businesses(*)')
      .or(`worker_id.eq.${id},business_id.eq.${id}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toMatch);
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const { data, error } = await this.sb
      .from('matches')
      .select('*, shifts(*, businesses(*)), worker_profiles(*), businesses(*)')
      .eq('id', matchId)
      .maybeSingle();
    if (error) throw error;
    return data ? toMatch(data) : null;
  }

  async listMessages(matchId: string): Promise<Message[]> {
    const { data, error } = await this.sb
      .from('messages')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toMessage);
  }

  async sendMessage(matchId: string, body: string): Promise<Message> {
    const id = await this.uid();
    const { data, error } = await this.sb
      .from('messages')
      .insert({ match_id: matchId, sender_id: id, body: body.trim() })
      .select()
      .single();
    if (error) throw error;
    await this.sb
      .from('matches')
      .update({ last_message: body.trim(), last_message_at: new Date().toISOString() })
      .eq('id', matchId);
    return toMessage(data);
  }

  subscribeMessages(matchId: string, onMessage: (m: Message) => void): () => void {
    const channel = this.sb
      .channel(`messages:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${matchId}` },
        (payload) => onMessage(toMessage(payload.new)),
      )
      .subscribe();
    return () => {
      this.sb.removeChannel(channel);
    };
  }

  async dismissOpenerDraft(matchId: string): Promise<void> {
    const id = await this.uid();
    // Scoped to the employer's own thread: only they are offered the draft.
    const { error } = await this.sb
      .from('matches')
      .update({ opener_dismissed_at: new Date().toISOString() })
      .eq('id', matchId)
      .eq('business_id', id);
    if (error) throw error;
  }
}
