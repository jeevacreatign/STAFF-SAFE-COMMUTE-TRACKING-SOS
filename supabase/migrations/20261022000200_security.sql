-- Staff Safe Commute: access control
-- Clients (anon / authenticated) get SELECT only, filtered by RLS. Every write goes through
-- SECURITY DEFINER functions that validate identity, organisation and state.

-- ---------------------------------------------------------------------------
-- Lock down default privileges (Supabase grants ALL to anon/authenticated by default).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- PostgreSQL grants EXECUTE on new functions to PUBLIC globally; a schema-scoped revoke cannot
-- remove that, so revoke it globally too. Function grants are an explicit allowlist in the
-- final migration (20261022000700_function_grants.sql).
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
create or replace function public.app_error(code text, message text default null)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
begin
  -- Stable machine-readable codes in MESSAGE; human text in DETAIL. Never includes personal data.
  raise exception using errcode = 'P0001', message = code, detail = coalesce(message, code);
end;
$$;

-- The caller's profile when the account is active; null otherwise.
create or replace function public.current_active_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from public.profiles p
  where p.id = auth.uid() and p.account_status = 'active'
$$;

create or replace function public.is_admin_for(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    join public.admin_assignments a on a.admin_id = p.id
    where p.id = auth.uid()
      and p.role = 'safety_admin'
      and p.account_status = 'active'
      and a.organisation_id = p_org
  )
$$;

create or replace function public.is_active_self(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_user = auth.uid() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.account_status = 'active'
  )
$$;

create or replace function public.location_freshness_for(p_observed_at timestamptz, p_now timestamptz default now())
returns public.location_freshness
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_observed_at is null then 'none'::public.location_freshness
    when p_now - p_observed_at <= interval '2 minutes' then 'fresh'
    when p_now - p_observed_at <= interval '10 minutes' then 'delayed'
    else 'stale'
  end
$$;

create or replace function public.write_audit(
  p_actor uuid, p_org uuid, p_action text, p_resource_type text, p_resource_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_logs (actor_id, organisation_id, action, resource_type, resource_id, metadata)
  values (p_actor, p_org, p_action, p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Queue a notification for every active admin of an organisation.
create or replace function public.enqueue_admin_notifications(
  p_org uuid, p_event text, p_journey uuid, p_alert uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.notification_records (recipient_id, organisation_id, event_type, related_journey_id, related_alert_id)
  select p.id, p_org, p_event, p_journey, p_alert
  from public.admin_assignments a
  join public.profiles p on p.id = a.admin_id
  where a.organisation_id = p_org and p.role = 'safety_admin' and p.account_status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile protection
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Direct client writes are not granted at all; this is defence in depth in case a grant is
  -- ever added by mistake. Trusted functions run as the table owner and pass this check.
  if current_user in ('anon', 'authenticated') and (
    new.role is distinct from old.role
    or new.organisation_id is distinct from old.organisation_id
    or new.account_status is distinct from old.account_status
    or new.id is distinct from old.id
  ) then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN', detail = 'Role, organisation and account status can only be changed by authorised backend operations.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_protect_columns
before update on public.profiles
for each row execute function public.protect_profile_columns();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger journeys_touch before update on public.journeys for each row execute function public.touch_updated_at();
create trigger sos_alerts_touch before update on public.sos_alerts for each row execute function public.touch_updated_at();

-- Audit logs are append-only for everyone except the retention job (which runs as owner with a flag).
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN', detail = 'Audit records cannot be modified.';
  end if;
  if coalesce(current_setting('app.retention_job', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN', detail = 'Audit records can only be removed by the retention job.';
  end if;
  return old;
end;
$$;

create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_mutation();

-- Journey terminal states are final: a finished journey can never become active again.
create or replace function public.enforce_journey_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'active' and new.status is distinct from old.status then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION', detail = format('Journey cannot move from %s to %s.', old.status, new.status);
  end if;
  if new.employee_id is distinct from old.employee_id
     or new.organisation_id is distinct from old.organisation_id
     or new.consented_at is distinct from old.consented_at
     or new.consent_version is distinct from old.consent_version then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN', detail = 'Journey ownership and consent fields are immutable.';
  end if;
  return new;
end;
$$;

create trigger journeys_enforce_transition
before update on public.journeys
for each row execute function public.enforce_journey_transition();

create or replace function public.enforce_sos_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.alert_status is distinct from old.alert_status and not (
    (old.alert_status = 'new' and new.alert_status = 'acknowledged')
    or (old.alert_status = 'acknowledged' and new.alert_status in ('responding', 'resolved'))
    or (old.alert_status = 'responding' and new.alert_status = 'resolved')
    or (old.alert_status = 'resolved' and new.alert_status = 'closed')
  ) then
    raise exception using errcode = 'P0001', message = 'INVALID_TRANSITION', detail = format('Alert cannot move from %s to %s.', old.alert_status, new.alert_status);
  end if;
  if new.employee_id is distinct from old.employee_id
     or new.organisation_id is distinct from old.organisation_id
     or new.journey_id is distinct from old.journey_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'FORBIDDEN', detail = 'Alert ownership fields are immutable.';
  end if;
  return new;
end;
$$;

create trigger sos_alerts_enforce_transition
before update on public.sos_alerts
for each row execute function public.enforce_sos_transition();

-- ---------------------------------------------------------------------------
-- New auth users -> profiles
-- Role and organisation come ONLY from raw_app_meta_data, which users cannot edit
-- (it is set by the service-role invite-user Edge Function). Depending on the Auth server
-- version, app_metadata may be written in the INSERT or in a follow-up UPDATE, so both apply it.
-- ---------------------------------------------------------------------------
create or replace function public.apply_invitation(p_user uuid, p_app_meta jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_role public.user_role := 'employee';
  v_profile public.profiles;
begin
  if not coalesce((p_app_meta ->> 'invited')::boolean, false) then
    return;
  end if;
  v_org := (p_app_meta ->> 'organisation_id')::uuid;
  if v_org is null or not exists (select 1 from public.organisations where id = v_org) then
    return;
  end if;
  select * into v_profile from public.profiles where id = p_user for update;
  -- Only a fresh, never-activated profile can be claimed by an invitation.
  if not found or v_profile.organisation_id is not null or v_profile.account_status <> 'pending_review' then
    return;
  end if;
  if (p_app_meta ->> 'role') = 'safety_admin' then
    v_role := 'safety_admin';
  end if;

  update public.profiles
  set organisation_id = v_org, role = v_role, account_status = 'active',
      employee_ref = coalesce(left(p_app_meta ->> 'employee_ref', 40), employee_ref)
  where id = p_user;

  if v_role = 'safety_admin' then
    insert into public.admin_assignments (admin_id, organisation_id) values (p_user, v_org)
    on conflict do nothing;
  end if;
  perform public.write_audit(null, v_org, 'account.invitation_applied', 'profile', p_user,
    jsonb_build_object('role', v_role));
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
begin
  insert into public.profiles (id, full_name, role, organisation_id, account_status)
  values (
    new.id,
    left(coalesce(v_name, split_part(coalesce(new.email, 'Staff member'), '@', 1)), 120),
    'employee', null, 'pending_review'
  );
  insert into public.notification_preferences (user_id) values (new.id);
  perform public.write_audit(null, null, 'account.created', 'profile', new.id, '{}'::jsonb);
  perform public.apply_invitation(new.id, new.raw_app_meta_data);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.handle_auth_user_app_meta_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.apply_invitation(new.id, new.raw_app_meta_data);
  return new;
end;
$$;

create trigger on_auth_user_app_meta_updated
after update of raw_app_meta_data on auth.users
for each row
when (new.raw_app_meta_data is distinct from old.raw_app_meta_data)
execute function public.handle_auth_user_app_meta_update();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organisations enable row level security;
alter table public.profiles enable row level security;
alter table public.admin_assignments enable row level security;
alter table public.consent_versions enable row level security;
alter table public.journeys enable row level security;
alter table public.journey_locations enable row level security;
alter table public.consent_records enable row level security;
alter table public.sos_alerts enable row level security;
alter table public.sos_alert_events enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notification_records enable row level security;
alter table public.audit_logs enable row level security;
alter table public.retention_settings enable row level security;

-- Read-only grants for signed-in users; RLS decides which rows.
grant select on
  public.organisations, public.profiles, public.admin_assignments, public.consent_versions,
  public.journeys, public.journey_locations, public.consent_records, public.sos_alerts,
  public.sos_alert_events, public.notification_preferences, public.notification_records,
  public.audit_logs, public.retention_settings
to authenticated;
-- anon gets nothing at all.

create policy organisations_select on public.organisations for select to authenticated
  using (
    public.is_admin_for(id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.organisation_id = organisations.id and p.account_status = 'active')
  );

create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_select_admin on public.profiles for select to authenticated
  using (organisation_id is not null and public.is_admin_for(organisation_id));

create policy admin_assignments_select_self on public.admin_assignments for select to authenticated
  using (admin_id = auth.uid());

create policy consent_versions_select on public.consent_versions for select to authenticated
  using (is_active);

create policy journeys_select_own on public.journeys for select to authenticated
  using (public.is_active_self(employee_id));
create policy journeys_select_admin on public.journeys for select to authenticated
  using (public.is_admin_for(organisation_id));

-- Precise breadcrumbs: the employee sees their own; admins only while the journey is active.
create policy journey_locations_select_own on public.journey_locations for select to authenticated
  using (public.is_active_self(employee_id));
create policy journey_locations_select_admin_active on public.journey_locations for select to authenticated
  using (
    public.is_admin_for(organisation_id)
    and exists (select 1 from public.journeys j where j.id = journey_id and j.status = 'active')
  );

create policy consent_records_select_own on public.consent_records for select to authenticated
  using (public.is_active_self(employee_id));
create policy consent_records_select_admin on public.consent_records for select to authenticated
  using (public.is_admin_for(organisation_id));

create policy sos_alerts_select_own on public.sos_alerts for select to authenticated
  using (public.is_active_self(employee_id));
create policy sos_alerts_select_admin on public.sos_alerts for select to authenticated
  using (public.is_admin_for(organisation_id));

create policy sos_alert_events_select_admin on public.sos_alert_events for select to authenticated
  using (public.is_admin_for(organisation_id));

create policy notification_preferences_select_own on public.notification_preferences for select to authenticated
  using (user_id = auth.uid());

create policy notification_records_select_own on public.notification_records for select to authenticated
  using (recipient_id = auth.uid());
create policy notification_records_select_admin on public.notification_records for select to authenticated
  using (organisation_id is not null and public.is_admin_for(organisation_id));

create policy audit_logs_select_admin on public.audit_logs for select to authenticated
  using (organisation_id is not null and public.is_admin_for(organisation_id));

create policy retention_settings_select_admin on public.retention_settings for select to authenticated
  using (public.is_admin_for(organisation_id));

-- push_tokens: no client access; managed through register_push_token().

