import { z } from 'zod';
import { JOURNEY_LIMITS } from '../constants/location';

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Journey setup form. Times are relative to "now" when the employee confirms. */
export const journeySetupSchema = z
  .object({
    label: z.string().trim().min(1, 'Give the journey a short label').max(80, 'Label must be at most 80 characters'),
    destination: optionalTrimmed(120, 'Destination'),
    etaMinutes: z
      .number({ message: 'Enter minutes as a number' })
      .int('Use whole minutes')
      .min(1, 'Arrival must be at least 1 minute away')
      .max(JOURNEY_LIMITS.maxExpiryMinutes, 'Arrival must be within 12 hours')
      .optional(),
    expiryMinutes: z
      .number({ message: 'Enter minutes as a number' })
      .int('Use whole minutes')
      .min(JOURNEY_LIMITS.minExpiryMinutes, `Sharing must last at least ${JOURNEY_LIMITS.minExpiryMinutes} minutes`)
      .max(JOURNEY_LIMITS.maxExpiryMinutes, 'Sharing can last at most 12 hours'),
  })
  .refine((v) => v.etaMinutes === undefined || v.etaMinutes <= v.expiryMinutes, {
    message: 'Expected arrival must be before sharing expires',
    path: ['etaMinutes'],
  });

export type JourneySetupInput = z.input<typeof journeySetupSchema>;
export type JourneySetup = z.output<typeof journeySetupSchema>;

/** Parse a minutes text field: '' -> undefined, otherwise a number (NaN fails validation). */
export function parseMinutes(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}
