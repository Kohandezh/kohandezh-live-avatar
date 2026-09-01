import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router-dom';
import { AppShell } from '@app/layout/AppShell';
import { HomePage } from '@pages/home';
import { LoginPage } from '@pages/login';
import { ProfilePage } from '@pages/profile';
import { NotFoundPage } from '@pages/not-found';
import { useSession } from '@features/authentication';
import { Spinner } from '@shared/ui';

// Route guard. The backend is the source of truth for authorization; this only shapes UX.
function RequireAuth() {
  const session = useSession();
  if (session.isLoading) return <Spinner />;
  if (!session.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <NotFoundPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        children: [{ path: '/profile', element: <ProfilePage /> }],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
