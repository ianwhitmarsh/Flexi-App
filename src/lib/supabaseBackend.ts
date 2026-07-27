/**
 * Live backend backed by Supabase (Postgres + Auth + Storage + Realtime).
 * Matches are created server-side by the `on_swipe` trigger (see db/schema.sql),
 * so a match only appears once BOTH sides have liked.
 */

import { decode as decodeBase64 } from 'base64-arraybuffer';

import { MAX_OFFERS_PER_BATCH, type Backend } from './backend';
import { RESUME_BUCKET } from './config';
import { sendOfferPush } from './push';
import { getSupabase } from './supabaseClient';
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

// ---- row <-> domain mappers ----
function toShift(row: any): Shift {
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    role: row.role,
    payRate: Number(row.pay_rate),
    payType: row.pay_type,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    description: row.description ?? '',
    requirements: row.requirements ?? [],
    status: row.status,
    fillMode: row.fill_mode ?? 'standard',
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
    desiredRate: row.desired_rate != null ? Number(row.desired_rate) : undefined,
    availability: row.availability ?? [],
    avatarUrl: row.avatar_url ?? undefined,
    resumeUrl: row.resume_url ?? undefined,
    resumeName: row.resume_name ?? undefined,
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
    const { error } = await this.sb.from('profiles').update({ role }).eq('id', id);
    if (error) throw error;
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
      desired_rate: data.desiredRate ?? null,
      availability: data.availability,
      avatar_url: data.avatarUrl ?? null,
      resume_url: data.resumeUrl ?? null,
      resume_name: data.resumeName ?? null,
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
    const row = {
      id,
      company_name: data.companyName,
      category: data.category,
      city: data.city,
      about: data.about,
      contact_name: data.contactName,
      logo_url: data.logoUrl ?? null,
    };
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
    const { data } = this.sb.storage.from(RESUME_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, name: file.name };
  }

  // ---- shifts ----
  async workerDeck(): Promise<Shift[]> {
    const id = await this.uid();
    const { data: swipes } = await this.sb.from('swipes').select('shift_id').eq('swiper_id', id);
    const seen = new Set((swipes ?? []).map((s) => s.shift_id));
    const { data, error } = await this.sb
      .from('shifts')
      .select('*, businesses(*)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).filter((s) => !seen.has(s.id)).map(toShift);
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
      pay_rate: data.payRate,
      pay_type: data.payType,
      date: data.date,
      start_time: data.startTime,
      end_time: data.endTime,
      location: data.location,
      description: data.description,
      requirements: data.requirements,
      status: 'open',
      fill_mode: data.fillMode,
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
    if (direction === 'pass') return { matched: false };
    return this.matchFor(shiftId, id);
  }

  async businessDeck(): Promise<InterestedWorker[]> {
    const id = await this.uid();
    // Workers who liked one of my open shifts, that I haven't reviewed yet.
    const { data, error } = await this.sb
      .from('swipes')
      .select('shift_id, worker_id, created_at, shifts!inner(*, businesses(*)), worker_profiles!swipes_worker_id_fkey(*)')
      .eq('role', 'worker')
      .neq('direction', 'pass')
      .eq('shifts.business_id', id)
      .eq('shifts.status', 'open')
      .order('created_at', { ascending: true });
    if (error) throw error;
    const { data: myReviews } = await this.sb
      .from('swipes')
      .select('shift_id, worker_id')
      .eq('swiper_id', id)
      .eq('role', 'business');
    const reviewed = new Set((myReviews ?? []).map((r) => `${r.shift_id}:${r.worker_id}`));
    const cards: InterestedWorker[] = [];
    for (const row of data ?? []) {
      if (reviewed.has(`${row.shift_id}:${row.worker_id}`)) continue;
      if (!row.worker_profiles || !row.shifts) continue;
      cards.push({
        shift: toShift(row.shifts),
        worker: toWorker(row.worker_profiles),
        swipedAt: row.created_at,
      });
    }
    return cards;
  }

  async swipeWorker(
    shiftId: string,
    workerId: string,
    direction: SwipeDirection,
  ): Promise<SwipeResult> {
    const id = await this.uid();
    const { error } = await this.sb.from('swipes').insert({
      swiper_id: id,
      role: 'business',
      shift_id: shiftId,
      worker_id: workerId,
      direction,
    });
    if (error) throw error;
    if (direction === 'pass') return { matched: false };
    return this.matchFor(shiftId, workerId);
  }

  /** Look up the match the trigger may have just created. */
  private async matchFor(shiftId: string, workerId: string): Promise<SwipeResult> {
    const { data } = await this.sb
      .from('matches')
      .select('*, shifts(*, businesses(*)), worker_profiles(*), businesses(*)')
      .eq('shift_id', shiftId)
      .eq('worker_id', workerId)
      .maybeSingle();
    return data ? { matched: true, match: toMatch(data) } : { matched: false };
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
      seen.add(row.worker_id);
      cards.push({
        shift: toShift(row.shifts),
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
    const shift = toShift(shiftRow);

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
    return (data ?? []).map(toOffer);
  }

  async acceptOffer(offerId: string): Promise<AcceptOfferResult> {
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
}
