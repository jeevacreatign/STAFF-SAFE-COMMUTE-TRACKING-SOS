# Staff Safe Commute

Android-first React Native (Expo SDK 58) + Supabase app that lets school staff **voluntarily** share
their location with authorised safety administrators for one commute at a time, raise an SOS, and
confirm safe arrival. Consent is explicit per journey; sharing stops on request, on safe arrival,
or at expiry (enforced by the server, even if the phone is offline).

> Status: feature-complete for a pilot candidate, **not yet pilot-ready**. Automated checks pass;
> physical-device tests, a real Supabase deployment and an Android build have not been run yet.
> See [docs/test-results.md](docs/test-results.md).

This app alerts the school safety team only. It does **not** contact police, ambulance or other
emergency services, and it cannot guarantee continuous background tracking on every Android phone.

## Quick start

```bash
npm install
cp .env.example .env                 # fill in public values only
npm run typecheck && npm run lint && npm test
TEST_DATABASE_URL=postgres://postgres@localhost:5432/ssc_test npm run test:db
npx eas-cli@latest build --profile development --platform android   # or: npx expo run:android
npm start
```

Full instructions: [docs/setup.md](docs/setup.md).

## Docs

- [Architecture and plan](docs/architecture.md)
- [Setup](docs/setup.md) and [Deployment](docs/deployment.md)
- [Android background location](docs/android-background-location.md)
- [Privacy and retention](docs/privacy-and-retention.md)
- [Testing checklist (device matrix)](docs/testing-checklist.md) and [Test results](docs/test-results.md)
- [Troubleshooting](docs/troubleshooting.md)

## Security model in one paragraph

The app holds only the public anon key. Every table has RLS; signed-in users get read access
filtered by policies and **no direct write access to any table**. All writes go through Postgres
functions that derive the user and organisation from `auth.uid()`, check role and journey state,
and write audit entries. Only 17 functions are executable by signed-in users (tested). The
service-role key is used only inside two Edge Functions and the operator CLI.
