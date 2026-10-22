import { toAppError } from '../../utils/errors';
import { supabase } from './client';

/** Call a Postgres function and normalise errors into AppError. */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let result;
  try {
    result = await supabase.rpc(fn, args);
  } catch (e) {
    throw toAppError(e);
  }
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}

/** Unwrap a supabase-js query result. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw toAppError(result.error);
  return result.data as T;
}
