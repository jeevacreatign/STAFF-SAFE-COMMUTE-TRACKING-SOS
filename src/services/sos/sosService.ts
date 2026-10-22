import * as Location from 'expo-location';
import { SOS_LOCATION } from '../../constants/location';
import type { SosAlert } from '../../types/db';
import { backoffDelay } from '../../utils/backoff';
import { toAppError } from '../../utils/errors';
import { freshnessOf } from '../../utils/freshness';
import { newRequestId } from '../../utils/id';
import { logger } from '../../utils/logger';
import { getLocationStatus } from '../location/state';
import { KEYS, readJson, writeJson } from '../storage/kv';
import { supabase } from '../supabase/client';
import { rpc } from '../supabase/rpc';

/**
 * Delivery states shown to the employee, in order:
 *  saved_locally -> sending -> confirmed            (server returned the stored alert)
 *                           -> waiting_retry        (no confirmation yet; will retry)
 *                           -> failed               (server refused; e.g. journey long finished)
 * Only "confirmed" is ever presented as received.
 */
export type SosDeliveryState = 'saved_locally' | 'sending' | 'waiting_retry' | 'confirmed' | 'failed';

export interface SosLocationSnapshot {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  observedAt: string;
  source: 'fresh_fix' | 'last_known';
}

export interface SosOutboxItem {
  clientRequestId: string;
  journeyId: string;
  createdAt: string;
  location: SosLocationSnapshot | null;
  state: SosDeliveryState;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  serverAlert: Pick<SosAlert, 'id' | 'alert_status' | 'created_at' | 'location_freshness' | 'location_source'> | null;
  lastError: string | null;
}

type Listener = (items: SosOutboxItem[]) => void;
const listeners = new Set<Listener>();
export function subscribeSos(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let cache: SosOutboxItem[] | null = null;
async function load(): Promise<SosOutboxItem[]> {
  if (!cache) cache = await readJson<SosOutboxItem[]>(KEYS.sosOutbox, []);
  return cache;
}
async function save(items: SosOutboxItem[]) {
  // Keep confirmed alerts for 24 h for the status screen; unconfirmed ones until resolved.
  const cutoff = Date.now() - 24 * 3600_000;
  cache = items.filter((i) => i.state !== 'confirmed' || Date.parse(i.createdAt) > cutoff);
  await writeJson(KEYS.sosOutbox, cache);
  listeners.forEach((fn) => fn(cache!));
}
async function update(id: string, patch: Partial<SosOutboxItem>) {
  const items = await load();
  await save(items.map((i) => (i.clientRequestId === id ? { ...i, ...patch } : i)));
}

export async function getSosItems() {
  return load();
}

/**
 * Best available location without delaying the alert much: the newest fix this device has;
 * if it is older than a minute, try briefly for a fresh one. Never invents a position.
 */
export async function captureSosLocation(): Promise<SosLocationSnapshot | null> {
  let best: SosLocationSnapshot | null = null;
  try {
    const status = await getLocationStatus();
    if (status.lastFix && status.lastFixAt) {
      best = { ...status.lastFix, accuracyM: status.lastFixAccuracyM, observedAt: status.lastFixAt, source: 'last_known' };
    }
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return best;
    const last = await Location.getLastKnownPositionAsync({});
    if (last && (!best || last.timestamp > Date.parse(best.observedAt))) {
      best = {
        latitude: last.coords.latitude, longitude: last.coords.longitude, accuracyM: last.coords.accuracy ?? null,
        observedAt: new Date(last.timestamp).toISOString(), source: 'last_known',
      };
    }
    if (!best || Date.now() - Date.parse(best.observedAt) > SOS_LOCATION.maxAgeMs) {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SOS_LOCATION.freshFixTimeoutMs)),
      ]);
      if (fresh) {
        best = {
          latitude: fresh.coords.latitude, longitude: fresh.coords.longitude, accuracyM: fresh.coords.accuracy ?? null,
          observedAt: new Date(fresh.timestamp).toISOString(), source: 'fresh_fix',
        };
      }
    }
  } catch (e) {
    logger.warn('sos_location_unavailable', { message: String(e).slice(0, 80) });
  }
  return best;
}

export function describeSosLocation(loc: SosLocationSnapshot | null): string {
  if (!loc) return 'No location available. The alert is sent without one; the safety team will see your last uploaded position if there is one.';
  const f = freshnessOf(loc.observedAt);
  return f === 'fresh' ? 'Current location attached.' : 'Only an older location was available. It is sent with its timestamp and marked as not live.';
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function attempt(id: string): Promise<SosOutboxItem | undefined> {
  const item = (await load()).find((i) => i.clientRequestId === id);
  if (!item || item.state === 'confirmed' || item.state === 'failed') return item;
  await update(id, { state: 'sending', attempts: item.attempts + 1, lastAttemptAt: new Date().toISOString(), nextAttemptAt: null });
  try {
    const alert = await rpc<SosAlert>('create_sos_alert', {
      p_client_request_id: item.clientRequestId,
      p_journey_id: item.journeyId,
      p_latitude: item.location?.latitude ?? null,
      p_longitude: item.location?.longitude ?? null,
      p_accuracy_m: item.location?.accuracyM ?? null,
      p_location_observed_at: item.location?.observedAt ?? null,
      p_client_created_at: item.createdAt,
    });
    await update(id, {
      state: 'confirmed',
      lastError: null,
      serverAlert: {
        id: alert.id, alert_status: alert.alert_status, created_at: alert.created_at,
        location_freshness: alert.location_freshness, location_source: alert.location_source,
      },
    });
    // Ask the server to push to administrators now rather than waiting for the next cron run.
    supabase.functions.invoke('dispatch-notifications', { body: {} }).catch(() => undefined);
  } catch (e) {
    const err = toAppError(e);
    if (err.retryable || err.code === 'SESSION_EXPIRED') {
      const attempts = item.attempts + 1;
      const delay = Math.max(2_000, backoffDelay(attempts, 2_000, 60_000));
      await update(id, { state: 'waiting_retry', lastError: err.message, nextAttemptAt: new Date(Date.now() + delay).toISOString() });
      scheduleRetry(id, delay);
    } else {
      await update(id, { state: 'failed', lastError: err.message });
    }
  }
  return (await load()).find((i) => i.clientRequestId === id);
}

function scheduleRetry(id: string, delay: number) {
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => {
    timers.delete(id);
    void attempt(id);
  }, delay));
}

/** Create the alert: saved on the device first, then sent. Returns the outbox item. */
export async function raiseSos(journeyId: string): Promise<SosOutboxItem> {
  const item: SosOutboxItem = {
    clientRequestId: newRequestId(),
    journeyId,
    createdAt: new Date().toISOString(),
    location: null,
    state: 'saved_locally',
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    serverAlert: null,
    lastError: null,
  };
  await save([...(await load()), item]);
  const location = await captureSosLocation();
  await update(item.clientRequestId, { location });
  return (await attempt(item.clientRequestId)) ?? item;
}

/** Manual retry (same idempotency key, so the server never duplicates). */
export async function retrySos(clientRequestId: string) {
  clearTimeout(timers.get(clientRequestId));
  const item = (await load()).find((i) => i.clientRequestId === clientRequestId);
  if (item?.state === 'failed') await update(clientRequestId, { state: 'waiting_retry' });
  return attempt(clientRequestId);
}

/** Retry every unconfirmed alert (on reconnect / app start). */
export async function retryPendingSos() {
  const items = await load();
  await Promise.all(items.filter((i) => i.state === 'saved_locally' || i.state === 'waiting_retry' || i.state === 'sending')
    .map((i) => attempt(i.clientRequestId)));
}

export async function dismissSos(clientRequestId: string) {
  const items = await load();
  // Unconfirmed alerts cannot be dismissed silently; only confirmed or failed ones.
  await save(items.filter((i) => i.clientRequestId !== clientRequestId || (i.state !== 'confirmed' && i.state !== 'failed')));
}

/** Server-side status of the employee's own alert (RLS: own rows only). */
export async function fetchMyAlert(alertId: string): Promise<SosAlert | null> {
  const { data } = await supabase.from('sos_alerts').select('*').eq('id', alertId).maybeSingle();
  return (data as SosAlert | null) ?? null;
}

/** Test hook. */
export function __resetSosCache() {
  cache = null;
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
}
