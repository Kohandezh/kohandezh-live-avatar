import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { UserRole } from '@/entities/user';
import { ErrorState, LoadingState } from '@/shared/ui';
import { useSession } from './hooks';
import { hasRole } from './roles';

/**
 * Redirects anonymous users to the login page.
 * Use as a layout route (renders <Outlet />) or wrap children.
 */
export function RequireAuth({
  loginPath = '/login',
  children,
}: {
  loginPath?: string;
  children?: ReactNode;
}) {
  const { user, isLoading, error, refetch } = useSession();
  const location = useLocation();

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  if (error) {
    // Network or server problem. Not the same as "not logged in".
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
