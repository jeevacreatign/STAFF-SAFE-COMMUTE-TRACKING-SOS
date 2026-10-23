# Setup

This guide takes you from an empty Supabase project to a development build on an Android phone.
Nothing here contains real credentials; you create your own.

## 1. Prerequisites

- Node.js 20+ and npm.
- A Supabase project (Free tier is fine for development). The Supabase CLI (`npx supabase`).
- An Expo account and EAS CLI (`npx eas-cli@latest`) for builds and push credentials.
- A Google Cloud project with **Maps SDK for Android** enabled.
- A Firebase project (for FCM push on Android).
- For local Android builds: Android Studio (SDK 35+), JDK 17. Not needed if you build with EAS.
- For database tests: PostgreSQL 15+ (any local install or Docker).

## 2. Install

```bash
npm install
cp .env.example .env
```

## 3. Create and configure Supabase

1. Create a project at https://supabase.com/dashboard. Note the project ref, URL and the **anon/publishable** key (Project Settings → API).
2. Authentication → Providers → Email: enable email sign-in, **disable "Allow new users to sign up"** (onboarding is invitation-only), keep "Confirm email" on.
3. Authentication → URL configuration: add `staffsafecommute://reset-password` to the redirect allow-list.
4. Authentication → Policies / Rate limits: keep defaults or tighten (see `supabase/config.toml` for the values used locally).
5. Password policy: minimum 10 characters, lower+upper+digits (matches the app's validation).

## 4. Apply database migrations

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies supabase/migrations in order
```

Migrations enable `pg_cron` and schedule `expire_journeys()` (every minute), `queue_journey_reminders()` (every 5 min) and `run_retention_cleanup()` (daily). Check in Dashboard → Integrations → Cron that the three jobs exist.

## 5. Deploy Edge Functions

```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill CRON_SECRET (random 32+ chars), optional EXPO_ACCESS_TOKEN
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy invite-user
npx supabase functions deploy dispatch-notifications --no-verify-jwt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically. The service-role key never leaves Supabase.

Then schedule the push dispatcher (SQL editor; uses `pg_net` and Vault):

```sql
create extension if not exists pg_net;
select vault.create_secret('<same CRON_SECRET value>', 'cron_secret');
select cron.schedule('dispatch-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/dispatch-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
```

The app also calls `dispatch-notifications` right after an SOS is confirmed, so SOS pushes do not wait for the next minute.

## 6. Realtime

Migrations add `journeys` and `sos_alerts` to the `supabase_realtime` publication. Nothing else is needed: Supabase Realtime checks each subscriber's RLS policies before delivering a change. Raw location breadcrumbs (`journey_locations`) are deliberately **not** published.

## 7. Create the first organisation and administrator

Administrator accounts are created by the platform operator, never from the app:

```bash
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service role key>   # in your shell only; never in .env for the app
node scripts/operator.mjs create-org --name "Example School"
node scripts/operator.mjs create-admin --org <org-uuid> --email safety.lead@school.example --name "Safety Lead"
```

The admin receives a password-setup email. Staff are then invited from the app (Staff → Invite staff member).
For operator-managed staff creation from a trusted terminal, set `INVITE_REDIRECT_URL` to
`staffsafecommute://reset-password` and run:

```bash
export INVITE_REDIRECT_URL=staffsafecommute://reset-password
node scripts/operator.mjs create-staff --org <org-uuid> --email staff@school.example --name "Staff Member" --employee-ref STAFF001
```

This creates an employee account for the specified organisation and sends a password-setup email.
Set `SUPABASE_ANON_KEY` to the project's publishable/anon key as well as the service-role key so
the script can request the setup email. The email must be new to this Supabase project. Never put
the service-role/secret key in app `.env`, source control, or chat; only provide it to the operator
script through the trusted shell environment.

To create a staff account and set its password directly in one terminal operation, enter the
password through a secure PowerShell prompt. This confirms the email for immediate sign-in and does
not send a password-setup email:

```powershell
$nodeExe = 'C:\Program Files\nodejs\node.exe'
$staffEmail = Read-Host 'New staff email (must be unused in this Supabase project)'
$staffName = Read-Host 'Staff full name'
$staffId = Read-Host 'Staff ID (optional; press Enter to skip)'
$securePassword = Read-Host 'Staff password (10+ chars, upper/lowercase and number)' -AsSecureString
$confirmPassword = Read-Host 'Confirm staff password' -AsSecureString
$newPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
$confirmation = [System.Net.NetworkCredential]::new('', $confirmPassword).Password
if ($newPassword -cne $confirmation) { throw 'Passwords do not match.' }
$env:OPERATOR_NEW_PASSWORD = $newPassword
try {
  if ($staffId) {
    & $nodeExe .\scripts\operator.mjs create-staff --org '<org-uuid>' --email $staffEmail --name $staffName --employee-ref $staffId
  } else {
    & $nodeExe .\scripts\operator.mjs create-staff --org '<org-uuid>' --email $staffEmail --name $staffName
  }
  if ($LASTEXITCODE -ne 0) { throw 'Staff account creation failed.' }
}
finally {
  Remove-Item Env:OPERATOR_NEW_PASSWORD -ErrorAction SilentlyContinue
  Remove-Variable securePassword, confirmPassword, newPassword, confirmation -ErrorAction SilentlyContinue
}
```

Replace `<org-uuid>` with the staff member's organisation ID. This requires the operator's
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to be set in the same PowerShell window. The chosen
email must not already exist in Supabase Auth. Never paste the password or secret key into chat.

If an existing user's password-setup link does not open the app's new-password screen, request a
fresh recovery email from the operator terminal. This command uses the app's supported token-based
link flow and does not create another account:

```bash
export INVITE_REDIRECT_URL=staffsafecommute://reset-password
node scripts/operator.mjs send-password-reset --email safety.lead@school.example
```

Open the newest email on the phone with the app installed. Do not reuse older recovery links.

For an operator-managed password change without email, use the trusted terminal only. Enter the
password through a secure prompt; do not put it in the command or chat:

```powershell
$securePassword = Read-Host 'New password (10+ chars, upper/lowercase and number)' -AsSecureString
$confirmPassword = Read-Host 'Confirm new password' -AsSecureString
$newPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
$confirmation = [System.Net.NetworkCredential]::new('', $confirmPassword).Password
if ($newPassword -cne $confirmation) { throw 'Passwords do not match.' }
$env:OPERATOR_NEW_PASSWORD = $newPassword
try {
  & $nodeExe .\scripts\operator.mjs set-password --email 'safety.lead@school.example'
  if ($LASTEXITCODE -ne 0) { throw 'Password update failed.' }
}
finally {
  Remove-Item Env:OPERATOR_NEW_PASSWORD -ErrorAction SilentlyContinue
  Remove-Variable securePassword, confirmPassword, newPassword, confirmation -ErrorAction SilentlyContinue
}
```

This changes only the matched Supabase Auth user's password; it does not modify their role or
organisation. Use this only for an account you are authorized to administer, and never paste the
password or service-role key into chat or source files.

For a **development** project only, `node scripts/operator.mjs seed-dev` creates a clearly labelled synthetic organisation with one admin and two staff accounts (refuses non-local URLs unless `--allow-remote-dev`).

## 8. Maps

1. Google Cloud Console → enable **Maps SDK for Android**.
2. Create an API key restricted to **Android apps**, package `com.staffsafecommute.app`, and your signing certificate SHA-1 (debug, upload and Play app-signing certificates).
3. Put it in `.env` as `EXPO_PUBLIC_MAPS_API_KEY` (or as the EAS secret `GOOGLE_MAPS_ANDROID_API_KEY`). It is embedded in the APK by design; the restriction is what protects it.

Without a key the app still works and shows coordinates with an "Open in maps" button instead of a map.

## 9. Push notifications

1. `npx eas-cli@latest init` → copy the project id into `EXPO_PUBLIC_EAS_PROJECT_ID`.
2. Firebase console → add an Android app with package `com.staffsafecommute.app`; create a service account key for FCM V1.
3. `npx eas-cli@latest credentials` → Android → upload the FCM V1 service account JSON. (Keep the JSON out of git.)
4. Optional: enable "Enhanced push security" in Expo and set `EXPO_ACCESS_TOKEN` as a Supabase function secret.

## 10. Fill `.env`

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
EXPO_PUBLIC_EAS_PROJECT_ID=<eas project id>
EXPO_PUBLIC_MAPS_API_KEY=<restricted Android maps key>
```

## 11. Build and run a development build

Background location and foreground services do **not** work in Expo Go. Use a development build:

```bash
# Cloud build (no Android SDK needed)
npx eas-cli@latest build --profile development --platform android
# or local build with Android Studio installed
npx expo run:android
# then
npm start
```

## 12. Run the checks

```bash
npm run typecheck
npm run lint
npm test                                   # app unit + component tests (mocks native modules)
TEST_DATABASE_URL=postgres://postgres@localhost:5432/ssc_test npm run test:db   # drops/recreates that database
npm run test:functions                     # needs Deno
```

`test:db` applies `tests/db/supabase-stub.sql` (a minimal stand-in for Supabase's `auth` schema and roles) and all migrations to a plain PostgreSQL database, then runs the RLS / authorisation / lifecycle tests. Use a throwaway database.
