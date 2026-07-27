/**
 * Expo push notifications for race-mode offers.
 *
 * Workers register a device token on sign-in; when an employer sends an offer
 * batch the backend looks up each recipient's tokens and posts them straight to
 * Expo's push service. There is no server component in this project, so the
 * sending device talks to `exp.host` directly.
 *
 * Remote push needs a development build — it does not work in Expo Go on
 * Android (SDK 53+) or in the web build, so every entry point here degrades to
 * a no-op rather than throwing.
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Shift } from './types';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/** Show offers that land while the app is foregrounded. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId
  );
}

/**
 * Ask for notification permission and return this device's Expo push token.
 * Returns null when push isn't available (simulator, web, permission denied,
 * or no EAS project id configured) — callers should treat that as "no push".
 *
 * The project-id check comes **before** the permission request on purpose.
 * Without an id no token can be issued, so asking first would show the system
 * prompt and then discard the answer. On iOS that prompt is one-shot per
 * install: a decline there could not be re-asked, and would leave push broken
 * for a user who never even had it offered to them for a working reason.
 */
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  const id = projectId();
  if (!id) return null;

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted) {
    const asked = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    granted = asked.granted;
  }
  if (!granted) return null;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return data;
  } catch {
    // Expo's token service can reject; an offer without a push is still valid.
    return null;
  }
}

export function offerNotificationBody(shift: Shift): { title: string; body: string } {
  return {
    title: `New shift offer · $${shift.payRate}/${shift.payType}`,
    body: `${shift.business?.companyName ?? 'A local business'} offered you "${shift.title}". First to accept gets it.`,
  };
}

/**
 * Post one offer notification per token. Failures are swallowed: a push that
 * doesn't land must never stop the offer rows from being created.
 */
export async function sendOfferPush(tokens: string[], shift: Shift): Promise<void> {
  if (tokens.length === 0) return;
  const { title, body } = offerNotificationBody(shift);
  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    sound: 'default',
    data: { type: 'offer', shiftId: shift.id },
  }));

  try {
    await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch {
    // Offline or push service down — offers are already persisted.
  }
}

/**
 * Demo-backend stand-in for a remote push: the offered "workers" are all on
 * this device, so present the notification locally instead.
 */
export async function presentOfferNotificationLocally(shift: Shift): Promise<void> {
  if (Platform.OS === 'web') return;
  const { title, body } = offerNotificationBody(shift);
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { type: 'offer', shiftId: shift.id } },
      trigger: null,
    });
  } catch {
    // Notifications unavailable in this runtime; the in-app offer card stands.
  }
}
