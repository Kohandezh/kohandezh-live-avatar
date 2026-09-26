import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingControls } from '@/features/recording';
import { loadInitialSettings } from '@/features/settings';
import { i18n } from '@/i18n';
import { fixtures, server } from '../utils/server';
import { renderWithProviders } from '../utils/renderWithProviders';

function renderControls(language: 'en' | 'fa' = 'en') {
  return renderWithProviders(
    <RecordingControls sessionId="s1" text="سلام" audioAssetId={null} transport="byo" />,
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

  it('waits for the finalize job and then links the MP4', async () => {
    const user = setupUser();
    answerJob({ status: 'running' });
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));

    expect(await screen.findByText(fixtures.finalizeJob.jobId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finalizing MP4/ })).toBeDisabled();

    answerJob({ status: 'done', result: fixtures.finalize });
    await advance(2000);

    expect(
      await screen.findByText('MP4 generated. Manual approval is still required.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open generated MP4' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/api/assets/video/${fixtures.finalize.id}`),
    );
  });

  it('shows a failed job with a retry that finalizes again', async () => {
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

    expect(await screen.findByText('Recording failed.')).toBeInTheDocument();
    expect(
      screen.getByText('The MP4 file did not appear in time. Retry to wait for it again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/The recording file did not appear in time/)).toBeNull();

    answerJob({ status: 'done', result: fixtures.finalize });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByText('MP4 generated. Manual approval is still required.'),
    ).toBeInTheDocument();
    expect(finalizeCalls).toBe(2);
  });

  it('stops waiting after 3 minutes and offers a retry', async () => {
    const user = setupUser();
    answerJob({ status: 'running' });
    renderControls();

    await user.click(screen.getByRole('button', { name: 'Start recording' }));
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await screen.findByText(fixtures.finalizeJob.jobId);
    for (let elapsed = 0; elapsed < 182_000; elapsed += 500) await advance(500);

    expect(
      await screen.findByText('The MP4 was not ready after 3 minutes. Retry to check again.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('shows the finalize flow in Persian', async () => {
    await i18n.changeLanguage('fa');
    const user = setupUser();
    answerJob({ status: 'done', result: fixtures.finalize });
    renderControls('fa');

    await user.click(screen.getByRole('button', { name: 'شروع ضبط' }));
    await user.click(await screen.findByRole('button', { name: 'توقف ضبط' }));

    expect(
      await screen.findByText('MP4 تولید شد. تأیید دستی همچنان لازم است.'),
    ).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('shows a timeout in Persian', async () => {
    await i18n.changeLanguage('fa');
    const user = setupUser();
    answerJob({ status: 'running' });
    renderControls('fa');

    await user.click(screen.getByRole('button', { name: 'شروع ضبط' }));
    await user.click(await screen.findByRole('button', { name: 'توقف ضبط' }));
    await screen.findByText(fixtures.finalizeJob.jobId);
    expect(screen.getByText('کار نهایی‌سازی')).toBeInTheDocument();
    for (let elapsed = 0; elapsed < 182_000; elapsed += 500) await advance(500);

    const timeout = await screen.findByText(
      'فایل MP4 پس از ۳ دقیقه آماده نشد. برای بررسی دوباره، «تلاش دوباره» را بزنید.',
    );
    // Translated text follows the page direction; only machine strings are forced LTR.
    expect(timeout.closest('.ltr')).toBeNull();
    await i18n.changeLanguage('en');
  });

  it('translates a failed job by its code in Persian', async () => {
    await i18n.changeLanguage('fa');
    const user = setupUser();
    answerJob({
      status: 'failed',
      error: { code: 'egress_failure', message: 'The recording file did not appear in time.' },
    });
    renderControls('fa');

    await user.click(screen.getByRole('button', { name: 'شروع ضبط' }));
    await user.click(await screen.findByRole('button', { name: 'توقف ضبط' }));

    const message = await screen.findByText(
      'فایل MP4 به‌موقع آماده نشد. برای انتظار دوباره، «تلاش دوباره» را بزنید.',
    );
    expect(message.closest('.ltr')).toBeNull();
    expect(screen.queryByText(/The recording file did not appear in time/)).toBeNull();
    expect(screen.getByRole('button', { name: 'تلاش دوباره' })).toBeEnabled();
    await i18n.changeLanguage('en');
  });

  it('falls back to the server text for a code it does not know', async () => {
    await i18n.changeLanguage('fa');
    const user = setupUser();
    answerJob({ status: 'failed', error: { code: 'disk_full', message: 'The disk is full.' } });
    renderControls('fa');

    await user.click(screen.getByRole('button', { name: 'شروع ضبط' }));
    await user.click(await screen.findByRole('button', { name: 'توقف ضبط' }));

    const message = await screen.findByText('disk_full: The disk is full.');
    expect(message.closest('.ltr')).not.toBeNull();
    await i18n.changeLanguage('en');
  });
});
