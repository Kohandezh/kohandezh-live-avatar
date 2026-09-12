import { z } from 'zod';
import { isValidBirthDate } from './jalali';

/**
 * The editable profile, as both onboarding and the personal information screen
 * collect it. `PUT /api/me/profile` is a full replace, so every field goes on
 * every call.
 *
 * Messages are i18n keys. The form translates them with t(), the same way
 * `features/authentication/schemas.ts` does.
 *
 * `.trim()` runs before the checks, so a value of only spaces fails `min(1)`
 * and the parsed output is already clean. The 100-character limit matches the
 * backend body.
 */
export const profileSchema = z.object({
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
  /**
   * Optional. Gregorian `YYYY-MM-DD` on the wire; the field shows and collects
   * it in the Jalali calendar. `null` means "not given", and sending it clears
   * a birthday saved before, which a full replace has to support.
   *
   * The bounds are re-checked here even though the picker enforces them:
   * `minValue` and `maxValue` stop the arrow keys, not a value that arrived
   * from somewhere else.
   */
  birthDate: z
    .string()
    .refine(isValidBirthDate, {
      error: 'settings.personal.errors.birthDateInvalid',
    })
    .nullable(),
});

export type ProfileValues = z.infer<typeof profileSchema>;
