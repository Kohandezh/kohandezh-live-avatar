import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/features/authentication';
import { AssistantPage } from '@/pages/assistant/AssistantPage';
import { AvatarSessionPage } from '@/pages/avatar-session/AvatarSessionPage';
import { HomePage } from '@/pages/home/HomePage';
import { LoginPage } from '@/pages/login/LoginPage';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';
import { ProfilePage } from '@/pages/profile/ProfilePage';
import { WebLayout } from './WebLayout';

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<WebLayout />}>
          <Route index element={<HomePage />} />
          {/* The Phase 1 workbench stays where it is; the assistant is the product screen. */}
          <Route path="avatar" element={<AvatarSessionPage />} />
          <Route path="login" element={<LoginPage redirectTo="/assistant" />} />
          <Route element={<RequireAuth />}>
            <Route path="assistant" element={<AssistantPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
