import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { getFullName } from '@/entities/user';
import { useLogout, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { Button, OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** Admin shell: sidebar on desktop, collapsible menu on small screens. */
export function AdminLayout() {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { user } = useSession();
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = [
    { to: '/', label: t('nav.dashboard'), end: true },
    { to: '/users', label: t('nav.users'), end: false },
  ];

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'block rounded-lg px-3 py-2 text-sm font-medium',
      isActive
        ? 'bg-slate-900 text-white'
        : 'text-slate-700 hover:bg-slate-100',
    );

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside
        className={cn(
          'border-b border-slate-200 bg-white md:w-60 md:shrink-0 md:border-e md:border-b-0',
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <span className="font-semibold">{t('title')}</span>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 md:hidden"
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">
              {menuOpen ? t('layout.closeMenu') : t('layout.openMenu')}
            </span>
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path d="M6 6l12 12M18 6 6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>

        <nav
          id="admin-nav"
          aria-label={t('layout.openMenu')}
          className={cn(
            'flex-col gap-1 px-3 pb-4 md:flex',
            menuOpen ? 'flex' : 'hidden',
          )}
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={navLinkClass}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 md:px-6">
          {user ? (
            <span className="truncate text-sm text-slate-600">
              {t('layout.signedInAs')}{' '}
              <span className="font-medium text-slate-900">
                {getFullName(user)}
              </span>
            </span>
          ) : null}
          <LanguageSwitcher />
          <Button
            variant="secondary"
            size="sm"
            loading={logout.isPending}
            onClick={() =>
              logout.mutate(undefined, {
                onSettled: () => navigate('/login', { replace: true }),
              })
            }
          >
            {t('nav.logout', { ns: 'common' })}
          </Button>
        </header>

        <OfflineBanner />

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
