import { UPLOAD } from '../../constants/location';
import type { JourneyStatus } from '../../types/db';
import { KEYS, readJson, remove, writeJson } from '../storage/kv';

/** The journey this device is collecting for. Persisted so the background task can read it. */
export interface LocalJourney {
  id: string;
  label: string;
  startedAt: string;
  expiresAt: string;
  /** 'active' until the device learns the journey ended (locally or from the server). */
  status: JourneyStatus;
  /** An end action taken on the device that the server has not confirmed yet. */
  pendingEnd?: 'safe_arrival' | 'stop' | 'cancel';
  endedAt?: string;
}

export interface QueuedPoint {
  journeyId: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  observed_at: string;
}

export interface LocationStatus {
  journeyId: string | null;
  lastFixAt: string | null;
  lastFixAccuracyM: number | null;
  /** The employee's own latest fix, for their own map only. Cleared when the journey ends. */
  lastFix: { latitude: number; longitude: number } | null;
  lastUploadAt: string | null;
  lastUploadError: 'offline' | 'session' | 'server' | null;
  pending: number;
  lastTaskError: string | null;
}

const EMPTY_STATUS: LocationStatus = {
  journeyId: null, lastFixAt: null, lastFixAccuracyM: null, lastFix: null,
  lastUploadAt: null, lastUploadError: null, pending: 0, lastTaskError: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeLocationState(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // listeners must not break the task
    }
  });
}

// Serialise all queue/state mutations: the background task and the UI share one JS runtime
// when the app is open.
let chain: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export const getLocalJourney = () => readJson<LocalJourney | null>(KEYS.activeJourney, null);
export async function setLocalJourney(j: LocalJourney | null) {
  if (j) await writeJson(KEYS.activeJourney, j);
  else await remove(KEYS.activeJourney);
  notify();
}

export const getQueue = () => readJson<QueuedPoint[]>(KEYS.locationQueue, []);
export async function setQueue(q: QueuedPoint[]) {
  await writeJson(KEYS.locationQueue, q);
}

export const getLocationStatus = () => readJson<LocationStatus>(KEYS.locationStatus, EMPTY_STATUS);
export async function patchLocationStatus(patch: Partial<LocationStatus>) {
  const cur = await getLocationStatus();
  await writeJson(KEYS.locationStatus, { ...cur, ...patch });
  notify();
}
export async function resetLocationStatus(journeyId: string | null) {
  await writeJson(KEYS.locationStatus, { ...EMPTY_STATUS, journeyId });
  notify();
}

/**
 * Merge new points into the queue: only for the given journey, de-duplicated by observation
 * time, sorted oldest-first, capped (newest kept) so an offline phone cannot grow it forever.
 */
export function mergePoints(queue: QueuedPoint[], incoming: QueuedPoint[], journeyId: string): QueuedPoint[] {
  const byTime = new Map<string, QueuedPoint>();
  for (const p of [...queue, ...incoming]) {
    if (p.journeyId !== journeyId) continue;
    byTime.set(p.observed_at, p);
  }
  const sorted = [...byTime.values()].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  return sorted.slice(Math.max(0, sorted.length - UPLOAD.maxQueued));
}
