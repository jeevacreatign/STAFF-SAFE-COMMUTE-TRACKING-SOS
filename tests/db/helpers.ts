import { randomUUID } from 'crypto';
import { Client } from 'pg';

export type Fixture = {
  orgA: string;
  orgB: string;
  employeeA1: string;
  employeeA2: string;
  employeeB1: string;
  adminA: string;
  adminB: string;
  pendingUser: string;
};

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  return client;
}

/** Run queries as a Supabase API role with the given user's JWT claims, in one transaction. */
export async function as<T>(
  db: Client,
  userId: string | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>,
): Promise<T> {
  await db.query('begin');
  try {
    if (userId) {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, role: 'authenticated' }),
      ]);
      await db.query('set local role authenticated');
    } else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
      await db.query('set local role anon');
    }
    const result = await fn(async (sql, params) => (await db.query(sql, params as any[])).rows);
    await db.query('commit');
    return result;
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}

/** Expect a call to fail with a given SQLSTATE or app error code (message). */
export async function expectError(p: Promise<unknown>, codeOrMessage: string) {
  let err: any;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`Expected error ${codeOrMessage} but the call succeeded`);
  const matches = err.code === codeOrMessage || err.message === codeOrMessage || String(err.message).includes(codeOrMessage);
  if (!matches) throw new Error(`Expected ${codeOrMessage}, got ${err.code}: ${err.message}`);
}

async function createUser(db: Client, email: string, appMeta: object, fullName: string): Promise<string> {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
     values ($1, $2, $3, now()) returning id`,
    [email, JSON.stringify(appMeta), JSON.stringify({ full_name: fullName })],
  );
  return rows[0].id;
}

/** Synthetic organisations and users. All data is fake. */
export async function createFixture(db: Client): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8);
  const orgA = (await db.query(`insert into organisations (name) values ($1) returning id`, [`Test School A ${tag}`])).rows[0].id;
  const orgB = (await db.query(`insert into organisations (name) values ($1) returning id`, [`Test School B ${tag}`])).rows[0].id;
  const invite = (org: string, role = 'employee') => ({ invited: true, organisation_id: org, role });
  return {
    orgA,
    orgB,
    employeeA1: await createUser(db, `a1-${tag}@example.test`, invite(orgA), 'Synthetic Employee A1'),
    employeeA2: await createUser(db, `a2-${tag}@example.test`, invite(orgA), 'Synthetic Employee A2'),
    employeeB1: await createUser(db, `b1-${tag}@example.test`, invite(orgB), 'Synthetic Employee B1'),
    adminA: await createUser(db, `admin-a-${tag}@example.test`, invite(orgA, 'safety_admin'), 'Synthetic Admin A'),
    adminB: await createUser(db, `admin-b-${tag}@example.test`, invite(orgB, 'safety_admin'), 'Synthetic Admin B'),
    // Self-registered (not invited): must have no access. Tries to claim admin via user metadata.
    pendingUser: await createUser(db, `pending-${tag}@example.test`, { role: 'safety_admin', organisation_id: orgA }, 'Pending'),
  };
}

export const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export async function startJourney(db: Client, userId: string, overrides: Partial<Record<string, unknown>> = {}) {
  const args = {
    request: randomUUID(),
    label: 'Commute home',
    destination: 'Home',
    eta: inMinutes(30),
    expires: inMinutes(90),
    version: '2026-10-v1',
    consent: true,
    ...overrides,
  };
  const rows = await as(db, userId, (q) =>
    q('select * from start_journey($1, $2, $3, $4, $5, $6, $7)', [
      args.request, args.label, args.destination, args.eta, args.expires, args.version, args.consent,
    ]),
  );
  return rows[0];
}

export const point = (lat: number, lng: number, observedAt: Date | string, accuracy = 12) => ({
  latitude: lat,
  longitude: lng,
  accuracy_m: accuracy,
  observed_at: typeof observedAt === 'string' ? observedAt : observedAt.toISOString(),
});

/** Test-only time travel: move a journey's window into the past (bypasses triggers as superuser). */
export async function backdateJourney(db: Client, journeyId: string, expiredSecondsAgo = 5) {
  await db.query('begin');
  await db.query(`set local session_replication_role = replica`);
  await db.query(
    `update journeys set consented_at = now() - interval '2 hours', sharing_started_at = now() - interval '2 hours',
       estimated_arrival_at = null, expires_at = now() - make_interval(secs => $2) where id = $1`,
    [journeyId, expiredSecondsAgo],
  );
  await db.query('commit');
}

/** Test-only: pretend a still-active journey started `minutes` ago. */
export async function shiftJourneyStart(db: Client, journeyId: string, minutes: number) {
  await db.query('begin');
  await db.query(`set local session_replication_role = replica`);
  await db.query(
    `update journeys set consented_at = consented_at - make_interval(mins => $2),
       sharing_started_at = sharing_started_at - make_interval(mins => $2), estimated_arrival_at = null where id = $1`,
    [journeyId, minutes],
  );
  await db.query('commit');
}
