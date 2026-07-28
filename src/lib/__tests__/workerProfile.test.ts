/**
 * Who may see a worker's profile (BIG-77).
 *
 * Employers need the full profile to decide who gets a shift, but this is a
 * directory of people and must not be browsable. The rule is a live
 * connection: the worker showed interest in, was offered, or is booked on one
 * of the caller's own shifts.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MockBackend } from '../mockBackend';
import type { Backend } from '../backend';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BIZ = { email: 'biz@test.dev', password: 'pw' };
const RIVAL = { email: 'rival@test.dev', password: 'pw' };
const ADA = { email: 'ada@test.dev', password: 'pw' };
const BEN = { email: 'ben@test.dev', password: 'pw' };

type ShiftInput = Parameters<Backend['createShift']>[0];

function shiftInput(over: Partial<ShiftInput> = {}): ShiftInput {
  return {
    title: 'Weekend Barista',
    role: 'Barista',
    payRate: 24,
    payType: 'hour',
    date: '2026-08-01',
    startTime: '09:00',
    endTime: '17:00',
    location: 'Oakland, CA',
    description: '',
    requirements: [],
    fillMode: 'race',
    ...over,
  };
}

async function signUpBusiness(backend: MockBackend, creds: typeof BIZ, name: string) {
  await backend.signUp(creds.email, creds.password);
  await backend.saveBusinessProfile({
    companyName: name,
    category: 'Café',
    city: 'Oakland, CA',
    about: '',
    contactName: 'Dana',
  });
}

async function signUpWorker(backend: MockBackend, creds: typeof ADA, name: string) {
  const session = await backend.signUp(creds.email, creds.password);
  await backend.saveWorkerProfile({
    fullName: name,
    headline: 'Barista · Espresso',
    bio: 'Three years behind the bar.',
    city: 'Oakland, CA',
    skills: ['Espresso', 'POS'],
    yearsExperience: 3,
    availability: ['Weekends'],
    resumeUrl: 'https://example.invalid/ada.pdf',
    resumeName: 'ada-resume.pdf',
  });
  return session.userId;
}

/** One employer with a shift Ada is interested in, plus an unrelated rival. */
async function setup() {
  await AsyncStorage.clear();
  const backend = new MockBackend();

  await signUpBusiness(backend, BIZ, 'Blue Harbor Coffee');
  const shift = await backend.createShift(shiftInput());

  const ada = await signUpWorker(backend, ADA, 'Ada Worker');
  await backend.swipeShift(shift.id, 'like');

  const ben = await signUpWorker(backend, BEN, 'Ben Worker');

  await signUpBusiness(backend, RIVAL, 'Rival Roasters');

  return { backend, shift, ada, ben };
}

describe('getWorkerProfile', () => {
  it('gives an employer the full profile of a worker interested in their shift', async () => {
    const { backend, ada } = await setup();
    await backend.signIn(BIZ.email, BIZ.password);

    const profile = await backend.getWorkerProfile(ada);

    expect(profile?.fullName).toBe('Ada Worker');
    expect(profile?.skills).toContain('Espresso');
    expect(profile?.availability).toContain('Weekends');
    expect(profile?.bio).toBe('Three years behind the bar.');
    // The résumé is the whole reason a worker uploads one.
    expect(profile?.resumeName).toBe('ada-resume.pdf');
    expect(profile?.resumeUrl).toBe('https://example.invalid/ada.pdf');
  });

  it('refuses a worker who has shown no interest in any of my shifts', async () => {
    const { backend, ben } = await setup();
    await backend.signIn(BIZ.email, BIZ.password);

    expect(await backend.getWorkerProfile(ben)).toBeNull();
  });

  it('refuses an unrelated employer', async () => {
    const { backend, ada } = await setup();
    await backend.signIn(RIVAL.email, RIVAL.password);

    expect(await backend.getWorkerProfile(ada)).toBeNull();
  });

  it('refuses one worker looking up another', async () => {
    const { backend, ada } = await setup();
    await backend.signIn(BEN.email, BEN.password);

    expect(await backend.getWorkerProfile(ada)).toBeNull();
  });

  it('refuses a worker looking up themselves through this route', async () => {
    const { backend, ada } = await setup();
    await backend.signIn(ADA.email, ADA.password);

    // Not a denial of their own data — Profile reads it from the session.
    // This route is the employer's view and answers nobody else.
    expect(await backend.getWorkerProfile(ada)).toBeNull();
  });

  it('opens up once a worker is offered a shift, even without prior interest', async () => {
    const { backend, shift, ben } = await setup();

    await backend.signIn(BIZ.email, BIZ.password);
    expect(await backend.getWorkerProfile(ben)).toBeNull();

    await backend.sendOffers(shift.id, [ben]);

    expect((await backend.getWorkerProfile(ben))?.fullName).toBe('Ben Worker');
  });

  it('stays open once the worker is booked', async () => {
    const { backend, shift, ada } = await setup();

    await backend.signIn(BIZ.email, BIZ.password);
    const batch = await backend.sendOffers(shift.id, [ada]);

    // The payroll gate (BIG-73) refuses anyone who is not `ready`, so a
    // fixture that means to book has to finish setup first. This is the
    // follow-up the note here asked for when that PR landed.
    await backend.signIn(ADA.email, ADA.password);
    await backend.startPayrollSetup();
    await backend.refreshPayrollStatus();
    expect((await backend.acceptOffer(batch.offers[0].id)).status).toBe('accepted');

    await backend.signIn(BIZ.email, BIZ.password);
    expect((await backend.getWorkerProfile(ada))?.fullName).toBe('Ada Worker');
  });

  it('returns null for a worker id that does not exist', async () => {
    const { backend } = await setup();
    await backend.signIn(BIZ.email, BIZ.password);

    expect(await backend.getWorkerProfile('nobody')).toBeNull();
  });
});
