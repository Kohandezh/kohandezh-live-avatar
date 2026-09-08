import { z } from 'zod';

/** Messages are i18n keys. The form translates them with t(). */
export const loginSchema = z.object({
  email: z.email({ error: 'auth.errors.invalidEmail' }),
  password: z.string().min(6, { error: 'auth.errors.passwordMin' }),
});

export type LoginInput = z.infer<typeof loginSchema>;
