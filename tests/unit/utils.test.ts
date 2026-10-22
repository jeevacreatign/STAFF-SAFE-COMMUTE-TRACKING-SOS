import { backoffDelay } from '../../src/utils/backoff';
import { AppError, toAppError } from '../../src/utils/errors';
import { freshnessOf } from '../../src/utils/freshness';
import { formatAge, formatRemaining } from '../../src/utils/time';

describe('freshnessOf (matches the database thresholds)', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');
  test.each([
    [null, 'none'],
    ['garbage', 'none'],
    ['2026-10-22T09:59:00Z', 'fresh'],
    ['2026-10-22T09:58:00Z', 'fresh'],
    ['2026-10-22T09:57:59Z', 'delayed'],
    ['2026-10-22T09:50:00Z', 'delayed'],
    ['2026-10-22T09:49:59Z', 'stale'],
  ])('%s -> %s', (observed, expected) => {
    expect(freshnessOf(observed as string | null, now)).toBe(expected);
  });
});

describe('backoffDelay', () => {
  test('grows exponentially and is capped, with full jitter', () => {
    expect(backoffDelay(0, 1000, 60000, () => 0.999)).toBe(999);
    expect(backoffDelay(3, 1000, 60000, () => 0.999)).toBe(7992);
    expect(backoffDelay(20, 1000, 60000, () => 0.999)).toBe(59940);
    expect(backoffDelay(5, 1000, 60000, () => 0)).toBe(0);
  });
});

describe('toAppError', () => {
  test('maps database codes to safe messages without leaking SQL', () => {
    const e = toAppError({ message: 'JOURNEY_ALREADY_ACTIVE', details: 'internal detail' });
    expect(e.code).toBe('JOURNEY_ALREADY_ACTIVE');
    expect(e.message).not.toMatch(/internal/);
  });
  test('network errors are retryable', () => {
    const e = toAppError(new TypeError('Network request failed'));
    expect(e.code).toBe('NETWORK');
    expect(e.retryable).toBe(true);
  });
  test('expired sessions', () => {
    expect(toAppError({ message: 'JWT expired', code: 'PGRST301' }).code).toBe('SESSION_EXPIRED');
  });
  test('unknown errors are generic', () => {
    const e = toAppError({ message: 'relation "x" does not exist', code: '42P01' });
    expect(e.code).toBe('UNKNOWN');
    expect(e.message).not.toMatch(/relation/);
  });
  test('AppError passes through', () => {
    const a = new AppError('FORBIDDEN', 'x');
    expect(toAppError(a)).toBe(a);
  });
});

describe('time formatting', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');
  test('remaining', () => {
    expect(formatRemaining('2026-10-22T11:05:00Z', now)).toBe('1 h 05 min');
    expect(formatRemaining('2026-10-22T10:04:10Z', now)).toBe('4 min 10 s');
    expect(formatRemaining('2026-10-22T09:00:00Z', now)).toBe('Expired');
  });
  test('age', () => {
    expect(formatAge('2026-10-22T09:59:30Z', now)).toBe('30 s ago');
    expect(formatAge('2026-10-22T09:30:00Z', now)).toBe('30 min ago');
    expect(formatAge(null, now)).toBe('never');
  });
});
