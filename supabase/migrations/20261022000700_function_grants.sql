-- Staff Safe Commute: function execute allowlist
-- Every function in public is first made non-executable for client roles, then only the
-- intended RPC entry points are granted to `authenticated`. `anon` can execute nothing.
-- Add new client-callable functions here; anything not listed stays server-only.

revoke execute on all functions in schema public from public, anon, authenticated;

-- Used inside RLS policies (evaluated as the calling role).
grant execute on function public.is_admin_for(uuid) to authenticated;
grant execute on function public.is_active_self(uuid) to authenticated;
grant execute on function public.location_freshness_for(timestamptz, timestamptz) to authenticated;

-- Staff
grant execute on function public.start_journey(uuid, text, text, timestamptz, timestamptz, text, boolean) to authenticated;
grant execute on function public.record_locations(uuid, jsonb) to authenticated;
grant execute on function public.end_journey(uuid, text) to authenticated;
grant execute on function public.create_sos_alert(uuid, uuid, double precision, double precision, real, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_my_profile(text) to authenticated;
grant execute on function public.update_notification_preferences(boolean, boolean, integer) to authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.record_auth_event(text) to authenticated;

-- Safety administrators (each function re-checks role and organisation scope)
grant execute on function public.update_sos_status(uuid, public.sos_status, text) to authenticated;
grant execute on function public.admin_set_account_status(uuid, public.account_status, text) to authenticated;
grant execute on function public.admin_get_journey_detail(uuid) to authenticated;
grant execute on function public.admin_get_sos_detail(uuid) to authenticated;
grant execute on function public.admin_dashboard_summary() to authenticated;
