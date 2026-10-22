import { UPLOAD } from '../../constants/location';
import type { JourneyStatus, RecordLocationsResult } from '../../types/db';
import { toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { rpc } from '../supabase/rpc';
import {
  getLocalJourney, getQueue, LocalJourney, mergePoints, patchLocationStatus, QueuedPoint,
  setLocalJourney, setQueue, withLock,
} from './state';

export type EndHandler = (journey: LocalJourney, serverStatus: JourneyStatus) => Promise<void>;
let onEnded: EndHandler | null = null;
/** The controller registers how to stop collection when the server says a journey ended. */
export function setJourneyEndedHandler(fn: EndHandler) {
  onEnded = fn;
}

export async function enqueuePoints(points: QueuedPoint[]): Promise<number> {
  return withLock(async () => {
    const journey = await getLocalJourney();
    if (!journey || journey.status !== 'active') return 0;
    const merged = mergePoints(await getQueue(), points, journey.id);
    await setQueue(merged);
    const newest = points.reduce<QueuedPoint | null>(
      (acc, p) => (!acc || Date.parse(p.observed_at) > Date.parse(acc.observed_at) ? p : acc),
      null,
    );
    await patchLocationStatus({
      pending: merged.length,
      ...(newest
        ? {
            lastFixAt: newest.observed_at,
            lastFixAccuracyM: newest.accuracy_m,
            lastFix: { latitude: newest.latitude, longitude: newest.longitude },
          }
        : {}),
    });
    return merged.length;
  });
}

export type FlushResult = 'empty' | 'uploaded' | 'offline' | 'session' | 'ended' | 'error' | 'no_journey';

/**
 * Upload queued points in order. Never reports success unless the server confirmed the batch.
 * If the server reports the journey is no longer active, collection stops and the queue is
 * discarded: those points are never shown anywhere as live.
 */
export async function flushQueue(): Promise<FlushResult> {
  // The end handler takes the lock itself, so it runs after the locked section (no re-entry).
  let ended: { journey: LocalJourney; status: JourneyStatus } | null = null;
  const result = await withLock<FlushResult>(async () => {
    const journey = await getLocalJourney();
    if (!journey || journey.status !== 'active') {
      await setQueue([]);
      return 'no_journey';
    }
    if (Date.now() >= Date.parse(journey.expiresAt)) {
      // The server will refuse these anyway; stop locally without waiting for the network.
      await setQueue([]);
      ended = { journey, status: 'expired' };
      return 'ended';
    }

    let queue = (await getQueue()).filter((p) => p.journeyId === journey.id);
    if (queue.length === 0) return 'empty';

    while (queue.length > 0) {
      const batch = queue.slice(0, UPLOAD.maxBatch);
      let result: RecordLocationsResult;
      try {
        result = await rpc<RecordLocationsResult>('record_locations', {
          p_journey_id: journey.id,
          p_points: batch.map(({ latitude, longitude, accuracy_m, observed_at }) => ({ latitude, longitude, accuracy_m, observed_at })),
        });
      } catch (e) {
        const err = toAppError(e);
        const kind = err.code === 'NETWORK' ? 'offline' : err.code === 'SESSION_EXPIRED' || err.code === 'NOT_AUTHENTICATED' ? 'session' : 'server';
        await patchLocationStatus({ lastUploadError: kind, pending: queue.length });
        if (err.code === 'NOT_FOUND' || err.code === 'ACCOUNT_INACTIVE') {
          await setQueue([]);
          ended = { journey, status: 'stopped' };
          return 'ended';
        }
        logger.warn('location_upload_failed', { code: err.code, pending: queue.length });
        return kind === 'offline' ? 'offline' : kind === 'session' ? 'session' : 'error';
      }

      if (result.journey_status !== 'active') {
        await setQueue([]);
        ended = { journey, status: result.journey_status };
        return 'ended';
      }
      queue = queue.slice(batch.length);
      await setQueue(queue);
      await patchLocationStatus({ lastUploadAt: new Date().toISOString(), lastUploadError: null, pending: queue.length });
    }
    return 'uploaded';
  });
  const end = ended as { journey: LocalJourney; status: JourneyStatus } | null;
  if (end) await onEnded?.(end.journey, end.status);
  return result;
}

/** Mark the local journey as ended without touching the network. */
export async function markLocalJourneyEnded(status: JourneyStatus, pendingEnd?: LocalJourney['pendingEnd']) {
  await withLock(async () => {
    const journey = await getLocalJourney();
    if (!journey) return;
    await setQueue([]);
    await setLocalJourney({ ...journey, status, pendingEnd, endedAt: journey.endedAt ?? new Date().toISOString() });
    await patchLocationStatus({ pending: 0, lastFix: null });
  });
}
