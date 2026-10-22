// Minimal structured logger. Never pass passwords, tokens, or coordinates to it.
type Level = 'debug' | 'info' | 'warn' | 'error';
const SENSITIVE = /(password|token|secret|latitude|longitude|lat|lng|authorization)/i;

function scrub(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? '[redacted]' : v;
  return out;
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (level === 'debug' && !__DEV__) return;
  const line = { level, event, ...scrub(fields) };
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(JSON.stringify(line));
}

export const logger = {
  debug: (e: string, f?: Record<string, unknown>) => emit('debug', e, f),
  info: (e: string, f?: Record<string, unknown>) => emit('info', e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit('warn', e, f),
  error: (e: string, f?: Record<string, unknown>) => emit('error', e, f),
};
