import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@heygen/liveavatar-web-sdk', async () => {
  const mock = await import('../utils/liveAvatarSdkMock');
  return mock.createLiveAvatarSdkMockModule();
});

import { installMockApi, mockSession } from '@/data/mock';
import { RequireAuth } from '@/features/authentication';
import { AssistantPage } from '@/pages/assistant/AssistantPage';
import { apiClient } from '@/shared/api';
import { resetLiveAvatarSdkMock } from '../utils/liveAvatarSdkMock';
import { renderWithProviders } from '../utils/renderWithProviders';

/** The same shape both routers use: /assistant sits inside RequireAuth. */
function renderAssistantRoute() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/assistant" element={<AssistantPage />} />
      </Route>
    </Routes>,
    { route: '/assistant' },
  );
}

describe('AssistantPage', () => {
  beforeEach(() => {
    resetLiveAvatarSdkMock();
    installMockApi(apiClient, { delayMs: 0 });
    mockSession.clear();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  it('sends anonymous visitors to the login page', async () => {
    renderAssistantRoute();

    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('shows the assistant to a signed-in user', async () => {
    mockSession.set('u-user');
    renderAssistantRoute();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Assistant' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start the conversation' }),
    ).toBeInTheDocument();
  });
});
