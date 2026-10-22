#!/usr/bin/env node
// Platform-operator CLI. Runs on a trusted machine with the service-role key in the environment;
// never ship this key in the app. Commands:
//   create-org   --name "School name"
//   create-admin --org <organisation uuid> --email a@b --name "Full Name"
//   seed-dev     (synthetic organisation, admin and two staff; refuses non-local URLs unless --allow-remote-dev)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function usage(code = 0) {
  console.log(`Usage:
  node scripts/operator.mjs create-org --name "School name"
  node scripts/operator.mjs create-admin --org <organisation-uuid> --email admin@school.example --name "Full Name"
  node scripts/operator.mjs seed-dev [--allow-remote-dev]
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(code);
}
if (!cmd || cmd === '--help' || cmd === '-h') usage(0);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function createOrg(name) {
  const { data, error } = await admin.from('organisations').insert({ name }).select('id, name').single();
  if (error) throw error;
  await admin.from('retention_settings').insert({ organisation_id: data.id });
  return data;
}

/** Creates the user with app_metadata (not user-editable); the DB trigger builds the profile. */
async function createUser({ org, email, name, role, password }) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: Boolean(password),
    user_metadata: { full_name: name },
    app_metadata: { invited: true, organisation_id: org, role },
  });
  if (error) throw error;
  if (!password) {
    const { error: linkError } = await admin.auth.resetPasswordForEmail(email);
    if (linkError) console.warn('Password-setup email could not be sent:', linkError.message);
  }
  const { data: profile } = await admin.from('profiles').select('role, account_status').eq('id', data.user.id).single();
  return { id: data.user.id, ...profile };
}

try {
  if (cmd === 'create-org') {
    const name = opt('name');
    if (!name) usage(1);
    console.log(await createOrg(name));
  } else if (cmd === 'create-admin') {
    const org = opt('org');
    const email = opt('email');
    const name = opt('name');
    if (!org || !email || !name) usage(1);
    const u = await createUser({ org, email, name, role: 'safety_admin' });
    console.log('Administrator created; a password-setup email was sent.', u);
  } else if (cmd === 'seed-dev') {
    const local = /localhost|127\.0\.0\.1/.test(url);
    if (!local && !args.includes('--allow-remote-dev')) {
      console.error('Refusing to seed synthetic data into a non-local project. Pass --allow-remote-dev for a dedicated dev project.');
      process.exit(1);
    }
    const pw = () => `Dev-${randomBytes(9).toString('base64url')}1a`;
    const org = await createOrg('DEMO School (synthetic data)');
    const people = [
      { email: 'demo.admin@example.test', name: 'Demo Safety Admin', role: 'safety_admin' },
      { email: 'demo.staff1@example.test', name: 'Demo Staff One', role: 'employee' },
      { email: 'demo.staff2@example.test', name: 'Demo Staff Two', role: 'employee' },
    ];
    console.log(`Organisation: ${org.id}`);
    for (const p of people) {
      const password = pw();
      const u = await createUser({ org: org.id, ...p, password });
      console.log(`${p.role.padEnd(13)} ${p.email}  password: ${password}  (${u.account_status})`);
    }
    console.log('These synthetic accounts are for development only. Delete them before any pilot.');
  } else {
    usage(1);
  }
} catch (e) {
  console.error('Failed:', e.message ?? e);
  process.exit(1);
}
