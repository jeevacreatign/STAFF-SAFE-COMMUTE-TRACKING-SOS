import * as Linking from 'expo-linking';
import type { Profile } from '../../types/db';
import { AppError, toAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { supabase } from '../supabase/client';
import { rpc, unwrap } from '../supabase/rpc';

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Same message for unknown email and wrong password.
    if (error.status === 400 || /invalid login/i.test(error.message)) {
      throw new AppError('VALIDATION', 'Email or password is incorrect.');
    }
    if (error.status === 429) throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Please wait and try again.');
    throw toAppError(error);
  }
  rpc('record_auth_event', { p_event: 'sign_in' }).catch((e) => logger.warn('auth_event_failed', { code: toAppError(e).code }));
}

export async function signOut(): Promise<void> {
  try {
    await rpc('record_auth_event', { p_event: 'sign_out' });
  } catch {
    // Signing out must never be blocked by the network.
  }
  await supabase.auth.signOut({ scope: 'local' });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const redirectTo = Linking.createURL('reset-password');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  // Do not reveal whether the email exists; only surface rate limiting and network errors.
  if (error && (error.status === 429 || error.name === 'AuthRetryableFetchError')) throw toAppError(error);
}

/** Exchange the code / tokens from a password-reset or invite deep link for a session. */
export async function sessionFromRecoveryUrl(url: string): Promise<boolean> {
  const parsed = Linking.parse(url);
  const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : undefined;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw toAppError(error);
    return true;
  }
  const fragment = url.includes('#') ? url.split('#')[1] : '';
  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw toAppError(error);
    return true;
  }
  return false;
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw toAppError(error);
}

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const result = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return unwrap(result) as Profile | null;
}

export async function updateMyName(fullName: string): Promise<Profile> {
  return rpc<Profile>('update_my_profile', { p_full_name: fullName });
}
