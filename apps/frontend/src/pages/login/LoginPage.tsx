import { Card } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { PhoneLoginForm, useSession } from '@/features/authentication';
import { LoadingState } from '@/shared/ui';

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
    <section className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4 py-8">
      <p className="mb-3 text-center text-sm font-medium text-muted">
        {t('app.name')}
      </p>

      <Card>
        <Card.Header>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('auth.title')}
          </h1>
          <Card.Description>{t('auth.subtitle')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <PhoneLoginForm onSuccess={() => navigate(from, { replace: true })} />
        </Card.Content>
      </Card>
    </section>
  );
}
