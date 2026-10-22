import { assertEquals } from 'jsr:@std/assert@1';
import { buildMessages, chunk, summarise } from './push.ts';

const row = {
  id: 'n1',
  recipient_id: 'u1',
  event_type: 'sos_created',
  related_journey_id: 'j1',
  related_alert_id: 'a1',
  tokens: ['ExponentPushToken[a]', 'ExponentPushToken[b]'],
  attempts: 1,
};

Deno.test('builds one high-priority message per token without location data', () => {
  const msgs = buildMessages(row);
  assertEquals(msgs.length, 2);
  assertEquals(msgs[0].channelId, 'sos-alerts');
  assertEquals(msgs[0].priority, 'high');
  assertEquals(msgs[0].data, { type: 'sos_created', notificationId: 'n1', alertId: 'a1', journeyId: 'j1' });
  const text = JSON.stringify(msgs);
  assertEquals(/lat|lng|longitude|latitude/i.test(text), false);
});

Deno.test('unknown event types produce no messages', () => {
  assertEquals(buildMessages({ ...row, event_type: 'nope' }), []);
});

Deno.test('chunks', () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

Deno.test('summarise outcomes', () => {
  assertEquals(summarise([], []).status, 'skipped');
  assertEquals(summarise(['a', 'b'], [{ status: 'ok', id: '1' }, { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }]),
    { status: 'sent', error: null, deadTokens: ['b'] });
  assertEquals(summarise(['a'], [{ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }]).status, 'failed');
  assertEquals(summarise(['a'], [{ status: 'error', message: 'x', details: { error: 'MessageRateExceeded' } }]).status, 'pending');
  assertEquals(summarise(['a'], [undefined]).status, 'pending');
});
