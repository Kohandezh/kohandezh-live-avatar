import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, buttonVariants } from '@heroui/react';
import {
  useDashboardSummary,
  type DashboardSummary,
} from '@/entities/dashboard';
import { ErrorState, LoadingState } from '@/shared/ui';

const statKeys: Array<keyof DashboardSummary> = [
  'totalUsers',
  'activeUsers',
  'disabledUsers',
  'newUsersThisWeek',
];

export function AdminDashboardPage() {
  const { t, i18n } = useTranslation('admin');
  const summary = useDashboardSummary();
  const numberFormat = new Intl.NumberFormat(i18n.language);

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t('dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-muted">{t('dashboard.subtitle')}</p>
      </header>

      {summary.isPending ? (
        <LoadingState />
      ) : summary.isError ? (
        <ErrorState onRetry={() => void summary.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statKeys.map((key) => (
            <Card key={key} className="gap-1">
              {/* A stat label is a description, not a heading: four headings
                  here would only add noise to screen reader navigation. */}
              <Card.Description>{t(`dashboard.stats.${key}`)}</Card.Description>
              <p className="text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                {numberFormat.format(summary.data[key])}
              </p>
            </Card>
          ))}
        </div>
      )}

      <div>
        {/* A real anchor keeps open-in-new-tab working; the HeroUI button
            variants keep it looking like the rest of the product. */}
        <Link to="/users" className={buttonVariants({ variant: 'secondary' })}>
          {t('dashboard.manageUsers')}
        </Link>
      </div>
    </section>
  );
}
