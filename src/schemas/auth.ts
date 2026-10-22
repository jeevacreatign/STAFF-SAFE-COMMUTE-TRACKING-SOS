import { z } from 'zod';

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const resetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/\d/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

export const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(120, 'Name must be at most 120 characters'),
});
