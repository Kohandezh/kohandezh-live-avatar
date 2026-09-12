import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { UserRole } from '@/entities/user';
import { isForbidden } from '@/shared/api';
import { ErrorState, LoadingState } from '@/shared/ui';
import { useSession } from './hooks';
import { hasRole } from './roles';

/**
 * Redirects anonymous users to the login page.
 * Use as a layout route (renders <Outlet />) or wrap children.
 */
export function RequireAuth({
  loginPath = '/login',
  forbiddenPath = '/forbidden',
  children,
}: {
  loginPath?: string;
  forbiddenPath?: string;
  children?: ReactNode;
}) {
  const { user, isLoading, error, refetch } = useSession();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  if (error) {
    // The `me` query answers 403 `account_disabled` for a disabled account.
    // ForbiddenPage carries its own log-out button, which is the only escape
    // a disabled user has now that the header (and its log-out) is gone.
    if (isForbidden(error)) {
      return <Navigate to={forbiddenPath} replace />;
    }

    // Any other failure (network, 5xx) is not the same as "not logged in".
    return (
      <ErrorState className="min-h-[50vh]" onRetry={() => void refetch()} />
    );
  }

  if (!user) {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to={loginPath} replace state={{ from }} />;
  }

  return children ?? <Outlet />;
}

/**
 * Gate for the product screens: a signed-in user AND a name on file.
 * The server's `firstName` is the "onboarding done" flag, never a local
 * flag, so it works after a reinstall, on a second device, or in a private
 * window. Sits inside `RequireAuth` but must stay outside `/onboarding`
 * itself, or a user with no name yet would be redirected to itself forever.
 */
export function RequireProfile({
  onboardingPath = '/onboarding',
  loginPath = '/login',
  children,
}: {
  onboardingPath?: string;
  loginPath?: string;
  children?: ReactNode;
}) {
  const { user, isLoading } = useSession();

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  // `useSession` can report a null user with `isLoading` false: the global
  // 401 handler already nulled the `me` query and a redirect to `loginPath`
  // is on its way from `RequireAuth`. Bail out before reading a property off
  // null instead of racing that redirect.
  if (!user) {
    return <Navigate to={loginPath} replace />;
  }

  if (user.firstName.trim() === '') {
    return <Navigate to={onboardingPath} replace />;
  }

  return children ?? <Outlet />;
}

/**
 * UI guard for role-based screens. Place inside RequireAuth.
 * The backend is the source of truth for authorization; this only improves UX.
 */
export function RequireRole({
  roles,
  forbiddenPath = '/forbidden',
  children,
}: {
  roles: readonly UserRole[];
  forbiddenPath?: string;
  children?: ReactNode;
}) {
  const { user, isLoading } = useSession();

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  if (!hasRole(user, roles)) {
    return <Navigate to={forbiddenPath} replace />;
  }

  return children ?? <Outlet />;
}
