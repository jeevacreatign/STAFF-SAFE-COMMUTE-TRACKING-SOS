-- Staff Safe Commute: account self-service, admin operations, audit access logging, retention

create or replace function public.update_my_profile(p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
begin
  if v_name is null or char_length(v_name) > 120 then
    perform public.app_error('VALIDATION', 'Name must be 1 to 120 characters.');
  end if;
  update public.profiles set full_name = v_name where id = v_profile.id returning * into v_profile;
  return v_profile;
end;
$$;

create or replace function public.update_notification_preferences(
  p_journey_reminders boolean, p_status_updates boolean, p_reminder_minutes_after_eta integer
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_prefs public.notification_preferences;
begin
  if p_reminder_minutes_after_eta is null or p_reminder_minutes_after_eta not between 5 and 240 then
    perform public.app_error('VALIDATION', 'Reminder delay must be between 5 and 240 minutes.');
  end if;
  insert into public.notification_preferences (user_id, journey_reminders, status_updates, reminder_minutes_after_eta, updated_at)
  values (v_profile.id, coalesce(p_journey_reminders, true), coalesce(p_status_updates, true), p_reminder_minutes_after_eta, now())
  on conflict (user_id) do update set
    journey_reminders = excluded.journey_reminders,
    status_updates = excluded.status_updates,
    reminder_minutes_after_eta = excluded.reminder_minutes_after_eta,
    updated_at = now()
  returning * into v_prefs;
  return v_prefs;
end;
$$;

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
begin
  if p_token is null or p_token !~ '^ExponentPushToken\[[A-Za-z0-9_-]{10,200}\]$' then
    perform public.app_error('VALIDATION', 'Invalid push token.');
  end if;
  if p_platform not in ('android', 'ios') then
    perform public.app_error('VALIDATION', 'Invalid platform.');
  end if;
  -- A device token belongs to whoever is signed in on that device now.
  insert into public.push_tokens (user_id, token, platform)
  values (v_profile.id, p_token, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

-- Called on sign-out so a shared device stops receiving the previous user's alerts.
create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

-- Client-reported auth events (sign-in / sign-out). Supabase Auth keeps its own server-side
-- audit trail too; this one is scoped to the organisation for admins.
create or replace function public.record_auth_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if p_event not in ('sign_in', 'sign_out') then
    perform public.app_error('VALIDATION', 'Unknown auth event.');
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    perform public.app_error('NOT_AUTHENTICATED', 'Sign in required.');
  end if;
  -- Light rate limit to keep the log meaningful.
  if (select count(*) from public.audit_logs where actor_id = v_profile.id and action like 'auth.%' and created_at > now() - interval '1 minute') >= 10 then
    return;
  end if;
  perform public.write_audit(v_profile.id, v_profile.organisation_id, 'auth.' || p_event, 'profile', v_profile.id, '{}'::jsonb);
end;
$$;

-- Admin: suspend / reactivate / flag an employee for review, within their organisations only.
create or replace function public.admin_set_account_status(p_user_id uuid, p_status public.account_status, p_reason text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.profiles := public.require_active_profile();
  v_target public.profiles;
  v_journey public.journeys;
  v_from public.account_status;
begin
  if p_status not in ('active', 'suspended', 'pending_review') then
    perform public.app_error('VALIDATION', 'Unsupported status.');
  end if;
  if p_user_id = v_admin.id then
    perform public.app_error('FORBIDDEN', 'You cannot change your own account status.');
  end if;
  select * into v_target from public.profiles where id = p_user_id for update;
  if not found or v_target.organisation_id is null or not public.is_admin_for(v_target.organisation_id) then
    perform public.app_error('NOT_FOUND', 'Account not found.');
  end if;
  if v_target.role <> 'employee' then
    perform public.app_error('FORBIDDEN', 'Administrator accounts are managed by the platform operator.');
  end if;
  v_from := v_target.account_status;

  update public.profiles set account_status = p_status where id = p_user_id returning * into v_target;

  -- Leaving active status ends any live sharing immediately (privacy-preserving default).
  if p_status <> 'active' then
    for v_journey in select * from public.journeys where employee_id = p_user_id and status = 'active' for update
    loop
      perform public.finish_journey_row(v_journey, 'stopped', 'account_suspended', v_admin.id);
    end loop;
  end if;

  perform public.write_audit(v_admin.id, v_target.organisation_id, 'account.status_changed', 'profile', p_user_id,
    jsonb_build_object('from', v_from, 'to', p_status, 'reason', left(coalesce(p_reason, ''), 200)));
  return v_target;
end;
$$;

-- Admin detail reads go through these functions so every access is logged.
create or replace function public.admin_get_journey_detail(p_journey_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.profiles := public.require_active_profile();
  v_journey public.journeys;
  v_result jsonb;
begin
  select * into v_journey from public.journeys where id = p_journey_id;
  if not found or not public.is_admin_for(v_journey.organisation_id) then
    perform public.app_error('NOT_FOUND', 'Journey not found.');
  end if;

  select jsonb_build_object(
    'journey', to_jsonb(v_journey),
    'employee', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'employee_ref', p.employee_ref)
                 from public.profiles p where p.id = v_journey.employee_id),
    'consent', (select to_jsonb(c) from public.consent_records c where c.journey_id = v_journey.id),
    -- Breadcrumbs only while live, capped to the latest 50 points.
    'recent_locations', case when v_journey.status = 'active' then coalesce((
        select jsonb_agg(to_jsonb(l) - 'employee_id' - 'organisation_id' order by l.observed_at desc)
        from (select * from public.journey_locations where journey_id = v_journey.id order by observed_at desc limit 50) l
      ), '[]'::jsonb) else '[]'::jsonb end,
    'sos_alerts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'alert_status', s.alert_status, 'created_at', s.created_at) order by s.created_at desc)
                  from public.sos_alerts s where s.journey_id = v_journey.id), '[]'::jsonb)
  ) into v_result;

  perform public.write_audit(v_admin.id, v_journey.organisation_id, 'admin.viewed_journey', 'journey', v_journey.id, '{}'::jsonb);
  return v_result;
end;
$$;

create or replace function public.admin_get_sos_detail(p_alert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.profiles := public.require_active_profile();
  v_alert public.sos_alerts;
  v_result jsonb;
begin
  select * into v_alert from public.sos_alerts where id = p_alert_id;
  if not found or not public.is_admin_for(v_alert.organisation_id) then
    perform public.app_error('NOT_FOUND', 'Alert not found.');
  end if;

  select jsonb_build_object(
    'alert', to_jsonb(v_alert),
    'employee', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'employee_ref', p.employee_ref)
                 from public.profiles p where p.id = v_alert.employee_id),
    'journey', (select jsonb_build_object('id', j.id, 'label', j.label, 'destination_label', j.destination_label,
                  'status', j.status, 'expires_at', j.expires_at, 'estimated_arrival_at', j.estimated_arrival_at,
                  'last_latitude', j.last_latitude, 'last_longitude', j.last_longitude,
                  'last_accuracy_m', j.last_accuracy_m, 'last_observed_at', j.last_observed_at)
                from public.journeys j where j.id = v_alert.journey_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'from_status', e.from_status, 'to_status', e.to_status,
                  'note', e.note, 'created_at', e.created_at,
                  'actor_name', (select p.full_name from public.profiles p where p.id = e.actor_id)) order by e.created_at)
               from public.sos_alert_events e where e.alert_id = v_alert.id), '[]'::jsonb)
  ) into v_result;

  perform public.write_audit(v_admin.id, v_alert.organisation_id, 'admin.viewed_sos', 'sos_alert', v_alert.id, '{}'::jsonb);
  return v_result;
end;
$$;

-- Dashboard counters from real data, scoped to the caller's organisations.
create or replace function public.admin_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.profiles := public.require_active_profile();
begin
  if v_admin.role <> 'safety_admin' then
    perform public.app_error('FORBIDDEN', 'Administrator access required.');
  end if;
  return (
    with orgs as (select organisation_id from public.admin_assignments where admin_id = v_admin.id)
    select jsonb_build_object(
      'active_journeys', (select count(*) from public.journeys where organisation_id in (select * from orgs) and status = 'active' and expires_at > now()),
      'safely_completed_today', (select count(*) from public.journeys where organisation_id in (select * from orgs) and status = 'safely_arrived' and ended_at > date_trunc('day', now())),
      'expired_today', (select count(*) from public.journeys where organisation_id in (select * from orgs) and (status = 'expired' or (status = 'active' and expires_at <= now())) and coalesce(ended_at, expires_at) > date_trunc('day', now())),
      'open_sos', (select count(*) from public.sos_alerts where organisation_id in (select * from orgs) and alert_status in ('new', 'acknowledged', 'responding')),
      'new_sos', (select count(*) from public.sos_alerts where organisation_id in (select * from orgs) and alert_status = 'new'),
      'failed_notifications_24h', (select count(*) from public.notification_records where organisation_id in (select * from orgs) and delivery_status = 'failed' and created_at > now() - interval '24 hours'),
      'generated_at', now()
    )
  );
end;
$$;

-- Retention: delete or anonymise according to each organisation's settings.
create or replace function public.run_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org record;
  v_locations integer := 0;
  v_journeys integer := 0;
  v_sos integer := 0;
  v_consents integer := 0;
  v_notifications integer := 0;
  v_audit integer := 0;
  v_n integer;
begin
  for v_org in
    select o.id, coalesce(r.location_history_days, 7) loc_days, coalesce(r.journey_record_days, 180) journey_days,
           coalesce(r.sos_alert_days, 730) sos_days, coalesce(r.consent_record_days, 730) consent_days,
           coalesce(r.audit_log_days, 730) audit_days, coalesce(r.notification_record_days, 90) notif_days
    from public.organisations o left join public.retention_settings r on r.organisation_id = o.id
  loop
    -- Precise breadcrumbs are short-lived.
    delete from public.journey_locations l
    using public.journeys j
    where l.journey_id = j.id and l.organisation_id = v_org.id
      and l.received_at < now() - make_interval(days => v_org.loc_days)
      and j.status <> 'active';
    get diagnostics v_n = row_count; v_locations := v_locations + v_n;

    -- Journeys: keep the operational record, drop free-text descriptors.
    update public.journeys set label = 'Removed by retention policy', destination_label = null
    where organisation_id = v_org.id and status <> 'active'
      and ended_at < now() - make_interval(days => v_org.journey_days)
      and label <> 'Removed by retention policy';
    get diagnostics v_n = row_count; v_journeys := v_journeys + v_n;

    -- Closed / resolved SOS: drop coordinates and notes after the retention window.
    update public.sos_alerts set latitude = null, longitude = null, accuracy_m = null, location_observed_at = null,
      response_notes = null
    where organisation_id = v_org.id and alert_status in ('resolved', 'closed')
      and created_at < now() - make_interval(days => v_org.sos_days) and latitude is not null;
    get diagnostics v_n = row_count; v_sos := v_sos + v_n;
    update public.sos_alert_events set note = null
    where organisation_id = v_org.id and created_at < now() - make_interval(days => v_org.sos_days) and note is not null;

    delete from public.consent_records
    where organisation_id = v_org.id and ended_at is not null
      and ended_at < now() - make_interval(days => v_org.consent_days);
    get diagnostics v_n = row_count; v_consents := v_consents + v_n;

    delete from public.notification_records
    where organisation_id = v_org.id and created_at < now() - make_interval(days => v_org.notif_days)
      and delivery_status <> 'pending';
    get diagnostics v_n = row_count; v_notifications := v_notifications + v_n;

    perform set_config('app.retention_job', 'on', true);
    delete from public.audit_logs
    where organisation_id = v_org.id and created_at < now() - make_interval(days => v_org.audit_days);
    get diagnostics v_n = row_count; v_audit := v_audit + v_n;
    perform set_config('app.retention_job', 'off', true);
  end loop;

  perform public.write_audit(null, null, 'retention.cleanup', 'system', null, jsonb_build_object(
    'locations_deleted', v_locations, 'journeys_anonymised', v_journeys, 'sos_anonymised', v_sos,
    'consents_deleted', v_consents, 'notifications_deleted', v_notifications, 'audit_deleted', v_audit));
  return jsonb_build_object('locations_deleted', v_locations, 'journeys_anonymised', v_journeys,
    'sos_anonymised', v_sos, 'consents_deleted', v_consents, 'notifications_deleted', v_notifications,
    'audit_deleted', v_audit);
end;
$$;

