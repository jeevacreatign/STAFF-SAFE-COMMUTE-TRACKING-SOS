# Test results

Run on 2026-10-22 in a Linux cloud container (Node 22, PostgreSQL 16.15, Deno 2.9). No Android
device, emulator, Android SDK or real Supabase project was available.

## Passed

| Check | Result |
|---|---|
| `npm run typecheck` (TypeScript 6, strict, noUnused*) | Pass, 0 errors |
| `npm run lint` (eslint-config-expo, React Compiler rules) | Pass, 0 errors / 0 warnings (2 rules turned off with reasons in `eslint.config.js`) |
| `npm test` (Jest + jest-expo + RNTL 14) | **148 passed**, 0 failed, 7 suites |
| `npm run test:db` against PostgreSQL 16 + Supabase stub | **75 passed**, 0 failed, 4 suites |
| Edge Functions `deno test` | 4 passed |
| Edge Functions `deno check` | Both functions type-check |
| `npx expo export --platform android` | JS bundle builds (2.4 MB) |
| `scripts/scan-bundle.js` on that bundle | No service-role / secret patterns found |
| `npx expo prebuild --platform android` | Manifest generated; permissions as documented (background + foreground-service location, notifications; camera/mic/contacts/storage blocked) |

Security behaviours verified by the DB suite include: anonymous access denied on every table; Employee A cannot read Employee B's journey/location in the same organisation; admins only see their organisations; employees cannot change role (direct update denied, and blocked by trigger even if a grant were added); no client INSERT/UPDATE/DELETE privileges on any table; only an allowlist of 17 functions is executable by signed-in users and none by anon; stopped / arrived / expired journeys reject uploads; expiry enforced inline even before the cron job runs; finished journeys can never return to active; SOS is idempotent per request id; only the organisation's admins can acknowledge/resolve; ended journeys expose no coordinates to admins; realtime publication contains only `journeys` and `sos_alerts`; audit log is append-only.

## Bugs found by the tests and fixed

1. **PUBLIC could execute every database function** (PostgreSQL's default `EXECUTE` grant to PUBLIC is not removed by a schema-scoped `ALTER DEFAULT PRIVILEGES`). Fixed with a global revoke and an explicit allowlist migration; a test now asserts the exact allowlist.
2. **Upload queue deadlock**: when the server reported a journey had ended, the uploader called the stop handler while holding its lock, and the handler waited on the same lock. Location handling would have hung after any server-side expiry. Fixed and covered by tests.
3. Defence-in-depth triggers called a helper the client role could not execute, producing a confusing error; triggers now raise directly.
4. Invitations: if the Auth server writes `app_metadata` after the user row is inserted, the profile would have stayed "pending". A second trigger now applies invitation metadata on update (once, and only to a fresh pending profile).

## Not run / blocked

| Item | Status | Why / what is needed |
|---|---|---|
| Android Gradle build (debug/release APK) | **Blocked** | `dl.google.com` (Android SDK) is not reachable from this environment. Build with `eas build` or Android Studio. |
| All physical-device scenarios (D01–D27 in testing-checklist.md) | **Not run** | Needs physical Android phones. |
| Real Supabase deployment (Auth, RLS via PostgREST, Realtime, pg_cron, Edge Functions) | **Not run** | Needs your Supabase project and keys. The SQL ran on vanilla PostgreSQL with a stub of Supabase's `auth` schema, not on Supabase itself. |
| Realtime authorisation end-to-end | **Not run** | Relies on Supabase Realtime applying RLS to `postgres_changes`; verify with two accounts on a real project. |
| Push delivery (Expo/FCM) | **Not run** | Needs EAS project + FCM credentials and devices. |
| Invite and password-reset emails, deep links | **Not run** | Needs Supabase Auth email + a device build. |
| Google Maps rendering | **Not run** | Needs a restricted Maps key and a device build. |
| Screen-reader pass (TalkBack) | **Not run** | Needs a device. |
