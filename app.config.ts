import type { ConfigContext, ExpoConfig } from 'expo/config';

// Build-time configuration. Only public values belong here: anything in this file or in an
// EXPO_PUBLIC_ variable ends up inside the APK. The Google Maps key is embedded by design and
// must be restricted to this package name + signing certificate in Google Cloud Console.
const googleMapsApiKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? process.env.EXPO_PUBLIC_MAPS_API_KEY ?? '';
const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Staff Safe Commute',
  slug: 'staff-safe-commute',
  scheme: 'staffsafecommute',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.staffsafecommute.app',
  },
  android: {
    package: 'com.staffsafecommute.app',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // ACCESS_FINE/COARSE/BACKGROUND_LOCATION and FOREGROUND_SERVICE(_LOCATION) are added by the
    // expo-location plugin below. POST_NOTIFICATIONS is added by expo-notifications.
    permissions: ['android.permission.ACCESS_NETWORK_STATE'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.CAMERA',
      'android.permission.READ_CONTACTS',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  plugins: [
    'expo-secure-store',
    [
      'expo-splash-screen',
      { backgroundColor: '#F7F9FC', image: './assets/splash-icon.png', imageWidth: 160 },
    ],
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: false,
        locationWhenInUsePermission:
          'Staff Safe Commute uses your location only during a journey you start and approve, so the school safety team can help you.',
        locationAlwaysAndWhenInUsePermission:
          'Allowing location all the time lets your approved journey keep sharing while your screen is locked. It stops when the journey ends.',
      },
    ],
    [
      'expo-notifications',
      { color: '#1B2A4A', defaultChannel: 'journey-updates' },
    ],
    ['react-native-maps', { androidGoogleMapsApiKey: googleMapsApiKey }],
  ],
  extra: {
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    mapsConfigured: googleMapsApiKey.length > 0,
  },
});
