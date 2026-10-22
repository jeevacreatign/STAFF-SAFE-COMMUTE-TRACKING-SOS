import { randomUUID } from 'crypto';
import type { Client } from 'pg';
import { as, backdateJourney, connect, createFixture, expectError, Fixture, inMinutes, point, startJourney } from '../../db/helpers';

let db: Client;
let f: Fixture;
beforeAll(async () => {
  db = await connect();
});
beforeEach(async () => {
  f = await createFixture(db);
});
afterAll(async () => db.end());

const upload = (userId: string, journeyId: string, points: object[]) =>
  as(db, userId, (q) => q('select record_locations($1, $2::jsonb) as r', [journeyId, JSON.stringify(points)])).then((r) => r[0].r);

describe('journey creation and consent', () => {
  test('creates an active journey with a consent record and audit entries', async () => {
    const j = await startJourney(db, f.employeeA1);
    expect(j.status).toBe('active');
    expect(j.consent_version).toBe('2026-10-v1');
    const consent = (await db.query('select * from consent_records where journey_id = $1', [j.id])).rows;
    expect(consent).toHaveLength(1);
    expect(consent[0].employee_id).toBe(f.employeeA1);
    const actions = (await db.query('select action from audit_logs where resource_id = $1 order by id', [j.id])).rows.map((r) => r.action);
    expect(actions).toEqual(['journey.created', 'consent.granted', 'location_sharing.started']);
  });

  test('refuses without explicit consent', async () => {
    await expectError(startJourney(db, f.employeeA1, { consent: false }), 'CONSENT_REQUIRED');
    await expectError(startJourney(db, f.employeeA1, { consent: null }), 'CONSENT_REQUIRED');
    expect((await db.query('select * from journeys where employee_id = $1', [f.employeeA1])).rows).toHaveLength(0);
  });

  test('refuses an outdated consent version', async () => {
    await expectError(startJourney(db, f.employeeA1, { version: '2020-old' }), 'CONSENT_OUTDATED');
  });

  test('validates expiry and ETA windows', async () => {
    await expectError(startJourney(db, f.employeeA1, { expires: inMinutes(2) }), 'VALIDATION');
    await expectError(startJourney(db, f.employeeA1, { expires: inMinutes(13 * 60) }), 'VALIDATION');
    await expectError(startJourney(db, f.employeeA1, { eta: inMinutes(-5) }), 'VALIDATION');
    await expectError(startJourney(db, f.employeeA1, { eta: inMinutes(120), expires: inMinutes(60) }), 'VALIDATION');
    await expectError(startJourney(db, f.employeeA1, { label: '   ' }), 'VALIDATION');
  });

  test('is idempotent per request id and allows only one active journey', async () => {
    const request = randomUUID();
    const a = await startJourney(db, f.employeeA1, { request });
    const b = await startJourney(db, f.employeeA1, { request });
    expect(b.id).toBe(a.id);
    await expectError(startJourney(db, f.employeeA1), 'JOURNEY_ALREADY_ACTIVE');
  });

  test('an expired journey does not block a new one, and does not resume', async () => {
    const old = await startJourney(db, f.employeeA1);
    await backdateJourney(db, old.id);
    const fresh = await startJourney(db, f.employeeA1);
    expect(fresh.id).not.toBe(old.id);
    const [o] = (await db.query('select status from journeys where id = $1', [old.id])).rows;
    expect(o.status).toBe('expired');
  });
});

describe('location uploads', () => {
  test('stores points, updates latest snapshot, dedupes, and ignores out-of-order for latest', async () => {
    const j = await startJourney(db, f.employeeA1);
    const t0 = new Date(Date.now() - 20_000);
    const t1 = new Date(Date.now() - 10_000);
    let r = await upload(f.employeeA1, j.id, [point(51.5, -0.1, t1)]);
    expect(r).toMatchObject({ journey_status: 'active', accepted: 1, duplicates: 0, rejected: 0 });

    // Older point arrives late: stored, but latest stays t1.
    r = await upload(f.employeeA1, j.id, [point(51.4, -0.2, t0), point(51.5, -0.1, t1)]);
    expect(r).toMatchObject({ accepted: 1, duplicates: 1 });
    const [row] = (await db.query('select last_latitude, last_observed_at from journeys where id = $1', [j.id])).rows;
    expect(row.last_latitude).toBeCloseTo(51.5);
    expect(new Date(row.last_observed_at).getTime()).toBe(t1.getTime());
    const count = (await db.query('select count(*)::int c from journey_locations where journey_id = $1', [j.id])).rows[0].c;
    expect(count).toBe(2);
  });

  test('rejects invalid, pre-consent and future points without fabricating anything', async () => {
    const j = await startJourney(db, f.employeeA1);
    const r = await upload(f.employeeA1, j.id, [
      point(91, 0, new Date()),
      point(0, 181, new Date()),
      point(1, 1, new Date(Date.now() - 3600_000)), // before consent
      point(1, 1, new Date(Date.now() + 3600_000)), // future
      { latitude: 'abc', longitude: 1, observed_at: 'not-a-date' },
      { latitude: 1, longitude: 1 },
    ]);
    expect(r).toMatchObject({ accepted: 0, rejected: 6 });
    const [row] = (await db.query('select last_latitude from journeys where id = $1', [j.id])).rows;
    expect(row.last_latitude).toBeNull();
  });

  test('caps batch size', async () => {
    const j = await startJourney(db, f.employeeA1);
    const pts = Array.from({ length: 101 }, (_, i) => point(1, 1, new Date(Date.now() - i * 1000)));
    await expectError(upload(f.employeeA1, j.id, pts), 'VALIDATION');
  });

  test.each([
    ['stop', 'stopped'],
    ['safe_arrival', 'safely_arrived'],
  ])('a journey ended with %s rejects further uploads', async (action, status) => {
    const j = await startJourney(db, f.employeeA1);
    await as(db, f.employeeA1, (q) => q('select * from end_journey($1, $2)', [j.id, action]));
    const r = await upload(f.employeeA1, j.id, [point(51.5, -0.1, new Date())]);
    expect(r).toMatchObject({ journey_status: status, accepted: 0, rejected: 1 });
  });

  test('an expired journey rejects uploads even before the scheduled job runs (offline phone)', async () => {
    const j = await startJourney(db, f.employeeA1);
    await backdateJourney(db, j.id);
    const r = await upload(f.employeeA1, j.id, [point(51.5, -0.1, new Date(Date.now() - 60_000))]);
    expect(r).toMatchObject({ journey_status: 'expired', accepted: 0 });
    const [row] = (await db.query('select status, end_reason, ended_at from journeys where id = $1', [j.id])).rows;
    expect(row.status).toBe('expired');
    expect(row.end_reason).toBe('expired');
    expect(row.ended_at).not.toBeNull();
  });
});

describe('ending journeys', () => {
  test('safe arrival records timestamp, ends consent, clears live position and notifies admins', async () => {
    const j = await startJourney(db, f.employeeA1);
    await upload(f.employeeA1, j.id, [point(51.5, -0.1, new Date())]);
    const [ended] = await as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'safe_arrival')`, [j.id]));
    expect(ended.status).toBe('safely_arrived');
    expect(ended.safe_arrival_at).not.toBeNull();
    expect(ended.last_latitude).toBeNull();
    const [c] = (await db.query('select ended_at from consent_records where journey_id = $1', [j.id])).rows;
    expect(c.ended_at).not.toBeNull();
    const notes = (await db.query(`select recipient_id, event_type from notification_records where related_journey_id = $1`, [j.id])).rows;
    expect(notes).toEqual([{ recipient_id: f.adminA, event_type: 'journey_safely_arrived' }]);
  });

  test('ending is idempotent, and a finished journey can never be reactivated', async () => {
    const j = await startJourney(db, f.employeeA1);
    await as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'stop')`, [j.id]));
    const [again] = await as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'stop')`, [j.id]));
    expect(again.status).toBe('stopped');
    // A different action on a finished journey reports the real state rather than changing it.
    const [other] = await as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'safe_arrival')`, [j.id]));
    expect(other.status).toBe('stopped');
    // Even the table owner cannot move it back to active.
    await expectError(db.query(`update journeys set status = 'active', ended_at = null, end_reason = null where id = $1`, [j.id]), 'INVALID_TRANSITION');
  });

  test('cancel is only allowed before any location was shared', async () => {
    const j = await startJourney(db, f.employeeA1);
    await upload(f.employeeA1, j.id, [point(51.5, -0.1, new Date())]);
    await expectError(as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'cancel')`, [j.id])), 'INVALID_TRANSITION');
    const j2 = await startJourney(db, f.employeeA2);
    const [c] = await as(db, f.employeeA2, (q) => q(`select * from end_journey($1, 'cancel')`, [j2.id]));
    expect(c.status).toBe('cancelled');
  });

  test('expire_journeys() expires overdue journeys and notifies employee and admins', async () => {
    const j = await startJourney(db, f.employeeA1);
    const live = await startJourney(db, f.employeeA2);
    await backdateJourney(db, j.id);
    const { rows } = await db.query('select expire_journeys() as n');
    expect(rows[0].n).toBeGreaterThanOrEqual(1);
    const st = (id: string) => db.query('select status from journeys where id = $1', [id]).then((r) => r.rows[0].status);
    expect(await st(j.id)).toBe('expired');
    expect(await st(live.id)).toBe('active');
    const notes = (await db.query(`select recipient_id from notification_records where related_journey_id = $1 and event_type = 'journey_expired' order by recipient_id`, [j.id])).rows.map((r) => r.recipient_id);
    expect(notes.sort()).toEqual([f.adminA, f.employeeA1].sort());
  });
});

describe('reminders', () => {
  test('queues one reminder after ETA plus the employee offset, respecting preferences', async () => {
    const j = await startJourney(db, f.employeeA1);
    const j2 = await startJourney(db, f.employeeA2);
    await db.query(`update journeys set estimated_arrival_at = consented_at + interval '1 second' where id = any($1)`, [[j.id, j2.id]]);
    await db.query(`update notification_preferences set reminder_minutes_after_eta = 5, journey_reminders = true where user_id = $1`, [f.employeeA1]);
    await db.query(`update notification_preferences set journey_reminders = false where user_id = $1`, [f.employeeA2]);
    // Move "now" past ETA + 5 min by backdating the window (keeping the journey active).
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    await db.query(`update journeys set consented_at = now() - interval '20 minutes', sharing_started_at = now() - interval '20 minutes',
      estimated_arrival_at = now() - interval '10 minutes' where id = any($1)`, [[j.id, j2.id]]);
    await db.query('commit');
    await db.query('select queue_journey_reminders()');
    await db.query('select queue_journey_reminders()');
    const rows = (await db.query(`select recipient_id from notification_records where event_type = 'journey_reminder' and related_journey_id = any($1)`, [[j.id, j2.id]])).rows;
    expect(rows).toEqual([{ recipient_id: f.employeeA1 }]);
  });
});
