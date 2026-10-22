import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { missingConfig } from '../constants/config';
import { fetchMyProfile, sessionFromRecoveryUrl, signOut as authSignOut } from '../services/auth/authService';
import { endJourney } from '../services/journeys/journeyService';
import { clearLocalJourney, getLocalJourney } from '../services/location/controller';
import { unregisterPush } from '../services/notifications/notificationService';
import { supabase } from '../services/supabase/client';
import type { Profile } from '../types/db';
import { toAppError } from '../utils/errors';
import { logger } from '../utils/logger';

export type AuthStatus =
  | 'loading'
  | 'needs_config'
  | 'signed_out'
  | 'recovery'
  | 'inactive'
  | 'profile_error'
  | 'employee'
  | 'admin';

interface AuthValue {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  finishRecovery: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const configMissing = missingConfig().length > 0;
  const [loading, setLoading] = useState(!configMissing);
  const [recovery, setRecovery] = useState(false);
  const lastUserId = useRef<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    try {
      // Role comes from the database, never from client state or JWT claims we could forge.
      setProfile(await fetchMyProfile(s.user.id));
      setProfileError(null);
    } catch (e) {
      setProfileError(toAppError(e).message);
    }
  }, []);

  useEffect(() => {
    if (configMissing) return;
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      lastUserId.current = data.session?.user.id ?? null;
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        setRecovery(false);
        setProfile(null);
      }
      setSession(s);
      const userChanged = (s?.user.id ?? null) !== lastUserId.current;
      lastUserId.current = s?.user.id ?? null;
      // Re-verify role on sign-in, user change and token refresh (role may have changed).
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || userChanged) {
        // Defer: supabase-js advises against awaiting other calls inside this callback.
        setTimeout(() => void loadProfile(s), 0);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [configMissing, loadProfile]);

  // Password reset / invitation deep links.
  const url = Linking.useLinkingURL();
  useEffect(() => {
    if (!url || !url.includes('reset-password')) return;
    sessionFromRecoveryUrl(url)
      .then((ok) => ok && setRecovery(true))
      .catch((e) => logger.warn('recovery_link_failed', { code: toAppError(e).code }));
  }, [url]);

  const signOut = useCallback(async () => {
    // Signing out ends any live sharing first (the device could not upload without a session).
    const local = await getLocalJourney();
    if (local && local.status === 'active') {
      try {
        await endJourney(local.id, 'stop');
      } catch (e) {
        logger.warn('signout_end_journey_failed', { code: toAppError(e).code });
      }
    }
    await unregisterPush();
    await clearLocalJourney();
    await authSignOut();
    setRecovery(false);
  }, []);

  const status: AuthStatus = useMemo(() => {
    if (configMissing) return 'needs_config';
    if (loading) return 'loading';
    if (!session) return 'signed_out';
    if (recovery) return 'recovery';
    if (profileError && !profile) return 'profile_error';
    if (!profile) return 'loading';
    if (profile.account_status !== 'active') return 'inactive';
    return profile.role === 'safety_admin' ? 'admin' : 'employee';
  }, [configMissing, loading, session, recovery, profile, profileError]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      session,
      profile,
      profileError,
      refreshProfile: () => loadProfile(session),
      signOut,
      finishRecovery: () => setRecovery(false),
    }),
    [status, session, profile, profileError, loadProfile, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
