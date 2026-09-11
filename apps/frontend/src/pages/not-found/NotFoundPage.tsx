import { buttonVariants } from '@heroui/styles';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/shared/ui';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <section className="px-4">
      {/* EmptyState paints the title; the page still needs a real heading. */}
      <h1 className="sr-only">{t('notFound.title')}</h1>
      <EmptyState
        className="min-h-[60vh]"
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
            {t('notFound.back')}
          </Link>
        }
      />
    </section>
  );
}
