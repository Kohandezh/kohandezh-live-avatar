import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireProfile } from '@/features/authentication';
import { AudioConversationPage } from '@/pages/conversation/AudioConversationPage';
import { VideoConversationPage } from '@/pages/conversation/VideoConversationPage';
import { ForbiddenPage } from '@/pages/forbidden/ForbiddenPage';
import { LoginPage } from '@/pages/login/LoginPage';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage';
import { AppearancePage } from '@/pages/settings/AppearancePage';
import { PersonalInfoPage } from '@/pages/settings/PersonalInfoPage';
import { SettingsIndexPage } from '@/pages/settings/SettingsIndexPage';
import { SettingsLayout } from '@/pages/settings/SettingsLayout';
import { MobileLayout } from './MobileLayout';

/**
 * Requirement 1: the first thing anyone sees is the login form, at `/` and at `/login`.
 * `LoginPage` sends a signed-in user straight to `/video`; `RequireProfile` catches the
 * case where the name is still empty and sends them to `/onboarding` instead, so
 * `LoginPage` itself never has to know onboarding exists.
 *
 * `/video` and `/audio` are ordinary sibling routes, each mounting its own session
 * through `useConversationScreen` (DESIGN_AMENDMENTS.md amendment 1). There is no
 * session-owning parent route: switching between them, or leaving to `/settings`,
 * unmounts the page and `useAssistantSession`'s own cleanup closes the session.
 */
export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MobileLayout />}>
          <Route index element={<LoginPage redirectTo="/video" />} />
          <Route path="login" element={<LoginPage redirectTo="/video" />} />
          <Route path="forbidden" element={<ForbiddenPage />} />

          <Route element={<RequireAuth />}>
            <Route path="onboarding" element={<OnboardingPage />} />

            <Route element={<RequireProfile />}>
              <Route path="video" element={<VideoConversationPage />} />
              <Route path="audio" element={<AudioConversationPage />} />

              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<SettingsIndexPage />} />
                <Route path="personal" element={<PersonalInfoPage />} />
                <Route path="appearance" element={<AppearancePage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
