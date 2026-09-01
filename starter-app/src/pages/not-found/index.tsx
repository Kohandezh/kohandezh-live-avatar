import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="state">
      <h1>404</h1>
      <p>{t('state.notFound')}</p>
      <Link to="/">{t('nav.home')}</Link>
    </div>
  );
}
