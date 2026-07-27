/**
 * Employer voice capture (BIG-39).
 *
 * Data capture only — no model is called anywhere in this path, and the opener
 * preview is string templating, so it is testable as a pure function.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildOpenerPreview } from '../opener';
import { MockBackend } from '../mockBackend';
import { SupabaseBackend } from '../supabaseBackend';
import type { AiProfile } from '../types';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BUSINESS = { email: 'biz@test.dev', password: 'pw' };

const BASE = {
  companyName: 'Blue Harbor Coffee',
  category: 'Café',
  city: 'Oakland, CA',
  about: '',
  contactName: 'Dana',
};

async function signedInBusiness() {
  await AsyncStorage.clear();
  const backend = new MockBackend();
  await backend.signUp(BUSINESS.email, BUSINESS.password);
  return backend;
}

describe('ai_profile persistence', () => {
  it('stores an empty object rather than nothing when the step is skipped', async () => {
    const backend = await signedInBusiness();

    const saved = await backend.saveBusinessProfile(BASE);

    expect(saved.aiProfile).toEqual({});
    expect((await backend.getAccount())?.business?.aiProfile).toEqual({});
  });

  it('round-trips every field, preserving FAQ order', async () => {
    const backend = await signedInBusiness();
    const aiProfile: AiProfile = {
      tone: 'casual',
      dressCode: 'Black shirt',
      arrivalInstructions: 'Side door, ask for Dana',
      parkingNotes: 'Free lot behind',
      whatMakesUsDifferent: 'We eat together after close',
      faqs: [
        { question: 'Tools?', answer: 'Provided' },
        { question: 'Breaks?', answer: 'Two paid' },
        { question: 'Parking cost?', answer: 'Free' },
      ],
    };

    await backend.saveBusinessProfile({ ...BASE, aiProfile });

    // Re-read through a fresh backend so this proves persistence, not memory.
    const reloaded = new MockBackend();
    await reloaded.signIn(BUSINESS.email, BUSINESS.password);
    const got = (await reloaded.getAccount())?.business?.aiProfile;

    expect(got).toEqual(aiProfile);
    expect(got?.faqs?.map((f) => f.question)).toEqual(['Tools?', 'Breaks?', 'Parking cost?']);
  });

  it('does not lose the voice profile when the plain profile is edited', async () => {
    const backend = await signedInBusiness();
    await backend.saveBusinessProfile({ ...BASE, aiProfile: { tone: 'warm', dressCode: 'Apron' } });

    // BusinessProfileForm passes `initial?.aiProfile` back through; this pins
    // the backend half of that, so an edit cannot silently blank it.
    await backend.saveBusinessProfile({ ...BASE, city: 'Berkeley, CA' });

    const got = (await backend.getAccount())?.business;
    expect(got?.city).toBe('Berkeley, CA');
    expect(got?.aiProfile).toEqual({ tone: 'warm', dressCode: 'Apron' });
  });
});

/**
 * The mock tests above pin only half the contract. The two backends disagreeing
 * on what "omitted" means is precisely how an employer would lose their voice
 * profile by editing their city — so the live half needs pinning as well, via a
 * stub client since there is no reachable project.
 */
describe('supabase parity for ai_profile', () => {
  function stubSupabase(backend: SupabaseBackend) {
    const upserts: { table: string; row: any }[] = [];
    const builder = (table: string) => {
      const self: any = {
        upsert: (row: any) => {
          upserts.push({ table, row });
          return self;
        },
        update: () => self,
        eq: () => self,
        select: () => self,
        single: async () => ({ data: { id: 'biz_1', company_name: 'X' }, error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return self;
    };
    Object.defineProperty(backend, 'sb', {
      get: () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'biz_1' } } }) },
        from: (table: string) => builder(table),
      }),
    });
    return upserts;
  }

  it('omits ai_profile entirely when the caller does not supply one', async () => {
    const live = new SupabaseBackend();
    const upserts = stubSupabase(live);

    await live.saveBusinessProfile(BASE);

    const row = upserts.find((u) => u.table === 'businesses')!.row;
    // `upsert` only SETs the columns present, so an absent key preserves the
    // stored value. Sending `{}` would blank it.
    expect('ai_profile' in row).toBe(false);
  });

  it('writes ai_profile when the caller does supply one', async () => {
    const live = new SupabaseBackend();
    const upserts = stubSupabase(live);

    await live.saveBusinessProfile({ ...BASE, aiProfile: { tone: 'casual' } });

    const row = upserts.find((u) => u.table === 'businesses')!.row;
    expect(row.ai_profile).toEqual({ tone: 'casual' });
  });
});

describe('opener preview', () => {
  it('changes with tone', () => {
    const casual = buildOpenerPreview('Blue Harbor', { tone: 'casual' });
    const professional = buildOpenerPreview('Blue Harbor', { tone: 'professional' });

    expect(casual).not.toEqual(professional);
    expect(casual).toContain('Blue Harbor');
    expect(professional).toContain('Blue Harbor');
  });

  it('includes only the clauses that were filled in', () => {
    const sparse = buildOpenerPreview('Blue Harbor', { tone: 'warm', dressCode: 'Black shirt' });

    expect(sparse).toContain('What to wear: Black shirt');
    expect(sparse).not.toContain('Parking:');
    expect(sparse).not.toContain('Getting in:');
  });

  it('reads sensibly with nothing filled in at all', () => {
    const empty = buildOpenerPreview('Blue Harbor', {});

    expect(empty).toContain('Blue Harbor');
    expect(empty).toContain('Any questions before the shift?');
    expect(empty).not.toContain('undefined');
  });

  it('falls back when the company name is blank', () => {
    expect(buildOpenerPreview('   ', {})).toContain('our business');
  });

  it('quotes the first complete FAQ and skips half-filled ones', () => {
    const out = buildOpenerPreview('Blue Harbor', {
      faqs: [
        { question: 'Half', answer: '' },
        { question: 'Tools?', answer: 'Provided' },
      ],
    });

    expect(out).toContain('Tools? — Provided');
    expect(out).not.toContain('Half');
  });
});
