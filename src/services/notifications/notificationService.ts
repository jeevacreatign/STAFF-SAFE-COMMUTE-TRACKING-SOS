import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { config } from '../../constants/config';
import type { NotificationPreferences } from '../../types/db';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { KEYS, readJson, remove, writeJson } from '../storage/kv';
import { supabase } from '../supabase/client';
import { rpc, unwrap } from '../supabase/rpc';

export const CHANNELS = { sos: 'sos-alerts', journey: 'journey-updates' } as const;

export async function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNELS.sos, {
      name: 'SOS alerts',
      description: 'Emergency alerts raised by staff (administrators only).',
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      sound: 'default',
    });
    await Notifications.setNotificationChannelAsync(CHANNELS.journey, {
      name: 'Journey updates',
      description: 'Journey status, reminders and SOS updates.',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export type PushRegistration =
  | { status: 'registered' }
  | { status: 'denied' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; reason: string };

/** Ask for notification permission (Android 13+) and register this device's push token. */
export async function registerForPush(askPermission: boolean): Promise<PushRegistration> {
  if (!Device.isDevice) return { status: 'unsupported', reason: 'Push notifications need a physical device.' };
  if (!config.easProjectId) return { status: 'unsupported', reason: 'Push is not configured (missing EAS project id).' };
  let perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted' && askPermission && perm.canAskAgain) {
    perm = await Notifications.requestPermissionsAsync();
  }
  if (perm.status !== 'granted') return { status: 'denied' };
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: config.easProjectId })).data;
    await rpc('register_push_token', { p_token: token, p_platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    await writeJson(KEYS.pushToken, token);
    return { status: 'registered' };
  } catch (e) {
    logger.warn('push_registration_failed', { code: toAppError(e).code });
    return { status: 'error', reason: toAppError(e).message };
  }
}

/** On sign-out: stop this device receiving the previous user's notifications. */
export async function unregisterPush() {
  const token = await readJson<string | null>(KEYS.pushToken, null);
  if (!token) return;
  try {
    await rpc('unregister_push_token', { p_token: token });
  } catch {
    // If offline the server keeps the token until the next user registers it on this device.
  }
  await remove(KEYS.pushToken);
}

export async function notificationPermissionStatus() {
  return (await Notifications.getPermissionsAsync()).status;
}

export async function getMyPreferences(userId: string): Promise<NotificationPreferences | null> {
  const r = await supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle();
  return unwrap(r) as NotificationPreferences | null;
}

export async function savePreferences(p: { journeyReminders: boolean; statusUpdates: boolean; reminderMinutesAfterEta: number }) {
  return rpc<NotificationPreferences>('update_notification_preferences', {
    p_journey_reminders: p.journeyReminders,
    p_status_updates: p.statusUpdates,
    p_reminder_minutes_after_eta: p.reminderMinutesAfterEta,
  });
}

/** Local, on-device notice. Text never contains location details. */
export async function showLocalNotice(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: Platform.OS === 'android' ? { channelId: CHANNELS.journey } : null,
    });
  } catch {
    // Notification permission denied: the in-app state still shows the change.
  }
}
