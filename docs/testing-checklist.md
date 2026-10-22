# Testing checklist

Automated tests use mocks for native modules and a plain PostgreSQL database for backend rules.
They do **not** prove operating-system behaviour. Every row below must be run on physical
Android devices and recorded honestly. A simulator or emulator pass never counts as a device pass.

## Automated suites

| Suite | Command | Covers |
|---|---|---|
| Type check | `npm run typecheck` | Whole app + tests |
| Lint | `npm run lint` | Expo ESLint config incl. React Compiler rules |
| App unit/component | `npm test` | Validation, freshness, backoff, error mapping, location queue/uploader, journey service lifecycle, SOS outbox/idempotency, SOS hold button, consent flow, static secret scan |
| Database security + integration | `TEST_DATABASE_URL=... npm run test:db` | RLS for anon / two employees / two admins in two orgs, privilege allowlist, journey state machine, expiry, uploads, SOS workflow, retention, outbox |
| Edge Function units | `npm run test:functions` | Push message building and delivery outcome logic; type-checks both functions |
| Bundle scan | `npx expo export --platform android --output-dir dist && node scripts/scan-bundle.js dist` | No privileged credentials in the shipped JS |

## Manual functional checks (any device / emulator with a dev build)

- Invitation email → set password → sign in as staff. Admin invite → staff appears in Staff list.
- Password reset link opens the app and lets you set a new password.
- Staff cannot see admin tabs; admin sees admin tabs only (role from server).
- Suspend a staff member during a journey → their sharing ends, they see "Account not active".
- Sign out during a journey → journey shows Stopped on the admin side.
- Admin acknowledges → responding → resolves → closes an SOS; staff sees status update in real time.
- Audit log shows each of the above.

## Physical device matrix

Record for each run: device model, Android version, permission settings (location: while-in-use / all-the-time / denied; notifications), battery configuration (saver, optimisation, vendor mode), network state, expected result, actual result, **Pass / Fail / Blocked**, and logs or screenshots (`adb logcat` filtered as in android-background-location.md).

Aim for at least: one Pixel (stock Android 14/15), one Samsung (One UI), one Xiaomi/Redmi or Oppo/Vivo/Realme (aggressive battery management), and one older device (Android 10–11).

| ID | Scenario | Expected | Device | Android | Permissions | Battery | Network | Actual | Result | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| D01 | App open in the foreground | Updates every ~30 s; banner + notification visible; admin map fresh (green). | | | | | | | |
| D02 | App minimised | Updates continue (bg permission granted); admin freshness stays fresh/delayed. | | | | | | | |
| D03 | Screen locked | Updates continue, possibly batched every ~60 s. | | | | | | | |
| D04 | Screen locked 30+ min | Updates continue or degrade to delayed; never shown as live when stale. | | | | | | | |
| D05 | Process killed by OS (adb shell am kill) | Service may restart or stop depending on vendor; admin sees stale if stopped. Record which. | | | | | | | |
| D06 | Battery saver on | Updates may be delayed; freshness reflects it. | | | | | | | |
| D07 | Battery optimisation on (default) | Record vendor behaviour over 30 min locked. | | | | | | | |
| D08 | Location permission denied at prompt | No journey created; 'Location permission needed' screen; nothing on admin dashboard. | | | | | | | |
| D09 | Background permission denied | Journey starts foreground-only with warning; updates pause when backgrounded. | | | | | | | |
| D10 | Location permission revoked during journey | Red warning within ~15 s; no new points; admin sees stale. | | | | | | | |
| D11 | GPS / location services off | 'Location services are off' warning; no fabricated points. | | | | | | | |
| D12 | Mobile data off (Wi-Fi off too) | Offline banner; points queued; 'Last confirmed upload' does not advance. | | | | | | | |
| D13 | Wi-Fi off, mobile data on | Uploads continue over mobile data. | | | | | | | |
| D14 | Airplane mode | Offline banner; queue grows; no success claimed. | | | | | | | |
| D15 | Network restored | Queue flushes; admin latest position updates only to the newest point. | | | | | | | |
| D16 | Low battery (<15%) / OS power saving | Record behaviour. | | | | | | | |
| D17 | Device reboot during journey | Sharing does not resume by itself; home shows 'Resume sharing'; admin sees stale until resume or expiry. | | | | | | | |
| D18 | Journey expiry while offline | Server marks expired at expiry; on reconnect the app stops and shows 'expired'; queued points rejected. | | | | | | | |
| D19 | SOS with fresh location | Confirmed state with server time; admin gets push + red alert with fresh location. | | | | | | | |
| D20 | SOS with only stale location | Alert labelled stale with original timestamp. | | | | | | | |
| D21 | SOS with no location (permission off / no fix) | Alert sent without coordinates (or server last-known, labelled). | | | | | | | |
| D22 | Repeated SOS taps / retries offline | 'NOT YET DELIVERED' shown; on reconnect exactly one alert per hold. | | | | | | | |
| D23 | Stop sharing while an upload is pending | Service stops immediately; pending points discarded; server status Stopped. | | | | | | | |
| D24 | Safe arrival while offline | Stops locally; 'Waiting for server confirmation'; confirmed on reconnect; admin sees Safely arrived. | | | | | | | |
| D25 | Notification permission denied (Android 13+) | App works; admin dashboard warns that SOS push is off. | | | | | | | |
| D26 | Admin receives SOS push with app closed | Push arrives (record latency); tap opens SOS detail. | | | | | | | |
| D27 | App update during an active journey | Record whether service survives; journey state reconciles on launch. | | | | | | | |

Status at hand-over: **all rows Not run** (no physical device was available to the developer environment).
