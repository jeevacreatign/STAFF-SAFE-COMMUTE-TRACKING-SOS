// Invitation-based onboarding. An active safety administrator invites a staff member into one
// of the organisations they are assigned to. Role and organisation are written to app_metadata
// (not user-editable), which the handle_new_auth_user trigger reads to create the profile.
// Administrator accounts are NOT created here; see docs/setup.md (platform operator only).
import { z } from 'npm:zod@4';
import { callerClient, serviceClient } from '../_shared/clients.ts';
import { corsHeaders, errorResponse, json, log } from '../_shared/http.ts';

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  full_name: z.string().trim().min(1).max(120),
  employee_ref: z.string().trim().max(40).optional(),
  organisation_id: z.string().uuid(),
});

const MAX_INVITES_PER_DAY = 50;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST.', 405);

  const caller = callerClient(req);
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return errorResponse('UNAUTHORISED', 'Sign in required.', 401);
  const callerId = userData.user.id;

  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return errorResponse('VALIDATION', 'Invalid JSON body.', 400);
  }
  if (!parsed.success) return errorResponse('VALIDATION', 'Check the email, name and organisation.', 400);
  const input = parsed.data;

  const admin = serviceClient();

  // Authorisation is checked server-side against the database, never from client claims.
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, account_status')
    .eq('id', callerId)
    .maybeSingle();
  const { data: assignment } = await admin
    .from('admin_assignments')
    .select('organisation_id')
    .eq('admin_id', callerId)
    .eq('organisation_id', input.organisation_id)
    .maybeSingle();
  if (!profile || profile.role !== 'safety_admin' || profile.account_status !== 'active' || !assignment) {
    log('warn', 'invite_forbidden', { caller: callerId });
    return errorResponse('FORBIDDEN', 'You are not allowed to invite staff to this organisation.', 403);
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', callerId)
    .eq('action', 'account.invited')
    .gte('created_at', since);
  if ((count ?? 0) >= MAX_INVITES_PER_DAY) {
    return errorResponse('RATE_LIMITED', 'Daily invitation limit reached.', 429);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: false,
    user_metadata: { full_name: input.full_name },
    app_metadata: {
      invited: true,
      role: 'employee',
      organisation_id: input.organisation_id,
      employee_ref: input.employee_ref ?? null,
    },
  });
  if (createError || !created.user) {
    // Do not reveal whether the address already has an account.
    log('warn', 'invite_create_failed', { caller: callerId, status: createError?.status });
    return errorResponse('INVITE_FAILED', 'The invitation could not be created.', 400);
  }

  // Sends the "set your password" email. Following it proves ownership of the address.
  const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') ?? undefined;
  const { error: linkError } = await caller.auth.resetPasswordForEmail(input.email, { redirectTo });

  await admin.rpc('write_audit', {
    p_actor: callerId,
    p_org: input.organisation_id,
    p_action: 'account.invited',
    p_resource_type: 'profile',
    p_resource_id: created.user.id,
    p_metadata: { email_sent: !linkError },
  });

  log('info', 'invite_created', { caller: callerId, user: created.user.id, email_sent: !linkError });
  return json({ user_id: created.user.id, email_sent: !linkError }, 201);
});
