import { randomUUID } from 'crypto';
import type { Client } from 'pg';
import { as, backdateJourney, shiftJourneyStart, connect, createFixture, expectError, Fixture, point, startJourney } from '../../db/helpers';

let db: Client;
let f: Fixture;
beforeAll(async () => {
  db = await connect();
});
beforeEach(async () => {
  f = await createFixture(db);
});
afterAll(async () => db.end());

const sos = (userId: string, journeyId: string, request = randomUUID(), loc: [number, number, number, string] | null = null) =>
  as(db, userId, (q) =>
    q('select * from create_sos_alert($1, $2, $3, $4, $5, $6, $7)', [
      request, journeyId, loc?.[0] ?? null, loc?.[1] ?? null, loc?.[2] ?? null, loc?.[3] ?? null, new Date().toISOString(),
    ]),
  ).then((r) => r[0]);
const setStatus = (userId: string, alertId: string, status: string, note: string | null = null) =>
  as(db, userId, (q) => q('select * from update_sos_status($1, $2, $3)', [alertId, status, note])).then((r) => r[0]);

test('SOS with a fresh device location is created, audited and queued for org admins only', async () => {
  const j = await startJourney(db, f.employeeA1);
  const a = await sos(f.employeeA1, j.id, randomUUID(), [51.5, -0.12, 8, new Date().toISOString()]);
  expect(a).toMatchObject({ alert_status: 'new', location_freshness: 'fresh', location_source: 'device', employee_id: f.employeeA1 });
  const notes = (await db.query('select recipient_id, event_type from notification_records where related_alert_id = $1', [a.id])).rows;
  expect(notes).toEqual([{ recipient_id: f.adminA, event_type: 'sos_created' }]);
  const audit = (await db.query(`select metadata from audit_logs where resource_id = $1 and action = 'sos.created'`, [a.id])).rows[0];
  expect(JSON.stringify(audit.metadata)).not.toMatch(/51\.5|-0\.12/); // coordinates never in audit
});

test('SOS with a stale device location is labelled stale', async () => {
  const j = await startJourney(db, f.employeeA1);
  const old = new Date(Date.now() - 30 * 60_000).toISOString();
  const a = await sos(f.employeeA1, j.id, randomUUID(), [51.5, -0.12, 30, old]);
  expect(a.location_freshness).toBe('stale');
  expect(new Date(a.location_observed_at).toISOString()).toBe(old);
});

test('SOS without a device location falls back to the server last-known position, labelled', async () => {
  const j = await startJourney(db, f.employeeA1);
  await shiftJourneyStart(db, j.id, 20);
  const obs = new Date(Date.now() - 5 * 60_000);
  await as(db, f.employeeA1, (q) => q('select record_locations($1, $2::jsonb)', [j.id, JSON.stringify([point(51.6, -0.2, obs)])]));
  const a = await sos(f.employeeA1, j.id);
  expect(a).toMatchObject({ location_source: 'server_last_known', location_freshness: 'delayed' });
  expect(a.latitude).toBeCloseTo(51.6);
});

test('SOS with no location at all is still created, with none freshness and no coordinates', async () => {
  const j = await startJourney(db, f.employeeA1);
  const a = await sos(f.employeeA1, j.id);
  expect(a).toMatchObject({ latitude: null, longitude: null, location_freshness: 'none', location_source: null });
});

test('repeated submission with the same request id never duplicates', async () => {
  const j = await startJourney(db, f.employeeA1);
  const req = randomUUID();
  const a = await sos(f.employeeA1, j.id, req);
  const b = await sos(f.employeeA1, j.id, req);
  expect(b.id).toBe(a.id);
  const n = (await db.query('select count(*)::int c from sos_alerts where employee_id = $1', [f.employeeA1])).rows[0].c;
  expect(n).toBe(1);
});

test('SOS remains available shortly after the journey ends but not long after', async () => {
  const j = await startJourney(db, f.employeeA1);
  await as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'stop')`, [j.id]));
  const a = await sos(f.employeeA1, j.id);
  expect(a.alert_status).toBe('new');

  const j2 = await startJourney(db, f.employeeA2);
  await backdateJourney(db, j2.id, 3600);
  await db.query('select expire_journeys()');
  await db.query(`update journeys set ended_at = now() - interval '1 hour' where id = $1`, [j2.id]);
  await expectError(sos(f.employeeA2, j2.id), 'JOURNEY_NOT_ACTIVE');
});

test('rate limits distinct alerts', async () => {
  const j = await startJourney(db, f.employeeA1);
  for (let i = 0; i < 10; i++) await sos(f.employeeA1, j.id);
  await expectError(sos(f.employeeA1, j.id), 'RATE_LIMITED');
});

describe('admin response workflow', () => {
  test('acknowledge -> responding -> resolved -> closed with history, audit and employee notification', async () => {
    const j = await startJourney(db, f.employeeA1);
    const a = await sos(f.employeeA1, j.id);
    const ack = await setStatus(f.adminA, a.id, 'acknowledged', 'Calling staff member');
    expect(ack.acknowledged_by).toBe(f.adminA);
    expect(ack.acknowledged_at).not.toBeNull();
    await setStatus(f.adminA, a.id, 'responding');
    await setStatus(f.adminA, a.id, 'responding', 'Colleague en route'); // note only
    await setStatus(f.adminA, a.id, 'resolved', 'Staff member safe');
    const closed = await setStatus(f.adminA, a.id, 'closed');
    expect(closed.closed_by).toBe(f.adminA);
    expect(closed.response_notes).toMatch(/Calling staff member[\s\S]*Colleague en route[\s\S]*Staff member safe/);
    const events = (await db.query('select from_status, to_status from sos_alert_events where alert_id = $1 order by id', [a.id])).rows;
    expect(events.map((e) => `${e.from_status ?? '-'}>${e.to_status}`)).toEqual([
      '->new', 'new>acknowledged', 'acknowledged>responding', 'responding>responding', 'responding>resolved', 'resolved>closed',
    ]);
    const empNotes = (await db.query(`select count(*)::int c from notification_records where related_alert_id = $1 and recipient_id = $2`, [a.id, f.employeeA1])).rows[0].c;
    expect(empNotes).toBe(4); // one per real transition
  });

  test('invalid transitions are rejected', async () => {
    const j = await startJourney(db, f.employeeA1);
    const a = await sos(f.employeeA1, j.id);
    await expectError(setStatus(f.adminA, a.id, 'resolved'), 'INVALID_TRANSITION');
    await expectError(setStatus(f.adminA, a.id, 'closed'), 'INVALID_TRANSITION');
    await setStatus(f.adminA, a.id, 'acknowledged');
    await expectError(setStatus(f.adminA, a.id, 'new'), 'INVALID_TRANSITION');
  });

  test('unauthorised users cannot acknowledge an alert', async () => {
    const j = await startJourney(db, f.employeeA1);
    const a = await sos(f.employeeA1, j.id);
    await expectError(setStatus(f.employeeA1, a.id, 'acknowledged'), 'NOT_FOUND'); // the employee themself
    await expectError(setStatus(f.employeeA2, a.id, 'acknowledged'), 'NOT_FOUND'); // a colleague
    await expectError(setStatus(f.adminB, a.id, 'acknowledged'), 'NOT_FOUND'); // admin of another org
    await expectError(as(db, null, (q) => q(`select * from update_sos_status($1, 'acknowledged', null)`, [a.id])), '42501');
    const [row] = (await db.query('select alert_status from sos_alerts where id = $1', [a.id])).rows;
    expect(row.alert_status).toBe('new');
  });

  test('admin of another org cannot see the alert', async () => {
    const j = await startJourney(db, f.employeeA1);
    const a = await sos(f.employeeA1, j.id);
    expect(await as(db, f.adminB, (q) => q('select * from sos_alerts where id = $1', [a.id]))).toHaveLength(0);
    await expectError(as(db, f.adminB, (q) => q('select admin_get_sos_detail($1)', [a.id])), 'NOT_FOUND');
  });

  test('detail access is logged', async () => {
    const j = await startJourney(db, f.employeeA1);
    const a = await sos(f.employeeA1, j.id);
    const [{ d }] = await as(db, f.adminA, (q) => q('select admin_get_sos_detail($1) d', [a.id]));
    expect(d.employee.full_name).toBe('Synthetic Employee A1');
    const logged = (await db.query(`select count(*)::int c from audit_logs where action = 'admin.viewed_sos' and resource_id = $1 and actor_id = $2`, [a.id, f.adminA])).rows[0].c;
    expect(logged).toBe(1);
  });

  test('dashboard summary counts real rows in scope', async () => {
    const j = await startJourney(db, f.employeeA1);
    await sos(f.employeeA1, j.id);
    const j2 = await startJourney(db, f.employeeA2);
    await as(db, f.employeeA2, (q) => q(`select * from end_journey($1, 'safe_arrival')`, [j2.id]));
    await startJourney(db, f.employeeB1);
    const [{ s }] = await as(db, f.adminA, (q) => q('select admin_dashboard_summary() s'));
    expect(s).toMatchObject({ active_journeys: 1, safely_completed_today: 1, open_sos: 1, new_sos: 1 });
  });
});
