import { z } from 'zod';

export const sosNoteSchema = z.object({
  note: z.string().trim().max(1000, 'Notes must be at most 1000 characters'),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  fullName: z.string().trim().min(1, 'Enter the staff member’s name').max(120),
  employeeRef: z.string().trim().max(40).optional(),
});

export const notificationPrefsSchema = z.object({
  journeyReminders: z.boolean(),
  statusUpdates: z.boolean(),
  reminderMinutesAfterEta: z.number().int().min(5).max(240),
});
