import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { hasRole, useLogout, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { Button, OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

/** Web shell: top navigation, content container, footer. */
export function WebLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useSession();
  const logout = useLogout();

  // The workbench stays reachable at /avatar, but only staff need the link.
  const links = isAuthenticated
    ? [
        { to: '/assistant', label: t('nav.assistant') },
        ...(hasRole(user, ['admin'])
          ? [{ to: '/avatar', label: t('nav.session') }]
          : []),
        { to: '/profile', label: t('nav.profile') },
      ]
    : [];

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
      isActive
        ? 'bg-default text-foreground'
        : 'text-muted hover:text-foreground',
    );

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b border-separator">
        {/* Wraps instead of overflowing: the PWA also runs at phone width. */}
        <div className="mx-auto flex min-h-16 max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
          <Link
            to="/"
            className="font-semibold tracking-tight text-foreground"
          >
            {t('app.name')}
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            {links.length > 0 ? (
              <nav
                aria-label={t('nav.menu')}
                className="flex items-center gap-1"
              >
                {links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={navLinkClass}
                  >
                    {link.label}
                  </NavLink>
                ))}
              </nav>
            ) : null}

            <LanguageSwitcher />

            {isAuthenticated ? (
              <Button
                variant="secondary"
                size="sm"
                isPending={logout.isPending}
                onPress={() =>
                  logout.mutate(undefined, { onSettled: () => navigate('/') })
                }
              >
                {t('nav.logout')}
              </Button>
            ) : (
              <Link
                to="/login"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-foreground hover:text-accent"
              >
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      </header>

      <OfflineBanner />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4">
        <Outlet />
      </main>

      <footer className="border-t border-separator py-6 text-center text-xs text-muted">
        {t('app.copyright', { year: new Date().getFullYear() })}
      </footer>

      <PwaUpdatePrompt />
    </div>
  );
}
