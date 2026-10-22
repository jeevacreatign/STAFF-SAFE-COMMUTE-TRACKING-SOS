# Staff Safe Commute: Implementation Plan and Architecture

Status: Phase 1 output (plan). Sections marked "Verification" are updated as phases complete.

## 1. Starting point

The workspace was empty (no existing repository), so nothing was overwritten. The project was
scaffolded with `create-expo-app` (blank TypeScript template), Expo SDK 58, React Native 0.88,
React 19.3, TypeScript 6.0. Native library versions were pinned with `expo install` against SDK 58's
bundled compatibility map.

## 2. Stack decisions

| Concern | Choice | Why |
|---|---|---|
| App runtime | Expo SDK 58 **development build** (`expo-dev-client`), Continuous Native Generation | Background location and foreground services are not available in Expo Go on Android. |
| Navigation | React Navigation 7 (native-stack + bottom-tabs) | Required by the spec. Role-gated navigators. |
| Backend | Supabase Auth, Postgres, Realtime, Edge Functions | Required by the spec. |
| Trusted writes | **Postgres `SECURITY DEFINER` RPC functions** called with the user's JWT | Transactional, run inside the DB with row locks, enforce state machine + authz in one place, testable with plain Postgres. Tables are not directly writable by clients. |
| Privileged ops needing the service role | Edge Functions (`invite-user`, `dispatch-notifications`) | Only these need the service-role key; it stays in Supabase function secrets. |
| Expiry | `expire_journeys()` SQL run by `pg_cron` every minute **and** checked inline in every location upload | Server rejects uploads after `expires_at` even if cron is late or the phone is offline. |
| Location | `expo-location` + `expo-task-manager` with an Android foreground service (persistent notification) | Platform-supported background API. |
| Map | `react-native-maps` (Google Maps SDK on Android) | Needs a Google Maps Android API key. |
| Push | `expo-notifications` + Expo Push Service (FCM underneath) | Server-side dispatch from an Edge Function. |
| Session storage | `expo-secure-store` (chunked) for Supabase auth tokens | Tokens encrypted at rest via Android Keystore. |
| Validation | Zod 4 on the client; the same rules are re-enforced in SQL | Client validation is UX only. |
| Tests | Jest (`jest-expo`) + React Native Testing Library; DB security/integration tests run against a real Postgres 16 with the migrations applied | RLS is verified against an actual database, not mocks. |

## 3. Data model (summary; full detail in `supabase/migrations`)

- `organisations` — school / site.
- `profiles` — 1:1 with `auth.users`; `role` (`employee` | `safety_admin`), `organisation_id`, `account_status` (`invited` | `active` | `suspended` | `pending_review`). Role, org and status are writable only by service role or authorised admin RPCs (trigger-enforced).
- `admin_assignments` — which organisations a safety admin may see (an admin can cover more than one school).
- `journeys` — state machine `active → safely_arrived | stopped | expired | cancelled` (terminal states are final). Carries consent timestamp + version, `expires_at`, and the **latest** location snapshot (`last_lat`, `last_lng`, `last_accuracy_m`, `last_observed_at`) so the admin map reads one row per journey.
- `journey_locations` — short-lived breadcrumb history (default retention 7 days), unique on `(journey_id, observed_at)` for idempotent replays.
- `consent_records` — per-journey consent: version, purpose, consented_at, ended_at.
- `sos_alerts` — `new → acknowledged → responding → resolved → closed`, with location snapshot + freshness, `client_request_id` unique per employee (idempotency).
- `sos_alert_events` — response history (who changed what, when, notes).
- `notification_records` — outbox for push delivery with `pending | sent | failed | skipped` status.
- `push_tokens` — per-device Expo push tokens.
- `audit_logs` — append-only; no UPDATE/DELETE for anyone except retention job; coordinates never logged.
- `retention_settings` — per-organisation retention windows.

## 4. Authorization model

- RLS on every table. Clients get `SELECT` only on what policies allow; **no client INSERT/UPDATE/DELETE grants** on journeys, locations, SOS, consent, audit tables. All writes go through RPCs that check `auth.uid()`, role, organisation and state.
- Helper functions: `current_profile()`, `is_safety_admin_for(org_id)`.
- Employees: own profile, own journeys/locations/SOS/consent only.
- Safety admins: rows whose `organisation_id` is in their `admin_assignments`. **Live location** (`journeys.last_*`, `journey_locations`) is only visible for journeys with `status = 'active'`; ended journeys expose metadata only, so history is never shown as live tracking.
- No RPC lets an admin create or resume a journey for someone else.
- Realtime: `postgres_changes` on `journeys` and `sos_alerts` only; Supabase Realtime applies the subscriber's RLS to each change, so a subscriber only receives rows it can `SELECT`.

## 5. Location lifecycle

1. Employee taps Start Safe Journey → disclosure/consent screen (versioned text) → setup form (label, destination, ETA, expiry).
2. Foreground permission requested; background permission explained on a separate screen and requested only if the employee opts in (journey still works foreground-only with an honest warning).
3. `start_journey` RPC creates journey + consent record atomically. **Only after it succeeds** does the app call `startLocationUpdatesAsync` with a foreground service notification.
4. Background task (defined at module top level) receives location batches → writes them to a persisted queue → uploader calls `record_locations` RPC in batches. Server dedupes by `observed_at`, ignores out-of-order points for the "latest" snapshot, rejects anything when journey is not `active` or `now() >= expires_at`, and rejects points observed before consent.
5. When the server rejects with `JOURNEY_NOT_ACTIVE`, the client stops the task and clears the queue for that journey.
6. Stop / Safe arrival / Expiry → RPC transitions state, sets `ended_at` + `end_reason`, closes the consent record, writes audit + notification outbox. Client stops the task locally first (stopping never waits on the network).
7. Freshness: `fresh` ≤ 2 min, `delayed` ≤ 10 min, `stale` older (configurable constants). Shown everywhere a location is shown, with the absolute timestamp.

Default interval: 30 s / 25 m, `Accuracy.Balanced` when moving. Configurable in `src/constants/location.ts`.

## 6. SOS lifecycle

- One SOS button on the active journey screen; press-and-hold (1.5 s, accessible alternative: tap + confirm dialog) to prevent accidental activation.
- Client creates a `client_request_id` (UUID) and saves the alert locally (`saved_locally`) → calls `create_sos_alert` RPC (`submitted`) → RPC returns the alert row (`confirmed`). Retries reuse the same id, so the server never creates duplicates.
- Location attached: latest fix with its timestamp + accuracy + freshness label; `null` when none exists. Never fabricated.
- DB trigger writes `notification_records` rows for every admin of the org; `dispatch-notifications` Edge Function sends them via Expo Push and records delivery status. Push failure does not affect the alert itself.
- The app never claims to contact police or ambulance services.

## 7. Required credentials (none are in the repo)

| Name | Where it lives | Public? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env` (app) | Public |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` (or publishable key) | `.env` (app) | Public, RLS-protected |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | `.env` (app) — needed for Expo push tokens | Public |
| `GOOGLE_MAPS_ANDROID_API_KEY` | EAS secret / `.env` at build time, injected by `app.config.ts`; restrict by package name + SHA-1 | Embedded in APK (restricted) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge Function secrets only (auto-provided) | **Secret** |
| `EXPO_ACCESS_TOKEN` (optional, enhanced push security) | Supabase function secrets | **Secret** |
| `CRON_SECRET` | Supabase function secrets + pg_cron job header (for `dispatch-notifications`) | **Secret** |
| FCM V1 service account JSON | Uploaded to EAS credentials (not repo) | **Secret** |
| Android upload keystore | EAS credentials | **Secret** |

## 8. Android permissions

| Permission | Why | Notes |
|---|---|---|
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Journey location while the app is in use | Requested only after consent. |
| `ACCESS_BACKGROUND_LOCATION` | Continue sharing while screen locked / app minimised | Android 11+ sends the user to Settings ("Allow all the time"). Google Play requires a declaration + review video. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` | Persistent "Location sharing active" notification service | Required on Android 14+. Play Console declaration required. |
| `POST_NOTIFICATIONS` | Foreground-service notification visibility and alerts (Android 13+) | Runtime permission; denial handled. |
| `INTERNET`, `ACCESS_NETWORK_STATE` | API + connectivity indicator | Normal permissions. |

Not requested: contacts, camera, microphone, SMS, phone, `RECEIVE_BOOT_COMPLETED` for tracking.

## 9. Platform limitations identified up front

- Background location **does not survive** the user swiping the app away on many vendors, and Android does not restart a terminated app for location updates. After reboot, tracking does not resume until the employee reopens the app; the journey stays active server-side and is shown as stale, then expires.
- OEM battery managers (Xiaomi, Huawei, Samsung, OnePlus, Oppo/Vivo) may throttle or kill the service. The troubleshooting screen explains how to exempt the app; we do not bypass these controls.
- Doze / battery saver can delay updates; deferred updates batch points. The UI shows freshness rather than pretending updates are live.
- Realtime and push are not guaranteed when offline or restricted.
- Google Play policy review for background location and foreground service type is a release gate outside the code.

## 10. Build phases

1. Plan (this doc). 2. Foundation (theme, components, navigation, auth). 3. Backend (migrations, RLS, RPCs, cron, Edge Functions) with DB security tests. 4. Staff flows. 5. Admin flows. 6. Integration hardening. 7. Tests, docs, device checklist.
