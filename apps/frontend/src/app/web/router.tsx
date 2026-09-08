import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/features/authentication';
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
          <Route path="avatar" element={<AvatarSessionPage />} />
          <Route path="login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
