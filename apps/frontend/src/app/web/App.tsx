import { Providers } from '../providers';
import { Router } from './router';

/** Entry of the installable web app (PWA). */
export function App() {
  return (
    <Providers>
      <Router />
    </Providers>
  );
}
