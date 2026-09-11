import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { LanguageSwitcher } from '@/features/settings';
import { OfflineBanner } from '@/shared/ui';
import { cn } from '@/shared/utils';

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10.5V20h14v-9.5" />
    </svg>
  );
}

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

/** Mobile shell: top bar, content, bottom tab bar with safe-area padding. */
export function MobileLayout() {
  const { t } = useTranslation();

  const tabs = [
    { to: '/', label: t('nav.home'), icon: <HomeIcon /> },
    { to: '/assistant', label: t('nav.assistant'), icon: <AssistantIcon /> },
    { to: '/profile', label: t('nav.profile'), icon: <UserIcon /> },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="safe-top sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <span className="font-semibold">{t('app.name')}</span>
          <LanguageSwitcher />
        </div>
      </header>

      <OfflineBanner />

      <main className="flex-1 px-4 pb-6">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.menu')}
        className="safe-bottom sticky bottom-0 border-t border-slate-200 bg-white"
      >
        <ul className="grid grid-cols-3">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                    isActive ? 'text-slate-900' : 'text-slate-500',
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
    </div>
  );
}
