/**
 * The suggested opener (BIG-79).
 *
 * A thread used to open with a message whose `senderId` was the business — so
 * the worker read something the employer never wrote. Nothing is auto-sent
 * now; the employer gets a draft built from their own voice profile, and only
 * they can see it until they send it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MockBackend } from '../mockBackend';
import { buildOpener, buildOpenerPreview } from '../opener';
import type { Backend } from '../backend';
import type { AiProfile } from '../types';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const BIZ = { email: 'biz@test.dev', password: 'pw' };
const WORKER = { email: 'w@test.dev', password: 'pw' };

type ShiftInput = Parameters<Backend['createShift']>[0];

function shiftInput(over: Partial<ShiftInput> = {}): ShiftInput {
  return {
    title: 'Weekend Barista',
    role: 'Barista',
    payRateCents: 2400,
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

/** A business with a voice profile, and a worker who has shown interest. */
async function setupThread(aiProfile?: AiProfile) {
  await AsyncStorage.clear();
  const backend = new MockBackend();

  await backend.signUp(BIZ.email, BIZ.password);
  await backend.saveBusinessProfile({
    companyName: 'Blue Harbor Coffee',
    category: 'Café',
    city: 'Oakland, CA',
    about: '',
    contactName: 'Dana',
    aiProfile,
  });
  const shift = await backend.createShift(shiftInput());

  await backend.signUp(WORKER.email, WORKER.password);
  await backend.saveWorkerProfile({
    fullName: 'Ada Worker',
    headline: 'Barista',
    bio: '',
    city: 'Oakland, CA',
    skills: [],
    yearsExperience: 2,
    availability: [],
  });
  const { thread } = await backend.swipeShift(shift.id, 'like');

  return { backend, shift, threadId: thread!.id };
}

describe('opening a thread', () => {
  it('writes no message at all — the worker sees nothing until one is sent', async () => {
    const { backend, threadId } = await setupThread();

    // The worker is the one who would have received the fabricated greeting.
    expect(await backend.listMessages(threadId)).toHaveLength(0);

    const [thread] = await backend.listMatches();
    expect(thread.lastMessage).toBeUndefined();
    expect(thread.lastMessageAt).toBeUndefined();
  });

  it('never attributes a message to somebody who did not write it', async () => {
    const { backend, threadId } = await setupThread();
    await backend.signIn(BIZ.email, BIZ.password);

    const messages = await backend.listMessages(threadId);

    expect(messages).toHaveLength(0);
  });
});

describe('buildOpener', () => {
  const profile: AiProfile = {
    tone: 'casual',
    dressCode: 'Black tee, closed-toe shoes',
    parkingNotes: 'Street parking on Lakeshore',
    whatMakesUsDifferent: 'Small crew, no rush-hour chaos.',
    faqs: [{ question: 'Do I need my own tools?', answer: 'No, we supply everything.' }],
  };

  it('greets the worker by first name and names the shift', () => {
    const text = buildOpener('Blue Harbor Coffee', profile, {
      workerFirstName: 'Ada',
      shiftTitle: 'Weekend Barista',
    });

    expect(text).toContain('Ada');
    expect(text).toContain('Weekend Barista');
    expect(text).toContain('Blue Harbor Coffee');
  });

  it('surfaces the details the employer took the trouble to fill in', () => {
    const text = buildOpener('Blue Harbor Coffee', profile, { workerFirstName: 'Ada' });

    expect(text).toContain('Black tee, closed-toe shoes');
    expect(text).toContain('Street parking on Lakeshore');
    expect(text).toContain('Small crew, no rush-hour chaos.');
    expect(text).toContain('No, we supply everything.');
  });

  it('still produces a coherent, shift-specific opener with no voice profile', () => {
    const text = buildOpener('Blue Harbor Coffee', {}, {
      workerFirstName: 'Ada',
      shiftTitle: 'Weekend Barista',
    });

    expect(text).toContain('Ada');
    expect(text).toContain('Weekend Barista');
    expect(text.trim().length).toBeGreaterThan(40);
    // Nothing dangling where a missing field would have been.
    expect(text).not.toMatch(/undefined|: *$/m);
  });

  it('reflects the configured tone', () => {
    const casual = buildOpener('Blue Harbor', { tone: 'casual' }, {});
    const professional = buildOpener('Blue Harbor', { tone: 'professional' }, {});

    expect(casual).not.toBe(professional);
    expect(professional).toMatch(/Hello/);
  });

  it('keeps the voice-form preview working, with no worker or shift yet', () => {
    const preview = buildOpenerPreview('Blue Harbor Coffee', profile);

    expect(preview).toContain('Blue Harbor Coffee');
    expect(preview).toContain('Black tee, closed-toe shoes');
  });
});

describe('discarding the opener', () => {
  it('persists, so reopening the thread does not bring it back', async () => {
    const { backend, threadId } = await setupThread();
    await backend.signIn(BIZ.email, BIZ.password);

    await backend.dismissOpenerDraft(threadId);

    const reopened = new MockBackend();
    await reopened.signIn(BIZ.email, BIZ.password);
    expect((await reopened.getMatch(threadId))?.openerDismissedAt).toBeTruthy();
  });

  it('is not something the worker can do to the employer', async () => {
    const { backend, threadId } = await setupThread();

    // Still signed in as the worker after expressing interest.
    await backend.dismissOpenerDraft(threadId);

    await backend.signIn(BIZ.email, BIZ.password);
    expect((await backend.getMatch(threadId))?.openerDismissedAt).toBeUndefined();
  });
});

describe('sending the opener', () => {
  it('becomes an ordinary message from the employer, visible to the worker', async () => {
    const { backend, threadId } = await setupThread({ tone: 'casual' });
    await backend.signIn(BIZ.email, BIZ.password);
    const biz = (await backend.getAccount())!.session.userId;

    const text = buildOpener('Blue Harbor Coffee', { tone: 'casual' }, { workerFirstName: 'Ada' });
    const sent = await backend.sendMessage(threadId, text);

    expect(sent.senderId).toBe(biz);

    await backend.signIn(WORKER.email, WORKER.password);
    const seen = await backend.listMessages(threadId);
    expect(seen.map((m) => m.body)).toEqual([text]);
  });
});
