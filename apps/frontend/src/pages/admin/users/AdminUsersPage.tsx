import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Chip, Pagination, SearchField, Table } from '@heroui/react';
import { getFullName, useUsers } from '@/entities/user';
import { useDebouncedValue } from '@/shared/hooks';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui';
import { cn, formatDate } from '@/shared/utils';

const PAGE_SIZE = 10;

/**
 * Page numbers to show around the current page.
 * 'gap' marks a hidden range so the footer stays short on long lists.
 */
function getPageItems(page: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, index) => index + 1);
  }

  const items: Array<number | 'gap'> = [1];
  if (page > 3) items.push('gap');
  for (
    let current = Math.max(2, page - 1);
    current <= Math.min(pages - 1, page + 1);
    current += 1
  ) {
    items.push(current);
  }
  if (page < pages - 2) items.push('gap');
  items.push(pages);

  return items;
}

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
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('users.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('users.subtitle')}</p>
        </div>
        <SearchField
          aria-label={t('users.search')}
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          className="w-full sm:w-72"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t('users.search')} />
            <SearchField.ClearButton aria-label={t('users.clearSearch')} />
          </SearchField.Group>
        </SearchField>
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
          className={cn('gap-0 p-2', users.isPlaceholderData && 'opacity-60')}
        >
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label={t('users.title')}
                className="min-w-[720px]"
              >
                <Table.Header>
                  <Table.Column isRowHeader>
                    {t('users.columns.name')}
                  </Table.Column>
                  <Table.Column>{t('users.columns.phone')}</Table.Column>
                  <Table.Column>{t('users.columns.email')}</Table.Column>
                  <Table.Column>{t('users.columns.role')}</Table.Column>
                  <Table.Column>{t('users.columns.status')}</Table.Column>
                  <Table.Column>{t('users.columns.createdAt')}</Table.Column>
                </Table.Header>
                <Table.Body items={users.data.items}>
                  {(user) => (
                    <Table.Row>
                      <Table.Cell className="text-start font-medium">
                        {getFullName(user)}
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted">
                        <span dir="ltr">{user.phone}</span>
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted">
                        <span dir="ltr">{user.email ?? '—'}</span>
                      </Table.Cell>
                      <Table.Cell className="text-start">
                        <Chip
                          color={user.role === 'admin' ? 'accent' : 'default'}
                          variant="soft"
                          size="sm"
                        >
                          {t(`roles.${user.role}`, { ns: 'common' })}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="text-start">
                        <Chip
                          color={
                            user.status === 'active' ? 'success' : 'warning'
                          }
                          variant="soft"
                          size="sm"
                        >
                          {t(`status.${user.status}`, { ns: 'common' })}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted">
                        {formatDate(user.createdAt, i18n.language)}
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>

            <Table.Footer>
              <Pagination size="sm" className="w-full px-2 py-1">
                <Pagination.Summary>
                  {t('users.pagination.summary', {
                    page: users.data.page,
                    pages,
                    total: users.data.total,
                  })}
                </Pagination.Summary>
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={page <= 1}
                      onPress={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                    >
                      <Pagination.PreviousIcon />
                      <span>{t('users.pagination.previous')}</span>
                    </Pagination.Previous>
                  </Pagination.Item>

                  {getPageItems(page, pages).map((item, index) =>
                    item === 'gap' ? (
                      <Pagination.Item
                        key={`gap-${index}`}
                        className="hidden sm:block"
                      >
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={item} className="hidden sm:block">
                        <Pagination.Link
                          isActive={item === page}
                          aria-label={t('users.pagination.goToPage', {
                            page: item,
                          })}
                          onPress={() => setPage(item)}
                        >
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    ),
                  )}

                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={page >= pages}
                      onPress={() =>
                        setPage((current) => Math.min(pages, current + 1))
                      }
                    >
                      <span>{t('users.pagination.next')}</span>
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </Table.Footer>
          </Table>
        </Card>
      )}
    </section>
  );
}
