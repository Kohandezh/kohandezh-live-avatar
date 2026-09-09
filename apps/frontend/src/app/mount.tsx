import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrap } from './bootstrap';
import '@/styles/globals.css';

/** Shared entry logic for main.tsx in each app target. */
export async function mountApp(App: ComponentType): Promise<void> {
  const container = document.getElementById('root');

  if (!container) {
    throw new Error('Missing #root element in index.html');
  }

  await bootstrap();

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
