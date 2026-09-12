import { z } from 'zod';

/**
 * The user's name, as both onboarding and the personal information screen
 * collect it. `PUT /api/me/profile` is a full replace, so both names are
 * required on every call.
 *
 * Messages are i18n keys. The form translates them with t(), the same way
 * `features/authentication/schemas.ts` does.
 *
 * `.trim()` runs before the checks, so a value of only spaces fails `min(1)`
 * and the parsed output is already clean. The 100-character limit matches the
 * backend body.
 */
export const profileNameSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, { error: 'settings.personal.errors.firstNameRequired' })
    .max(100, { error: 'settings.personal.errors.tooLong' }),
  lastName: z
    .string()
    .trim()
    .min(1, { error: 'settings.personal.errors.lastNameRequired' })
    .max(100, { error: 'settings.personal.errors.tooLong' }),
});

export type ProfileNameValues = z.infer<typeof profileNameSchema>;
