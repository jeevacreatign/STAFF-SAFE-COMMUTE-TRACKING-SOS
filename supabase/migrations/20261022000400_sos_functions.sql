-- Staff Safe Commute: SOS alerts

create or replace function public.create_sos_alert(
  p_client_request_id uuid,
  p_journey_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m real,
  p_location_observed_at timestamptz,
  p_client_created_at timestamptz
)
returns public.sos_alerts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_journey public.journeys;
  v_alert public.sos_alerts;
  v_now timestamptz := now();
  v_lat double precision;
  v_lng double precision;
  v_acc real;
  v_obs timestamptz;
  v_source text;
begin
  if p_client_request_id is null then
    perform public.app_error('VALIDATION', 'A request id is required.');
  end if;

  -- Idempotent: retries of the same alert never create duplicates.
  select * into v_alert from public.sos_alerts
  where employee_id = v_profile.id and client_request_id = p_client_request_id;
  if found then
    return v_alert;
  end if;

  select * into v_journey from public.journeys where id = p_journey_id and employee_id = v_profile.id;
  if not found then
    perform public.app_error('NOT_FOUND', 'Journey not found.');
  end if;
  -- SOS is allowed during the journey and for 30 minutes after it ends, so an expiry or stop
  -- racing with an emergency never blocks the alert.
  if v_journey.status <> 'active' and v_journey.ended_at < v_now - interval '30 minutes' then
    perform public.app_error('JOURNEY_NOT_ACTIVE', 'SOS is available during an active journey.');
  end if;

  if (select count(*) from public.sos_alerts where employee_id = v_profile.id and created_at > v_now - interval '10 minutes') >= 10 then
    perform public.app_error('RATE_LIMITED', 'Too many alerts in a short time. Your earlier alerts were received.');
  end if;

  -- Device location if valid; otherwise the server's last known position (labelled as such).
  if p_latitude is not null and p_longitude is not null and p_location_observed_at is not null
     and p_latitude between -90 and 90 and p_longitude between -180 and 180
     and (p_accuracy_m is null or p_accuracy_m between 0 and 50000)
     and p_location_observed_at <= v_now + interval '2 minutes'
     and p_location_observed_at > v_now - interval '24 hours' then
    v_lat := p_latitude; v_lng := p_longitude; v_acc := p_accuracy_m;
    v_obs := least(p_location_observed_at, v_now); v_source := 'device';
  elsif v_journey.last_observed_at is not null then
    v_lat := v_journey.last_latitude; v_lng := v_journey.last_longitude; v_acc := v_journey.last_accuracy_m;
    v_obs := v_journey.last_observed_at; v_source := 'server_last_known';
  end if;

  insert into public.sos_alerts (
    journey_id, employee_id, organisation_id, client_request_id, alert_status,
    latitude, longitude, accuracy_m, location_observed_at, location_freshness, location_source,
    client_created_at
  ) values (
    v_journey.id, v_profile.id, v_profile.organisation_id, p_client_request_id, 'new',
    v_lat, v_lng, v_acc, v_obs, public.location_freshness_for(v_obs, v_now), v_source,
    case when p_client_created_at between v_now - interval '24 hours' and v_now + interval '2 minutes' then p_client_created_at end
  ) returning * into v_alert;

  insert into public.sos_alert_events (alert_id, organisation_id, actor_id, from_status, to_status)
  values (v_alert.id, v_alert.organisation_id, v_profile.id, null, 'new');

  perform public.write_audit(v_profile.id, v_profile.organisation_id, 'sos.created', 'sos_alert', v_alert.id,
    jsonb_build_object('journey_id', v_journey.id, 'location_freshness', v_alert.location_freshness));
  perform public.enqueue_admin_notifications(v_profile.organisation_id, 'sos_created', v_journey.id, v_alert.id);
  return v_alert;
end;
$$;

-- Admin response workflow. Same status + note records a progress note without a transition.
create or replace function public.update_sos_status(p_alert_id uuid, p_status public.sos_status, p_note text)
returns public.sos_alerts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles := public.require_active_profile();
  v_alert public.sos_alerts;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_from public.sos_status;
begin
  if v_note is not null and char_length(v_note) > 1000 then
    perform public.app_error('VALIDATION', 'Notes must be at most 1000 characters.');
  end if;

  select * into v_alert from public.sos_alerts where id = p_alert_id for update;
  if not found or not public.is_admin_for(v_alert.organisation_id) then
    perform public.app_error('NOT_FOUND', 'Alert not found.');
  end if;
  v_from := v_alert.alert_status;

  if p_status = v_from then
    if v_note is null then
      return v_alert; -- idempotent retry
    end if;
  end if;

  update public.sos_alerts set
    alert_status = p_status,
    acknowledged_at = case when p_status = 'acknowledged' and v_from <> p_status then now() else acknowledged_at end,
    acknowledged_by = case when p_status = 'acknowledged' and v_from <> p_status then v_profile.id else acknowledged_by end,
    responding_at = case when p_status = 'responding' and v_from <> p_status then now() else responding_at end,
    resolved_at = case when p_status = 'resolved' and v_from <> p_status then now() else resolved_at end,
    resolved_by = case when p_status = 'resolved' and v_from <> p_status then v_profile.id else resolved_by end,
    closed_at = case when p_status = 'closed' and v_from <> p_status then now() else closed_at end,
    closed_by = case when p_status = 'closed' and v_from <> p_status then v_profile.id else closed_by end,
    response_notes = case when v_note is null then response_notes
      else left(concat_ws(E'\n', response_notes, to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') || ': ' || v_note), 4000) end
  where id = v_alert.id
  returning * into v_alert;

  insert into public.sos_alert_events (alert_id, organisation_id, actor_id, from_status, to_status, note)
  values (v_alert.id, v_alert.organisation_id, v_profile.id, v_from, p_status, v_note);

  perform public.write_audit(v_profile.id, v_alert.organisation_id,
    case when v_from = p_status then 'sos.note_added' else 'sos.status_changed' end,
    'sos_alert', v_alert.id, jsonb_build_object('from', v_from, 'to', p_status));

  if v_from <> p_status then
    insert into public.notification_records (recipient_id, organisation_id, event_type, related_journey_id, related_alert_id)
    select v_alert.employee_id, v_alert.organisation_id, 'sos_status_changed', v_alert.journey_id, v_alert.id
    from public.notification_preferences np
    where np.user_id = v_alert.employee_id and np.status_updates;
  end if;
  return v_alert;
end;
$$;

