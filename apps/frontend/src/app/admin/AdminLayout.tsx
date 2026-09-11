import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Avatar } from '@heroui/react';
import { getFullName, type User } from '@/entities/user';
import { useLogout, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { Button, OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** Two letters for the header avatar. Falls back to the phone when there is no name yet. */
function getInitials(
  user: Pick<User, 'firstName' | 'lastName' | 'phone'>,
): string {
  const letters = [user.firstName, user.lastName]
    .map((part) => part.trim().charAt(0))
    .filter(Boolean)
    .join('');
  return letters ? letters.toUpperCase() : user.phone.slice(-2);
}

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
      // 44px tall on a phone, compact on the desktop sidebar.
      'flex min-h-11 items-center rounded-lg px-3 text-sm font-medium md:min-h-9',
      isActive
        ? 'bg-accent-soft text-accent-soft-foreground'
        : 'text-foreground hover:bg-default',
    );

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <aside className="border-b border-separator bg-surface md:w-64 md:shrink-0 md:border-e md:border-b-0">
        <div className="flex h-16 items-center justify-between gap-2 px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {t('app.name', { ns: 'common' })}
            </p>
            <p className="truncate text-xs text-muted">{t('title')}</p>
          </div>
          <Button
            isIconOnly
            variant="ghost"
            // 44px keeps the touch target usable on a phone.
            className="size-11 md:hidden"
            aria-label={menuOpen ? t('layout.closeMenu') : t('layout.openMenu')}
            aria-expanded={menuOpen}
            aria-controls="admin-nav"
            onPress={() => setMenuOpen((open) => !open)}
          >
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
          </Button>
        </div>

        <nav
          id="admin-nav"
          aria-label={t('layout.navLabel')}
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
        <header className="flex h-16 items-center gap-3 border-b border-separator bg-surface px-4 md:px-6">
          {user ? (
            <div className="flex min-w-0 items-center gap-2">
              <Avatar size="sm" color="accent" variant="soft">
                <Avatar.Fallback>{getInitials(user)}</Avatar.Fallback>
              </Avatar>
              <span className="truncate text-sm text-foreground">
                <span className="sr-only">{t('layout.signedInAs')} </span>
                {getFullName(user)}
              </span>
            </div>
          ) : null}

          <div className="ms-auto flex shrink-0 items-center gap-3">
            <LanguageSwitcher />
            <Button
              variant="secondary"
              isPending={logout.isPending}
              onPress={() =>
                logout.mutate(undefined, {
                  onSettled: () => navigate('/login', { replace: true }),
                })
              }
            >
              {t('nav.logout', { ns: 'common' })}
            </Button>
          </div>
        </header>

        <OfflineBanner />

        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
