import { Card } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { useSession } from '@/features/authentication';
import { LoadingState } from '@/shared/ui';

/** Where the landing page sends the visitor once they are signed in. */
const CONVERSATION_PATH = '/assistant';

const STEPS = ['login', 'mic', 'talk'] as const;

/**
 * The first screen of the mobile app and the web PWA.
 * Signed-in users never see it: they go straight to the conversation.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated, isLoading } = useSession();

  if (isLoading) {
    return <LoadingState className="min-h-[50vh]" />;
  }

  if (isAuthenticated) {
    return <Navigate to={CONVERSATION_PATH} replace />;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 px-4 py-10">
      <section>
        {/* No brand line here: the layout header already carries the name. */}
        <h1 className="text-3xl font-semibold tracking-tight text-balance text-foreground">
          {t('home.hero.title')}
        </h1>
        <p className="mt-3 text-base text-muted">{t('home.hero.description')}</p>

        <div className="mt-6 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <Link
            to="/login"
            state={{ from: CONVERSATION_PATH }}
            className={buttonVariants({
              size: 'lg',
              className: 'min-h-11 sm:w-auto',
            })}
          >
            {t('home.hero.cta')}
          </Link>
          <Link
            to="/login"
            className={buttonVariants({
              variant: 'ghost',
              size: 'lg',
              className: 'min-h-11 sm:w-auto',
            })}
          >
            {t('home.hero.login')}
          </Link>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {t('home.steps.title')}
        </h2>

        <ol className="mt-4 flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step}>
              <Card>
                <Card.Header className="flex-row items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-soft-foreground"
                  >
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                    <Card.Title className="text-base">
                      {t(`home.steps.${step}.title`)}
                    </Card.Title>
                    <Card.Description>
                      {t(`home.steps.${step}.description`)}
                    </Card.Description>
                  </div>
                </Card.Header>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
