import type { z } from 'zod';

/** Flatten zod issues into { field: firstMessage }. */
export function fieldErrors<T extends z.ZodType>(schema: T, value: unknown):
  | { ok: true; data: z.output<T> }
  | { ok: false; errors: Record<string, string> } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
