// Background location task. Imported once at app start (index.ts) so it is defined at the top
// level of the bundle, which Android needs when it wakes the app for location updates.
import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TASK_NAME } from '../../constants/location';
import { logger } from '../../utils/logger';
// Importing the controller registers the handler that stops collection when the server reports
// the journey ended; this must also happen when Android starts the task headlessly.
import { stopLocationCollection } from './controller';
import { getLocalJourney, patchLocationStatus, type QueuedPoint } from './state';
import { enqueuePoints, flushQueue } from './uploader';

export function toQueuedPoints(locations: LocationObject[], journeyId: string, startedAt: string, expiresAt: string): QueuedPoint[] {
  const start = Date.parse(startedAt) - 30_000;
  const end = Date.parse(expiresAt);
  return locations
    .filter((l) => Number.isFinite(l.coords?.latitude) && Number.isFinite(l.coords?.longitude) && Number.isFinite(l.timestamp))
    // Never queue anything observed before consent or after expiry.
    .filter((l) => l.timestamp >= start && l.timestamp < end)
    .map((l) => ({
      journeyId,
      latitude: l.coords.latitude,
      longitude: l.coords.longitude,
      accuracy_m: l.coords.accuracy ?? null,
      observed_at: new Date(l.timestamp).toISOString(),
    }));
}

export async function handleLocationTask(body: TaskManager.TaskManagerTaskBody<{ locations?: LocationObject[] }>) {
  if (body.error) {
    logger.warn('location_task_error', { code: body.error.code });
    await patchLocationStatus({ lastTaskError: body.error.message.slice(0, 120) });
    return;
  }
  const journey = await getLocalJourney();
  if (!journey || journey.status !== 'active') {
    // Collection should already be stopped; make sure of it.
    await stopLocationCollection();
    return;
  }
  const points = toQueuedPoints(body.data?.locations ?? [], journey.id, journey.startedAt, journey.expiresAt);
  if (points.length > 0) await enqueuePoints(points);
  await flushQueue();
}

if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask<{ locations?: LocationObject[] }>(LOCATION_TASK_NAME, handleLocationTask);
}
