// Sends pending notification_records through the Expo Push Service.
// Callers: pg_cron every minute (x-cron-secret header) and the app right after an SOS is
// confirmed (any signed-in user's JWT; it only flushes the shared queue, it cannot choose
// recipients or content). Deploy with --no-verify-jwt because cron does not send a user JWT.
import { callerClient, serviceClient } from '../_shared/clients.ts';
import { corsHeaders, errorResponse, json, log, safeEqual } from '../_shared/http.ts';
import { buildMessages, chunk, type ExpoTicket, type OutboxRow, summarise } from '../_shared/push.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function authorised(req: Request): Promise<boolean> {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (cronSecret && provided && safeEqual(provided, cronSecret)) return true;
  if (!req.headers.get('Authorization')) return false;
  const { data, error } = await callerClient(req).auth.getUser();
  return !error && !!data.user;
}

async function sendBatch(messages: ReturnType<typeof buildMessages>): Promise<(ExpoTicket | undefined)[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
    if (!res.ok) {
      log('warn', 'expo_push_http_error', { status: res.status });
      return messages.map(() => undefined);
    }
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : messages.map(() => undefined);
  } catch (e) {
    log('warn', 'expo_push_network_error', { message: String(e).slice(0, 200) });
    return messages.map(() => undefined);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST.', 405);
  if (!(await authorised(req))) return errorResponse('UNAUTHORISED', 'Not authorised.', 401);

  const admin = serviceClient();
  const { data: rows, error } = await admin.rpc('claim_pending_notifications', { p_limit: 200 });
  if (error) {
    log('error', 'claim_failed', { code: error.code });
    return errorResponse('INTERNAL', 'Could not read the notification queue.', 500);
  }

  const outbox = (rows ?? []) as OutboxRow[];
  const plan = outbox.map((row) => ({ row, messages: buildMessages(row) }));
  const flat = plan.flatMap((p) => p.messages.map((m) => ({ id: p.row.id, m })));
  const tickets = new Map<string, (ExpoTicket | undefined)[]>();
  for (const batch of chunk(flat, 100)) {
    const result = await sendBatch(batch.map((b) => b.m));
    batch.forEach((b, i) => tickets.set(b.id, [...(tickets.get(b.id) ?? []), result[i]]));
  }

  const counts = { sent: 0, failed: 0, pending: 0, skipped: 0 };
  for (const { row, messages } of plan) {
    const outcome = messages.length === 0 && row.tokens.length > 0
      ? { status: 'failed' as const, error: 'unknown_event_type', deadTokens: [] }
      : summarise(row.tokens, tickets.get(row.id) ?? []);
    counts[outcome.status]++;
    for (const dead of outcome.deadTokens) await admin.rpc('remove_push_token', { p_token: dead });
    const { error: completeError } = await admin.rpc('complete_notification', {
      p_id: row.id,
      p_status: outcome.status,
      p_error: outcome.error,
    });
    if (completeError) log('error', 'complete_failed', { id: row.id, code: completeError.code });
  }

  log('info', 'dispatch_complete', { claimed: outbox.length, ...counts });
  return json({ claimed: outbox.length, ...counts });
});
