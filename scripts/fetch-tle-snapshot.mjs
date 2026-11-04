// Download a daily snapshot of CelesTrak orbit data into SkyWatch's public folder.
// The app only uses it as a fallback when CelesTrak can't be reached live.
// Run once per deploy (daily at most), as CelesTrak asks.
import { mkdirSync, writeFileSync } from 'node:fs';

const groups = ['stations', 'visual', 'last-30-days', 'starlink'];
const out = 'apps/skywatch/public/data/tle';
mkdirSync(out, { recursive: true });
let ok = 0;
for (const group of groups) {
  try {
    const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=json`, {
      headers: { 'User-Agent': 'SkyWatch daily snapshot (GitHub Actions)' },
    });
    const text = await res.text();
    const data = JSON.parse(text);
    if (!res.ok || !Array.isArray(data) || !data.length) throw new Error(`HTTP ${res.status}`);
    writeFileSync(`${out}/${group}.json`, JSON.stringify(data));
    console.log(`${group}: ${data.length} objects`);
    ok++;
  } catch (err) {
    console.warn(`${group}: failed (${err.message})`);
  }
}
writeFileSync(`${out}/meta.json`, JSON.stringify({ fetchedAt: Date.now() }));
if (!ok) process.exitCode = 1;
