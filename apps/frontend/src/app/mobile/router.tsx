import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/features/authentication';
import { AssistantPage } from '@/pages/assistant/AssistantPage';
import { HomePage } from '@/pages/home/HomePage';
import { LoginPage } from '@/pages/login/LoginPage';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';
import { ProfilePage } from '@/pages/profile/ProfilePage';
import { MobileLayout } from './MobileLayout';

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MobileLayout />}>
          <Route index element={<HomePage />} />
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
