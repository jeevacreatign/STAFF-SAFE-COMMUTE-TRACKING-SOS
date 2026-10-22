import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

export interface LocationDiagnostics {
  foreground: Location.PermissionStatus;
  foregroundCanAskAgain: boolean;
  background: Location.PermissionStatus;
  backgroundCanAskAgain: boolean;
  servicesEnabled: boolean;
  gpsAvailable: boolean | null;
  networkProviderAvailable: boolean | null;
  androidVersion: number | null;
}

export async function getLocationDiagnostics(): Promise<LocationDiagnostics> {
  const [fg, bg, servicesEnabled, provider] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Location.hasServicesEnabledAsync().catch(() => false),
    Location.getProviderStatusAsync().catch(() => null),
  ]);
  return {
    foreground: fg.status,
    foregroundCanAskAgain: fg.canAskAgain,
    background: bg.status,
    backgroundCanAskAgain: bg.canAskAgain,
    servicesEnabled,
    gpsAvailable: provider?.gpsAvailable ?? null,
    networkProviderAvailable: provider?.networkAvailable ?? null,
    androidVersion: Platform.OS === 'android' ? Number(Platform.Version) : null,
  };
}

/** Ask for "while using the app" location. Only called after the employee approved a journey. */
export async function requestForegroundLocation(): Promise<Location.PermissionStatus> {
  const res = await Location.requestForegroundPermissionsAsync();
  return res.status;
}

/**
 * Ask for "Allow all the time". On Android 11+ this opens system settings, so the app explains
 * why first (BackgroundPermissionScreen). The journey still works in the foreground if refused.
 */
export async function requestBackgroundLocation(): Promise<Location.PermissionStatus> {
  const res = await Location.requestBackgroundPermissionsAsync();
  return res.status;
}

export function openAppSettings() {
  return Linking.openSettings();
}

export function openLocationSettings() {
  if (Platform.OS === 'android') {
    return Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings());
  }
  return Linking.openSettings();
}

export function openBatteryOptimisationSettings() {
  if (Platform.OS === 'android') {
    return Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings());
  }
  return Linking.openSettings();
}
