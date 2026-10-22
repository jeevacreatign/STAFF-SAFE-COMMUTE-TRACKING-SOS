import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppError } from '../../src/utils/errors';

jest.mock('../../src/services/supabase/rpc', () => ({ rpc: jest.fn(), unwrap: jest.fn() }));
jest.mock('../../src/services/supabase/client', () => ({ supabase: {} }));

import { rpc } from '../../src/services/supabase/rpc';
import { endLocally, startLocationCollection } from '../../src/services/location/controller';
import { handleLocationTask, toQueuedPoints } from '../../src/services/location/locationTask';
import { getLocalJourney, getLocationStatus, getQueue, mergePoints, QueuedPoint } from '../../src/services/location/state';
import { enqueuePoints, flushQueue } from '../../src/services/location/uploader';
import type { Journey } from '../../src/types/db';

const mockedRpc = rpc as jest.Mock;
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

const journey = (over: Partial<Journey> = {}): Journey => ({
  id: 'j1', employee_id: 'u1', organisation_id: 'o1', client_request_id: 'r1', label: 'Home', destination_label: null,
  estimated_arrival_at: null, consented_at: iso(-60_000), consent_version: '2026-10-v1', sharing_started_at: iso(-60_000),
  expires_at: iso(3600_000), ended_at: null, end_reason: null, safe_arrival_at: null, status: 'active',
  last_latitude: null, last_longitude: null, last_accuracy_m: null, last_observed_at: null, last_received_at: null,
  created_at: iso(-60_000), updated_at: iso(-60_000), ...over,
});
const pt = (offsetMs: number, journeyId = 'j1'): QueuedPoint => ({ journeyId, latitude: 51.5, longitude: -0.1, accuracy_m: 10, observed_at: iso(offsetMs) });

beforeEach(async () => {
  await AsyncStorage.clear();
  mockedRpc.mockReset();
  jest.clearAllMocks();
});

describe('point handling', () => {
  test('mergePoints dedupes, sorts, filters other journeys and caps size', () => {
    const merged = mergePoints([pt(-3000), pt(-1000)], [pt(-1000), pt(-2000), pt(-500, 'other')], 'j1');
    expect(merged.map((p) => p.observed_at)).toEqual([iso(-3000), iso(-2000), iso(-1000)]);
    const many = Array.from({ length: 600 }, (_, i) => pt(-600_000 + i * 1000));
    const capped = mergePoints([], many, 'j1');
    expect(capped).toHaveLength(500);
    expect(capped[capped.length - 1].observed_at).toBe(many[599].observed_at); // newest kept
  });

  test('toQueuedPoints drops fixes from before consent or after expiry and invalid fixes', () => {
    const loc = (t: number, lat = 51.5) => ({ timestamp: t, coords: { latitude: lat, longitude: -0.1, accuracy: 5 } }) as unknown as Location.LocationObject;
    const pts = toQueuedPoints(
      [loc(now - 10 * 60_000), loc(now - 1000), loc(now + 7200_000), loc(now, Number.NaN)],
      'j1', iso(-60_000), iso(3600_000),
    );
    expect(pts).toHaveLength(1);
    expect(pts[0].observed_at).toBe(iso(-1000));
  });
});

describe('collection lifecycle', () => {
  test('does not start without foreground permission', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    const r = await startLocationCollection(journey());
    expect(r).toMatchObject({ ok: false, reason: 'foreground_denied' });
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(await getLocalJourney()).toBeNull();
  });

  test('does not start for a journey that is not active', async () => {
    const r = await startLocationCollection(journey({ status: 'expired' }));
    expect(r.ok).toBe(false);
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  test('starts with a visible foreground service notification', async () => {
    const r = await startLocationCollection(journey());
    expect(r).toEqual({ ok: true, background: true });
    const [, opts] = (Location.startLocationUpdatesAsync as jest.Mock).mock.calls[0];
    expect(opts.foregroundService.notificationTitle).toBe('Location sharing active');
    expect((await getLocalJourney())?.status).toBe('active');
  });

  test('ending locally stops collection and discards queued points without network', async () => {
    await startLocationCollection(journey());
    await enqueuePoints([pt(-1000)]);
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValueOnce(true);
    await endLocally('stop');
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
    expect(await getQueue()).toEqual([]);
    expect(await getLocalJourney()).toMatchObject({ status: 'stopped', pendingEnd: 'stop' });
    expect(mockedRpc).not.toHaveBeenCalled();
    // Nothing is accepted for an ended journey.
    expect(await enqueuePoints([pt(-500)])).toBe(0);
  });
});

describe('uploader', () => {
  beforeEach(async () => {
    await startLocationCollection(journey());
  });

  test('uploads in order in batches and records confirmed upload time', async () => {
    mockedRpc.mockResolvedValue({ journey_status: 'active', accepted: 50, duplicates: 0, rejected: 0 });
    await enqueuePoints(Array.from({ length: 70 }, (_, i) => pt(-70_000 + i * 1000)));
    expect(await flushQueue()).toBe('uploaded');
    expect(mockedRpc).toHaveBeenCalledTimes(2);
    expect(mockedRpc.mock.calls[0][1].p_points).toHaveLength(50);
    expect(mockedRpc.mock.calls[1][1].p_points).toHaveLength(20);
    expect(mockedRpc.mock.calls[0][1].p_points[0]).not.toHaveProperty('journeyId');
    expect(await getQueue()).toEqual([]);
    expect((await getLocationStatus()).lastUploadAt).not.toBeNull();
  });

  test('offline keeps points queued and never reports success', async () => {
    mockedRpc.mockRejectedValue(new AppError('NETWORK', 'offline', true));
    await enqueuePoints([pt(-2000), pt(-1000)]);
    expect(await flushQueue()).toBe('offline');
    expect(await getQueue()).toHaveLength(2);
    const status = await getLocationStatus();
    expect(status.lastUploadAt).toBeNull();
    expect(status.lastUploadError).toBe('offline');
  });

  test('server says journey expired: collection stops and queue is discarded', async () => {
    mockedRpc.mockResolvedValue({ journey_status: 'expired', accepted: 0, duplicates: 0, rejected: 1 });
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
    await enqueuePoints([pt(-1000)]);
    expect(await flushQueue()).toBe('ended');
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
    expect(await getQueue()).toEqual([]);
    expect((await getLocalJourney())?.status).toBe('expired');
  });

  test('local expiry stops without calling the server', async () => {
    await AsyncStorage.clear();
    await startLocationCollection(journey({ expires_at: iso(-1000), sharing_started_at: iso(-3600_000) }));
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
    expect(await flushQueue()).toBe('ended');
    expect(mockedRpc).not.toHaveBeenCalled();
    expect((await getLocalJourney())?.status).toBe('expired');
  });
});

describe('background task entry point', () => {
  test('task handler stops collection when there is no active journey', async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
    await handleLocationTask({ data: { locations: [] }, error: null, executionInfo: { eventId: 'e', taskName: 't' } });
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
  });

  test('task handler queues and uploads fixes for the active journey', async () => {
    await startLocationCollection(journey());
    mockedRpc.mockResolvedValue({ journey_status: 'active', accepted: 1, duplicates: 0, rejected: 0 });
    const fix = { timestamp: Date.now() - 1000, coords: { latitude: 51.5, longitude: -0.1, accuracy: 8 } } as unknown as Location.LocationObject;
    await handleLocationTask({ data: { locations: [fix] }, error: null, executionInfo: { eventId: 'e', taskName: 't' } });
    expect(mockedRpc).toHaveBeenCalledWith('record_locations', expect.objectContaining({ p_journey_id: 'j1' }));
    expect((await getLocationStatus()).lastUploadAt).not.toBeNull();
  });
});
