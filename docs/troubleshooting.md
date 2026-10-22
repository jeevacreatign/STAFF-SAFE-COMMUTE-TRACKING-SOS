# Troubleshooting (developers and operators)

## App

| Symptom | Check |
|---|---|
| "App not configured" screen | `.env` missing `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`; restart Metro with `--clear` after editing. |
| Map shows "Map unavailable" | No `EXPO_PUBLIC_MAPS_API_KEY` at build time, or key not restricted correctly (check `adb logcat | grep -i "Google Maps"`). Rebuild after adding. |
| Background location never starts | Running in Expo Go (unsupported) — use a dev build. Check foreground service permission in the manifest (`npx expo prebuild` then inspect `android/app/src/main/AndroidManifest.xml`). |
| "Account not active" after invite | Invitation `app_metadata` lacked `invited/organisation_id`; check `select * from profiles where id = ...` and the `account.invitation_applied` audit row. |
| Uploads show "session" error | Refresh token expired or revoked; sign in again. |
| `CONSENT_OUTDATED` on start | App `CONSENT_VERSION` differs from the active row in `consent_versions`. |
| SOS stuck "NOT YET DELIVERED" | Device offline or the server unreachable; check Supabase status and function logs. The app retries automatically and on reconnect. |

## Backend

```sql
-- Active journeys past expiry (should be empty within a minute if cron runs)
select id, expires_at from journeys where status = 'active' and expires_at < now();
-- Cron job health
select jobname, status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
-- Notification outbox health
select delivery_status, count(*) from notification_records where created_at > now() - interval '1 day' group by 1;
-- Recent failures
select event_type, last_error, attempts, created_at from notification_records where delivery_status = 'failed' order by created_at desc limit 20;
```

Edge Function logs: Dashboard → Edge Functions → logs. Lines are JSON (`dispatch_complete`, `invite_created`, `expo_push_http_error`) without personal data or coordinates.

## Errors returned by database functions

Functions raise a stable code in the error message: `NOT_AUTHENTICATED`, `ACCOUNT_INACTIVE`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONSENT_REQUIRED`, `CONSENT_OUTDATED`, `JOURNEY_ALREADY_ACTIVE`, `JOURNEY_NOT_ACTIVE`, `INVALID_TRANSITION`, `RATE_LIMITED`. The app maps them in `src/utils/errors.ts`. `NOT_FOUND` is also used for "exists but not yours" to avoid revealing other people's records.
