import { randomUUID } from 'crypto';
import type { Client } from 'pg';
import { as, connect, createFixture, expectError, Fixture, point, startJourney } from '../db/helpers';

let db: Client;
let f: Fixture;
let journeyA1: any;
let journeyB1: any;

beforeAll(async () => {
  db = await connect();
  f = await createFixture(db);
  journeyA1 = await startJourney(db, f.employeeA1);
  journeyB1 = await startJourney(db, f.employeeB1);
  const now = new Date();
  await as(db, f.employeeA1, (q) => q('select record_locations($1, $2::jsonb)', [journeyA1.id, JSON.stringify([point(51.5, -0.12, now)])]));
  await as(db, f.employeeB1, (q) => q('select record_locations($1, $2::jsonb)', [journeyB1.id, JSON.stringify([point(52.2, 0.11, now)])]));
});
afterAll(async () => db.end());

describe('unauthenticated access', () => {
  const tables = ['profiles', 'journeys', 'journey_locations', 'sos_alerts', 'consent_records', 'audit_logs', 'notification_records', 'organisations', 'push_tokens'];
  test.each(tables)('anon cannot read %s', async (table) => {
    await expectError(as(db, null, (q) => q(`select * from ${table}`)), '42501');
  });

  test('anon cannot call journey or SOS functions', async () => {
    await expectError(as(db, null, (q) => q('select record_locations($1, $2::jsonb)', [journeyA1.id, '[]'])), '42501');
    await expectError(as(db, null, (q) => q('select * from create_sos_alert($1,$2,null,null,null,null,null)', [randomUUID(), journeyA1.id])), '42501');
  });
});

describe('employee isolation', () => {
  test('Employee A2 cannot read Employee A1 journey or location (same organisation)', async () => {
    const rows = await as(db, f.employeeA2, (q) => q('select * from journeys where id = $1', [journeyA1.id]));
    expect(rows).toHaveLength(0);
    const locs = await as(db, f.employeeA2, (q) => q('select * from journey_locations where journey_id = $1', [journeyA1.id]));
    expect(locs).toHaveLength(0);
  });

  test('employee sees only own profile', async () => {
    const rows = await as(db, f.employeeA1, (q) => q('select id from profiles'));
    expect(rows.map((r) => r.id)).toEqual([f.employeeA1]);
  });

  test('employee cannot read audit logs or SOS events', async () => {
    expect(await as(db, f.employeeA1, (q) => q('select * from audit_logs'))).toHaveLength(0);
    expect(await as(db, f.employeeA1, (q) => q('select * from sos_alert_events'))).toHaveLength(0);
  });

  test('employee cannot upload locations to another employee journey', async () => {
    await expectError(
      as(db, f.employeeA2, (q) => q('select record_locations($1, $2::jsonb)', [journeyA1.id, JSON.stringify([point(1, 1, new Date())])])),
      'NOT_FOUND',
    );
  });

  test('employee cannot stop another employee journey', async () => {
    await expectError(as(db, f.employeeA2, (q) => q(`select * from end_journey($1, 'stop')`, [journeyA1.id])), 'NOT_FOUND');
  });

  test('employee cannot raise SOS on another employee journey', async () => {
    await expectError(
      as(db, f.employeeA2, (q) => q('select * from create_sos_alert($1,$2,null,null,null,null,null)', [randomUUID(), journeyA1.id])),
      'NOT_FOUND',
    );
  });
});

describe('no direct writes', () => {
  test('employee cannot grant themselves admin (direct update)', async () => {
    await expectError(as(db, f.employeeA1, (q) => q(`update profiles set role = 'safety_admin' where id = $1`, [f.employeeA1])), '42501');
  });

  test('employee cannot insert admin assignment', async () => {
    await expectError(
      as(db, f.employeeA1, (q) => q('insert into admin_assignments (admin_id, organisation_id) values ($1, $2)', [f.employeeA1, f.orgA])),
      '42501',
    );
  });

  test('employee cannot insert a journey directly (bypassing consent)', async () => {
    await expectError(
      as(db, f.employeeA2, (q) =>
        q(`insert into journeys (employee_id, organisation_id, client_request_id, label, consented_at, consent_version, sharing_started_at, expires_at)
           values ($1, $2, gen_random_uuid(), 'x', now(), '2026-10-v1', now(), now() + interval '1 hour')`, [f.employeeA2, f.orgA]),
      ),
      '42501',
    );
  });

  test('nobody can insert locations directly', async () => {
    await expectError(
      as(db, f.employeeA1, (q) =>
        q(`insert into journey_locations (journey_id, employee_id, organisation_id, latitude, longitude, observed_at) values ($1,$2,$3,1,1,now())`,
          [journeyA1.id, f.employeeA1, f.orgA]),
      ),
      '42501',
    );
  });

  test('admin cannot update journeys or audit logs directly', async () => {
    await expectError(as(db, f.adminA, (q) => q(`update journeys set status = 'stopped' where id = $1`, [journeyA1.id])), '42501');
    await expectError(as(db, f.adminA, (q) => q(`delete from audit_logs`)), '42501');
    await expectError(as(db, f.adminA, (q) => q(`update audit_logs set action = 'x'`)), '42501');
  });

  test('audit logs are immutable even for the table owner outside the retention job', async () => {
    await expectError(db.query(`update audit_logs set action = 'tampered' where id = (select min(id) from audit_logs)`), 'FORBIDDEN');
    await expectError(db.query(`delete from audit_logs where id = (select min(id) from audit_logs)`), 'FORBIDDEN');
  });

  test('protected profile columns cannot change even if an update grant is added by mistake', async () => {
    await db.query('grant update on profiles to authenticated');
    await db.query(`create policy tmp_self_update on profiles for update to authenticated using (id = auth.uid())`);
    try {
      await expectError(as(db, f.employeeA1, (q) => q(`update profiles set role = 'safety_admin' where id = $1`, [f.employeeA1])), 'FORBIDDEN');
    } finally {
      await db.query('drop policy tmp_self_update on profiles');
      await db.query('revoke update on profiles from authenticated');
    }
  });

  test('internal helper functions are not callable by clients', async () => {
    await expectError(as(db, f.employeeA1, (q) => q(`select write_audit($1, $2, 'fake', 'x', null, '{}')`, [f.employeeA1, f.orgA])), '42501');
    await expectError(as(db, f.employeeA1, (q) => q('select expire_journeys()')), '42501');
    await expectError(as(db, f.employeeA1, (q) => q('select run_retention_cleanup()')), '42501');
    await expectError(as(db, f.employeeA1, (q) => q(`select enqueue_admin_notifications($1, 'sos_created', null, null)`, [f.orgA])), '42501');
  });
});

describe('admin scope', () => {
  test('admin A sees org A active journeys with live position and not org B', async () => {
    const rows = await as(db, f.adminA, (q) => q('select id, last_latitude from journeys'));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(journeyA1.id);
    expect(ids).not.toContain(journeyB1.id);
    expect(rows.find((r) => r.id === journeyA1.id).last_latitude).toBeCloseTo(51.5);
  });

  test('admin A cannot read org B locations, profiles or detail', async () => {
    expect(await as(db, f.adminA, (q) => q('select * from journey_locations where journey_id = $1', [journeyB1.id]))).toHaveLength(0);
    expect(await as(db, f.adminA, (q) => q('select * from profiles where id = $1', [f.employeeB1]))).toHaveLength(0);
    await expectError(as(db, f.adminA, (q) => q('select admin_get_journey_detail($1)', [journeyB1.id])), 'NOT_FOUND');
  });

  test('admin A cannot suspend an org B employee', async () => {
    await expectError(as(db, f.adminA, (q) => q(`select * from admin_set_account_status($1, 'suspended', 'x')`, [f.employeeB1])), 'NOT_FOUND');
  });

  test('employee cannot use admin functions', async () => {
    await expectError(as(db, f.employeeA1, (q) => q('select admin_dashboard_summary()')), 'FORBIDDEN');
    await expectError(as(db, f.employeeA1, (q) => q('select admin_get_journey_detail($1)', [journeyA1.id])), 'NOT_FOUND');
    await expectError(as(db, f.employeeA2, (q) => q(`select * from admin_set_account_status($1, 'suspended', 'x')`, [f.employeeA1])), 'NOT_FOUND');
  });

  test('admin cannot start a journey (no way to start tracking on behalf of staff)', async () => {
    await expectError(startJourney(db, f.adminA), 'FORBIDDEN');
  });

  test('admin cannot see breadcrumbs once the journey has ended', async () => {
    const j = await startJourney(db, f.employeeA2);
    await as(db, f.employeeA2, (q) => q('select record_locations($1, $2::jsonb)', [j.id, JSON.stringify([point(51.6, -0.1, new Date())])]));
    expect(await as(db, f.adminA, (q) => q('select * from journey_locations where journey_id = $1', [j.id]))).toHaveLength(1);
    await as(db, f.employeeA2, (q) => q(`select * from end_journey($1, 'stop')`, [j.id]));
    expect(await as(db, f.adminA, (q) => q('select * from journey_locations where journey_id = $1', [j.id]))).toHaveLength(0);
    const [row] = await as(db, f.adminA, (q) => q('select status, last_latitude from journeys where id = $1', [j.id]));
    expect(row.status).toBe('stopped');
    expect(row.last_latitude).toBeNull();
  });
});

describe('self-registration and role metadata', () => {
  test('a non-invited user gets pending_review, no org, employee role, and no access', async () => {
    const [p] = await db.query('select role, account_status, organisation_id from profiles where id = $1', [f.pendingUser]).then((r) => r.rows);
    expect(p).toEqual({ role: 'employee', account_status: 'pending_review', organisation_id: null });
    await expectError(startJourney(db, f.pendingUser), 'ACCOUNT_INACTIVE');
    expect(await as(db, f.pendingUser, (q) => q('select * from journeys'))).toHaveLength(0);
  });

  test('role in user-editable metadata is ignored', async () => {
    const { rows } = await db.query(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning id`,
      [`meta-${randomUUID()}@example.test`, JSON.stringify({ role: 'safety_admin', invited: true, organisation_id: f.orgA }), '{}'],
    );
    const [p] = (await db.query('select role, account_status from profiles where id = $1', [rows[0].id])).rows;
    expect(p).toEqual({ role: 'employee', account_status: 'pending_review' });
  });
});

describe('invitation via later app_metadata update', () => {
  test('an invitation written after user creation activates a pending profile once, and only once', async () => {
    const { rows } = await db.query(`insert into auth.users (email) values ($1) returning id`, [`late-${randomUUID()}@example.test`]);
    const id = rows[0].id;
    await db.query(`update auth.users set raw_app_meta_data = $2 where id = $1`, [id, JSON.stringify({ invited: true, role: 'employee', organisation_id: f.orgA })]);
    let [p] = (await db.query('select role, account_status, organisation_id from profiles where id = $1', [id])).rows;
    expect(p).toEqual({ role: 'employee', account_status: 'active', organisation_id: f.orgA });
    // A second invitation cannot move an already-activated account to another org or role.
    await db.query(`update auth.users set raw_app_meta_data = $2 where id = $1`, [id, JSON.stringify({ invited: true, role: 'safety_admin', organisation_id: f.orgB })]);
    [p] = (await db.query('select role, organisation_id from profiles where id = $1', [id])).rows;
    expect(p).toEqual({ role: 'employee', organisation_id: f.orgA });
  });
});

describe('suspended accounts', () => {
  test('suspension ends live sharing and blocks further access', async () => {
    const fx = await createFixture(db);
    const j = await startJourney(db, fx.employeeA1);
    await as(db, fx.adminA, (q) => q(`select * from admin_set_account_status($1, 'suspended', 'test')`, [fx.employeeA1]));
    const [row] = (await db.query('select status, end_reason from journeys where id = $1', [j.id])).rows;
    expect(row).toEqual({ status: 'stopped', end_reason: 'account_suspended' });
    await expectError(
      as(db, fx.employeeA1, (q) => q('select record_locations($1, $2::jsonb)', [j.id, JSON.stringify([point(1, 1, new Date())])])),
      'ACCOUNT_INACTIVE',
    );
    expect(await as(db, fx.employeeA1, (q) => q('select * from journeys'))).toHaveLength(0);
  });
});

describe('realtime exposure', () => {
  test('only journeys and sos_alerts are in the realtime publication (no raw breadcrumbs)', async () => {
    const { rows } = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
    expect(rows.map((r) => r.tablename)).toEqual(['journeys', 'sos_alerts']);
  });

  test('every public table has RLS enabled', async () => {
    const { rows } = await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  test('anon has no table privileges and authenticated has no write privileges', async () => {
    const { rows } = await db.query(`select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type <> 'SELECT'))`);
    expect(rows).toEqual([]);
  });

  test('no SECURITY DEFINER function is executable by anon', async () => {
    const { rows } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  test('authenticated can execute exactly the RPC allowlist', async () => {
    const { rows } = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([
      'admin_dashboard_summary', 'admin_get_journey_detail', 'admin_get_sos_detail', 'admin_set_account_status',
      'create_sos_alert', 'end_journey', 'is_active_self', 'is_admin_for', 'location_freshness_for',
      'record_auth_event', 'record_locations', 'register_push_token', 'start_journey', 'unregister_push_token',
      'update_my_profile', 'update_notification_preferences', 'update_sos_status',
    ]);
  });
});
