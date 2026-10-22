import Constants from 'expo-constants';

// EXPO_PUBLIC_ values are inlined at build time and are public by definition.
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  easProjectId:
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    '',
  mapsConfigured: Boolean((Constants.expoConfig?.extra as { mapsConfigured?: boolean } | undefined)?.mapsConfigured),
  // Demo mode only labels the UI; it never substitutes fake GPS. It is ignored in release builds.
  demoMode: __DEV__ && process.env.EXPO_PUBLIC_DEMO_MODE === 'true',
};

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}
