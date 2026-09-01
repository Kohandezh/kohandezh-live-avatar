import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="p-8 text-center text-muted">
      <h1 className="text-3xl font-bold text-foreground">404</h1>
      <p>{t('state.notFound')}</p>
      <Link to="/" className="underline">
        {t('nav.home')}
      </Link>
    </div>
  );
}
