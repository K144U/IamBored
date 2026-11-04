// Build both apps and assemble one static site in dist/:
//   dist/index.html      landing page
//   dist/skywatch/       SkyWatch
//   dist/loopland/       LoopLand
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const apps = ['skywatch', 'loopland'];
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
for (const app of apps) {
  execSync(`npm run build -w ${app}`, { stdio: 'inherit' });
  cpSync(`apps/${app}/dist`, `dist/${app}`, { recursive: true });
}
cpSync('site/index.html', 'dist/index.html');
writeFileSync('dist/.nojekyll', '');
console.log('\nSite ready in dist/');
