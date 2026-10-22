import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AppError } from '../../src/utils/errors';

jest.mock('../../src/services/supabase/rpc', () => ({ rpc: jest.fn(), unwrap: jest.fn() }));
jest.mock('../../src/services/supabase/client', () => ({
  supabase: { functions: { invoke: jest.fn(async () => ({ data: {}, error: null })) } },
}));

import { supabase } from '../../src/services/supabase/client';
import { rpc } from '../../src/services/supabase/rpc';
import { patchLocationStatus } from '../../src/services/location/state';
import { __resetSosCache, captureSosLocation, describeSosLocation, raiseSos, retrySos } from '../../src/services/sos/sosService';

const mockedRpc = rpc as jest.Mock;
const alert = (id = 'a1') => ({ id, alert_status: 'new', created_at: new Date().toISOString(), location_freshness: 'fresh', location_source: 'device' });

beforeEach(async () => {
  jest.useRealTimers();
  await AsyncStorage.clear();
  __resetSosCache();
  mockedRpc.mockReset();
  jest.clearAllMocks();
});

test('confirmed only after the server returns the alert; then asks for dispatch', async () => {
  mockedRpc.mockResolvedValueOnce(alert());
  const item = await raiseSos('j1');
  expect(item.state).toBe('confirmed');
  expect(item.serverAlert?.id).toBe('a1');
  expect(mockedRpc).toHaveBeenCalledWith('create_sos_alert', expect.objectContaining({ p_journey_id: 'j1', p_client_request_id: item.clientRequestId }));
  expect(supabase.functions.invoke).toHaveBeenCalledWith('dispatch-notifications', expect.anything());
});

test('offline: shows not delivered, retries with the SAME request id (no duplicates)', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  mockedRpc.mockRejectedValueOnce(new AppError('NETWORK', 'No connection', true));
  const item = await raiseSos('j1');
  expect(item.state).toBe('waiting_retry');
  expect(item.serverAlert).toBeNull();
  mockedRpc.mockResolvedValueOnce(alert());
  const retried = await retrySos(item.clientRequestId);
  expect(retried?.state).toBe('confirmed');
  const ids = mockedRpc.mock.calls.map((c) => c[1].p_client_request_id);
  expect(new Set(ids).size).toBe(1);
});

test('non-retryable refusal is reported as failed, never as delivered', async () => {
  mockedRpc.mockRejectedValueOnce(new AppError('JOURNEY_NOT_ACTIVE', 'ended'));
  const item = await raiseSos('j1');
  expect(item.state).toBe('failed');
});

test('no location available: alert is still sent without coordinates', async () => {
  mockedRpc.mockResolvedValueOnce(alert());
  const item = await raiseSos('j1');
  const args = mockedRpc.mock.calls[0][1];
  expect(args.p_latitude).toBeNull();
  expect(args.p_location_observed_at).toBeNull();
  expect(item.location).toBeNull();
  expect(describeSosLocation(null)).toMatch(/No location available/);
});

test('stale last fix is sent with its original timestamp and labelled', async () => {
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  await patchLocationStatus({ lastFix: { latitude: 1, longitude: 2 }, lastFixAt: old, lastFixAccuracyM: 30 });
  const loc = await captureSosLocation();
  expect(loc).toMatchObject({ latitude: 1, longitude: 2, observedAt: old, source: 'last_known' });
  expect(describeSosLocation(loc)).toMatch(/older location/);
});

test('uses a fresh fix when the stored one is old', async () => {
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  await patchLocationStatus({ lastFix: { latitude: 1, longitude: 2 }, lastFixAt: old, lastFixAccuracyM: 30 });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce({ timestamp: Date.now(), coords: { latitude: 3, longitude: 4, accuracy: 5 } });
  const loc = await captureSosLocation();
  expect(loc).toMatchObject({ latitude: 3, longitude: 4, source: 'fresh_fix' });
});
