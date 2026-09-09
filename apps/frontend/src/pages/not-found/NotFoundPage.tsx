import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t('notFound.title')}
      </h1>
      <p className="text-slate-600">{t('notFound.description')}</p>
      <Link
        to="/"
        className="mt-2 text-sm font-medium text-slate-900 underline underline-offset-4"
      >
        {t('notFound.back')}
      </Link>
    </section>
  );
}
