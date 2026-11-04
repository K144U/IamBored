// Build both apps to live at fixed paths on another site (kittu.pro):
//   dist-embed/skywatch/  for https://kittu.pro/skywatch
//   dist-embed/loopland/  for https://kittu.pro/loopland
//
//   node scripts/build-embed.mjs                       # defaults below
//   HOME_NAME="My site" HOME_URL=/ node scripts/build-embed.mjs
//
// Differences from `npm run build` (GitHub Pages, relative base './'): an absolute base, so the apps work at
// `/skywatch` without a trailing slash (Next.js strips it), and the footer's "Part of …" link points to the host site.
// kittu.pro copies the result in with its own scripts/sync-labs.mjs.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const APPS = { skywatch: '/skywatch/', loopland: '/loopland/' };
const env = {
  ...process.env,
  VITE_HOME_NAME: process.env.HOME_NAME ?? 'kittu.pro',
  VITE_HOME_URL: process.env.HOME_URL ?? '/',
};

rmSync('dist-embed', { recursive: true, force: true });
mkdirSync('dist-embed');
for (const [app, base] of Object.entries(APPS)) {
  execSync(`npm run build -w ${app} -- --base=${base}`, { stdio: 'inherit', env });
  cpSync(`apps/${app}/dist`, `dist-embed/${app}`, { recursive: true });
}
console.log('\nEmbeddable builds ready in dist-embed/');
