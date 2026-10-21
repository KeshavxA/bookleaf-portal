// @vitest-environment node
// Runs a real production build and proves mocks can't ship: MSW isn't bundled, the worker file isn't
// emitted, and the absolute API URL is baked in. Also checks the build refuses unsafe env.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyDist } from './verify-prod-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = 'https://bookleaf-api.example.test/api/v1';
const saved = { ...process.env };

async function prodBuild(env) {
  Object.assign(process.env, { NODE_ENV: 'production' }, env);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookleaf-dist-'));
  await build({ root, mode: 'production', logLevel: 'silent', build: { outDir, emptyOutDir: true } });
  return outDir;
}

describe('production build', () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it('contains no MSW, mock data or demo credentials, and uses the absolute VITE_API_URL', async () => {
    const outDir = await prodBuild({ VITE_API_URL: API_URL, VITE_USE_MOCKS: 'false' });
    expect(verifyDist(outDir, { apiUrl: API_URL })).toEqual([]);
    expect(fs.existsSync(path.join(outDir, 'mockServiceWorker.js'))).toBe(false);
    // The SPA must not call a relative /api path that only the dev proxy would answer.
    const js = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'));
    const bundle = js.map((f) => fs.readFileSync(path.join(outDir, 'assets', f), 'utf8')).join('\n');
    expect(bundle).not.toMatch(/["'`]\/api\/v1["'`]/);
  }, 60_000);

  it('refuses VITE_USE_MOCKS=true', async () => {
    await expect(prodBuild({ VITE_API_URL: API_URL, VITE_USE_MOCKS: 'true' })).rejects.toThrow(/not allowed in a production build/);
  }, 60_000);

  it('refuses a missing VITE_API_URL', async () => {
    delete process.env.VITE_API_URL;
    await expect(prodBuild({ VITE_USE_MOCKS: 'false' })).rejects.toThrow(/VITE_API_URL is required/);
  }, 60_000);
});
