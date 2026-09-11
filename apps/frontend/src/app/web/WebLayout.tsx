import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLogout, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { Button, OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

/** Web shell: top navigation, content container, footer. */
export function WebLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useSession();
  const logout = useLogout();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-lg px-3 py-1.5 text-sm font-medium',
      isActive
        ? 'bg-slate-100 text-slate-900'
        : 'text-slate-600 hover:text-slate-900',
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
          <Link to="/" className="font-semibold">
            {t('app.name')}
          </Link>

          <nav aria-label={t('nav.menu')} className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              {t('nav.home')}
            </NavLink>
            <NavLink to="/avatar" className={navLinkClass}>
              {t('nav.avatar')}
            </NavLink>
            <NavLink to="/profile" className={navLinkClass}>
              {t('nav.profile')}
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            {isAuthenticated ? (
              <Button
                variant="ghost"
                size="sm"
                loading={logout.isPending}
                onClick={() =>
                  logout.mutate(undefined, { onSettled: () => navigate('/') })
                }
              >
                {t('nav.logout')}
              </Button>
            ) : (
              <Link to="/login" className="text-sm font-medium text-slate-900">
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

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        {t('app.tagline')}
      </footer>

      <PwaUpdatePrompt />
    </div>
  );
}
