import { z } from 'zod';

export const userRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['active', 'disabled']);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Public user shape returned by the backend (GET /api/me, GET /api/admin/users).
 * Validated at the API boundary so the UI can trust it.
 */
export const userSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  role: userRoleSchema,
  status: userStatusSchema,
  /** ISO 8601 date-time string. */
  createdAt: z.string(),
});

export type User = z.infer<typeof userSchema>;

export function getFullName(
  user: Pick<User, 'firstName' | 'lastName'>,
): string {
  return `${user.firstName} ${user.lastName}`.trim();
}
