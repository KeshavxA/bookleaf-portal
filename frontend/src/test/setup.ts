import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // Build tests run in the node environment, which has no localStorage.
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
