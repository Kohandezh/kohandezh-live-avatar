import {
  act,
  configure,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { toast } from '@heroui/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMockApi, mockSession, resetMockLibrary } from '@/data/mock';
import { loadInitialSettings, setLanguage } from '@/features/settings';
import { i18n } from '@/i18n';
import {
  adminLibraryEntryPageSchema,
  type AdminLibraryEntry,
} from '@/entities/library-entry';
import { AdminLibraryPage } from '@/pages/admin/library/AdminLibraryPage';
import { apiClient } from '@/shared/api';
import { renderWithProviders } from '../utils/renderWithProviders';

/*
 * The seed of src/data/mock/handlers.ts holds one entry in each status, all in Persian and
 * category 4, except the two published ones in category 3:
 *   C3Q01 published identity, C3Q02 published sizing, C4Q01 pending (technical),
 *   C4Q02 ready, C4Q03 draft (video 55555555-...-503), C4Q04 withdrawn.
 * The list is newest first, so the rows run C4Q04 down to C3Q01.
 */

/**
 * This page renders five HeroUI Selects and a React Aria table, which is slow in jsdom when the
 * whole suite runs in parallel. The default 5 s per test was not enough on a loaded machine.
 */
const UI_TEST_TIMEOUT = 20_000;

// For the same reason, every findBy and waitFor here waits up to 5 s, not 1 s. Vitest isolates
// test files, so this setting stays in this file.
configure({ asyncUtilTimeout: 5_000 });

let requests: InternalAxiosRequestConfig[] = [];
let mockAdapter: AxiosAdapter;

/** One answer the next matching request gets instead of the mock's, then the mock again. */
let override:
  | ((config: InternalAxiosRequestConfig) => AxiosResponse | undefined)
  | undefined;

function reply(
  config: InternalAxiosRequestConfig,
  data: unknown,
  status = 200,
): AxiosResponse {
  return { data, status, statusText: 'OK', headers: {}, config };
}

beforeEach(() => {
  installMockApi(apiClient, { delayMs: 0 });
  mockAdapter = apiClient.defaults.adapter as AxiosAdapter;
  requests = [];
  override = undefined;
  // Records every request, and lets one test answer a request the mock cannot (a video file,
  // a server error).
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    const answer = override?.(config);
    if (answer) {
      if (answer.status >= 400) {
        throw new AxiosError(
          'failed',
          'ERR_BAD_RESPONSE',
          config,
          null,
          answer,
        );
      }
      return answer;
    }
    return mockAdapter(config);
  };
  resetMockLibrary();
  mockSession.set('u-admin');
});

afterEach(() => {
  apiClient.defaults.adapter = mockAdapter;
  // The toast queue is global, so a toast would otherwise show up in the next test.
  toast.clear();
});

async function renderPage(locale: 'en' | 'fa' = 'en') {
  // LanguageSync resets i18n to the store's language, so a Persian render needs both.
  if (locale === 'fa') await i18n.changeLanguage('fa');
  return renderWithProviders(
    <Routes>
      <Route path="/library" element={<AdminLibraryPage />} />
      <Route path="/forbidden" element={<p>forbidden page</p>} />
    </Routes>,
    {
      route: '/library',
      locale,
      preloadedState: {
        settings: { ...loadInitialSettings(), language: locale },
      },
    },
  );
}

/**
 * The list itself. HeroUI's Select also renders a hidden native <select>, so a status name
 * appears in its options too; list assertions look inside the table only.
 */
function table() {
  return screen.getByRole('grid');
}

/** The list's data rows, without the header row. */
function dataRows() {
  return screen.getAllByRole('row').slice(1);
}

/** The row that holds `key`. */
function rowOf(key: string) {
  const row = screen.getByText(key).closest('[role="row"]');
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${key}`);
  return row;
}

/**
 * Waits for the list to hold exactly these keys. The old page stays on screen while the next one
 * loads (keepPreviousData), so a plain find would pass on the old rows.
 */
async function expectKeys(keys: string[]) {
  await waitFor(() =>
    // The key is the second column, after the question.
    expect(
      dataRows().map(
        (row) =>
          row.querySelectorAll('[role="rowheader"], [role="gridcell"]')[1]
            ?.textContent,
      ),
    ).toEqual(keys),
  );
}

function listRequests() {
  return requests.filter(
    (config) =>
      config.method === 'get' && config.url === '/api/admin/library/entries',
  );
}

function lastListParams() {
  return listRequests().at(-1)?.params as Record<string, unknown>;
}

function writes() {
  return requests
    .filter((config) => config.method === 'patch')
    .map((config) => ({
      url: config.url,
      body: JSON.parse(String(config.data)) as Record<string, unknown>,
    }));
}

/** Reads an entry straight from the mock, the way the server holds it now. */
async function serverEntry(key: string): Promise<AdminLibraryEntry> {
  const { data } = await apiClient.get('/api/admin/library/entries', {
    params: { q: key },
  });
  const entry = adminLibraryEntryPageSchema
    .parse(data)
    .items.find((item) => item.key === key);
  if (!entry) throw new Error(`no entry ${key}`);
  return entry;
}

/**
 * Picks an option of a HeroUI Select. The trigger's accessible name is "<value> <label>" (React
 * Aria composes both), so it is matched on the label part.
 */
async function choose(
  user: UserEvent,
  label: RegExp,
  option: string,
  scope: Pick<typeof screen, 'getByRole'> = screen,
) {
  await user.click(scope.getByRole('button', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/**
 * The counter is two elements side by side: the text of
 * `library.rules.counter` on its own, and the limit it is measured against.
 */
function expectCounter(panel: HTMLElement, count: string, limit: string) {
  const countElement = within(panel).getByText(count);
  const group = countElement.parentElement;
  if (!group) throw new Error('the counter has no parent');
  expect(within(group).getByText(limit)).toBeInTheDocument();
}

async function openEntry(user: UserEvent, key: string) {
  await user.click(await screen.findByText(key));
  return screen.findByRole('dialog', { name: `Answer ${key}` });
}

describe(
  'AdminLibraryPage list (REQ-031)',
  { timeout: UI_TEST_TIMEOUT },
  () => {
    it('shows loading, then every entry with its columns and status', async () => {
      await renderPage();

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(await screen.findByText('C4Q04')).toBeInTheDocument();

      for (const column of [
        'Question',
        'Key',
        'Category',
        'Section type',
        'Status',
        'Duration',
      ]) {
        expect(
          screen.getByRole('columnheader', { name: column }),
        ).toBeInTheDocument();
      }
      expect(dataRows()).toHaveLength(6);
      expect(dataRows()[0]).toHaveTextContent('C4Q04');
      expect(dataRows()[5]).toHaveTextContent('C3Q01');
      const draft = rowOf('C4Q03');
      expect(draft).toHaveTextContent('Waiting for video review');
      expect(draft).toHaveTextContent('12 s');
      expect(draft).toHaveTextContent('کاشت مو');
      expect(draft).toHaveTextContent('Knowledge');
      for (const status of [
        'Waiting for text approval',
        'Ready for video',
        'Withdrawn',
      ]) {
        expect(within(table()).getByText(status)).toBeInTheDocument();
      }
      expect(within(table()).getAllByText('Published')).toHaveLength(2);
    });

    it('filters by status', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await choose(user, /Status/, 'Published');

      await expectKeys(['C3Q02', 'C3Q01']);
      expect(lastListParams()).toMatchObject({ status: 'published', page: 1 });
    });

    it('filters by language, and says so when nothing matches', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await choose(user, /Answer language/, 'English');

      expect(
        await screen.findByText('No answers match these filters.'),
      ).toBeInTheDocument();
      expect(lastListParams()).toMatchObject({ language: 'en' });

      await choose(user, /Answer language/, 'فارسی');
      await expectKeys(['C4Q04', 'C4Q03', 'C4Q02', 'C4Q01', 'C3Q02', 'C3Q01']);
      expect(lastListParams()).toMatchObject({ language: 'fa' });
    });

    it('filters by category number', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await user.type(screen.getByRole('textbox', { name: 'Category' }), '3');

      await expectKeys(['C3Q02', 'C3Q01']);
      expect(lastListParams()).toMatchObject({ category: '3' });
    });

    it('filters by section type', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await choose(user, /Section type/, 'Sizing');

      await expectKeys(['C3Q02']);
      expect(lastListParams()).toMatchObject({ sectionType: 'sizing' });
      expect(screen.getByText('Page 1 of 1 · 1 answer')).toBeInTheDocument();
    });

    it('filters by technical', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await choose(user, /Technical/, 'Technical');

      await expectKeys(['C4Q01']);
      expect(lastListParams()).toMatchObject({ technical: 'technical' });
    });

    it('sends every filter at once, and All removes one', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await choose(user, /Status/, 'Ready for video');
      await choose(user, /Technical/, 'Non-technical');
      await expectKeys(['C4Q02']);
      expect(lastListParams()).toMatchObject({
        status: 'ready',
        technical: 'non-technical',
      });

      await choose(user, /Status/, 'All');
      // Non-technical still applies: every seed entry but the technical pending one.
      await expectKeys(['C4Q04', 'C4Q03', 'C4Q02', 'C3Q02', 'C3Q01']);
      expect(lastListParams().status).toBeUndefined();
    });

    it('searches the key and the question', async () => {
      const user = userEvent.setup();
      await renderPage();
      await screen.findByText('C4Q04');

      await user.type(screen.getByRole('searchbox'), 'C4Q02');

      await expectKeys(['C4Q02']);
      expect(lastListParams()).toMatchObject({ q: 'C4Q02' });
    });

    it('pages through a long list', async () => {
      for (let index = 1; index <= 20; index += 1) {
        await apiClient.post('/api/admin/library/entries', {
          key: `K${String(index).padStart(2, '0')}`,
          question: `Question ${index}`,
          language: 'fa',
          category: '9',
          categoryTitle: 'Long list',
          sectionType: 'knowledge',
          technical: 'technical',
        });
      }
      const user = userEvent.setup();
      await renderPage();

      expect(await screen.findByText(/Page 1 of 3/)).toBeInTheDocument();
      expect(screen.getByText('K20')).toBeInTheDocument();
      expect(dataRows()).toHaveLength(10);

      await user.click(screen.getByRole('button', { name: 'Next' }));

      expect(await screen.findByText(/Page 2 of 3/)).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByText('K20')).not.toBeInTheDocument(),
      );
      expect(screen.getByText('K10')).toBeInTheDocument();
      expect(lastListParams()).toMatchObject({ page: 2, pageSize: 10 });
    });

    it('shows the empty library message when there is no entry at all', async () => {
      override = (config) =>
        config.url === '/api/admin/library/entries'
          ? reply(config, { items: [], total: 0, page: 1, pageSize: 10 })
          : undefined;
      await renderPage();

      expect(
        await screen.findByText(
          'No answers yet. Record one, or import the answer files on the server.',
        ),
      ).toBeInTheDocument();
    });

    it('shows an error with a retry that loads the list again', async () => {
      let failures = 1;
      override = (config) => {
        if (config.url !== '/api/admin/library/entries' || failures === 0) {
          return undefined;
        }
        failures -= 1;
        return reply(config, { error: { code: 'internal_error' } }, 500);
      };
      const user = userEvent.setup();
      await renderPage();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Something went wrong',
      );
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('C4Q04')).toBeInTheDocument();
    });

    it('sends a non-admin to the forbidden page on a 403 (section 10)', async () => {
      mockSession.set('u-user');
      await renderPage();

      expect(await screen.findByText('forbidden page')).toBeInTheDocument();
    });

    it('renders right to left in Persian with the spec wording', async () => {
      await renderPage('fa');

      expect(
        await screen.findByRole('heading', { name: 'کتابخانه پاسخ‌ها' }),
      ).toBeInTheDocument();
      await screen.findByText('C4Q03');
      expect(
        within(table()).getByText('در انتظار بررسی ویدیو'),
      ).toBeInTheDocument();
    });

    it('writes the page count in Persian digits in Persian', async () => {
      await renderPage('fa');
      await screen.findByText('C4Q03');

      expect(screen.getByText('صفحه ۱ از ۱ · ۶ پاسخ')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'رفتن به صفحه ۱' }),
      ).toHaveTextContent('۱');
    });
    it('translates the rows again when the language changes', async () => {
      const { store } = await renderPage();
      await screen.findByText('C4Q03');
      expect(rowOf('C4Q03')).toHaveTextContent('Waiting for video review');

      await act(async () => {
        store.dispatch(setLanguage('fa'));
      });

      await waitFor(() =>
        expect(rowOf('C4Q03')).toHaveTextContent('در انتظار بررسی ویدیو'),
      );
      expect(rowOf('C4Q03')).toHaveTextContent('دانش');
    });
  },
);

describe(
  'AdminLibraryPage panel per status (REQ-032, SC-020)',
  { timeout: UI_TEST_TIMEOUT },
  () => {
    it('pending: the editor with the rules, Mark ready and Withdraw only', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');

      expect(
        within(panel).getByText('Waiting for text approval'),
      ).toBeInTheDocument();
      expect(
        within(panel).getByText(
          'پاسخ اصلی و بلند نمونه، پیش از بازنویسی برای گفتار.',
        ),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('textbox', { name: 'Spoken answer' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Withdraw' }),
      ).toBeInTheDocument();
      for (const absent of [
        'Publish',
        'Reject video',
        'Unpublish',
        'Reopen text',
      ]) {
        expect(
          within(panel).queryByRole('button', { name: absent }),
        ).not.toBeInTheDocument();
      }
    });

    it('ready: editable labels, the answer read only, the hint, Reopen and Withdraw', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');

      expect(
        within(panel).getByText(
          'Record this answer here, or export it for a render run on the render server. Both need an active LiveAvatar account.',
        ),
      ).toBeInTheDocument();
      expect(within(panel).getByText('پاسخ گفتاری نمونه.')).toBeInTheDocument();
      expect(
        within(panel).queryByRole('textbox', { name: 'Spoken answer' }),
      ).not.toBeInTheDocument();
      expect(
        within(panel).getByRole('textbox', { name: 'Question' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Reopen text' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Withdraw' }),
      ).toBeInTheDocument();
      for (const absent of ['Publish', 'Mark ready', 'Unpublish']) {
        expect(
          within(panel).queryByRole('button', { name: absent }),
        ).not.toBeInTheDocument();
      }
    });

    it('draft: plays the video fetched as a blob, with Publish, Reject video and Withdraw', async () => {
      override = (config) =>
        config.url?.startsWith('/api/assets/video/')
          ? reply(
              config,
              new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'video/mp4' }),
            )
          : undefined;
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q03');

      const video = await within(panel).findByLabelText(
        'Video of answer C4Q03',
      );
      expect(video.tagName).toBe('VIDEO');
      expect(video.getAttribute('src')).toMatch(/^blob:/);
      const download = requests.find((config) =>
        config.url?.startsWith('/api/assets/video/'),
      );
      expect(download?.url).toBe(
        '/api/assets/video/55555555-5555-4555-8555-555555555503',
      );
      expect(download?.responseType).toBe('blob');
      for (const action of ['Publish', 'Reject video', 'Withdraw']) {
        expect(
          within(panel).getByRole('button', { name: action }),
        ).toBeInTheDocument();
      }
      expect(
        within(panel).getByRole('textbox', { name: 'Question' }),
      ).toBeInTheDocument();
    });

    it('draft: says so when the video cannot be loaded', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q03');

      // The mock holds no media, so the review player's request answers 404.
      expect(
        await within(panel).findByText('The video could not be loaded.'),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Publish' }),
      ).toBeInTheDocument();
    });

    it('published: read only with the note, Unpublish and Withdraw', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C3Q01');

      expect(
        within(panel).getByText(
          'A published answer cannot be edited. Unpublish it to edit it, then publish it again.',
        ),
      ).toBeInTheDocument();
      expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);
      expect(
        within(panel).getByRole('button', { name: 'Unpublish' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Withdraw' }),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByRole('button', { name: 'Save changes' }),
      ).not.toBeInTheDocument();
    });

    it('withdrawn: the texts only, no action', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q04');

      expect(within(panel).getByText('Withdrawn')).toBeInTheDocument();
      expect(within(panel).getByText('پرسش نمونه')).toBeInTheDocument();
      expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);
      for (const absent of [
        'Withdraw',
        'Publish',
        'Unpublish',
        'Mark ready',
        'Reopen text',
        'Save changes',
      ]) {
        expect(
          within(panel).queryByRole('button', { name: absent }),
        ).not.toBeInTheDocument();
      }
    });
  },
);

describe(
  'AdminLibraryPage editor rules (REQ-073, SC-033)',
  { timeout: UI_TEST_TIMEOUT },
  () => {
    it('lists the six rules, linked to the answer field', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');

      const rules = within(panel).getByRole('region', {
        name: 'How to write the spoken answer',
      });
      expect(within(rules).getAllByRole('listitem')).toHaveLength(6);
      expect(rules).toHaveTextContent(
        'At most 350 characters, or 480 when the answer has a phone number.',
      );
      const field = within(panel).getByRole('textbox', {
        name: 'Spoken answer',
      });
      expect(field.getAttribute('aria-describedby')).toContain(rules.id);
    });

    it('counts the characters and warns above 350', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');
      const field = within(panel).getByRole('textbox', {
        name: 'Spoken answer',
      });

      await user.click(field);
      await user.paste('a'.repeat(350));
      expectCounter(panel, '350 characters', '350');
      expect(
        within(panel).queryByText(/Longer than 350 characters/),
      ).not.toBeInTheDocument();

      await user.paste('b');
      expectCounter(panel, '351 characters', '480');
      expect(
        within(panel).getByText(
          'Longer than 350 characters. This is allowed only when the answer has a phone number.',
        ),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      ).toBeEnabled();
    });

    it('counts after collapsing whitespace, as the server stores it', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');

      await user.click(
        within(panel).getByRole('textbox', { name: 'Spoken answer' }),
      );
      await user.paste('  one    two  ');

      expectCounter(panel, '7 characters', '350');
    });

    it('counts in Persian digits in Persian', async () => {
      const user = userEvent.setup();
      await renderPage('fa');
      await user.click(await screen.findByText('C4Q01'));
      const panel = await screen.findByRole('dialog', { name: 'پاسخ C4Q01' });

      await user.click(
        within(panel).getByRole('textbox', { name: 'پاسخ گفتاری' }),
      );
      await user.paste('سلام دکتر');

      expectCounter(panel, '۹ نویسه', '۳۵۰');
    });

    it('disables Mark ready above 480 characters', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');

      await user.click(
        within(panel).getByRole('textbox', { name: 'Spoken answer' }),
      );
      await user.paste('a'.repeat(481));

      expect(
        within(panel).getByText(
          'Longer than 480 characters. Shorten it before marking it ready.',
        ),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      ).toBeDisabled();
    });

    it('disables Mark ready while there is no spoken answer', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');

      expect(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      ).toBeDisabled();
    });
  },
);

describe(
  'AdminLibraryPage saving and state actions',
  { timeout: UI_TEST_TIMEOUT },
  () => {
    it('saves only the edited label fields of a ready entry', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');
      const question = within(panel).getByRole('textbox', { name: 'Question' });

      await user.clear(question);
      await user.type(question, 'پرسش ویرایش‌شده');
      await choose(user, /Section type/, 'Meeting', within(panel));
      await user.click(
        within(panel).getByRole('button', { name: 'Save changes' }),
      );

      expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
      expect(writes()).toEqual([
        {
          url: '/api/admin/library/entries/mock-library-ready',
          body: { question: 'پرسش ویرایش‌شده', sectionType: 'meeting' },
        },
      ]);
      const saved = await serverEntry('C4Q02');
      expect(saved).toMatchObject({
        question: 'پرسش ویرایش‌شده',
        sectionType: 'meeting',
        status: 'ready',
      });
      await waitFor(() =>
        expect(rowOf('C4Q02')).toHaveTextContent('پرسش ویرایش‌شده'),
      );
      expect(rowOf('C4Q02')).toHaveTextContent('Meeting');
    });

    it('saves the category fields of a draft entry', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q03');
      const category = within(panel).getByRole('textbox', {
        name: 'Category number',
      });
      const title = within(panel).getByRole('textbox', {
        name: 'Category title',
      });

      await user.clear(category);
      await user.type(category, '7');
      await user.clear(title);
      await user.type(title, 'هزینه');
      await choose(user, /Technical/, 'Technical', within(panel));
      await user.click(
        within(panel).getByRole('button', { name: 'Save changes' }),
      );

      expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
      expect(writes()[0]?.body).toEqual({
        category: '7',
        categoryTitle: 'هزینه',
        technical: 'technical',
      });
      expect(await serverEntry('C4Q03')).toMatchObject({
        category: '7',
        categoryTitle: 'هزینه',
        technical: 'technical',
        status: 'draft',
      });
    });

    it('keeps Save disabled until a field changes, and refuses an empty question', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');
      const save = within(panel).getByRole('button', { name: 'Save changes' });

      expect(save).toBeDisabled();
      await user.clear(
        within(panel).getByRole('textbox', { name: 'Question' }),
      );

      expect(
        within(panel).getByText('This field is required.'),
      ).toBeInTheDocument();
      expect(save).toBeDisabled();
    });

    it('saves the spoken answer, then marks the entry ready with fromStatus', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');

      await user.click(
        within(panel).getByRole('textbox', { name: 'Spoken answer' }),
      );
      await user.paste('پاسخ گفتاری تازه.');
      await user.click(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      );

      expect(
        await screen.findByText('Marked ready for video.'),
      ).toBeInTheDocument();
      expect(writes()).toEqual([
        {
          url: '/api/admin/library/entries/mock-library-pending',
          body: { answerText: 'پاسخ گفتاری تازه.' },
        },
        {
          url: '/api/admin/library/entries/mock-library-pending/status',
          body: { status: 'ready', fromStatus: 'pending' },
        },
      ]);
      expect(
        await within(panel).findByText('Ready for video'),
      ).toBeInTheDocument();
      expect(await serverEntry('C4Q01')).toMatchObject({
        status: 'ready',
        answerText: 'پاسخ گفتاری تازه.',
      });
    });

    it('reopens a ready entry', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');

      await user.click(
        within(panel).getByRole('button', { name: 'Reopen text' }),
      );

      expect(
        await screen.findByText('Text reopened for editing.'),
      ).toBeInTheDocument();
      expect(writes()).toEqual([
        {
          url: '/api/admin/library/entries/mock-library-ready/status',
          body: { status: 'pending', fromStatus: 'ready' },
        },
      ]);
      expect(
        await within(panel).findByRole('textbox', { name: 'Spoken answer' }),
      ).toHaveValue('پاسخ گفتاری نمونه.');
    });

    it('publishes a draft entry', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q03');

      await user.click(within(panel).getByRole('button', { name: 'Publish' }));

      expect(await screen.findByText('Answer published.')).toBeInTheDocument();
      expect(writes().at(-1)?.body).toEqual({
        status: 'published',
        fromStatus: 'draft',
      });
      expect(
        await within(panel).findByRole('button', { name: 'Unpublish' }),
      ).toBeInTheDocument();
      expect((await serverEntry('C4Q03')).status).toBe('published');
    });

    it('unpublishes a published entry', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C3Q01');

      await user.click(
        within(panel).getByRole('button', { name: 'Unpublish' }),
      );

      expect(
        await screen.findByText('Answer unpublished.'),
      ).toBeInTheDocument();
      expect(writes().at(-1)?.body).toEqual({
        status: 'draft',
        fromStatus: 'published',
      });
      expect((await serverEntry('C3Q01')).status).toBe('draft');
    });

    it('rejects the video only after the dialog confirms it (REQ-033)', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q03');

      await user.click(
        within(panel).getByRole('button', { name: 'Reject video' }),
      );
      let dialog = await screen.findByRole('alertdialog', {
        name: 'Reject video',
      });
      expect(dialog).toHaveTextContent(
        'Reject this video? It is deleted at the next daily cleanup. The answer goes back to Ready for video, and a new recording costs paid minutes.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(writes()).toEqual([]);

      await user.click(
        within(panel).getByRole('button', { name: 'Reject video' }),
      );
      dialog = await screen.findByRole('alertdialog', { name: 'Reject video' });
      await user.click(
        within(dialog).getByRole('button', { name: 'Reject video' }),
      );

      expect(await screen.findByText('Video rejected.')).toBeInTheDocument();
      expect(writes()).toEqual([
        {
          url: '/api/admin/library/entries/mock-library-draft/status',
          body: { status: 'ready', fromStatus: 'draft' },
        },
      ]);
      expect((await serverEntry('C4Q03')).status).toBe('ready');
    });

    it('withdraws only after the dialog confirms it (REQ-033)', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C3Q02');

      await user.click(within(panel).getByRole('button', { name: 'Withdraw' }));
      let dialog = await screen.findByRole('alertdialog', { name: 'Withdraw' });
      expect(dialog).toHaveTextContent(
        'Withdraw this answer? Users stop seeing it now. Its video is deleted at the next daily cleanup and cannot be restored.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(writes()).toEqual([]);

      await user.click(within(panel).getByRole('button', { name: 'Withdraw' }));
      dialog = await screen.findByRole('alertdialog', { name: 'Withdraw' });
      await user.click(
        within(dialog).getByRole('button', { name: 'Withdraw' }),
      );

      expect(await screen.findByText('Answer withdrawn.')).toBeInTheDocument();
      expect(writes()).toEqual([
        {
          url: '/api/admin/library/entries/mock-library-sizing/status',
          body: { status: 'withdrawn', fromStatus: 'published' },
        },
      ]);
      expect(await within(panel).findByText('Withdrawn')).toBeInTheDocument();
      expect(
        within(panel).queryByRole('button', { name: 'Withdraw' }),
      ).not.toBeInTheDocument();
      // The pressed button is gone, so focus moves to the panel heading, not to the page body.
      await waitFor(() =>
        expect(
          within(panel).getByRole('heading', { name: 'Answer C3Q02' }),
        ).toHaveFocus(),
      );
    });

    it('on a stale 409, says the answer changed, shows its current state and keeps the typed text', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');
      const question = within(panel).getByRole('textbox', { name: 'Question' });
      await user.clear(question);
      await user.type(question, 'پرسش تازه من');

      // Another admin reopens the text meanwhile.
      await apiClient.patch(
        '/api/admin/library/entries/mock-library-ready/status',
        {
          status: 'pending',
          fromStatus: 'ready',
        },
      );
      await user.click(
        within(panel).getByRole('button', { name: 'Reopen text' }),
      );

      expect(
        await within(panel).findByText(
          'This answer changed in the meantime. The page now shows its current state.',
        ),
      ).toBeInTheDocument();
      expect(
        await within(panel).findByText('Waiting for text approval'),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('textbox', { name: 'Question' }),
      ).toHaveValue('پرسش تازه من');
      expect(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      ).toBeInTheDocument();
    });

    it('after a 409 that locks the spoken answer, keeps the typed text next to the server text (section 8)', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q01');
      await user.click(
        within(panel).getByRole('textbox', { name: 'Spoken answer' }),
      );
      await user.paste('متن تایپ‌شده من که هنوز ذخیره نشده است.');

      // Another admin writes a different answer and marks the entry ready meanwhile.
      await apiClient.patch('/api/admin/library/entries/mock-library-pending', {
        answerText: 'متن ادمین دیگر.',
      });
      await apiClient.patch(
        '/api/admin/library/entries/mock-library-pending/status',
        { status: 'ready', fromStatus: 'pending' },
      );
      await user.click(
        within(panel).getByRole('button', { name: 'Mark ready' }),
      );

      expect(
        await within(panel).findByText(
          'This answer changed in the meantime. The page now shows its current state.',
        ),
      ).toBeInTheDocument();
      expect(
        await within(panel).findByText('Ready for video'),
      ).toBeInTheDocument();
      expect(within(panel).getByText('متن ادمین دیگر.')).toBeInTheDocument();
      const unsaved = within(panel).getByRole('region', {
        name: 'Your unsaved text (Spoken answer)',
      });
      expect(unsaved).toHaveTextContent(
        'متن تایپ‌شده من که هنوز ذخیره نشده است.',
      );

      await user.click(
        within(unsaved).getByRole('button', { name: 'Dismiss' }),
      );

      expect(
        within(panel).queryByRole('region', {
          name: 'Your unsaved text (Spoken answer)',
        }),
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByText('متن تایپ‌شده من که هنوز ذخیره نشده است.'),
      ).not.toBeInTheDocument();
    });

    it('after a 409 that publishes the entry, keeps the typed question', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q03');
      const question = within(panel).getByRole('textbox', { name: 'Question' });
      await user.clear(question);
      await user.type(question, 'پرسش تازه‌ای که ذخیره نشد');

      // Another admin publishes it meanwhile; a published entry refuses every edit.
      await apiClient.patch(
        '/api/admin/library/entries/mock-library-draft/status',
        { status: 'published', fromStatus: 'draft' },
      );
      await user.click(within(panel).getByRole('button', { name: 'Publish' }));

      expect(
        await within(panel).findByText(
          'This answer changed in the meantime. The page now shows its current state.',
        ),
      ).toBeInTheDocument();
      expect(
        await within(panel).findByRole('button', { name: 'Unpublish' }),
      ).toBeInTheDocument();
      expect(
        within(panel).getByRole('region', {
          name: 'Your unsaved text (Question)',
        }),
      ).toHaveTextContent('پرسش تازه‌ای که ذخیره نشد');
    });

    it('shows no unsaved text when nothing typed differs from the server', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');

      await user.click(
        within(panel).getByRole('button', { name: 'Reopen text' }),
      );

      expect(
        await within(panel).findByText('Waiting for text approval'),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByText('Your unsaved text'),
      ).not.toBeInTheDocument();
    });

    it('shows an error with a retry, not the old status, when the entry cannot be read again', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C4Q02');
      // The panel reads the entry again through the list search on its key.
      let failing = true;
      override = (config) =>
        failing &&
        config.url === '/api/admin/library/entries' &&
        (config.params as Record<string, unknown> | undefined)?.q === 'C4Q02'
          ? reply(config, { error: { code: 'internal_error' } }, 500)
          : undefined;

      await user.click(
        within(panel).getByRole('button', { name: 'Reopen text' }),
      );

      expect(
        await within(panel).findByText('This answer could not be loaded.'),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByText('Ready for video'),
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByText('Waiting for text approval'),
      ).not.toBeInTheDocument();
      expect(
        within(panel).queryByRole('button', { name: 'Reopen text' }),
      ).not.toBeInTheDocument();

      failing = false;
      await user.click(within(panel).getByRole('button', { name: 'Retry' }));

      expect(
        await within(panel).findByText('Waiting for text approval'),
      ).toBeInTheDocument();
      expect(
        within(panel).queryByText('This answer could not be loaded.'),
      ).not.toBeInTheDocument();
    });

    it('shows the same message when the server refuses a transition the screen allowed', async () => {
      const user = userEvent.setup();
      await renderPage();
      const panel = await openEntry(user, 'C3Q01');

      // The real backend sends `details.currentStatus`; the mock never does, so this answer is faked.
      override = (config) =>
        config.method === 'patch'
          ? reply(
              config,
              {
                error: {
                  code: 'invalid_status_transition',
                  details: { currentStatus: 'draft' },
                },
              },
              409,
            )
          : undefined;
      await user.click(
        within(panel).getByRole('button', { name: 'Unpublish' }),
      );

      expect(
        await within(panel).findByText(
          'This answer changed in the meantime. The page now shows its current state.',
        ),
      ).toBeInTheDocument();
    });
  },
);
