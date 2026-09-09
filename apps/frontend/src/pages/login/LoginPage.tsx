import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoginForm, useSession } from '@/features/authentication';
import { Card, LoadingState } from '@/shared/ui';

/**
 * Shared by every app target. After login it returns the user to the page
 * that redirected them (location.state.from) or to `redirectTo`.
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
    <section className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center py-8">
      <Card>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('auth.title')}
        </h1>
        <p className="mt-1 mb-6 text-sm text-slate-600">{t('auth.subtitle')}</p>
        <LoginForm onSuccess={() => navigate(from, { replace: true })} />
      </Card>
    </section>
  );
}
