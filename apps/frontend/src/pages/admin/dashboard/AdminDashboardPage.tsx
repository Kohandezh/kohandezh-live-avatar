import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  useDashboardSummary,
  type DashboardSummary,
} from '@/entities/dashboard';
import { Card } from '@heroui/react';
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
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('dashboard.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('dashboard.subtitle')}</p>
      </header>

      {summary.isPending ? (
        <LoadingState />
      ) : summary.isError ? (
        <ErrorState onRetry={() => void summary.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statKeys.map((key) => (
            <Card key={key}>
              <p className="text-sm text-slate-500">
                {t(`dashboard.stats.${key}`)}
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight">
                {numberFormat.format(summary.data[key])}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Link
        to="/users"
        className="text-sm font-medium text-slate-900 underline underline-offset-4"
      >
        {t('dashboard.manageUsers')}
      </Link>
    </section>
  );
}
