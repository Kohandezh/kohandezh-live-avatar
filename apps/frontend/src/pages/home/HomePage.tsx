import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useSession } from '@/features/authentication';
import { buttonClassName, Card } from '@/shared/ui';

export function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useSession();

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 py-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t('home.title')}
        </h1>
        <p className="mt-2 text-slate-600">{t('home.description')}</p>
      </div>

      <Card className="flex flex-col items-start gap-3">
        <p className="text-sm text-slate-600">{t('app.tagline')}</p>
        <Link
          to={isAuthenticated ? '/profile' : '/login'}
          className={buttonClassName({ className: 'w-full sm:w-auto' })}
        >
          {isAuthenticated ? t('home.goToProfile') : t('home.loginCta')}
        </Link>
      </Card>
    </section>
  );
}
