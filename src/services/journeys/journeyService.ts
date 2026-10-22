import { CONSENT_VERSION } from '../../constants/consent';
import type { JourneySetup } from '../../schemas/journey';
import type { ConsentRecord, Journey, JourneyStatus, SosAlert } from '../../types/db';
import { addMinutes } from '../../utils/time';
import { AppError, toAppError } from '../../utils/errors';
import {
  clearLocalJourney, endLocally, getLocalJourney, isCollecting, startLocationCollection, stopLocationCollection,
} from '../location/controller';
import { setLocalJourney } from '../location/state';
import { flushQueue, markLocalJourneyEnded } from '../location/uploader';
import { supabase } from '../supabase/client';
import { rpc, unwrap } from '../supabase/rpc';

export type EndAction = 'safe_arrival' | 'stop' | 'cancel';

export const PAGE_SIZE = 20;

/** Allowed client-visible transitions; the database enforces the same rules. */
export const JOURNEY_TRANSITIONS: Record<JourneyStatus, JourneyStatus[]> = {
  active: ['safely_arrived', 'stopped', 'expired', 'cancelled'],
  safely_arrived: [],
  stopped: [],
  expired: [],
  cancelled: [],
};
export const canTransition = (from: JourneyStatus, to: JourneyStatus) => JOURNEY_TRANSITIONS[from].includes(to);

export function computeJourneyTimes(setup: JourneySetup, now = new Date()) {
  return {
    expiresAt: addMinutes(now, setup.expiryMinutes).toISOString(),
    estimatedArrivalAt: setup.etaMinutes !== undefined ? addMinutes(now, setup.etaMinutes).toISOString() : null,
  };
}

/**
 * Create the journey on the server (which records consent), then start collection.
 * If collection cannot start, the journey is cancelled so nothing stays "active" untracked.
 */
export async function startJourney(setup: JourneySetup, requestId: string, consentGiven: boolean) {
  if (!consentGiven) throw new AppError('CONSENT_REQUIRED', 'You need to approve location sharing for this journey first.');
  const { expiresAt, estimatedArrivalAt } = computeJourneyTimes(setup);
  const journey = await rpc<Journey>('start_journey', {
    p_client_request_id: requestId,
    p_label: setup.label,
    p_destination_label: setup.destination ?? null,
    p_estimated_arrival_at: estimatedArrivalAt,
    p_expires_at: expiresAt,
    p_consent_version: CONSENT_VERSION,
    p_consent_given: true,
  });

  const started = await startLocationCollection(journey);
  if (!started.ok) {
    try {
      await rpc<Journey>('end_journey', { p_journey_id: journey.id, p_action: 'cancel' });
    } catch {
      // The server will expire it; it has no location and is never shown as live tracking.
    }
    await clearLocalJourney();
    throw new AppError('VALIDATION', started.message);
  }
  return { journey, background: started.background };
}

/**
 * End the journey: stop collection on the device immediately, then confirm with the server.
 * Returns the server row when confirmed, or null if the server could not be reached yet
 * (the pending action is kept and retried by reconcile()).
 */
export async function endJourney(journeyId: string, action: EndAction): Promise<Journey | null> {
  await endLocally(action);
  try {
    const row = await rpc<Journey>('end_journey', { p_journey_id: journeyId, p_action: action });
    const local = await getLocalJourney();
    if (local?.id === journeyId) await setLocalJourney({ ...local, status: row.status, pendingEnd: undefined });
    return row;
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'NETWORK' || err.code === 'SESSION_EXPIRED') return null;
    throw err;
  }
}

/** The employee's active journey according to the server (RLS limits this to their own). */
export async function fetchMyActiveJourney(userId: string): Promise<Journey | null> {
  const result = await supabase
    .from('journeys')
    .select('*')
    .eq('employee_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  return unwrap(result) as Journey | null;
}

export type ReconcileOutcome =
  | { kind: 'none' }
  | { kind: 'active'; journey: Journey; collecting: boolean }
  | { kind: 'ended'; journey: Journey | null; status: JourneyStatus }
  | { kind: 'pending_end'; journeyId: string };

/**
 * Align the device with the server after launch / reconnect. The server is the source of truth:
 * a journey that ended there stops here. A server-active journey that is not collecting on
 * this device (e.g. after a reboot) is reported so the employee can choose to resume; it is
 * never resumed silently.
 */
export async function reconcile(userId: string): Promise<ReconcileOutcome> {
  const local = await getLocalJourney();

  if (local?.pendingEnd) {
    try {
      const row = await rpc<Journey>('end_journey', { p_journey_id: local.id, p_action: local.pendingEnd });
      await setLocalJourney({ ...local, status: row.status, pendingEnd: undefined });
      return { kind: 'ended', journey: row, status: row.status };
    } catch (e) {
      if (toAppError(e).code === 'NETWORK') return { kind: 'pending_end', journeyId: local.id };
      throw e;
    }
  }

  const server = await fetchMyActiveJourney(userId);
  if (server && Date.parse(server.expires_at) > Date.now()) {
    const collecting = (await isCollecting()) && local?.id === server.id && local.status === 'active';
    if (collecting) await flushQueue();
    return { kind: 'active', journey: server, collecting };
  }

  if (local && local.status === 'active') {
    // Ended on the server (expired / suspended) or locally overdue.
    const { data } = await supabase.from('journeys').select('*').eq('id', local.id).maybeSingle();
    const row = (data as Journey | null) ?? null;
    const status: JourneyStatus = row?.status && row.status !== 'active' ? row.status : 'expired';
    await stopLocationCollection();
    await markLocalJourneyEnded(status);
    return { kind: 'ended', journey: row, status };
  }
  if (await isCollecting()) await clearLocalJourney();
  return { kind: 'none' };
}

/** Restart collection for a journey that is still active and consented on the server. */
export async function resumeCollection(journey: Journey) {
  return startLocationCollection(journey);
}

export async function listMyJourneys(userId: string, page: number): Promise<Journey[]> {
  const from = page * PAGE_SIZE;
  const result = await supabase
    .from('journeys')
    .select('*')
    .eq('employee_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  return unwrap(result) as Journey[];
}

export async function getMyJourney(journeyId: string) {
  const [journey, consent, alerts] = await Promise.all([
    supabase.from('journeys').select('*').eq('id', journeyId).maybeSingle(),
    supabase.from('consent_records').select('*').eq('journey_id', journeyId).maybeSingle(),
    supabase.from('sos_alerts').select('*').eq('journey_id', journeyId).order('created_at', { ascending: false }),
  ]);
  return {
    journey: unwrap(journey) as Journey | null,
    consent: unwrap(consent) as ConsentRecord | null,
    alerts: (unwrap(alerts) as SosAlert[]) ?? [],
  };
}
