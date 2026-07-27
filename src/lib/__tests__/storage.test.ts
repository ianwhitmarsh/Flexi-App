/**
 * Demo-database key rename (BIG-66).
 *
 * `DB_KEY` moved from `shiftmatch.*` to `flexi.*`. Without a migration that
 * reads as data loss: nothing lives at the new key, so `load` re-seeds and a
 * returning demo user silently loses their account, shifts and matches.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DB_KEY, MockBackend, SESSION_KEY } from '../mockBackend';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const LEGACY_DB_KEY = 'shiftmatch.db.v1';
const LEGACY_SESSION_KEY = 'shiftmatch.session.v1';

/**
 * A real demo database, moved back onto the old keys — i.e. exactly what a user
 * who last opened the app before the rename has on their device.
 */
async function seedLegacyInstall(email: string) {
  await AsyncStorage.clear();
  await new MockBackend().signUp(email, 'pw');

  const db = (await AsyncStorage.getItem(DB_KEY))!;
  const session = (await AsyncStorage.getItem(SESSION_KEY))!;
  await AsyncStorage.multiRemove([DB_KEY, SESSION_KEY]);
  await AsyncStorage.setItem(LEGACY_DB_KEY, db);
  await AsyncStorage.setItem(LEGACY_SESSION_KEY, session);
  return { db, session };
}

describe('legacy storage keys', () => {
  it('carries a pre-rename demo install across, and clears the old keys', async () => {
    const { db } = await seedLegacyInstall('old@test.dev');

    // Still signed in as the same account, with the same data.
    expect((await new MockBackend().getSession())?.email).toBe('old@test.dev');
    expect(await AsyncStorage.getItem(DB_KEY)).toBe(db);

    // And it runs at most once.
    expect(await AsyncStorage.getItem(LEGACY_DB_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
  });

  it('never overwrites a database already at the new key', async () => {
    await seedLegacyInstall('old@test.dev');

    // A newer install exists too — the legacy copy must not win.
    const current = new MockBackend();
    await current.signUp('new@test.dev', 'pw');
    const newer = await AsyncStorage.getItem(DB_KEY);

    expect((await new MockBackend().getSession())?.email).toBe('new@test.dev');
    expect(await AsyncStorage.getItem(DB_KEY)).toBe(newer);
  });

  it('seeds normally when there is nothing to adopt', async () => {
    await AsyncStorage.clear();

    expect(await new MockBackend().getSession()).toBeNull();
    expect(await AsyncStorage.getItem(DB_KEY)).not.toBeNull();
  });
});
