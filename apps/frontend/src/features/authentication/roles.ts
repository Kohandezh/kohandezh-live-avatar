import type { User, UserRole } from '@/entities/user';

/**
 * UI-only check used to hide screens the user cannot use.
 * It is not security. The backend must check the role on every request.
 */
export function hasRole(
  user: Pick<User, 'role'> | null | undefined,
  roles: readonly UserRole[],
): boolean {
  return Boolean(user && roles.includes(user.role));
}
