import { newPasswordSchema, signInSchema } from '../../src/schemas/auth';
import { journeySetupSchema, parseMinutes } from '../../src/schemas/journey';
import { fieldErrors } from '../../src/schemas/validate';

describe('journey setup validation', () => {
  const base = { label: 'Home', expiryMinutes: 90 };
  test('accepts a minimal journey', () => {
    expect(journeySetupSchema.safeParse(base).success).toBe(true);
  });
  test('trims and drops empty destination', () => {
    const r = journeySetupSchema.parse({ ...base, destination: '   ' });
    expect(r.destination).toBeUndefined();
  });
  test.each([
    [{ ...base, label: '' }, 'label'],
    [{ ...base, label: 'x'.repeat(81) }, 'label'],
    [{ ...base, expiryMinutes: 4 }, 'expiryMinutes'],
    [{ ...base, expiryMinutes: 721 }, 'expiryMinutes'],
    [{ ...base, expiryMinutes: Number.NaN }, 'expiryMinutes'],
    [{ ...base, etaMinutes: 120, expiryMinutes: 60 }, 'etaMinutes'],
    [{ ...base, etaMinutes: 0 }, 'etaMinutes'],
  ])('rejects %j on %s', (input, field) => {
    const r = fieldErrors(journeySetupSchema, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toContain(field);
  });
  test('parseMinutes', () => {
    expect(parseMinutes('')).toBeUndefined();
    expect(parseMinutes(' 45 ')).toBe(45);
    expect(parseMinutes('4.5')).toBeNaN();
    expect(parseMinutes('-3')).toBeNaN();
  });
});

describe('auth validation', () => {
  test('normalises email', () => {
    expect(signInSchema.parse({ email: '  A@Example.COM ', password: 'x' }).email).toBe('a@example.com');
  });
  test('password strength and match', () => {
    expect(newPasswordSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: 'Longenough1', confirm: 'Longenough2' }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: 'Longenough1', confirm: 'Longenough1' }).success).toBe(true);
  });
});
