import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppError } from '../../src/utils/errors';

jest.mock('../../src/services/supabase/rpc', () => ({ rpc: jest.fn(), unwrap: jest.fn((r) => r.data) }));
const mockMaybeSingle = jest.fn();
jest.mock('../../src/services/supabase/client', () => {
  const builder: Record<string, unknown> = {};
  ['select', 'eq', 'order', 'range'].forEach((m) => (builder[m] = () => builder));
  builder.maybeSingle = () => mockMaybeSingle();
  return { supabase: { from: () => builder } };
});

import { rpc } from '../../src/services/supabase/rpc';
import { canTransition, endJourney, reconcile, startJourney } from '../../src/services/journeys/journeyService';
import { getLocalJourney } from '../../src/services/location/state';
import type { Journey } from '../../src/types/db';

const mockedRpc = rpc as jest.Mock;
const j = (over: Partial<Journey> = {}): Journey => ({
  id: 'j1', employee_id: 'u1', organisation_id: 'o1', client_request_id: 'r1', label: 'Home', destination_label: null,
  estimated_arrival_at: null, consented_at: new Date().toISOString(), consent_version: '2026-10-v1',
  sharing_started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(),
  ended_at: null, end_reason: null, safe_arrival_at: null, status: 'active', last_latitude: null, last_longitude: null,
  last_accuracy_m: null, last_observed_at: null, last_received_at: null, created_at: '', updated_at: '', ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockedRpc.mockReset();
  mockMaybeSingle.mockReset();
  jest.clearAllMocks();
});

test('state machine: finished journeys never go back to active', () => {
  expect(canTransition('active', 'stopped')).toBe(true);
  expect(canTransition('stopped', 'active')).toBe(false);
  expect(canTransition('expired', 'active')).toBe(false);
  expect(canTransition('safely_arrived', 'stopped')).toBe(false);
});

test('no journey or collection without consent', async () => {
  await expect(startJourney({ label: 'x', destination: undefined, expiryMinutes: 60 }, 'req', false)).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' });
  expect(mockedRpc).not.toHaveBeenCalled();
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

test('server record is created before any collection starts', async () => {
  const order: string[] = [];
  mockedRpc.mockImplementation(async (fn: string) => { order.push(fn); return j(); });
  (Location.startLocationUpdatesAsync as jest.Mock).mockImplementation(async () => { order.push('startLocationUpdates'); });
  await startJourney({ label: 'Home', destination: undefined, expiryMinutes: 60 }, 'req-1', true);
  expect(order).toEqual(['start_journey', 'startLocationUpdates']);
  expect(mockedRpc.mock.calls[0][1]).toMatchObject({ p_client_request_id: 'req-1', p_consent_given: true, p_consent_version: '2026-10-v1' });
});

test('if collection cannot start, the new journey is cancelled', async () => {
  mockedRpc.mockResolvedValueOnce(j()).mockResolvedValueOnce(j({ status: 'cancelled' }));
  (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValueOnce(false);
  await expect(startJourney({ label: 'Home', destination: undefined, expiryMinutes: 60 }, 'req-2', true)).rejects.toBeInstanceOf(AppError);
  expect(mockedRpc.mock.calls[1]).toEqual(['end_journey', { p_journey_id: 'j1', p_action: 'cancel' }]);
  expect(await getLocalJourney()).toBeNull();
});

test('stop while offline: stops locally, reports unconfirmed, and confirms on reconcile', async () => {
  mockedRpc.mockResolvedValueOnce(j());
  await startJourney({ label: 'Home', destination: undefined, expiryMinutes: 60 }, 'req-3', true);
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
  mockedRpc.mockRejectedValueOnce(new AppError('NETWORK', 'offline', true));
  expect(await endJourney('j1', 'stop')).toBeNull();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
  expect(await getLocalJourney()).toMatchObject({ status: 'stopped', pendingEnd: 'stop' });

  mockedRpc.mockResolvedValueOnce(j({ status: 'stopped', ended_at: new Date().toISOString(), end_reason: 'stopped_by_employee' }));
  const r = await reconcile('u1');
  expect(r).toMatchObject({ kind: 'ended', status: 'stopped' });
  expect(mockedRpc).toHaveBeenLastCalledWith('end_journey', { p_journey_id: 'j1', p_action: 'stop' });
  expect((await getLocalJourney())?.pendingEnd).toBeUndefined();
});

test('reconcile: server-ended journey stops local collection', async () => {
  mockedRpc.mockResolvedValueOnce(j());
  await startJourney({ label: 'Home', destination: undefined, expiryMinutes: 60 }, 'req-4', true);
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
  mockMaybeSingle
    .mockResolvedValueOnce({ data: null, error: null }) // no active journey on server
    .mockResolvedValueOnce({ data: j({ status: 'expired' }), error: null });
  const r = await reconcile('u1');
  expect(r).toMatchObject({ kind: 'ended', status: 'expired' });
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalled();
});

test('reconcile: server-active journey not collecting here is reported, not silently resumed', async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: j(), error: null });
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(false);
  const r = await reconcile('u1');
  expect(r).toMatchObject({ kind: 'active', collecting: false });
  expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
});
