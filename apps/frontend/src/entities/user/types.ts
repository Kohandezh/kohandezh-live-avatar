import { z } from 'zod';

export const userRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['active', 'disabled']);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Public user shape returned by the backend (GET /api/me, GET /api/admin/users).
 * Validated at the API boundary so the UI can trust it.
 * `phone` is the login identity (E.164, for example "+989121234567").
 * `email` is optional profile data and is null until the user sets one.
 * `birthDate` is optional profile data collected during onboarding.
 */
export const userSchema = z.object({
  id: z.string(),
  phone: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  /**
   * Birthday as a Gregorian calendar day, `YYYY-MM-DD`, or null when the user did not give one.
   * The wire format is Gregorian even though the app collects and shows it in the Jalali
   * calendar; `features/profile/jalali.ts` converts at the edge.
   */
  birthDate: z.iso.date().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  /** ISO 8601 date-time string. */
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;

/** Falls back to the phone number when the user has not set a name yet. */
export function getFullName(
  user: Pick<User, 'firstName' | 'lastName' | 'phone'>,
): string {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return name || user.phone;
}
