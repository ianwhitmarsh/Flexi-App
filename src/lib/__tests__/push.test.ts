/**
 * Push permission ordering (BIG-74).
 *
 * Without an EAS project id no token can ever be issued, so asking for
 * notification permission first shows the system prompt and then throws the
 * answer away. On iOS that prompt is one-shot per install, so a decline there
 * is not recoverable in-app — which makes the ordering a correctness question,
 * not a tidiness one.
 */

const mockConstants: { expoConfig: { extra?: Record<string, unknown> } | null } = {
  expoConfig: { extra: {} },
};
const mockDevice = { isDevice: true };

// `__esModule: true` matters: `push.ts` uses a default import, and without the
// flag Babel's interop wraps the whole mock as `{ default: mock }`, leaving
// `Constants.expoConfig` undefined. That would make every "no project id" test
// pass for the wrong reason — vacuously, rather than because of the ordering
// this file exists to pin.
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() {
    return mockConstants;
  },
}));
jest.mock('expo-device', () => ({ __esModule: true, ...mockDevice, get isDevice() {
  return mockDevice.isDevice;
} }));

const mockGetPermissions = jest.fn(async () => ({ granted: false }));
const mockRequestPermissions = jest.fn(async () => ({ granted: true }));
const mockGetToken = jest.fn(async () => ({ data: 'ExponentPushToken[xyz]' }));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...(args as [])),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetToken(...(args as [])),
  scheduleNotificationAsync: jest.fn(),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/**
 * Re-require with a fresh module registry so each test sees the project id it
 * set. `push.ts` reads `Constants` at call time, but it also runs
 * `setNotificationHandler` at import time, so isolating keeps that per-test.
 */
function loadPush(): typeof import('../push') {
  let mod: typeof import('../push') | undefined;
  jest.isolateModules(() => {
    mod = require('../push') as typeof import('../push');
  });
  return mod!;
}

beforeEach(() => {
  mockGetPermissions.mockClear().mockResolvedValue({ granted: false });
  mockRequestPermissions.mockClear().mockResolvedValue({ granted: true });
  mockGetToken.mockClear().mockResolvedValue({ data: 'ExponentPushToken[xyz]' });
  mockDevice.isDevice = true;
  mockConstants.expoConfig = { extra: {} };
});

describe('getPushToken without an EAS project id', () => {
  it('never asks for notification permission', async () => {
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBeNull();

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    // Not even the silent check — there is nothing to decide.
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('still asks for nothing when extra is missing entirely', async () => {
    mockConstants.expoConfig = {};
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBeNull();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});

describe('getPushToken with an EAS project id', () => {
  beforeEach(() => {
    mockConstants.expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
  });

  it('requests permission when it has not been granted, then fetches a token', async () => {
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBe('ExponentPushToken[xyz]');

    expect(mockGetPermissions).toHaveBeenCalled();
    expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
    expect(mockGetToken).toHaveBeenCalledWith({ projectId: 'proj-123' });
  });

  it('does not re-request permission that is already granted', async () => {
    mockGetPermissions.mockResolvedValue({ granted: true });
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBe('ExponentPushToken[xyz]');

    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it('returns null when the worker declines, without fetching a token', async () => {
    mockRequestPermissions.mockResolvedValue({ granted: false });
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBeNull();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the token service rejects', async () => {
    mockGetToken.mockRejectedValue(new Error('service down'));
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBeNull();
  });
});

describe('runtimes that cannot receive push at all', () => {
  it('asks for nothing on a simulator, even with a project id', async () => {
    mockDevice.isDevice = false;
    mockConstants.expoConfig = { extra: { eas: { projectId: 'proj-123' } } };
    const { getPushToken } = loadPush();

    expect(await getPushToken()).toBeNull();
    expect(mockGetPermissions).not.toHaveBeenCalled();
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });
});
