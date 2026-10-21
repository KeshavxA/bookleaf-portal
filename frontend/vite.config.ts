/// <reference types="vitest/config" />
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const seedDir = path.resolve(__dirname, '../backend/seed');

/**
 * Serves MSW's service worker from node_modules on the dev server only (`apply: 'serve'`). Keeping it
 * out of public/ means it never lands in a production dist/.
 */
function mswDevWorker(): Plugin {
  const workerFile = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js');
  return {
    name: 'bookleaf:msw-dev-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(fs.readFileSync(workerFile));
      });
    },
  };
}

/** Fails a production build early on settings that would ship a broken or mock-backed site. */
function assertProductionEnv(env: Record<string, string>) {
  if (env.VITE_USE_MOCKS === 'true') {
    throw new Error('VITE_USE_MOCKS=true is not allowed in a production build. Mocks are for `npm run dev` only.');
  }
  const apiUrl = env.VITE_API_URL;
  if (!apiUrl) {
    throw new Error(
      'VITE_API_URL is required for a production build, e.g. VITE_API_URL=https://bookleaf-api.onrender.com/api/v1. ' +
        'The relative dev default only works behind the Vite dev proxy.',
    );
  }
  if (!/^https?:\/\//.test(apiUrl)) {
    console.warn(
      `\n[bookleaf] VITE_API_URL="${apiUrl}" is relative. That only works if the static host proxies it to the API ` +
        '(same origin). For a separately hosted backend use an absolute URL.\n',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  // '' prefix: read every variable, including ones passed on the command line.
  const env = loadEnv(mode, process.cwd(), '');
  if (command === 'build') assertProductionEnv(env);

  return {
    plugins: [react(), tailwindcss(), mswDevWorker()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        // Mock data is read straight from the backend seed file so both sides share one source.
        '@seed': seedDir,
      },
    },
    server: {
      port: 5173,
      fs: { allow: [path.resolve(__dirname), seedDir] },
      proxy: {
        // Dev only: used when VITE_API_URL is relative (the dev default) and mocks are off.
        '/api': { target: env.DEV_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
      },
    },
    preview: {
      port: 4173,
      // preview.proxy defaults to server.proxy. Turn it off so `vite preview` behaves like a real static
      // host and proves the build doesn't rely on the dev proxy.
      proxy: {},
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      env: { VITE_API_URL: 'http://localhost/api/v1', VITE_USE_MOCKS: 'false' },
    },
  };
});
