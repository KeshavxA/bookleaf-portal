/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const seedDir = path.resolve(__dirname, '../backend/seed');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
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
        // Only used when VITE_API_URL is relative (the default) and mocks are off.
        '/api': { target: env.DEV_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
      },
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
