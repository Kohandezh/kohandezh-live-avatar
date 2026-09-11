import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSession } from '@/features/authentication';
import { Card } from '@heroui/react';
import { buttonVariants } from '@heroui/styles';

export function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useSession();

  return (
    <section className="flex flex-col gap-6 px-4 py-6">
      <div className="px-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('home.title')}
        </h1>
        <p className="mt-2 text-sm text-muted">{t('home.description')}</p>
      </div>

      <Card className="w-full bg-surface">
        <Card.Header>
          <Card.Title>{t('home.assistant.title')}</Card.Title>
          <Card.Description>{t('home.assistant.description')}</Card.Description>
        </Card.Header>
        <Card.Content>
          <Link
            to="/assistant"
            className={buttonVariants({
              variant: 'primary',
              className: 'min-h-[44px] w-full',
            })}
          >
            {t('home.assistant.cta')}
          </Link>
        </Card.Content>
      </Card>

      <Card className="w-full bg-surface">
        <Card.Content>
          <p className="mb-4 text-sm text-muted">{t('app.tagline')}</p>
          <Link
            to={isAuthenticated ? '/profile' : '/login'}
            className={buttonVariants({ 
              variant: 'outline',
              className: 'min-h-[44px] w-full' 
            })}
          >
            {isAuthenticated ? t('home.goToProfile') : t('home.loginCta')}
          </Link>
        </Card.Content>
      </Card>
    </section>
  );
}
