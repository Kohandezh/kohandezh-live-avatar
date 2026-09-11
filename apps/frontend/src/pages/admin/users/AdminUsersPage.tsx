import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getFullName, useUsers } from '@/entities/user';
import { useDebouncedValue } from '@/shared/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@/shared/ui';
import { cn, formatDate } from '@/shared/utils';

const PAGE_SIZE = 10;

export function AdminUsersPage() {
  const { t, i18n } = useTranslation('admin');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim(), 300);

  const users = useUsers({ q, page, pageSize: PAGE_SIZE });
  const pages = users.data
    ? Math.max(1, Math.ceil(users.data.total / users.data.pageSize))
    : 1;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('users.title')}
          </h1>
          <p className="mt-1 text-sm text-slate-600">{t('users.subtitle')}</p>
        </div>
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder={t('users.search')}
          aria-label={t('users.search')}
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 sm:w-72"
        />
      </header>

      {users.isPending ? (
        <LoadingState />
      ) : users.isError ? (
        <ErrorState onRetry={() => void users.refetch()} />
      ) : users.data.items.length === 0 ? (
        <EmptyState
          title={t('users.empty.title')}
          description={t('users.empty.description')}
        />
      ) : (
        <Card
          className={cn(
            'overflow-x-auto p-0',
            users.isPlaceholderData && 'opacity-60',
          )}
        >
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t('users.columns.name')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t('users.columns.phone')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t('users.columns.email')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t('users.columns.role')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t('users.columns.status')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-medium">
                  {t('users.columns.createdAt')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.items.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {getFullName(user)}
                  </td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">
                    {user.phone}
                  </td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">
                    {user.email ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>
                      {t(`roles.${user.role}`, { ns: 'common' })}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={user.status === 'active' ? 'success' : 'warning'}
                    >
                      {t(`status.${user.status}`, { ns: 'common' })}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDate(user.createdAt, i18n.language)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {t('users.pagination.summary', {
                page: users.data.page,
                pages,
                total: users.data.total,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {t('users.pagination.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() =>
                  setPage((current) => Math.min(pages, current + 1))
                }
              >
                {t('users.pagination.next')}
              </Button>
            </div>
          </footer>
        </Card>
      )}
    </section>
  );
}
