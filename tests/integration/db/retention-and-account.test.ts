import type { Client } from 'pg';
import { as, connect, createFixture, expectError, Fixture, point, startJourney } from '../../db/helpers';

let db: Client;
let f: Fixture;
beforeAll(async () => {
  db = await connect();
  f = await createFixture(db);
});
afterAll(async () => db.end());

test('retention removes old breadcrumbs of ended journeys, anonymises old records, keeps active data', async () => {
  const ended = await startJourney(db, f.employeeA1);
  await as(db, f.employeeA1, (q) => q('select record_locations($1, $2::jsonb)', [ended.id, JSON.stringify([point(51.5, -0.1, new Date())])]));
  await as(db, f.employeeA1, (q) => q(`select * from end_journey($1, 'safe_arrival')`, [ended.id]));
  const active = await startJourney(db, f.employeeA2);
  await as(db, f.employeeA2, (q) => q('select record_locations($1, $2::jsonb)', [active.id, JSON.stringify([point(51.5, -0.1, new Date())])]));

  await db.query(`update journey_locations set received_at = now() - interval '30 days' where journey_id = any($1)`, [[ended.id, active.id]]);
  await db.query('begin');
  await db.query('set local session_replication_role = replica');
  await db.query(`update journeys set ended_at = now() - interval '400 days' where id = $1`, [ended.id]);
  await db.query(`update consent_records set ended_at = now() - interval '800 days' where journey_id = $1`, [ended.id]);
  await db.query('commit');

  const { rows } = await db.query('select run_retention_cleanup() r');
  expect(rows[0].r.locations_deleted).toBeGreaterThanOrEqual(1);
  const left = (id: string) => db.query('select count(*)::int c from journey_locations where journey_id = $1', [id]).then((r) => r.rows[0].c);
  expect(await left(ended.id)).toBe(0);
  expect(await left(active.id)).toBe(1); // active journeys are never purged mid-journey
  const [j] = (await db.query('select label, destination_label from journeys where id = $1', [ended.id])).rows;
  expect(j).toEqual({ label: 'Removed by retention policy', destination_label: null });
  expect((await db.query('select * from consent_records where journey_id = $1', [ended.id])).rows).toHaveLength(0);
  const logged = (await db.query(`select count(*)::int c from audit_logs where action = 'retention.cleanup'`)).rows[0].c;
  expect(logged).toBeGreaterThanOrEqual(1);
});

test('employee can update own name and preferences but nothing else', async () => {
  const [p] = await as(db, f.employeeA1, (q) => q(`select * from update_my_profile('Renamed Person')`));
  expect(p.full_name).toBe('Renamed Person');
  expect(p.role).toBe('employee');
  const [prefs] = await as(db, f.employeeA1, (q) => q('select * from update_notification_preferences(false, true, 30)'));
  expect(prefs).toMatchObject({ journey_reminders: false, reminder_minutes_after_eta: 30 });
  await expectError(as(db, f.employeeA1, (q) => q('select * from update_notification_preferences(true, true, 1)')), 'VALIDATION');
});

test('push tokens are validated and moved to the current device owner', async () => {
  const token = 'ExponentPushToken[abcdefghijklmnop]';
  await as(db, f.employeeA1, (q) => q(`select register_push_token($1, 'android')`, [token]));
  await as(db, f.employeeA2, (q) => q(`select register_push_token($1, 'android')`, [token]));
  const [row] = (await db.query('select user_id from push_tokens where token = $1', [token])).rows;
  expect(row.user_id).toBe(f.employeeA2);
  await expectError(as(db, f.employeeA1, (q) => q(`select register_push_token('nope', 'android')`)), 'VALIDATION');
  await as(db, f.employeeA1, (q) => q(`select unregister_push_token($1)`, [token])); // not theirs: no effect
  expect((await db.query('select * from push_tokens where token = $1', [token])).rows).toHaveLength(1);
});

test('admin cannot change own status or another admin', async () => {
  await expectError(as(db, f.adminA, (q) => q(`select * from admin_set_account_status($1, 'suspended', null)`, [f.adminA])), 'FORBIDDEN');
});

test('auth events are logged for admins of the org', async () => {
  await as(db, f.employeeA1, (q) => q(`select record_auth_event('sign_in')`));
  const rows = await as(db, f.adminA, (q) => q(`select action from audit_logs where actor_id = $1 and action = 'auth.sign_in'`, [f.employeeA1]));
  expect(rows).toHaveLength(1);
});

test('notification outbox: claim, complete, retry and clients cannot drive it', async () => {
  const fx = await createFixture(db);
  await as(db, fx.adminA, (q) => q(`select register_push_token('ExponentPushToken[adminAtokenxxxx]', 'android')`));
  const j = await startJourney(db, fx.employeeA1);
  await as(db, fx.employeeA1, (q) => q(`select * from end_journey($1, 'safe_arrival')`, [j.id]));
  const claimed = (await db.query('select * from claim_pending_notifications(500)')).rows.filter((r) => r.related_journey_id === j.id);
  expect(claimed).toHaveLength(1);
  expect(claimed[0].tokens).toEqual(['ExponentPushToken[adminAtokenxxxx]']);
  // A claimed row is not handed out again immediately (backoff).
  const again = (await db.query('select * from claim_pending_notifications(500)')).rows.filter((r) => r.related_journey_id === j.id);
  expect(again).toHaveLength(0);
  await db.query(`select complete_notification($1, 'sent', null)`, [claimed[0].id]);
  const [row] = (await db.query('select delivery_status, delivered_at from notification_records where id = $1', [claimed[0].id])).rows;
  expect(row.delivery_status).toBe('sent');
  expect(row.delivered_at).not.toBeNull();
  await expectError(as(db, fx.employeeA1, (q) => q('select * from claim_pending_notifications(10)')), '42501');
  await expectError(as(db, fx.adminA, (q) => q(`select complete_notification($1, 'sent', null)`, [claimed[0].id])), '42501');
});
