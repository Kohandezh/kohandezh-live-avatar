import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PhoneLoginForm, useSession } from '@/features/authentication';
import { LanguageSwitcher } from '@/features/settings';
import { LoadingState } from '@/shared/ui';

/**
 * The first screen of the app. Shared by every app target. After login it returns
 * the user to the page that redirected them (location.state.from) or to `redirectTo`.
 */
export function LoginPage({ redirectTo = '/' }: { redirectTo?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading } = useSession();

  const from = (location.state as { from?: string } | null)?.from ?? redirectTo;

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-8">
      {/*
       * The product name stays. This screen is now the first thing a new user sees,
       * and a bare phone-number form with no product name reads as a phishing page.
       * The requirement removed the brand from the header, which is gone anyway.
       */}
      <div className="flex flex-col gap-2 text-center">
        <p className="text-sm font-medium text-muted">{t('app.name')}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('auth.title')}
        </h1>
        <p className="text-sm text-muted">{t('auth.subtitle')}</p>
      </div>

      <PhoneLoginForm onSuccess={() => navigate(from, { replace: true })} />

      {/*
       * The only language control outside /settings, and it has to be here. Settings
       * sits behind RequireAuth, so a Persian speaker who lands on an English login
       * screen would otherwise have no way to switch before signing in.
       */}
      <div className="flex justify-center">
        <LanguageSwitcher />
      </div>
    </section>
  );
}
