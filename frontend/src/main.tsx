import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { USE_MOCKS } from './lib/config';
import './index.css';

async function enableMocks() {
  // USE_MOCKS is a build-time `false` in production, so this import (MSW and seed data) is dropped.
  if (!USE_MOCKS) return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}

enableMocks().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
