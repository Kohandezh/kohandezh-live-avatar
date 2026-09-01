import { AppProviders } from './providers';
import { AppRouter } from './router';
import { initDeepLinks } from '@shared/platform';

// Register platform hooks once at boot. Native-only concerns stay behind shared/platform.
initDeepLinks((path) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
});

export function App() {
  return (
    <AppProviders>
      <AppRouter />
    </AppProviders>
  );
}
