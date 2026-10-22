# Android background location

## How it works

- `expo-location` `startLocationUpdatesAsync` with a **foreground service** (type `location`) and a persistent notification titled "Location sharing active". The service starts only after: the employee approved the journey, Android granted location permission, and the server created the journey.
- The task (`src/services/location/locationTask.ts`) is defined at module load in `index.ts`, so Android can deliver locations when the app is backgrounded or started headlessly.
- Each batch is filtered (nothing before consent or after expiry), queued in AsyncStorage (max 500 points, newest kept), and uploaded with `record_locations` in batches of 50.
- The server answers with the journey status. Anything other than `active` stops the service and discards the queue.
- Requested settings: `Accuracy.High`, every 30 s or 25 m, with 60 s deferred batching in the background (`src/constants/location.ts`). Android treats these as hints.

## Permission flow

1. Consent screen (in-app disclosure of purpose, audience, duration, how to stop).
2. `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` runtime prompt ("While using the app").
3. A separate in-app screen explaining "Allow all the time". On Android 11+ the request opens system settings. The employee may refuse and still share while the app is open; the app then warns that updates may pause.
4. Android 13+: `POST_NOTIFICATIONS` is requested from Notification settings / home card, not during the journey flow. If refused, the foreground-service notification may be hidden from the shade on some versions, but the service still runs and the in-app banner stays visible.

## Android versions

| Version | Behaviour to expect |
|---|---|
| 10 (API 29) | Background location is a separate grant; dialog offers "Allow all the time". |
| 11 (API 30) | Background request goes to Settings. "Only this time" grants are one-shot. |
| 12 (API 31) | Users can grant approximate only; accuracy will be ~km. Foreground services cannot start from background (ours starts from the UI). |
| 13 (API 33) | Notification permission is runtime. |
| 14 (API 34) | `FOREGROUND_SERVICE_LOCATION` and a declared service type are mandatory (added by the expo-location plugin). |
| 15+ (API 35+) | Same requirements; stricter background starts. Re-test each new Android release. |

## Known limitations (do not promise continuous tracking)

- **Swipe away / force stop:** many vendors kill the service. `killServiceOnDestroy: false` keeps it where the OS allows, but Android does not restart a terminated app for location updates.
- **Device reboot:** sharing does **not** resume automatically. The journey stays active on the server and appears as stale, then expires. When the employee opens the app, the home screen shows "Resume sharing for this journey" (explicit tap; never silent).
- **Vendor battery managers** (Xiaomi MIUI/HyperOS, Huawei EMUI, Samsung One UI "sleeping apps", OnePlus/Oppo/Vivo/Realme): may delay or stop the service. The troubleshooting screen links to battery optimisation settings. We do not bypass these controls. See https://dontkillmyapp.com.
- **Doze / battery saver:** updates are batched or delayed; the UI and admin dashboard show freshness (fresh ≤ 2 min, delayed ≤ 10 min, stale beyond).
- **GPS unavailable / indoors / underground:** no fixes are produced; nothing is fabricated.
- **Permission revoked mid-journey:** the active screen detects it within ~15 s and shows a red warning; the server sees no new points (stale).
- **Offline:** points are queued and uploaded later. They update the "latest" position only if newer than what the server has, so replayed history never appears as live. Points after expiry are rejected.
- **Expo Go:** cannot run this feature. Use a development build.

## Diagnosing on a device

```bash
adb logcat | grep -iE "ReactNativeJS|expo.modules.location|TaskService"
adb shell dumpsys activity services com.staffsafecommute.app   # is the location service running?
adb shell dumpsys deviceidle                                   # doze state
adb shell cmd appops get com.staffsafecommute.app              # location / background grants
```

The app logs structured JSON lines (`location_upload_failed`, `location_task_error`, etc.) without coordinates.
