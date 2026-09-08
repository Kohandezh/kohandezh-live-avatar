import { Providers } from '../providers';
import { Router } from './router';

/** Entry of the admin dashboard. */
export function App() {
  return (
    <Providers>
      <Router />
    </Providers>
  );
}
