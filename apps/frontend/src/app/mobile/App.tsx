import { Providers } from '../providers';
import { Router } from './router';

/** Entry of the Capacitor (Android / iOS) app. */
export function App() {
  return (
    <Providers>
      <Router />
    </Providers>
  );
}
