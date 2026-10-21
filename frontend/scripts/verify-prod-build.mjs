#!/usr/bin/env node
// Scans a production dist/ for anything that must never ship: MSW, mock data, demo credentials.
// Usage: VITE_API_URL=https://api.example.com/api/v1 node scripts/verify-prod-build.mjs [distDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = [
  ['MSW runtime', /setupWorker|mockServiceWorker|\[MSW\]/],
  ['mock layer or seed data', /bookleaf\.mockdb|demo auto-reply|priya\.sharma@email\.com/],
  ['demo password', /Passw0rd!/],
];

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : [full];
  });
}

/** Returns a list of problems; empty means the bundle is clean. */
export function verifyDist(distDir, { apiUrl } = {}) {
  const problems = [];
  if (!fs.existsSync(path.join(distDir, 'index.html'))) return [`${distDir}/index.html not found. Run the build first.`];
  const files = listFiles(distDir);
  if (files.some((f) => path.basename(f) === 'mockServiceWorker.js')) problems.push('dist contains mockServiceWorker.js');

  const texts = files.filter((f) => /\.(js|html|css)$/.test(f)).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  for (const [label, re] of MARKERS) {
    for (const [file, text] of texts) {
      if (re.test(text)) problems.push(`${label} found in ${path.relative(distDir, file)}`);
    }
  }
  if (apiUrl && !texts.some(([, text]) => text.includes(apiUrl))) {
    problems.push(`VITE_API_URL (${apiUrl}) is not baked into the bundle`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist'));
  const problems = verifyDist(distDir, { apiUrl: process.env.VITE_API_URL });
  if (problems.length) {
    console.error(`Production bundle check FAILED:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`Production bundle check passed (${distDir}): no MSW, mock data or demo credentials.`);
}
