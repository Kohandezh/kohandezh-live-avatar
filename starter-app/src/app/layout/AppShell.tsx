import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@app/store';
import { setLocale, type Locale } from '@app/store/uiSlice';
import { useSession, useLogout } from '@features/authentication';
import { Button } from '@shared/ui';

export function AppShell() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const locale = useAppSelector((s) => s.ui.locale);
  const online = useAppSelector((s) => s.ui.online);
  const session = useSession();
  const logout = useLogout();

  return (
    <div className="shell">
      {!online && <div className="banner" role="status">{t('app.offline')}</div>}
      <header className="shell__header">
        <Link to="/" style={{ fontWeight: 700, textDecoration: 'none' }}>
          {t('app.name')}
        </Link>
        <nav aria-label="main">
          <NavLink to="/">{t('nav.home')}</NavLink>
          <NavLink to="/profile">{t('nav.profile')}</NavLink>
        </nav>
        <label className="sr-only" htmlFor="locale">{t('settings.language')}</label>
        <select id="locale" value={locale} onChange={(e) => dispatch(setLocale(e.target.value as Locale))}>
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
        {session.data ? (
          <Button onClick={() => logout.mutate()} loading={logout.isPending}>
            {t('nav.logout')}
          </Button>
        ) : (
          <Link to="/login">{t('nav.login')}</Link>
        )}
      </header>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
