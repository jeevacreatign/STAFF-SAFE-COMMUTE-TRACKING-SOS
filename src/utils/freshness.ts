import { FRESHNESS } from '../constants/location';
import type { LocationFreshness } from '../types/db';

/** Same thresholds as the database function location_freshness_for(). */
export function freshnessOf(observedAt: string | Date | null | undefined, now: number = Date.now()): LocationFreshness {
  if (!observedAt) return 'none';
  const t = typeof observedAt === 'string' ? Date.parse(observedAt) : observedAt.getTime();
  if (Number.isNaN(t)) return 'none';
  const age = now - t;
  if (age <= FRESHNESS.freshMs) return 'fresh';
  if (age <= FRESHNESS.delayedMs) return 'delayed';
  return 'stale';
}

export const freshnessLabel: Record<LocationFreshness, string> = {
  fresh: 'Live',
  delayed: 'Delayed',
  stale: 'Stale (not live)',
  none: 'No location yet',
};
