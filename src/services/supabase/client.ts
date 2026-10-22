import 'react-native-url-polyfill/auto';
import { createClient, processLock, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { config } from '../../constants/config';
import { secureStorage } from '../storage/secureStorage';

// Public anon key only. Privileged server keys must never be referenced from the app.
export const supabase: SupabaseClient = createClient(
  config.supabaseUrl || 'https://not-configured.invalid',
  config.supabaseAnonKey || 'not-configured',
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
    realtime: { params: { eventsPerSecond: 5 } },
  },
);

// Refresh tokens only while in the foreground (recommended for React Native).
let registered = false;
export function registerAuthAppStateListener() {
  if (registered) return;
  registered = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
