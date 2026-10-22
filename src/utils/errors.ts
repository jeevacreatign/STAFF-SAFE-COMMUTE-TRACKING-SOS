// Central mapping from backend error codes to safe, user-facing messages.
// Database functions raise stable codes in the message field (see public.app_error).

export type AppErrorCode =
  | 'NOT_AUTHENTICATED' | 'ACCOUNT_INACTIVE' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION'
  | 'CONSENT_REQUIRED' | 'CONSENT_OUTDATED' | 'JOURNEY_ALREADY_ACTIVE' | 'JOURNEY_NOT_ACTIVE'
  | 'INVALID_TRANSITION' | 'RATE_LIMITED' | 'NETWORK' | 'SESSION_EXPIRED' | 'CONFIG' | 'UNKNOWN';

export class AppError extends Error {
  constructor(public code: AppErrorCode, message: string, public retryable = false, public detail?: string) {
    super(message);
    this.name = 'AppError';
  }
}

const MESSAGES: Record<AppErrorCode, string> = {
  NOT_AUTHENTICATED: 'Please sign in again.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  ACCOUNT_INACTIVE: 'Your account is not active. Contact your school safety administrator.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'That record could not be found or you do not have access to it.',
  VALIDATION: 'Please check the details and try again.',
  CONSENT_REQUIRED: 'You need to approve location sharing for this journey first.',
  CONSENT_OUTDATED: 'The consent information has been updated. Please review it again.',
  JOURNEY_ALREADY_ACTIVE: 'You already have an active journey. Finish it before starting a new one.',
  JOURNEY_NOT_ACTIVE: 'This journey has already ended.',
  INVALID_TRANSITION: 'That action is not possible in the current state.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  NETWORK: 'No connection to the server. Check your network and try again.',
  CONFIG: 'The app is not configured. Contact your administrator.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

const KNOWN = new Set(Object.keys(MESSAGES));

/** Normalise anything thrown by supabase-js / fetch into an AppError. Never exposes raw SQL. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as { message?: string; code?: string; details?: string; status?: number; name?: string } | null;
  const message = err?.message ?? '';
  if (KNOWN.has(message)) {
    const code = message as AppErrorCode;
    return new AppError(code, MESSAGES[code], code === 'RATE_LIMITED', err?.details);
  }
  if (err?.code === 'PGRST301' || err?.code === '401' || err?.status === 401 || /JWT expired|invalid jwt/i.test(message)) {
    return new AppError('SESSION_EXPIRED', MESSAGES.SESSION_EXPIRED);
  }
  if (err?.code === '42501') return new AppError('FORBIDDEN', MESSAGES.FORBIDDEN);
  if (
    err?.name === 'TypeError' ||
    /network request failed|failed to fetch|fetch failed|timeout|aborted/i.test(message) ||
    err?.name === 'AuthRetryableFetchError'
  ) {
    return new AppError('NETWORK', MESSAGES.NETWORK, true);
  }
  return new AppError('UNKNOWN', MESSAGES.UNKNOWN, true);
}

export function userMessage(e: unknown): string {
  return toAppError(e).message;
}
