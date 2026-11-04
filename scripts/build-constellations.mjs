#!/usr/bin/env node
// Builds apps/skywatch/public/data/constellations.json: constellation stick figures from d3-celestial.
//
//   node scripts/build-constellations.mjs                     # downloads from GitHub
//   node scripts/build-constellations.mjs lines.json LICENSE  # or uses local copies
//
// d3-celestial (https://github.com/ofrohn/d3-celestial) is BSD-3-Clause, © 2015 Olaf Frohn;
// the licence text travels inside the output file. Coordinates are J2000.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'apps/skywatch/public/data/constellations.json');

const get = async (local, url) =>
  local
    ? readFile(local, 'utf8')
    : fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.text();
      });

const [linesSrc, licenseSrc] = process.argv.slice(2);
const geo = JSON.parse(await get(linesSrc, `${BASE}/data/constellations.lines.json`));
const license = (await get(licenseSrc, `${BASE}/LICENSE`)).trim();

const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const figures = geo.features.map((f) => ({
  id: f.id,
  // d3-celestial stores RA as a longitude in −180…180 degrees; store RA hours 0…24 instead
  lines: f.geometry.coordinates.map((line) => line.map(([lon, dec]) => [r((((lon % 360) + 360) % 360) / 15, 4), r(dec, 3)])),
}));
const doc = {
  source: 'd3-celestial constellations.lines.json, https://github.com/ofrohn/d3-celestial',
  license: `BSD-3-Clause. ${license}`,
  epoch: 'J2000',
  fields: ['raHours', 'decDeg'],
  figures,
};
await writeFile(out, `${JSON.stringify(doc)}\n`);
console.log(`wrote ${figures.length} figures → ${out}`);
