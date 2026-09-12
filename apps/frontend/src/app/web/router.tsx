import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireProfile } from '@/features/authentication';
import { AvatarSessionPage } from '@/pages/avatar-session/AvatarSessionPage';
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
import { WebLayout } from './WebLayout';

/**
 * Same tree as the mobile router, with one extra public route kept from today: the
 * Phase 1 avatar workbench at `/avatar`. It stays unguarded, as it is today. Its only
 * link now lives on `/settings` (admin role, web target only), since the header that
 * used to carry that link is gone (requirement 6).
 */
export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<WebLayout />}>
          <Route index element={<LoginPage redirectTo="/video" />} />
          <Route path="login" element={<LoginPage redirectTo="/video" />} />
          <Route path="avatar" element={<AvatarSessionPage />} />
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
