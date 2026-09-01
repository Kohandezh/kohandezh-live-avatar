import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@app/store';
import { setLocale, setTheme, type Locale, type Theme } from '@app/store/uiSlice';
import { HealthStatusChip } from '@features/diagnostics';
import { cn } from '@shared/utils';
import { ReloadPrompt } from './ReloadPrompt';

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'inline-flex min-h-[var(--touch)] items-center rounded-lg px-3 text-sm transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    isActive ? 'bg-accent/15 font-semibold text-foreground' : 'text-muted hover:text-foreground',
  );

export function AppShell() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const locale = useAppSelector((s) => s.ui.locale);
  const theme = useAppSelector((s) => s.ui.theme);
  const online = useAppSelector((s) => s.ui.online);

  return (
    <div className="flex min-h-full flex-col">
      {!online && (
        <div
          className="bg-warning px-4 py-2 text-center text-sm text-warning-foreground"
          role="status"
        >
          {t('app.offline')}
        </div>
      )}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Link to="/" className="flex flex-col no-underline">
          <span className="font-bold text-foreground">{t('app.name')}</span>
          <span className="text-xs text-muted">{t('app.tagline')}</span>
        </Link>
        <nav aria-label={t('nav.main')} className="ms-auto flex gap-1">
          <NavLink to="/" end className={navClass}>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/session" className={navClass}>
            {t('nav.session')}
          </NavLink>
        </nav>
        <HealthStatusChip />
        <label className="sr-only" htmlFor="locale">
          {t('settings.language')}
        </label>
        <select
          id="locale"
          className="native-select"
          value={locale}
          onChange={(e) => dispatch(setLocale(e.target.value as Locale))}
        >
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
        <label className="sr-only" htmlFor="theme">
          {t('settings.theme')}
        </label>
        <select
          id="theme"
          className="native-select"
          value={theme}
          onChange={(e) => dispatch(setTheme(e.target.value as Theme))}
        >
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </header>
      <ReloadPrompt />
      <p className="bg-warning/15 px-4 py-2 text-center text-xs text-foreground">
        {t('app.phaseNotice')}
      </p>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
