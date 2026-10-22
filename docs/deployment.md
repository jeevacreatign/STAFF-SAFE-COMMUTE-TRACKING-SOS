# Deployment

## Environments

Use separate Supabase projects for development, staging and production. Never run `scripts/operator.mjs seed-dev` against staging or production.

## Release checklist

1. All checks green: `npm run test:all`, `npm run test:functions`.
2. `npx supabase db push` against the target project; confirm cron jobs (Dashboard → Integrations → Cron).
3. Deploy functions (`invite-user`, `dispatch-notifications --no-verify-jwt`) and confirm secrets are set.
4. Confirm Auth: sign-ups disabled, redirect URL allow-listed, email templates reviewed (invite / recovery text).
5. Build (profiles are in `eas.json`): `npx eas-cli@latest build --profile production --platform android`.
6. Scan the release bundle: `npx expo export --platform android --output-dir dist && node scripts/scan-bundle.js dist` (set `SCAN_FORBIDDEN_VALUES` to your service-role key and other secrets to prove they are absent).
7. Run the physical-device checklist in `docs/testing-checklist.md` on the release build.
8. Google Play Console:
   - **Location permissions declaration** for `ACCESS_BACKGROUND_LOCATION`, with a video showing the in-app disclosure (Consent screen + "Keep sharing when your screen is locked?" screen) before the system prompt.
   - **Foreground service declaration** for type `location`, describing the user-visible journey-sharing notification.
   - Data safety form: precise location (collected, shared with the school safety team, not sold, user can stop), personal info (name, email), app activity.
   - Privacy policy URL.
9. Privacy policy, consent wording (`src/constants/consent.ts` + migration seed), retention values and operating procedures approved by the school / data-protection owner (acceptance criterion 20).

`eas.json` (committed):

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "android": { "buildType": "apk" } },
    "preview": { "distribution": "internal", "android": { "buildType": "apk" } },
    "production": { "autoIncrement": true }
  }
}
```

Store `EXPO_PUBLIC_*` values and `GOOGLE_MAPS_ANDROID_API_KEY` as EAS environment variables for the matching environment (development, preview, production), via expo.dev → Project → Environment variables or `npx eas-cli@latest env:create`. Each build profile reads its `environment`. Never put the service-role key there.

## Changing the consent text

The server only accepts the active row in `public.consent_versions`. To change wording: add a migration that inserts a new version and flips `is_active`, then update `CONSENT_VERSION` and the text in `src/constants/consent.ts` in the same release. Older app builds will get `CONSENT_OUTDATED` and must update, so ship the app update first if needed and activate the new version after.

## Rollback

Migrations are forward-only. To roll back an app release, ship the previous build; the database stays compatible as long as no migration removed a column the old build uses.
