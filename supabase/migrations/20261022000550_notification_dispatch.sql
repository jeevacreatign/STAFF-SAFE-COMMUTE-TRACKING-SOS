-- Staff Safe Commute: notification outbox processing (service role only)
-- The dispatch-notifications Edge Function claims pending rows, sends them via the Expo Push
-- Service, and records the outcome. Message text is generic and never includes coordinates.

create or replace function public.claim_pending_notifications(p_limit integer default 100)
returns table (
  id uuid, recipient_id uuid, event_type text, related_journey_id uuid, related_alert_id uuid,
  tokens text[], attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with claimed as (
    select n.id from public.notification_records n
    where n.delivery_status = 'pending' and n.attempts < 5
      -- Back off between attempts: 0, 1, 2, 4, 8 minutes.
      and (n.attempts = 0 or n.created_at < now() - make_interval(mins => power(2, n.attempts - 1)::int))
    order by (n.event_type = 'sos_created') desc, n.created_at
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  ), bumped as (
    update public.notification_records n set attempts = n.attempts + 1
    from claimed c where n.id = c.id
    returning n.*
  )
  select b.id, b.recipient_id, b.event_type, b.related_journey_id, b.related_alert_id,
         coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = b.recipient_id), '{}'),
         b.attempts
  from bumped b;
end;
$$;

create or replace function public.complete_notification(p_id uuid, p_status public.delivery_status, p_error text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.notification_records;
begin
  if p_status = 'pending' then
    -- Transient failure: leave pending for retry unless attempts are exhausted.
    update public.notification_records
    set delivery_status = case when attempts >= 5 then 'failed'::public.delivery_status else 'pending' end,
        last_error = left(p_error, 500)
    where id = p_id returning * into v_row;
  else
    update public.notification_records
    set delivery_status = p_status, last_error = left(p_error, 500),
        delivered_at = case when p_status = 'sent' then now() else delivered_at end
    where id = p_id returning * into v_row;
  end if;
  if v_row.delivery_status = 'failed' then
    perform public.write_audit(null, v_row.organisation_id, 'notification.failed', 'notification', v_row.id,
      jsonb_build_object('event_type', v_row.event_type));
  end if;
end;
$$;

-- Device tokens that Expo reports as DeviceNotRegistered are removed.
create or replace function public.remove_push_token(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.push_tokens where token = p_token;
$$;
