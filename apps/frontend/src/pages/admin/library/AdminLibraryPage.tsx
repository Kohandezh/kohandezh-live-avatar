import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import {
  Card,
  Chip,
  Drawer,
  Input,
  Label,
  Pagination,
  SearchField,
  Table,
  TextField,
} from '@heroui/react';
import {
  useLibraryEntries,
  type AdminLibraryEntry,
  type LibraryLanguage,
  type LibrarySectionType,
  type LibraryStatus,
  type LibraryTechnical,
} from '@/entities/library-entry';
import { formatNumber } from '@/i18n';
import { useDebouncedValue } from '@/shared/hooks';
import { isApiError } from '@/shared/api';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { EntryPanelContent } from './EntryPanel';
import { LibrarySelect } from './LibrarySelect';
import {
  getPageItems,
  LANGUAGES,
  SECTION_TYPES,
  STATUS_COLOR,
  STATUSES,
  TECHNICAL_VALUES,
} from './libraryText';

const PAGE_SIZE = 10;

interface SelectFilters {
  status?: LibraryStatus;
  language?: LibraryLanguage;
  sectionType?: LibrarySectionType;
  technical?: LibraryTechnical;
}

/**
 * The answer library (REQ-031): every entry, newest first, with filters and a search. Opening a
 * row shows the panel of its state (REQ-032).
 */
export function AdminLibraryPage() {
  const { t, i18n } = useTranslation('admin');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [filters, setFilters] = useState<SelectFilters>({});
  const [page, setPage] = useState(1);
  // The row stays set while the drawer animates closed, so its content does not vanish first.
  const [openRow, setOpenRow] = useState<AdminLibraryEntry | null>(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const q = useDebouncedValue(search.trim(), 300);
  const categoryFilter = useDebouncedValue(category.trim(), 300);

  const entries = useLibraryEntries({
    ...filters,
    category: categoryFilter || undefined,
    q: q || undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const pages = entries.data
    ? Math.max(1, Math.ceil(entries.data.total / entries.data.pageSize))
    : 1;
  const isFiltered =
    Object.values(filters).some(Boolean) ||
    Boolean(q) ||
    Boolean(categoryFilter);

  function setFilter<K extends keyof SelectFilters>(
    name: K,
    value: SelectFilters[K],
  ) {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  }

  function formatDuration(durationMs: number | null): string {
    if (durationMs === null) return '—';
    return t('library.duration', {
      seconds: formatNumber(Math.round(durationMs / 1000), i18n.language),
    });
  }

  // A 403 from the API shows the same page as RequireRole (section 10).
  if (isApiError(entries.error) && entries.error.status === 403) {
    return <Navigate to="/forbidden" replace />;
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t('library.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('library.subtitle')}</p>
        </div>
        <SearchField
          aria-label={t('library.search')}
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          className="w-full sm:w-72"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t('library.search')} />
            <SearchField.ClearButton aria-label={t('library.clearSearch')} />
          </SearchField.Group>
        </SearchField>
      </header>

      <div
        role="group"
        aria-label={t('library.filters.label')}
        className="grid grid-cols-2 gap-3 lg:grid-cols-5"
      >
        <LibrarySelect
          label={t('library.filters.status')}
          allLabel={t('library.filters.all')}
          value={filters.status}
          options={STATUSES.map((id) => ({
            id,
            label: t(`library.status.${id}`),
          }))}
          onChange={(value) => setFilter('status', value)}
        />
        <LibrarySelect
          label={t('library.filters.language')}
          allLabel={t('library.filters.all')}
          value={filters.language}
          options={LANGUAGES.map((id) => ({
            id,
            label: t(`language.${id}`, { ns: 'common' }),
          }))}
          onChange={(value) => setFilter('language', value)}
        />
        <TextField
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
          fullWidth
        >
          <Label>{t('library.filters.category')}</Label>
          <Input
            inputMode="numeric"
            maxLength={100}
            placeholder={t('library.filters.categoryPlaceholder')}
            className="min-h-11 md:min-h-9"
          />
        </TextField>
        <LibrarySelect
          label={t('library.filters.sectionType')}
          allLabel={t('library.filters.all')}
          value={filters.sectionType}
          options={SECTION_TYPES.map((id) => ({
            id,
            label: t(`library.sectionType.${id}`),
          }))}
          onChange={(value) => setFilter('sectionType', value)}
        />
        <LibrarySelect
          label={t('library.filters.technical')}
          allLabel={t('library.filters.all')}
          value={filters.technical}
          options={TECHNICAL_VALUES.map((id) => ({
            id,
            label: t(`library.technical.${id}`),
          }))}
          onChange={(value) => setFilter('technical', value)}
        />
      </div>

      {entries.isPending ? (
        <LoadingState />
      ) : entries.isError ? (
        <ErrorState onRetry={() => void entries.refetch()} />
      ) : entries.data.items.length === 0 ? (
        <EmptyState
          description={isFiltered ? t('library.noMatch') : t('library.empty')}
        />
      ) : (
        <Card
          className={cn('gap-0 p-2', entries.isPlaceholderData && 'opacity-60')}
        >
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content
                aria-label={t('library.title')}
                className="min-w-[760px]"
                onRowAction={(id) => {
                  const row = entries.data.items.find((item) => item.id === id);
                  if (!row) return;
                  setOpenRow(row);
                  setPanelOpen(true);
                }}
              >
                <Table.Header>
                  <Table.Column isRowHeader>
                    {t('library.columns.question')}
                  </Table.Column>
                  <Table.Column>{t('library.columns.key')}</Table.Column>
                  <Table.Column>
                    {t('library.columns.categoryTitle')}
                  </Table.Column>
                  <Table.Column>
                    {t('library.columns.sectionType')}
                  </Table.Column>
                  <Table.Column>{t('library.columns.status')}</Table.Column>
                  <Table.Column>{t('library.columns.duration')}</Table.Column>
                </Table.Header>
                {/*
                  React Aria caches the rows of a collection. `dependencies` re-renders them when
                  the language changes, so the status and section names follow it.
                */}
                <Table.Body
                  items={entries.data.items}
                  dependencies={[i18n.language]}
                >
                  {(entry) => (
                    <Table.Row id={entry.id} className="cursor-pointer">
                      <Table.Cell className="max-w-80 text-start font-medium">
                        {/* `bdi` keeps a Persian question in order without moving it off the start. */}
                        <span className="line-clamp-2">
                          <bdi>{entry.question}</bdi>
                        </span>
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted whitespace-nowrap">
                        <span dir="ltr">{entry.key}</span>
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted">
                        <bdi>{entry.categoryTitle}</bdi>
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted whitespace-nowrap">
                        {t(`library.sectionType.${entry.sectionType}`)}
                      </Table.Cell>
                      <Table.Cell className="text-start">
                        <Chip
                          color={STATUS_COLOR[entry.status]}
                          variant="soft"
                          size="sm"
                        >
                          {t(`library.status.${entry.status}`)}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell className="text-start text-muted whitespace-nowrap">
                        {formatDuration(entry.durationMs)}
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>

            <Table.Footer>
              <Pagination size="sm" className="w-full px-2 py-1">
                <Pagination.Summary>
                  {t('library.pagination.summary', {
                    page: entries.data.page,
                    pages,
                    count: entries.data.total,
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
                      <span>{t('library.pagination.previous')}</span>
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
                          aria-label={t('library.pagination.goToPage', {
                            page: item,
                          })}
                          onPress={() => setPage(item)}
                        >
                          {formatNumber(item, i18n.language)}
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
                      <span>{t('library.pagination.next')}</span>
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </Table.Footer>
          </Table>
        </Card>
      )}

      <Drawer.Backdrop isOpen={isPanelOpen} onOpenChange={setPanelOpen}>
        {/* The panel opens from the end side: right in English, left in Persian. */}
        <Drawer.Content placement={i18n.dir() === 'rtl' ? 'left' : 'right'}>
          <Drawer.Dialog className="w-full sm:max-w-2xl">
            <Drawer.CloseTrigger />
            {openRow ? (
              <EntryPanelContent key={openRow.id} row={openRow} />
            ) : null}
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </section>
  );
}
