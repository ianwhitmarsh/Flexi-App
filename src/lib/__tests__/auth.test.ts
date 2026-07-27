/**
 * Auth-path behaviour for the live backend (BIG-63).
 *
 * There is no reachable Supabase project, so these drive `SupabaseBackend`
 * through a stub client — the same approach the parity test in offers.test.ts
 * uses. That covers the shape of the calls this issue is about (does `signIn`
 * ensure a profile row, and is it non-destructive) but not that Postgres and
 * RLS accept them; that is BIG-60's job.
 */

import { SupabaseBackend } from '../supabaseBackend';

// Pulled in transitively by supabaseBackend, and native-only. Unmocked it warns
// about Expo Go push on every run.
jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const USER = { id: 'user_1', email: 'ian@test.dev' };

type Recorded = {
  table: string;
  op: 'upsert' | 'update';
  values: any;
  options?: any;
};

/**
 * Minimal stand-in for the chainable query builder. `updatedRows` is what an
 * `update(...).eq(...).select()` resolves to, so a test can simulate the row
 * being absent.
 */
function stubSupabase(backend: SupabaseBackend, updatedRows: any[] = [{ id: USER.id }]) {
  const calls: Recorded[] = [];

  const builder = (table: string) => {
    const self: any = {
      upsert: (values: any, options?: any) => {
        calls.push({ table, op: 'upsert', values, options });
        return Promise.resolve({ data: null, error: null });
      },
      update: (values: any) => {
        calls.push({ table, op: 'update', values });
        return self;
      },
      eq: () => self,
      select: () => Promise.resolve({ data: updatedRows, error: null }),
    };
    return self;
  };

  Object.defineProperty(backend, 'sb', {
    get: () => ({
      auth: {
        signInWithPassword: async () => ({ data: { user: USER }, error: null }),
        getUser: async () => ({ data: { user: USER } }),
      },
      from: (table: string) => builder(table),
    }),
  });

  return calls;
}

describe('signIn', () => {
  it('ensures a profiles row exists', async () => {
    const backend = new SupabaseBackend();
    const calls = stubSupabase(backend);

    const session = await backend.signIn(USER.email, 'pw');

    expect(session.userId).toBe(USER.id);
    const upsert = calls.find((c) => c.table === 'profiles' && c.op === 'upsert');
    expect(upsert).toBeDefined();
    expect(upsert!.values.id).toBe(USER.id);
  });

  it('does not clobber a role that was already chosen', async () => {
    const backend = new SupabaseBackend();
    const calls = stubSupabase(backend);

    await backend.signIn(USER.email, 'pw');

    const upsert = calls.find((c) => c.table === 'profiles' && c.op === 'upsert')!;
    // Two independent guarantees: the write skips existing rows entirely, and
    // it never carries a `role` key that could overwrite one.
    expect(upsert.options).toMatchObject({ onConflict: 'id', ignoreDuplicates: true });
    expect(upsert.values).not.toHaveProperty('role');
  });
});

describe('setRole', () => {
  it('persists the role when the profile row exists', async () => {
    const backend = new SupabaseBackend();
    const calls = stubSupabase(backend);

    await expect(backend.setRole('worker')).resolves.toBeUndefined();
    expect(calls.find((c) => c.op === 'update')!.values).toEqual({ role: 'worker' });
  });

  it('throws rather than silently matching zero rows', async () => {
    const backend = new SupabaseBackend();
    stubSupabase(backend, []);

    // The old code discarded the row count, so onboarding looped with no error.
    await expect(backend.setRole('worker')).rejects.toThrow(/profile is missing/);
  });
});
