#!/usr/bin/env node
// Platform-operator CLI. Runs on a trusted machine with the service-role key in the environment;
// never ship this key in the app. Commands:
//   create-org   --name "School name"
//   create-admin --org <organisation uuid> --email a@b --name "Full Name"
//   create-staff --org <organisation uuid> --email a@b --name "Full Name" [--employee-ref ID]
//     optionally reads OPERATOR_NEW_PASSWORD to create a confirmed account with that password
//   send-password-reset --email a@b
//   set-password --email a@b (reads OPERATOR_NEW_PASSWORD from the environment)
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
  node scripts/operator.mjs create-staff --org <organisation-uuid> --email staff@school.example --name "Full Name" [--employee-ref ID]
  node scripts/operator.mjs send-password-reset --email user@school.example
  node scripts/operator.mjs set-password --email user@school.example
  node scripts/operator.mjs seed-dev [--allow-remote-dev]
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (for setup emails),
     OPERATOR_NEW_PASSWORD (optional for create-staff; required for set-password)`);
  process.exit(code);
}
if (!cmd || cmd === '--help' || cmd === '-h') usage(0);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = anonKey
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
    })
  : null;

async function sendPasswordReset(email) {
  if (!authClient) {
    throw new Error('Set SUPABASE_ANON_KEY to the project publishable/anon key to send a password-reset email.');
  }
  const { error } = await authClient.auth.resetPasswordForEmail(email, {
    redirectTo: process.env.INVITE_REDIRECT_URL || undefined,
  });
  if (error) throw error;
}

async function setPassword(email, password) {
  if (!password || password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('Password must be at least 10 characters and include lowercase, uppercase, and a number.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (user) {
      const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password });
      if (updateError) throw updateError;
      return;
    }
    if (data.users.length < 1000) throw new Error('No Supabase Auth user found for that email.');
  }
}

async function createOrg(name) {
  const { data, error } = await admin.from('organisations').insert({ name }).select('id, name').single();
  if (error) throw error;
  await admin.from('retention_settings').insert({ organisation_id: data.id });
  return data;
}

/** Creates the user with app_metadata (not user-editable); the DB trigger builds the profile. */
async function createUser({ org, email, name, role, password, employeeRef }) {
  if (!password && !authClient) {
    throw new Error('Set SUPABASE_ANON_KEY to the project publishable/anon key to send the password-setup email.');
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: Boolean(password),
    user_metadata: { full_name: name },
    app_metadata: { invited: true, organisation_id: org, role, ...(employeeRef ? { employee_ref: employeeRef } : {}) },
  });
  if (error) throw error;
  let emailSent = false;
  if (!password) {
    const { error: linkError } = await authClient.auth.resetPasswordForEmail(email, {
      redirectTo: process.env.INVITE_REDIRECT_URL || undefined,
    });
    if (linkError) console.warn('Password-setup email could not be sent:', linkError.message);
    else emailSent = true;
  }
  const { data: profile } = await admin.from('profiles').select('role, account_status').eq('id', data.user.id).single();
  return { id: data.user.id, emailSent, passwordSet: Boolean(password), ...profile };
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
    console.log(
      u.emailSent
        ? 'Administrator created; password-setup email sent.'
        : 'Administrator created, but the password-setup email failed.',
      { id: u.id, role: u.role, account_status: u.account_status },
    );
  } else if (cmd === 'create-staff') {
    const org = opt('org');
    const email = opt('email');
    const name = opt('name');
    const employeeRef = opt('employee-ref');
    if (!org || !email || !name) usage(1);
    const u = await createUser({
      org,
      email,
      name,
      role: 'employee',
      employeeRef,
      password: process.env.OPERATOR_NEW_PASSWORD,
    });
    const { error: auditError } = await admin.from('audit_logs').insert({
      organisation_id: org,
      action: 'account.invited',
      resource_type: 'profile',
      resource_id: u.id,
      metadata: { email_sent: u.emailSent },
    });
    if (auditError) throw auditError;
    console.log(
      u.passwordSet
        ? 'Staff account created with password set.'
        : u.emailSent
          ? 'Staff account created; password-setup email sent.'
          : 'Staff account created, but the password-setup email failed. Use the Auth password-reset flow after fixing email delivery.',
      { id: u.id, role: u.role, account_status: u.account_status },
    );
  } else if (cmd === 'send-password-reset') {
    const email = opt('email');
    if (!email) usage(1);
    await sendPasswordReset(email);
    console.log('Password-reset email sent. Open the new link on the phone with the app installed.');
  } else if (cmd === 'set-password') {
    const email = opt('email');
    if (!email) usage(1);
    await setPassword(email, process.env.OPERATOR_NEW_PASSWORD);
    console.log(`Password updated for ${email.trim().toLowerCase()}.`);
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
