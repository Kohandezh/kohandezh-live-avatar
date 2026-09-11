import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLogout } from '@/features/authentication';
import { Button, EmptyState } from '@/shared/ui';

/** Shown when a signed-in user lacks the role for this app or page. */
export function ForbiddenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useLogout();

  return (
    <section className="px-4">
      {/* EmptyState paints the title; the page still needs a real heading. */}
      <h1 className="sr-only">{t('forbidden.title')}</h1>
      <EmptyState
        className="min-h-[60vh]"
        title={t('forbidden.title')}
        description={t('forbidden.description')}
        action={
          <Button
            variant="secondary"
            isPending={logout.isPending}
            onPress={() =>
              logout.mutate(undefined, {
                onSettled: () => navigate('/login', { replace: true }),
              })
            }
          >
            {t('forbidden.switchAccount')}
          </Button>
        }
      />
    </section>
  );
}
