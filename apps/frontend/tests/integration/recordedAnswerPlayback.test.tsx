import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from 'axios';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

// The live assistant is not what these tests are about, but Start still has to reach the
// backend POST, so the SDK is the same fake the other conversation tests use.
vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import { installMockApi, mockSession, resetMockLibrary } from '@/data/mock';
import { ConversationLiveProvider } from '@/features/navigation';
import { loadInitialSettings } from '@/features/settings';
import { AudioConversationPage } from '@/pages/conversation/AudioConversationPage';
import { VideoConversationPage } from '@/pages/conversation/VideoConversationPage';
import { apiClient } from '@/shared/api';
import { CONTACT_CHANNELS } from '@/features/answer-library/contactChannels';
import en from '@/i18n/locales/en/common.json';
import fa from '@/i18n/locales/fa/common.json';
import { resetLiveAvatarSdkMock, sdkState } from '../utils/liveAvatarSdkMock';
import {
  MOCK_LIBRARY,
  servePersianLibraryToEnglishScreens,
} from '../utils/persianLibrary';
import { renderWithProviders } from '../utils/renderWithProviders';

const {
  firstQuestion: FIRST_QUESTION,
  firstAnswer: FIRST_ANSWER,
  firstId: FIRST_ID,
  secondQuestion: SECOND_QUESTION,
} = MOCK_LIBRARY;
const LIST = { name: en.library.suggestionsTitle } as const;
const LEAD = { name: en.library.lead.title } as const;
const FOLLOW_UPS = { name: en.library.lead.followUpsTitle } as const;

type Page = typeof VideoConversationPage;

function renderPage(Page: Page, locale: 'en' | 'fa' = 'en') {
  return renderWithProviders(
    <ConversationLiveProvider>
      <Page />
    </ConversationLiveProvider>,
    {
      route: '/video',
      locale,
      // `LanguageSync` switches i18n to the store's language, so the store starts in it too.
      preloadedState: { settings: { ...loadInitialSettings(), language: locale } },
    },
  );
}

/** What each request looked like, in order, with the moment it was sent. */
let sent: { config: InternalAxiosRequestConfig; at: number }[];
let clock: number;
let events: string[];
/** Replaces the mock's answer for the video route, when a test sets it. */
let videoOverride: ((config: InternalAxiosRequestConfig) => Promise<never>) | null;
let suggestionsOverride:
  | ((config: InternalAxiosRequestConfig) => Promise<unknown>)
  | null;
let followUpsOverride:
  | ((config: InternalAxiosRequestConfig) => Promise<unknown>)
  | null;

function isFollowUps(config: InternalAxiosRequestConfig): boolean {
  return /\/api\/library\/answers\/[^/]+\/follow-ups$/.test(config.url ?? '');
}

function isVideo(config: InternalAxiosRequestConfig): boolean {
  return /\/api\/library\/answers\/[^/]+\/video$/.test(config.url ?? '');
}

function failWith(status: number | null, code?: string) {
  return (config: InternalAxiosRequestConfig): Promise<never> =>
    Promise.reject(
      status === null
        ? new AxiosError('failed', code ?? AxiosError.ERR_NETWORK, config)
        : new AxiosError('failed', AxiosError.ERR_BAD_REQUEST, config, undefined, {
            data: { error: { code: 'x', message: 'x' } },
            status,
            statusText: '',
            headers: {},
            config,
          }),
    );
}

let playSpy: MockInstance<HTMLMediaElement['play']>;
let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  resetLiveAvatarSdkMock();
  resetMockLibrary();
  installMockApi(apiClient, { delayMs: 0 });
  servePersianLibraryToEnglishScreens();
  mockSession.set('u-user');
  sent = [];
  clock = 0;
  events = [];
  videoOverride = null;
  suggestionsOverride = null;
  followUpsOverride = null;

  const inner = apiClient.defaults.adapter as AxiosAdapter;
  apiClient.defaults.adapter = async (config) => {
    sent.push({ config, at: (clock += 1) });
    events.push(`${config.method?.toUpperCase()} ${config.url}`);
    if (isVideo(config) && videoOverride) return videoOverride(config);
    if (isFollowUps(config) && followUpsOverride) {
      return (await followUpsOverride(config)) as Awaited<ReturnType<AxiosAdapter>>;
    }
    if (config.url === '/api/library/suggestions' && suggestionsOverride) {
      return (await suggestionsOverride(config)) as Awaited<ReturnType<AxiosAdapter>>;
    }
    return inner(config);
  };

  playSpy = vi
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (this.hasAttribute('src')) events.push('pause');
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  let count = 0;
  URL.createObjectURL = vi.fn(() => `blob:answer-${(count += 1)}`);
  revokeSpy = vi.fn((url: string) => {
    events.push(`revoke ${url}`);
  });
  URL.revokeObjectURL = revokeSpy;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function tapQuestion(
  user: ReturnType<typeof userEvent.setup>,
  question: string = FIRST_QUESTION,
) {
  const list = await screen.findByRole('list', LIST);
  await user.click(within(list).getByRole('button', { name: question }));
}

describe('suggested questions under Start (REQ-051, REQ-056)', () => {
  it.each([
    ['/video', VideoConversationPage],
    ['/audio', AudioConversationPage],
  ] as const)('%s lists the questions of the screen language under Start', async (_route, Page) => {
    renderPage(Page);

    const list = await screen.findByRole('list', LIST);
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      FIRST_QUESTION,
      SECOND_QUESTION,
    ]);
    const request = sent.find((entry) => entry.config.url === '/api/library/suggestions');
    expect(request?.config.params).toMatchObject({ language: 'en' });
    // Start is still there and still pressable.
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeEnabled();
  });

  it('asks for Persian questions on a Persian screen', async () => {
    renderPage(VideoConversationPage, 'fa');

    await screen.findByRole('list', { name: 'پرسش‌های پیشنهادی' });
    const request = sent.find((entry) => entry.config.url === '/api/library/suggestions');
    expect(request?.config.params).toMatchObject({ language: 'fa' });
  });

  it('renders nothing under Start for an empty library (section 10, empty)', async () => {
    suggestionsOverride = async (config) => ({
      data: { items: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    });
    renderPage(VideoConversationPage);

    await waitFor(() =>
      expect(
        sent.some((entry) => entry.config.url === '/api/library/suggestions'),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(screen.queryByRole('list', LIST)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', LIST)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('a failed list shows a compact error with a working Retry, and Start still works', async () => {
    suggestionsOverride = failWith(500);
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    expect(
      await screen.findByText(en.library.suggestionsError),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeEnabled();

    suggestionsOverride = null;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('list', LIST)).toBeInTheDocument();
  });

  it('disables the questions while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderPage(VideoConversationPage);

    const list = await screen.findByRole('list', LIST);
    for (const button of within(list).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});

describe('playing a recorded answer on /video (REQ-052, REQ-055, REQ-057, SC-013)', () => {
  it('downloads the whole file as a blob and plays it with the label and the caption', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(VideoConversationPage);

    await tapQuestion(user);

    expect(await screen.findByText(en.library.recordedLabel)).toBeInTheDocument();
    const caption = screen.getByRole('region', { name: en.library.captionLabel });
    expect(caption).toHaveTextContent(FIRST_ANSWER);

    const video = sent.find((entry) => isVideo(entry.config));
    expect(video?.config.responseType).toBe('blob');
    expect(playSpy).toHaveBeenCalled();

    // No element points at the API: the only media source is the local blob URL.
    const sources = Array.from(container.ownerDocument.querySelectorAll('[src]')).map(
      (element) => element.getAttribute('src') ?? '',
    );
    expect(sources.some((source) => source.includes('/api/'))).toBe(false);
    expect(sources).toContain('blob:answer-1');
    // The recorded player is its own element, not the live stage's.
    const live = screen.getByLabelText('Assistant video');
    expect(live.hasAttribute('src')).toBe(false);
  });

  it('while the file downloads: a spinner on the tapped question, the others disabled, a polite line and Stop', async () => {
    let release: (value: never) => void = () => {};
    videoOverride = () =>
      new Promise<never>((resolve) => {
        release = resolve;
      });
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    await tapQuestion(user);

    const list = screen.getByRole('list', LIST);
    const tapped = within(list).getByRole('button', { name: FIRST_QUESTION });
    const other = within(list).getByRole('button', { name: SECOND_QUESTION });
    expect(tapped).toHaveAttribute('data-pending', 'true');
    expect(other).toBeDisabled();
    const line = screen.getByText(en.library.loading);
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: en.library.stop })).toBeInTheDocument();
    release(undefined as never);
  });

  it('hides the list from the moment playback starts; Start stays', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    await tapQuestion(user);
    await screen.findByText(en.library.recordedLabel);

    expect(screen.queryByRole('list', LIST)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.library.stop })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeInTheDocument();
  });

  it('Stop revokes the URL and shows the lead card with focus on its heading (REQ-061, SC-016)', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    await tapQuestion(user);
    await screen.findByText(en.library.recordedLabel);

    await user.click(screen.getByRole('button', { name: en.library.stop }));

    expect(revokeSpy).toHaveBeenCalledWith('blob:answer-1');
    const card = await screen.findByRole('region', LEAD);
    await waitFor(() =>
      expect(within(card).getByRole('heading', LEAD)).toHaveFocus(),
    );
    // The lead card is in the list's place.
    expect(screen.queryByRole('list', LIST)).not.toBeInTheDocument();
    expect(screen.queryByText(en.library.recordedLabel)).not.toBeInTheDocument();
  });

  it('the end of the answer does the same (SC-016)', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(VideoConversationPage);
    await tapQuestion(user, SECOND_QUESTION);
    await screen.findByText(en.library.recordedLabel);

    const player = container.ownerDocument.querySelector('video[src^="blob:"]');
    expect(player).not.toBeNull();
    fireEvent.ended(player as HTMLVideoElement);

    expect(revokeSpy).toHaveBeenCalledWith('blob:answer-1');
    const card = await screen.findByRole('region', LEAD);
    await waitFor(() =>
      expect(within(card).getByRole('heading', LEAD)).toHaveFocus(),
    );
  });

  it('"Other questions" returns to the list with focus on the played question (REQ-061, SC-016)', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    await tapQuestion(user, SECOND_QUESTION);
    await screen.findByText(en.library.recordedLabel);
    await user.click(screen.getByRole('button', { name: en.library.stop }));
    const card = await screen.findByRole('region', LEAD);

    await user.click(
      within(card).getByRole('button', { name: en.library.lead.backToQuestions }),
    );

    const list = await screen.findByRole('list', LIST);
    await waitFor(() =>
      expect(within(list).getByRole('button', { name: SECOND_QUESTION })).toHaveFocus(),
    );
    expect(screen.queryByRole('region', LEAD)).not.toBeInTheDocument();
    // Start is back: the lead card no longer holds the primary action.
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeInTheDocument();
  });

  it('a refused autoplay shows "Tap to play the answer", which plays it (REQ-059)', async () => {
    playSpy.mockImplementationOnce(() =>
      Promise.reject(new DOMException('no gesture', 'NotAllowedError')),
    );
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    await tapQuestion(user);
    const tap = await screen.findByRole('button', { name: en.library.tapToPlay });

    await user.click(tap);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: en.library.tapToPlay }),
      ).not.toBeInTheDocument(),
    );
    expect(playSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText(en.library.recordedLabel)).toBeInTheDocument();
  });

  it('Start during playback pauses and revokes before the live session is requested (REQ-060, SC-015)', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    await tapQuestion(user);
    await screen.findByText(en.library.recordedLabel);
    events = [];

    await user.click(screen.getByRole('button', { name: 'Start the conversation' }));

    await waitFor(() =>
      expect(events).toContain('POST /api/assistant/session'),
    );
    const post = events.indexOf('POST /api/assistant/session');
    expect(events.indexOf('pause')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('pause')).toBeLessThan(post);
    expect(events.indexOf('revoke blob:answer-1')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('revoke blob:answer-1')).toBeLessThan(post);
    expect(screen.queryByText(en.library.recordedLabel)).not.toBeInTheDocument();
  });

  it('leaving the route stops playback and revokes the URL (REQ-063)', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(VideoConversationPage);
    await tapQuestion(user);
    await screen.findByText(en.library.recordedLabel);

    unmount();

    expect(events).toContain('pause');
    expect(revokeSpy).toHaveBeenCalledWith('blob:answer-1');
  });
});

describe('playing a recorded answer on /audio (REQ-058, SC-014)', () => {
  it('plays the sound with the orb speaking, the caption visible and no visible video', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(AudioConversationPage);

    await tapQuestion(user);

    await waitFor(() =>
      expect(
        container.querySelector('[data-sphere-state]')?.getAttribute('data-sphere-state'),
      ).toBe('agent'),
    );
    expect(screen.getByText(en.library.recordedLabel)).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: en.library.captionLabel }),
    ).toHaveTextContent(FIRST_ANSWER);
    // Every video on this screen sits inside the page's sr-only wrapper: heard, not seen.
    const videos = Array.from(container.querySelectorAll('video'));
    expect(videos.length).toBeGreaterThanOrEqual(2);
    for (const video of videos) {
      expect(video.closest('.sr-only')).not.toBeNull();
    }
  });

  it('a refused autoplay shows "Tap to play the answer" under the orb, not inside the hidden wrapper', async () => {
    playSpy.mockImplementationOnce(() =>
      Promise.reject(new DOMException('no gesture', 'NotAllowedError')),
    );
    const user = userEvent.setup();
    renderPage(AudioConversationPage);

    await tapQuestion(user);

    const tap = await screen.findByRole('button', { name: en.library.tapToPlay });
    expect(tap.closest('.sr-only')).toBeNull();
    expect(
      screen.queryByRole('region', { name: en.library.captionLabel }),
    ).not.toBeInTheDocument();
  });

  it('the orb rests again once the answer is stopped', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(AudioConversationPage);
    await tapQuestion(user);
    await screen.findByText(en.library.recordedLabel);

    await user.click(screen.getByRole('button', { name: en.library.stop }));

    await waitFor(() =>
      expect(
        container.querySelector('[data-sphere-state]')?.getAttribute('data-sphere-state'),
      ).toBe('idle'),
    );
  });
});

describe('when a recorded answer fails (section 8)', () => {
  it('a 404 says the answer is gone, refetches the list and the entry leaves it (REQ-062, SC-017)', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    await screen.findByRole('list', LIST);
    // An admin withdraws the answer after the list was loaded.
    mockSession.set('u-admin');
    await apiClient.patch(`/api/admin/library/entries/${FIRST_ID}/status`, {
      status: 'withdrawn',
    });
    mockSession.set('u-user');
    const listRequests = () =>
      sent.filter((entry) => entry.config.url === '/api/library/suggestions').length;
    const before = listRequests();

    await tapQuestion(user);

    expect(await screen.findByText(en.library.errors.notFound)).toBeInTheDocument();
    await waitFor(() => expect(listRequests()).toBe(before + 1));
    const list = await screen.findByRole('list', LIST);
    await waitFor(() =>
      expect(
        within(list).queryByRole('button', { name: FIRST_QUESTION }),
      ).not.toBeInTheDocument(),
    );
    // A 404 is not retried: the answer is gone.
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('a 429 says to wait and offers no Retry', async () => {
    videoOverride = failWith(429);
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    await tapQuestion(user);

    expect(await screen.findByText(en.library.errors.rateLimited)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    // The list returns under the error line.
    expect(screen.getByRole('list', LIST)).toBeInTheDocument();
  });

  it('a download with no response is "offline" even when the browser says online, with a working Retry', async () => {
    videoOverride = failWith(null);
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    await tapQuestion(user);

    expect(await screen.findByText(en.library.errors.offline)).toBeInTheDocument();
    const videoRequests = () => sent.filter((entry) => isVideo(entry.config)).length;
    expect(videoRequests()).toBe(1);

    videoOverride = null;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(en.library.recordedLabel)).toBeInTheDocument();
    expect(videoRequests()).toBe(2);
  });

  it('Retry is disabled while the device is offline, like the questions, and returns with the connection', async () => {
    videoOverride = failWith(null);
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    await tapQuestion(user);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(retry).toBeEnabled();

    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    for (const question of within(screen.getByRole('list', LIST)).getAllByRole('button')) {
      expect(question).toBeDisabled();
    }

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it.each([
    ['a timeout', null, 'ECONNABORTED'],
    ['a server error', 503, undefined],
  ] as const)('%s shows the generic line with Retry', async (_name, status, code) => {
    videoOverride = failWith(status, code);
    const user = userEvent.setup();
    renderPage(AudioConversationPage);

    await tapQuestion(user);

    expect(await screen.findByText(en.library.errors.generic)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('list', LIST)).toBeInTheDocument();
  });

  it('a media error while playing shows the generic line', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(VideoConversationPage);
    await tapQuestion(user);
    await screen.findByText(en.library.recordedLabel);

    const player = container.ownerDocument.querySelector('video[src^="blob:"]');
    act(() => {
      fireEvent.error(player as HTMLVideoElement);
    });

    expect(await screen.findByText(en.library.errors.generic)).toBeInTheDocument();
    expect(revokeSpy).toHaveBeenCalledWith('blob:answer-1');
  });
});

/** Plays `question` to its end with Stop, and returns the lead card that takes the list's place. */
async function finishAnswer(
  user: ReturnType<typeof userEvent.setup>,
  question: string = FIRST_QUESTION,
) {
  await tapQuestion(user, question);
  await screen.findByText(en.library.recordedLabel);
  await user.click(screen.getByRole('button', { name: en.library.stop }));
  return screen.findByRole('region', LEAD);
}

function okResponse(config: InternalAxiosRequestConfig, data: unknown) {
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
}

/** Every link's `href`, in page order. */
function hrefs(scope: HTMLElement): (string | null)[] {
  return within(scope)
    .getAllByRole('link')
    .map((link) => link.getAttribute('href'));
}

const CONTACT_HREFS = [
  ...CONTACT_CHANNELS.phones.map((phone) => phone.href),
  CONTACT_CHANNELS.email.href,
  CONTACT_CHANNELS.website.href,
];

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('the lead card after a recorded answer (REQ-075, REQ-076, SC-034)', () => {
  it.each([
    ['/video', VideoConversationPage],
    ['/audio', AudioConversationPage],
  ] as const)('%s shows it in place of the list and of Start, with its parts in order', async (_route, Page) => {
    const user = userEvent.setup();
    renderPage(Page);

    const card = await finishAnswer(user);

    const consult = within(card).getByRole('button', { name: en.library.lead.consult });
    expect(consult).toBeEnabled();
    expect(within(card).getByText(en.library.lead.consultHint)).toBeInTheDocument();
    const contact = within(card).getByRole('region', { name: en.library.lead.contactTitle });
    const followUps = await within(card).findByRole('list', FOLLOW_UPS);
    const back = within(card).getByRole('button', { name: en.library.lead.backToQuestions });
    expect(follows(consult, contact)).toBe(true);
    expect(follows(contact, followUps)).toBe(true);
    expect(follows(followUps, back)).toBe(true);

    // One primary action: the page's Start is hidden while the lead card shows.
    expect(
      screen.queryByRole('button', { name: 'Start the conversation' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('list', LIST)).not.toBeInTheDocument();
  });

  it('the contact card has four tel: links, a mailto: link and a website link, from contactChannels.ts only', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);
    const contact = within(card).getByRole('region', { name: en.library.lead.contactTitle });

    expect(hrefs(contact)).toEqual(CONTACT_HREFS);
    expect(
      within(contact).getByRole('link', { name: 'Call Office: 021 2623 0054' }),
    ).toHaveAttribute('href', 'tel:+982126230054');
    expect(
      within(contact).getByRole('link', { name: 'Call Office: 021 2623 0047' }),
    ).toHaveAttribute('href', 'tel:+982126230047');
    expect(
      within(contact).getByRole('link', { name: 'Call Sales: 021 7622 2351' }),
    ).toHaveAttribute('href', 'tel:+982176222351');
    expect(
      within(contact).getByRole('link', { name: 'Call Sales: 021 7622 2354' }),
    ).toHaveAttribute('href', 'tel:+982176222354');
  });

  it('the email and website links are named by their label and address; the website opens a new tab', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);

    const email = within(card).getByRole('link', {
      name: `${en.library.lead.email} info@kohansystemfarda.com`,
    });
    expect(email).toHaveAttribute('href', 'mailto:info@kohansystemfarda.com');
    expect(email).not.toHaveAttribute('target');

    const website = within(card).getByRole('link', {
      name: `${en.library.lead.website} kohansystemfarda.com`,
    });
    expect(website).toHaveAttribute('href', 'https://kohansystemfarda.com');
    expect(website).toHaveAttribute('target', '_blank');
    expect(website).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('numbers, the email and the website sit in left-to-right spans', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);

    for (const text of [
      '021 2623 0054',
      '021 2623 0047',
      '021 7622 2351',
      '021 7622 2354',
      'info@kohansystemfarda.com',
      'kohansystemfarda.com',
    ]) {
      expect(within(card).getByText(text).closest('[dir="ltr"]'), text).not.toBeNull();
    }
  });

  it('in Persian, the numbers use Persian digits, still grouped and left to right', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage, 'fa');
    const list = await screen.findByRole('list', { name: fa.library.suggestionsTitle });
    await user.click(within(list).getByRole('button', { name: FIRST_QUESTION }));
    await screen.findByText(fa.library.recordedLabel);
    await user.click(screen.getByRole('button', { name: fa.library.stop }));

    const card = await screen.findByRole('region', { name: fa.library.lead.title });
    const office = within(card).getByRole('link', { name: 'تماس با دفتر: ۰۲۱ ۲۶۲۳ ۰۰۵۴' });
    expect(office).toHaveAttribute('href', 'tel:+982126230054');
    expect(within(card).getByText('۰۲۱ ۲۶۲۳ ۰۰۵۴').closest('[dir="ltr"]')).not.toBeNull();
    expect(
      within(card).getByRole('link', { name: 'تماس با فروش: ۰۲۱ ۷۶۲۲ ۲۳۵۴' }),
    ).toHaveAttribute('href', 'tel:+982176222354');
    expect(
      within(card).getByRole('button', { name: fa.library.lead.consult }),
    ).toBeInTheDocument();
  });

  it('no response can change where a contact link points (SEC-007, SC-037)', async () => {
    followUpsOverride = (config) =>
      okResponse(config, {
        items: [
          {
            id: 'mock-library-sizing',
            question: 'tel:+10000000000',
            answerText: 'mailto:someone@example.com https://example.com',
            durationMs: 1000,
          },
        ],
      });
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);
    await within(card).findByRole('list', FOLLOW_UPS);

    expect(hrefs(card)).toEqual(CONTACT_HREFS);
  });
});

describe('the follow-ups on the lead card (REQ-077)', () => {
  it('asks for the follow-ups of the played answer and lists them under their heading', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    const card = await finishAnswer(user);

    const list = await within(card).findByRole('list', FOLLOW_UPS);
    expect(within(card).getByRole('heading', FOLLOW_UPS)).toBeInTheDocument();
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([SECOND_QUESTION]);
    expect(events).toContain(`GET /api/library/answers/${FIRST_ID}/follow-ups`);
  });

  it('a tap plays that answer like a suggestion, and its end shows the lead card again', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);
    const list = await within(card).findByRole('list', FOLLOW_UPS);

    await user.click(within(list).getByRole('button', { name: SECOND_QUESTION }));

    expect(await screen.findByText(en.library.recordedLabel)).toBeInTheDocument();
    expect(events).toContain('GET /api/library/answers/mock-library-sizing/video');
    expect(screen.queryByRole('region', LEAD)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.library.stop })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: en.library.stop }));

    const next = await screen.findByRole('region', LEAD);
    await waitFor(() => expect(within(next).getByRole('heading', LEAD)).toHaveFocus());
  });

  it('with no follow-up, neither the heading nor the list is rendered', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    // The sizing answer is stage 2; the mock has no stage 3 answer, so it has no follow-up.
    const card = await finishAnswer(user, SECOND_QUESTION);

    await waitFor(() =>
      expect(events).toContain('GET /api/library/answers/mock-library-sizing/follow-ups'),
    );
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
    expect(within(card).queryByRole('heading', FOLLOW_UPS)).not.toBeInTheDocument();
    expect(within(card).queryByRole('list', FOLLOW_UPS)).not.toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: en.library.lead.backToQuestions }),
    ).toBeInTheDocument();
  });

  it('a follow-ups error leaves the card working, with no follow-ups and no error shown (section 8)', async () => {
    let answered = false;
    followUpsOverride = async (config) => {
      answered = true;
      return failWith(500)(config);
    };
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    const card = await finishAnswer(user);

    await waitFor(() => expect(answered).toBe(true));
    await waitFor(() =>
      expect(within(card).queryByRole('heading', FOLLOW_UPS)).not.toBeInTheDocument(),
    );
    expect(within(card).queryByRole('list', FOLLOW_UPS)).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
    expect(hrefs(card)).toEqual(CONTACT_HREFS);
    expect(
      within(card).getByRole('button', { name: en.library.lead.consult }),
    ).toBeEnabled();
  });

  it('offline, the follow-ups are disabled and the contact links stay usable (section 10)', async () => {
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);
    const list = await within(card).findByRole('list', FOLLOW_UPS);

    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    for (const button of within(list).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    expect(hrefs(card)).toEqual(CONTACT_HREFS);
    for (const link of within(card).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-disabled');
    }

    // The online status is shared by the whole app, so the next test must find it online again.
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    for (const button of within(list).getAllByRole('button')) {
      expect(button).toBeEnabled();
    }
  });
});

describe('«Request a consultation» (REQ-060, REQ-075, SC-034)', () => {
  it.each([
    ['/video', VideoConversationPage],
    ['/audio', AudioConversationPage],
  ] as const)('%s starts the live session, and the card and its follow-ups leave once it is not idle', async (_route, Page) => {
    let release: () => void = () => {};
    sdkState.startGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderPage(Page);
    const card = await finishAnswer(user);
    await within(card).findByRole('list', FOLLOW_UPS);
    events = [];

    await user.click(within(card).getByRole('button', { name: en.library.lead.consult }));

    await waitFor(() => expect(events).toContain('POST /api/assistant/session'));
    await waitFor(() => expect(screen.queryByRole('region', LEAD)).not.toBeInTheDocument());
    expect(screen.queryByRole('list', FOLLOW_UPS)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', LIST)).not.toBeInTheDocument();
    release();
  });
});

describe('when the live start fails (REQ-078, SC-036)', () => {
  it.each([
    ['/video', VideoConversationPage],
    ['/audio', AudioConversationPage],
  ] as const)('%s: from the lead card, the existing error and under it the contact card', async (_route, Page) => {
    sdkState.startError = new Error('LiveAvatar inactive');
    const user = userEvent.setup();
    renderPage(Page);
    const card = await finishAnswer(user);
    await within(card).findByRole('list', FOLLOW_UPS);

    await user.click(within(card).getByRole('button', { name: en.library.lead.consult }));

    const title = await screen.findByText(en.assistant.errors.title);
    const fallback = await screen.findByRole('region', LEAD);
    expect(follows(title, fallback)).toBe(true);
    expect(within(fallback).getByText(en.library.lead.liveUnavailable)).toBeInTheDocument();
    expect(hrefs(fallback)).toEqual(CONTACT_HREFS);
    // The message is in place of the button; no follow-ups and no way back to a hidden list.
    expect(
      within(fallback).queryByRole('button', { name: en.library.lead.consult }),
    ).not.toBeInTheDocument();
    expect(within(fallback).queryByRole('list', FOLLOW_UPS)).not.toBeInTheDocument();
    expect(
      within(fallback).queryByRole('button', { name: en.library.lead.backToQuestions }),
    ).not.toBeInTheDocument();
    // The existing error keeps its Retry.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it.each([
    ['/video', VideoConversationPage],
    ['/audio', AudioConversationPage],
  ] as const)('%s: after a plain Start, the existing error alone', async (_route, Page) => {
    sdkState.startError = new Error('LiveAvatar inactive');
    const user = userEvent.setup();
    renderPage(Page);
    await screen.findByRole('list', LIST);

    await user.click(screen.getByRole('button', { name: 'Start the conversation' }));

    expect(await screen.findByText(en.assistant.errors.title)).toBeInTheDocument();
    expect(screen.queryByRole('region', LEAD)).not.toBeInTheDocument();
    expect(screen.queryByText(en.library.lead.liveUnavailable)).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('a plain Start after "Other questions" is a plain Start: its failure shows the error alone', async () => {
    sdkState.startError = new Error('LiveAvatar inactive');
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);
    await user.click(
      within(card).getByRole('button', { name: en.library.lead.backToQuestions }),
    );

    await user.click(screen.getByRole('button', { name: 'Start the conversation' }));

    expect(await screen.findByText(en.assistant.errors.title)).toBeInTheDocument();
    expect(screen.queryByRole('region', LEAD)).not.toBeInTheDocument();
  });

  it('Retry after a failed consultation start that fails again keeps the contact card', async () => {
    sdkState.startError = new Error('LiveAvatar inactive');
    const user = userEvent.setup();
    renderPage(VideoConversationPage);
    const card = await finishAnswer(user);
    await user.click(within(card).getByRole('button', { name: en.library.lead.consult }));
    await screen.findByText(en.library.lead.liveUnavailable);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(sdkState.startCount).toBe(2));
    expect(await screen.findByText(en.library.lead.liveUnavailable)).toBeInTheDocument();
  });
});

describe('the lead card: focus after consulting, the orb caption, the follow-up count', () => {
  it.each([
    ['/video', VideoConversationPage, en.conversation.video.title],
    ['/audio', AudioConversationPage, en.conversation.audio.title],
  ] as const)('%s: after «Request a consultation» the focus is on the page heading, not lost', async (_route, Page, title) => {
    let release: () => void = () => {};
    sdkState.startGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderPage(Page);
    const card = await finishAnswer(user);

    await user.click(within(card).getByRole('button', { name: en.library.lead.consult }));

    await waitFor(() => expect(screen.queryByRole('region', LEAD)).not.toBeInTheDocument());
    const heading = screen.getByRole('heading', { level: 1, name: title });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).not.toBe(document.body);
    release();
  });

  it('/audio: the orb says no "Press start" while the lead card hides Start, and says it again after "Other questions"', async () => {
    const user = userEvent.setup();
    renderPage(AudioConversationPage);
    await screen.findByRole('list', LIST);
    expect(
      screen.getByText(en.assistant.voice.idle, { selector: 'p[aria-hidden="true"]' }),
    ).toBeInTheDocument();

    const card = await finishAnswer(user);

    await waitFor(() =>
      expect(screen.queryByText(en.assistant.voice.idle)).not.toBeInTheDocument(),
    );

    await user.click(
      within(card).getByRole('button', { name: en.library.lead.backToQuestions }),
    );

    expect(
      await screen.findByText(en.assistant.voice.idle, { selector: 'p[aria-hidden="true"]' }),
    ).toBeInTheDocument();
  });

  it('shows at most three follow-ups, whatever the server sends (REQ-075)', async () => {
    followUpsOverride = (config) =>
      okResponse(config, {
        items: [1, 2, 3, 4, 5].map((index) => ({
          id: `follow-up-${index}`,
          question: `Follow-up question ${index}`,
          answerText: `Answer ${index}`,
          durationMs: 1000,
        })),
      });
    const user = userEvent.setup();
    renderPage(VideoConversationPage);

    const card = await finishAnswer(user);

    const list = await within(card).findByRole('list', FOLLOW_UPS);
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Follow-up question 1', 'Follow-up question 2', 'Follow-up question 3']);
  });
});
