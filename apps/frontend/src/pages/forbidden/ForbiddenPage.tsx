import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLogout } from '@/features/authentication';
import { Button } from '@/shared/ui';

/** Shown when a signed-in user lacks the role for this app or page. */
export function ForbiddenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('forbidden.title')}
      </h1>
      <p className="text-slate-600">{t('forbidden.description')}</p>
      <Button
        variant="secondary"
        className="mt-2"
        isPending={logout.isPending}
        onPress={() =>
          logout.mutate(undefined, {
            onSettled: () => navigate('/login', { replace: true }),
          })
        }
      >
        {t('forbidden.switchAccount')}
      </Button>
    </section>
  );
}
