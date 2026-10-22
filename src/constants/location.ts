// Location collection settings. Actual delivery depends on the device, Android version, vendor
// battery management and connectivity: these are requests to the OS, not guarantees.
export const LOCATION_TASK_NAME = 'staff-safe-commute.journey-location';

export const LOCATION_UPDATE = {
  /** Minimum time between updates requested from the OS (ms). */
  timeIntervalMs: 30_000,
  /** Minimum distance between updates (m). */
  distanceIntervalM: 25,
  /** Batch updates while backgrounded to save battery (ms). */
  deferredUpdatesIntervalMs: 60_000,
};

/** Freshness thresholds. Must match public.location_freshness_for() in the database. */
export const FRESHNESS = {
  freshMs: 2 * 60_000,
  delayedMs: 10 * 60_000,
};

export const UPLOAD = {
  maxBatch: 50,
  /** Points kept on the device while offline; older points beyond this are dropped. */
  maxQueued: 500,
};

export const JOURNEY_LIMITS = {
  minExpiryMinutes: 5,
  maxExpiryMinutes: 12 * 60,
  defaultExpiryMinutes: 90,
};

/** SOS: if the newest fix is older than this, try for a fresh one (bounded wait). */
export const SOS_LOCATION = { maxAgeMs: 60_000, freshFixTimeoutMs: 4_000 };
