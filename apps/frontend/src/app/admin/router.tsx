import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireRole } from '@/features/authentication';
import { AdminDashboardPage } from '@/pages/admin/dashboard/AdminDashboardPage';
import { AdminLibraryPage } from '@/pages/admin/library/AdminLibraryPage';
import { AdminRecordAnswerPage } from '@/pages/admin/library/AdminRecordAnswerPage';
import { AdminUsersPage } from '@/pages/admin/users/AdminUsersPage';
import { ForbiddenPage } from '@/pages/forbidden/ForbiddenPage';
import { LoginPage } from '@/pages/login/LoginPage';
import { NotFoundPage } from '@/pages/not-found/NotFoundPage';
import { AdminLayout } from './AdminLayout';

/**
 * Every admin screen sits behind RequireAuth and RequireRole('admin').
 * These guards only improve UX. The backend must check the admin role
 * on every /api/admin/* request.
 */
export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage redirectTo="/" />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<RequireRole roles={['admin']} />}>
            <Route element={<AdminLayout />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="library" element={<AdminLibraryPage />} />
              <Route path="library/record" element={<AdminRecordAnswerPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
