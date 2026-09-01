import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AppShell } from '@app/layout/AppShell';
import { HomePage } from '@pages/home';
import { AvatarSessionPage } from '@pages/avatar-session';
import { NotFoundPage } from '@pages/not-found';

// No auth guard in Phase 1. When authentication lands, add a RequireAuth layout route here; the
// API client already exposes setCredentialsProvider/setUnauthorizedHandler for it.
const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <NotFoundPage />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/session', element: <AvatarSessionPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
