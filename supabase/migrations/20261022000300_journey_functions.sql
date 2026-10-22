-- Staff Safe Commute: journey lifecycle functions
-- All journey writes happen here. Each function derives the employee and organisation from
-- auth.uid(); client-supplied ids are only used to look up rows the caller already owns.

create or replace function public.require_active_profile()
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    perform public.app_error('NOT_AUTHENTICATED', 'Sign in required.');
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  if not found or v_profile.account_status <> 'active' then
    perform public.app_error('ACCOUNT_INACTIVE', 'This account is not active.');
  end if;
  return v_profile;
end;
$$;

-- Internal: finish a journey row (caller must hold a row lock). Clears the live position.
create or replace function public.finish_journey_row(
  p_journey public.journeys, p_status public.journey_status, p_reason public.journey_end_reason, p_actor uuid
)
returns public.journeys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.journeys;
  v_event text;
begin
  update public.journeys
  set status = p_status,
      end_reason = p_reason,
      ended_at = now(),
      safe_arrival_at = case when p_status = 'safely_arrived' then now() else null end,
      last_latitude = null,
      last_longitude = null,
      last_accuracy_m = null
  where id = p_journey.id
  returning * into v_row;

  update public.consent_records
  set ended_at = now(),
      revoked_at = case when p_reason in ('stopped_by_employee', 'cancelled') then now() else revoked_at end
  where journey_id = p_journey.id and ended_at is null;

  perform public.write_audit(p_actor, p_journey.organisation_id, 'journey.ended', 'journey', p_journey.id,
    jsonb_build_object('status', p_status, 'reason', p_reason));
  perform public.write_audit(p_actor, p_journey.organisation_id, 'location_sharing.ended', 'journey', p_journey.id, '{}'::jsonb);

  v_event := case p_status
    when 'safely_arrived' then 'journey_safely_arrived'
    when 'stopped' then 'journey_stopped'
    when 'expired' then 'journey_expired'
    else null end;
  if v_event is not null then
    perform public.enqueue_admin_notifications(p_journey.organisation_id, v_event, p_journey.id, null);
  end if;
  if p_status = 'expired' then
    insert into public.notification_records (recipient_id, organisation_id, event_type, related_journey_id)
    values (p_journey.employee_id, p_journey.organisation_id, 'journey_expired', p_journey.id);
  end if;
  return v_row;
end;
$$;

-- Lock the caller's journey; returns it after applying server-side expiry.
create or replace function public.lock_own_journey(p_journey_id uuid)
returns public.journeys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_journey public.journeys;
begin
  select * into v_journey from public.journeys
  where id = p_journey_id and employee_id = auth.uid()
  for update;
  if not found then
    -- Same error whether the journey does not exist or belongs to someone else.
    perform public.app_error('NOT_FOUND', 'Journey not found.');
  end if;
  if v_journey.status = 'active' and v_journey.expires_at <= now() then
    v_journey := public.finish_journey_row(v_journey, 'expired', 'expired', null);
  end if;
  return v_journey;
end;
$$;

create or replace function public.start_journey(
  p_client_request_id uuid,
  p_label text,
  p_destination_label text,
  p_estimated_arrival_at timestamptz,
  p_expires_at timestamptz,
  p_consent_version text,
  p_consent_given boolean
)
returns public.journeys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_journey public.journeys;
  v_existing public.journeys;
  v_consent public.consent_versions;
  v_now timestamptz := now();
  v_label text := nullif(trim(coalesce(p_label, '')), '');
  v_dest text := nullif(trim(coalesce(p_destination_label, '')), '');
begin
  if v_profile.role <> 'employee' then
    perform public.app_error('FORBIDDEN', 'Only staff accounts can start a journey.');
  end if;
  if p_client_request_id is null then
    perform public.app_error('VALIDATION', 'A request id is required.');
  end if;

  -- Idempotent replay: the same request returns the journey it created.
  select * into v_existing from public.journeys
  where employee_id = v_profile.id and client_request_id = p_client_request_id;
  if found then
    return v_existing;
  end if;

  if p_consent_given is distinct from true then
    perform public.app_error('CONSENT_REQUIRED', 'Explicit consent is required for every journey.');
  end if;
  select * into v_consent from public.consent_versions where version = p_consent_version and is_active;
  if not found then
    perform public.app_error('CONSENT_OUTDATED', 'The consent text has changed. Please review it again.');
  end if;

  if v_label is null or char_length(v_label) > 80 then
    perform public.app_error('VALIDATION', 'Journey label must be 1 to 80 characters.');
  end if;
  if v_dest is not null and char_length(v_dest) > 120 then
    perform public.app_error('VALIDATION', 'Destination must be at most 120 characters.');
  end if;
  if p_expires_at is null or p_expires_at < v_now + interval '5 minutes' or p_expires_at > v_now + interval '12 hours' then
    perform public.app_error('VALIDATION', 'Expiry must be between 5 minutes and 12 hours from now.');
  end if;
  if p_estimated_arrival_at is not null and (p_estimated_arrival_at <= v_now or p_estimated_arrival_at > p_expires_at) then
    perform public.app_error('VALIDATION', 'Estimated arrival must be in the future and no later than expiry.');
  end if;

  -- Rate limit: 20 journeys per rolling hour.
  if (select count(*) from public.journeys where employee_id = v_profile.id and created_at > v_now - interval '1 hour') >= 20 then
    perform public.app_error('RATE_LIMITED', 'Too many journeys started recently. Please wait and try again.');
  end if;

  -- Expire any overdue active journey first, then refuse if one is still active.
  perform public.expire_overdue_for_employee(v_profile.id);
  if exists (select 1 from public.journeys where employee_id = v_profile.id and status = 'active') then
    perform public.app_error('JOURNEY_ALREADY_ACTIVE', 'Finish your current journey before starting a new one.');
  end if;

  insert into public.journeys (
    employee_id, organisation_id, client_request_id, label, destination_label, estimated_arrival_at,
    consented_at, consent_version, sharing_started_at, expires_at, status
  ) values (
    v_profile.id, v_profile.organisation_id, p_client_request_id, v_label, v_dest, p_estimated_arrival_at,
    v_now, v_consent.version, v_now, p_expires_at, 'active'
  ) returning * into v_journey;

  insert into public.consent_records (journey_id, employee_id, organisation_id, consent_version, purpose, consented_at)
  values (v_journey.id, v_profile.id, v_profile.organisation_id, v_consent.version, v_consent.purpose, v_now);

  perform public.write_audit(v_profile.id, v_profile.organisation_id, 'journey.created', 'journey', v_journey.id,
    jsonb_build_object('expires_at', p_expires_at));
  perform public.write_audit(v_profile.id, v_profile.organisation_id, 'consent.granted', 'journey', v_journey.id,
    jsonb_build_object('consent_version', v_consent.version));
  perform public.write_audit(v_profile.id, v_profile.organisation_id, 'location_sharing.started', 'journey', v_journey.id, '{}'::jsonb);
  return v_journey;
end;
$$;

create or replace function public.expire_overdue_for_employee(p_employee uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_journey public.journeys;
  v_count integer := 0;
begin
  for v_journey in
    select * from public.journeys
    where employee_id = p_employee and status = 'active' and expires_at <= now()
    for update skip locked
  loop
    perform public.finish_journey_row(v_journey, 'expired', 'expired', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Batch location upload. Never raises for a finished journey: it reports the journey status so
-- the client can stop collecting. Points are validated individually.
create or replace function public.record_locations(p_journey_id uuid, p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_journey public.journeys;
  v_point jsonb;
  v_lat double precision;
  v_lng double precision;
  v_acc real;
  v_obs timestamptz;
  v_now timestamptz := now();
  v_accepted integer := 0;
  v_duplicates integer := 0;
  v_rejected integer := 0;
  v_inserted integer;
  v_latest jsonb := null;
begin
  if p_points is null or jsonb_typeof(p_points) <> 'array' then
    perform public.app_error('VALIDATION', 'Points must be an array.');
  end if;
  if jsonb_array_length(p_points) > 100 then
    perform public.app_error('VALIDATION', 'At most 100 points per upload.');
  end if;

  v_journey := public.lock_own_journey(p_journey_id);
  if v_journey.status <> 'active' then
    return jsonb_build_object('journey_status', v_journey.status, 'accepted', 0, 'duplicates', 0,
      'rejected', jsonb_array_length(p_points));
  end if;

  for v_point in select * from jsonb_array_elements(p_points)
  loop
    begin
      v_lat := (v_point ->> 'latitude')::double precision;
      v_lng := (v_point ->> 'longitude')::double precision;
      v_acc := (v_point ->> 'accuracy_m')::real;
      v_obs := (v_point ->> 'observed_at')::timestamptz;
    exception when others then
      v_rejected := v_rejected + 1;
      continue;
    end;

    if v_lat is null or v_lng is null or v_obs is null
       or v_lat not between -90 and 90 or v_lng not between -180 and 180
       or (v_acc is not null and (v_acc < 0 or v_acc > 5000))
       -- Nothing observed before consent, after expiry, or in the future (2 min clock skew allowed).
       or v_obs < v_journey.sharing_started_at - interval '30 seconds'
       or v_obs >= v_journey.expires_at
       or v_obs > v_now + interval '2 minutes' then
      v_rejected := v_rejected + 1;
      continue;
    end if;

    insert into public.journey_locations (journey_id, employee_id, organisation_id, latitude, longitude, accuracy_m, observed_at, received_at)
    values (v_journey.id, v_journey.employee_id, v_journey.organisation_id, v_lat, v_lng, v_acc, least(v_obs, v_now), v_now)
    on conflict (journey_id, observed_at) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;
    v_accepted := v_accepted + 1;

    -- Out-of-order points are stored but never replace a newer "latest" position.
    if v_latest is null or least(v_obs, v_now) > (v_latest ->> 'observed_at')::timestamptz then
      v_latest := jsonb_build_object('latitude', v_lat, 'longitude', v_lng, 'accuracy_m', v_acc, 'observed_at', least(v_obs, v_now));
    end if;
  end loop;

  if v_latest is not null and (v_journey.last_observed_at is null or (v_latest ->> 'observed_at')::timestamptz > v_journey.last_observed_at) then
    update public.journeys
    set last_latitude = (v_latest ->> 'latitude')::double precision,
        last_longitude = (v_latest ->> 'longitude')::double precision,
        last_accuracy_m = (v_latest ->> 'accuracy_m')::real,
        last_observed_at = (v_latest ->> 'observed_at')::timestamptz,
        last_received_at = v_now
    where id = v_journey.id;
  elsif v_accepted > 0 then
    update public.journeys set last_received_at = v_now where id = v_journey.id;
  end if;

  return jsonb_build_object('journey_status', 'active', 'accepted', v_accepted, 'duplicates', v_duplicates,
    'rejected', v_rejected, 'expires_at', v_journey.expires_at);
end;
$$;

-- Employee ends their own journey. Never requires admin approval.
create or replace function public.end_journey(p_journey_id uuid, p_action text)
returns public.journeys
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_journey public.journeys;
  v_target public.journey_status;
  v_reason public.journey_end_reason;
begin
  case p_action
    when 'safe_arrival' then v_target := 'safely_arrived'; v_reason := 'safe_arrival';
    when 'stop' then v_target := 'stopped'; v_reason := 'stopped_by_employee';
    when 'cancel' then v_target := 'cancelled'; v_reason := 'cancelled';
    else perform public.app_error('VALIDATION', 'Unknown journey action.');
  end case;

  v_journey := public.lock_own_journey(p_journey_id);

  if v_journey.status <> 'active' then
    if v_journey.status = v_target then
      return v_journey; -- idempotent retry
    end if;
    -- Already finished another way (e.g. expired while offline). Report the real state.
    return v_journey;
  end if;

  if v_target = 'cancelled' and v_journey.last_observed_at is not null then
    perform public.app_error('INVALID_TRANSITION', 'A journey that has shared a location must be stopped, not cancelled.');
  end if;

  return public.finish_journey_row(v_journey, v_target, v_reason, v_profile.id);
end;
$$;

-- Server-side expiry for every overdue journey. Scheduled with pg_cron (see realtime/cron migration).
create or replace function public.expire_journeys()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_journey public.journeys;
  v_count integer := 0;
begin
  for v_journey in
    select * from public.journeys
    where status = 'active' and expires_at <= now()
    order by expires_at
    for update skip locked
  loop
    perform public.finish_journey_row(v_journey, 'expired', 'expired', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Reminders for active journeys past ETA + preference offset. One reminder per journey.
create or replace function public.queue_journey_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with due as (
    select j.id, j.employee_id, j.organisation_id
    from public.journeys j
    join public.notification_preferences np on np.user_id = j.employee_id
    where j.status = 'active'
      and j.reminder_sent_at is null
      and j.estimated_arrival_at is not null
      and np.journey_reminders
      and now() >= j.estimated_arrival_at + make_interval(mins => np.reminder_minutes_after_eta)
    for update of j skip locked
  ), marked as (
    update public.journeys j set reminder_sent_at = now()
    from due where j.id = due.id
    returning due.*
  )
  insert into public.notification_records (recipient_id, organisation_id, event_type, related_journey_id)
  select employee_id, organisation_id, 'journey_reminder', id from marked;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

