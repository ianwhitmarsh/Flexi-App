/**
 * Résumé references (BIG-82).
 *
 * The bucket used to be public with a read policy true for every caller, so a
 * résumé — legal name, work history, usually a phone number — was readable by
 * anyone holding the URL, forever, with no account. Profiles now store a
 * storage path and the app mints a short-lived signed URL to open it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MockBackend } from '../mockBackend';
import { resumePathFrom } from '../supabaseBackend';

jest.mock('../push', () => ({
  getPushToken: jest.fn(async () => null),
  sendOfferPush: jest.fn(async () => undefined),
  presentOfferNotificationLocally: jest.fn(async () => undefined),
}));

const WORKER = { email: 'w@test.dev', password: 'pw' };

describe('resumePathFrom', () => {
  it('passes a stored path straight through', () => {
    expect(resumePathFrom('abc-123/1753650000000-cv.pdf')).toBe('abc-123/1753650000000-cv.pdf');
  });

  it('recovers the path from a legacy public URL', () => {
    const legacy =
      'https://xyz.supabase.co/storage/v1/object/public/resumes/abc-123/1753650000000-cv.pdf';

    expect(resumePathFrom(legacy)).toBe('abc-123/1753650000000-cv.pdf');
  });

  it('drops any query string from a legacy URL', () => {
    const legacy =
      'https://xyz.supabase.co/storage/v1/object/public/resumes/abc-123/cv.pdf?download=1';

    expect(resumePathFrom(legacy)).toBe('abc-123/cv.pdf');
  });

  it('returns null for a URL that is not a résumé at all', () => {
    expect(resumePathFrom('https://example.invalid/some/other/file.pdf')).toBeNull();
  });

  it('returns null for nothing', () => {
    expect(resumePathFrom('')).toBeNull();
  });
});

describe('demo mode', () => {
  async function signUpWorker() {
    await AsyncStorage.clear();
    const backend = new MockBackend();
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
    return backend;
  }

  it('keeps the device-local uri and resolves it unchanged', async () => {
    const backend = await signUpWorker();

    const saved = await backend.uploadResume({ uri: 'file:///tmp/ada-cv.pdf', name: 'ada-cv.pdf' });
    expect(saved.url).toBe('file:///tmp/ada-cv.pdf');

    expect(await backend.resolveResumeUrl(saved.url)).toBe('file:///tmp/ada-cv.pdf');
  });

  it('issues no network call while resolving', async () => {
    const backend = await signUpWorker();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await backend.uploadResume({ uri: 'file:///tmp/ada-cv.pdf', name: 'ada-cv.pdf' });
    await backend.resolveResumeUrl('file:///tmp/ada-cv.pdf');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('resolves nothing to null rather than an empty link', async () => {
    const backend = await signUpWorker();
    expect(await backend.resolveResumeUrl('')).toBeNull();
  });
});
