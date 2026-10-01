import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingControls } from '@/features/recording';
import { loadInitialSettings } from '@/features/settings';
import { i18n } from '@/i18n';
import { errorBody, fixtures, server } from '../utils/server';
import { renderWithProviders } from '../utils/renderWithProviders';

function renderControls(
  language: 'en' | 'fa' = 'en',
  recordBlock: 'needsAudio' | 'tooLong' | null = null,
) {
  return renderWithProviders(
    <RecordingControls
      sessionId="s1"
      text="سلام"
      audioAssetId={null}
      transport="byo"
      recordBlock={recordBlock}
    />,
    {
      locale: language,
      preloadedState: { settings: { ...loadInitialSettings(), language } },
    },
  );
}

function answerJob(answer: Record<string, unknown>) {
  server.use(http.get('*/api/jobs/:jobId', () => HttpResponse.json(answer)));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('RecordingControls', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupUser() {
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }

  it('shows the job status line while it waits, then the done line (REQ-041)', async () => {
    const user = setupUser();
    answerJob({ status: 'queued' });
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));

    const line = await screen.findByText('Waiting to process the recording');
    expect(line.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Finalizing MP4/ })).toBeDisabled();

    answerJob({ status: 'running' });
    await advance(2000);
    expect(await screen.findByText('Processing the recording')).toBeInTheDocument();

    answerJob({ status: 'done', result: fixtures.finalize });
    await advance(2000);
    expect(
      await screen.findByText('The recording is ready. Save it to the library.'),
    ).toBeInTheDocument();
    expect(screen.getByText(fixtures.finalize.id)).toBeInTheDocument();
  });

  it('shows a failed job with its message and code, and lets a new recording start', async () => {
    const user = setupUser();
    let finalizeCalls = 0;
    server.use(
      http.post('*/api/assets/video/:id/finalize', () => {
        finalizeCalls += 1;
        return HttpResponse.json(fixtures.finalizeJob, { status: 202 });
      }),
    );
    answerJob({
      status: 'failed',
      error: { code: 'egress_failure', message: 'The recording file did not appear in time.' },
    });
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));

    expect(
      await screen.findByText('The video file did not appear in time. Record the answer again.'),
    ).toBeInTheDocument();
    expect(screen.getByText('egress_failure')).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByText(/The recording file did not appear in time/)).toBeNull();
    // Finalizing again cannot help: the message asks for a new recording, and Start is back.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
    expect(finalizeCalls).toBe(1);
  });

  it('stops waiting after 3 minutes with the slow line and Check again', async () => {
    const user = setupUser();
    answerJob({ status: 'running' });
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await screen.findByText('Processing the recording');
    for (let elapsed = 0; elapsed < 182_000; elapsed += 2000) await advance(2000);

    expect(
      await screen.findByText('The recording is still being processed. Check again in a minute.'),
    ).toBeInTheDocument();
    // Slow is not an error (section 8).
    expect(screen.queryByRole('alert')).toBeNull();

    answerJob({ status: 'done', result: fixtures.finalize });
    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(
      await screen.findByText('The recording is ready. Save it to the library.'),
    ).toBeInTheDocument();
  });

  it('keeps Record off and says why when no audio of the text exists (REQ-036: its length must be known)', () => {
    renderControls('en', 'needsAudio');

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
    expect(
      screen.getByText('Generate the audio first, so its length can be checked.'),
    ).toBeInTheDocument();
  });

  it('keeps Record off and says why when the audio is too long (REQ-036)', () => {
    renderControls('en', 'tooLong');

    expect(screen.getByRole('button', { name: 'Start recording' })).toBeDisabled();
    expect(
      screen.getByText(
        'This answer is too long for one recording. Keep its audio under 4 minutes 30 seconds.',
      ),
    ).toBeInTheDocument();
  });

  it('maps a recording start refused with recording_unavailable', async () => {
    const user = setupUser();
    server.use(
      http.post('*/api/assets/generate-video', () =>
        HttpResponse.json(errorBody('recording_unavailable', 'Fixed English text.'), {
          status: 409,
        }),
      ),
    );
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));

    expect(
      await screen.findByText(
        'Recording is not available on this server. It needs the BYO transport and a public LiveKit address.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('recording_unavailable')).toHaveAttribute('dir', 'ltr');
  });

  it('shows the job line and the done line in Persian', async () => {
    await i18n.changeLanguage('fa');
    const user = setupUser();
    answerJob({ status: 'queued' });
    renderControls('fa');

    await user.click(screen.getByRole('button', { name: 'شروع ضبط' }));
    await user.click(await screen.findByRole('button', { name: 'توقف ضبط' }));
    expect(await screen.findByText('در انتظار پردازش ضبط')).toBeInTheDocument();

    answerJob({ status: 'done', result: fixtures.finalize });
    await advance(2000);
    expect(
      await screen.findByText('ضبط آماده است. آن را در کتابخانه ذخیره کنید.'),
    ).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('translates a failed job by its code in Persian, with only the code left to right', async () => {
    await i18n.changeLanguage('fa');
    const user = setupUser();
    answerJob({
      status: 'failed',
      error: { code: 'worker_lost', message: 'The worker stopped.' },
    });
    renderControls('fa');

    await user.click(screen.getByRole('button', { name: 'شروع ضبط' }));
    await user.click(await screen.findByRole('button', { name: 'توقف ضبط' }));

    const message = await screen.findByText(
      'سرور هنگام پردازش ضبط دوباره راه‌اندازی شد. پاسخ را دوباره ضبط کنید.',
    );
    expect(message.closest('[dir="ltr"]')).toBeNull();
    expect(screen.getByText('worker_lost')).toHaveAttribute('dir', 'ltr');
    await i18n.changeLanguage('en');
  });
});
