# Handover report

## Implemented

- **Auth and roles**: Supabase email/password sign-in, sign-out, password reset via deep link, invitation-only onboarding (admin invites staff through the `invite-user` Edge Function; admins are created by the operator CLI). Role, organisation and account status come from `app_metadata` / trusted functions only. Suspended or pending accounts see an "Account not active" screen and are blocked server-side.
- **Consent-based journeys**: Start → setup (label, destination, ETA, expiry 5 min–12 h, proposed duration shown) → versioned disclosure with explicit per-journey approval → foreground permission → separately explained background permission (optional) → server creates journey + consent record → only then the foreground location service starts.
- **Active journey**: "Location Sharing Active" banner, persistent notification, map of the employee's last fix, accuracy, last GPS fix, last *confirmed* upload, what the safety team sees (freshness), expiry countdown, permission/GPS/offline warnings, always-visible "I Have Arrived Safely" and "Stop Sharing".
- **Location pipeline**: background task → filtered persisted queue → batched `record_locations` uploads with dedupe, out-of-order handling, pre-consent/post-expiry rejection, and server-side expiry on every call. Server-ended journeys stop collection on the device.
- **SOS**: press-and-hold (1.5 s) or screen-reader confirmation; saved on the phone first, sent with an idempotency key, retried with backoff + jitter and on reconnect; states "saved locally / sending / NOT YET DELIVERED / received by the server / not accepted"; location is fresh, stale-labelled, server last-known, or none, never invented. Admin push via outbox + `dispatch-notifications`.
- **Admin**: dashboard counters from real data, new-SOS highlight, active journeys list and live map with fresh/delayed/stale markers, journey detail (access logged), SOS list by status, SOS detail with acknowledge → responding → resolved → closed and notes (history + audit), staff list/search, invite, suspend / review / restore (ends live sharing), audit log viewer with filters and pagination, notification delivery problems.
- **Expiry and reminders**: `pg_cron` jobs plus inline checks; one reminder after ETA + employee-chosen delay.
- **Privacy**: retention job with per-organisation settings, append-only audit log, no coordinates in logs/notifications/audit, privacy screen in the app.
- **Tooling**: CI workflow (app, database, Edge Functions), bundle secret scan, operator CLI, dev seed with clearly labelled synthetic data (refuses non-local projects by default).

## Database and RLS (summary)

Migrations in `supabase/migrations`:

1. `..0100_core_schema` – tables, enums, constraints (state consistency, one active journey per employee, expiry window, ETA window, ended journeys have no live position), indexes.
2. `..0200_security` – default-privilege lockdown, helper functions, profile/journey/SOS/audit protection triggers, invitation handling, RLS enabled on every table with own-row and admin-of-organisation policies.
3. `..0300_journey_functions` – `start_journey`, `record_locations`, `end_journey`, `expire_journeys`, `queue_journey_reminders`.
4. `..0400_sos_functions` – `create_sos_alert`, `update_sos_status`.
5. `..0500_account_admin_retention` – profile/preferences/push-token RPCs, `admin_set_account_status`, logged detail RPCs, dashboard summary, `run_retention_cleanup`.
6. `..0550_notification_dispatch` – outbox claim/complete for the dispatcher (service role only).
7. `..0600_realtime_cron_seed` – realtime publication (`journeys`, `sos_alerts`), cron jobs, initial consent version.
8. `..0700_function_grants` – revoke everything, then grant exactly 17 functions to `authenticated`.

## Commands

| Purpose | Command |
|---|---|
| Install | `npm install` |
| Dev server (dev build) | `npm start` |
| Local Android build | `npm run android` (needs Android Studio) or `npx eas-cli@latest build --profile development --platform android` |
| Release build | `npx eas-cli@latest build --profile production --platform android` |
| Type check / lint | `npm run typecheck` / `npm run lint` |
| App tests | `npm test` |
| DB tests | `TEST_DATABASE_URL=postgres://... npm run test:db` |
| Edge Function tests | `npm run test:functions` (Deno) |
| Apply migrations | `npx supabase db push` |
| Deploy functions | `npx supabase functions deploy invite-user` and `... dispatch-notifications --no-verify-jwt` |

## Results

See [test-results.md](test-results.md): 148 app tests, 75 database tests, 4 Edge Function tests passed; type check and lint clean; Android JS bundle builds and contains no privileged keys. Android Gradle build blocked (no SDK access here); physical-device, real-Supabase, push, email and maps checks not run.

## Known limitations

- Continuous background tracking is not guaranteed: vendor battery managers, swipe-away, reboot and Doze can stop or delay updates. After reboot, sharing resumes only when the employee opens the app and taps Resume.
- "Sent" for push means accepted by Expo, not displayed on the device; delivery receipts are not polled yet.
- Client-reported sign-in/sign-out audit events can be skipped by a modified client; Supabase Auth's own server-side log is authoritative.
- Admin list views read through RLS and are not individually audit-logged; opening a journey or SOS detail is.
- No web dashboard yet (services in `src/services/admin` are UI-free and reusable).
- Supabase-generated TypeScript types are not used yet (hand-written in `src/types/db.ts`).
- Pending self-registered accounts cannot be approved from the app (sign-up is disabled; onboarding is by invitation).
- Retention defaults are placeholders pending approval.

## Remaining before a production pilot (release blockers in bold)

1. **Run the physical-device matrix (docs/testing-checklist.md) on at least four devices incl. one aggressive-battery vendor; fix failures.**
2. **Deploy to a staging Supabase project and verify RLS through PostgREST, Realtime scoping with two staff and two admins in two schools, cron expiry, and offline expiry.**
3. **End-to-end SOS: push to admins with app closed, latency, retry behaviour offline; decide the escalation procedure if no admin acknowledges within N minutes (not implemented).**
4. **Approve privacy notice, consent wording, retention values and operating procedures with the school's data-protection owner.**
5. Google Play background-location and foreground-service declarations (with disclosure video).
6. Produce a signed release build; restrict the Maps key to release SHA-1.
7. TalkBack accessibility pass and large-font check.
8. Optional: Expo push receipt polling, crash reporting (only with disclosure), web admin dashboard.
