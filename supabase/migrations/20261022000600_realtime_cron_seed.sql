-- Staff Safe Commute: realtime publication, scheduled jobs, initial consent text

-- Realtime: only journey status/latest-position rows and SOS alerts. Supabase Realtime evaluates
-- each subscriber's RLS SELECT policies before delivering a change. journey_locations is NOT
-- published, so raw breadcrumbs are never broadcast.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.journeys, public.sos_alerts;
  end if;
end $$;

-- Scheduled jobs (pg_cron is available on Supabase; skipped automatically where it is not).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('expire-journeys', '* * * * *', 'select public.expire_journeys()');
    perform cron.schedule('journey-reminders', '*/5 * * * *', 'select public.queue_journey_reminders()');
    perform cron.schedule('retention-cleanup', '17 3 * * *', 'select public.run_retention_cleanup()');
  else
    raise notice 'pg_cron not available: schedule expire_journeys(), queue_journey_reminders() and run_retention_cleanup() externally.';
  end if;
end $$;

insert into public.consent_versions (version, purpose, summary, is_active) values (
  '2026-10-v1',
  'Share my location with authorised school safety administrators for the duration of this commute so they can help if I raise an SOS or do not arrive safely.',
  'Location is collected only during this journey, only after you approve it, and stops when you tap Stop Sharing, confirm safe arrival, or the journey expires.',
  true
);
