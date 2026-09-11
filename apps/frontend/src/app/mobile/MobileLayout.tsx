import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';

function AssistantIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 1 1-3.2-6.4" />
      <path d="M9 10v4" />
      <path d="M12 8v8" />
      <path d="M15 10v4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  );
}

/** Mobile shell: locked viewport, fixed header, scrollable content, fixed tab bar. */
export function MobileLayout() {
  const { t } = useTranslation();
  const { isAuthenticated } = useSession();

  const tabs = [
    { to: '/assistant', label: t('nav.assistant'), icon: <AssistantIcon /> },
    { to: '/profile', label: t('nav.profile'), icon: <UserIcon /> },
  ];

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background">
      <header className="safe-top z-10 shrink-0 select-none border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="font-semibold tracking-tight text-foreground">
            {t('app.shortName')}
          </span>
          <LanguageSwitcher />
        </div>
      </header>

      <div className="shrink-0">
        <OfflineBanner />
      </div>

      <main className="flex-1 overflow-y-auto overscroll-y-contain pb-6">
        <Outlet />
      </main>

      {/* The landing and the login screen have nothing to switch between. */}
      {isAuthenticated ? (
        <nav
          aria-label={t('nav.menu')}
          className="safe-bottom shrink-0 select-none border-t border-border bg-surface"
        >
          <ul className="grid h-14 grid-cols-2">
            {tabs.map((tab) => (
              <li key={tab.to} className="h-full">
                <NavLink
                  to={tab.to}
                  className={({ isActive }) =>
                    cn(
                      'flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors active:scale-95',
                      isActive ? 'text-accent' : 'text-muted',
                    )
                  }
                >
                  {tab.icon}
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
