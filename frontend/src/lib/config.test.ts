import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('./config');
}

describe('USE_MOCKS', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is false in production even if VITE_USE_MOCKS=true', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    expect((await loadConfig()).USE_MOCKS).toBe(false);
  });

  it('is on in development only when VITE_USE_MOCKS=true', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    expect((await loadConfig()).USE_MOCKS).toBe(true);
    vi.stubEnv('VITE_USE_MOCKS', 'false');
    expect((await loadConfig()).USE_MOCKS).toBe(false);
  });

  it('uses an absolute VITE_API_URL as-is (no trailing slash)', async () => {
    vi.stubEnv('VITE_API_URL', 'https://bookleaf-api.onrender.com/api/v1/');
    expect((await loadConfig()).config.apiUrl).toBe('https://bookleaf-api.onrender.com/api/v1');
  });
});
