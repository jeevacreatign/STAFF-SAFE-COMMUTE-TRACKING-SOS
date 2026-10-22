import * as Location from 'expo-location';
import { LOCATION_TASK_NAME, LOCATION_UPDATE } from '../../constants/location';
import { colors } from '../../theme';
import type { Journey, JourneyStatus } from '../../types/db';
import { logger } from '../../utils/logger';
import { getLocalJourney, resetLocationStatus, setLocalJourney, setQueue, withLock } from './state';
import { markLocalJourneyEnded, setJourneyEndedHandler } from './uploader';

export type StartResult =
  | { ok: true; background: boolean }
  | { ok: false; reason: 'foreground_denied' | 'services_disabled' | 'start_failed'; message: string };

/** Start OS location collection for a journey the server has already created and approved. */
export async function startLocationCollection(journey: Journey): Promise<StartResult> {
  if (journey.status !== 'active') {
    return { ok: false, reason: 'start_failed', message: 'This journey is not active.' };
  }
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    return { ok: false, reason: 'foreground_denied', message: 'Location permission is required to share this journey.' };
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    return { ok: false, reason: 'services_disabled', message: 'Location services are turned off on this phone.' };
  }
  const bg = await Location.getBackgroundPermissionsAsync();

  await withLock(async () => {
    await setQueue([]);
    await setLocalJourney({
      id: journey.id,
      label: journey.label,
      startedAt: journey.sharing_started_at,
      expiresAt: journey.expires_at,
      status: 'active',
    });
  });
  await resetLocationStatus(journey.id);

  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      timeInterval: LOCATION_UPDATE.timeIntervalMs,
      distanceInterval: LOCATION_UPDATE.distanceIntervalM,
      deferredUpdatesInterval: LOCATION_UPDATE.deferredUpdatesIntervalMs,
      mayShowUserSettingsDialog: true,
      foregroundService: {
        notificationTitle: 'Location sharing active',
        notificationBody: 'Your journey is shared with the school safety team. Open the app to stop.',
        notificationColor: colors.navy,
        // Keep sharing if the app is swiped away, where the device allows it. The persistent
        // notification stays visible the whole time, so this is never hidden from the user.
        killServiceOnDestroy: false,
      },
    });
  } catch (e) {
    logger.error('location_start_failed', { message: String(e).slice(0, 120) });
    await setLocalJourney(null);
    return { ok: false, reason: 'start_failed', message: 'Android did not allow location sharing to start.' };
  }
  return { ok: true, background: bg.status === 'granted' };
}

/** Stop OS collection. Safe to call repeatedly and when nothing is running. */
export async function stopLocationCollection(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  } catch (e) {
    logger.warn('location_stop_failed', { message: String(e).slice(0, 120) });
  }
}

export async function isCollecting(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

/** Called when the server (or local expiry) says the journey is over. */
async function onServerEnded(_journey: unknown, status: JourneyStatus) {
  await stopLocationCollection();
  await markLocalJourneyEnded(status);
}
setJourneyEndedHandler(async (j, s) => onServerEnded(j, s));

/** End locally first (stopping never waits for the network), then the caller tells the server. */
export async function endLocally(pendingEnd: 'safe_arrival' | 'stop' | 'cancel') {
  await stopLocationCollection();
  const status: JourneyStatus = pendingEnd === 'safe_arrival' ? 'safely_arrived' : pendingEnd === 'stop' ? 'stopped' : 'cancelled';
  await markLocalJourneyEnded(status, pendingEnd);
}

export async function clearLocalJourney() {
  await stopLocationCollection();
  await setLocalJourney(null);
  await resetLocationStatus(null);
}

export { getLocalJourney };
