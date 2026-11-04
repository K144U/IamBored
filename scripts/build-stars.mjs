#!/usr/bin/env node
// Builds apps/skywatch/public/data/stars.json: naked-eye stars (mag ≤ 4.5) from the HYG database.
//
//   node scripts/build-stars.mjs                 # downloads HYG v4.1 from GitHub
//   node scripts/build-stars.mjs path/to/hyg.csv # or uses a local copy
//
// HYG (https://github.com/astronexus/HYG-Database) is CC BY-SA 4.0, so the output carries
// the same licence and an attribution. Positions are J2000 (epoch and equinox); proper motion
// is ignored, which is < 0.1° over a century for every star this bright except a handful.
// The output is committed: rerun only to change the cut-off or the format.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HYG_URL = 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv';
const MAG_LIMIT = 4.5;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'apps/skywatch/public/data/stars.json');

const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ',
  Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π',
  Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};
const SUP = { 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** "Alp-2" + "Cen" → "α² Cen"; falls back to Flamsteed ("61 Cyg") or a catalogue number. */
export function designation(row) {
  if (row.bayer) {
    const [abbr, n] = row.bayer.split('-');
    const letter = GREEK[abbr] ?? abbr;
    return `${letter}${n ? (SUP[n] ?? n) : ''} ${row.con}`;
  }
  if (row.flam) return `${row.flam} ${row.con}`;
  if (row.hr) return `HR ${row.hr}`;
  if (row.hip) return `HIP ${row.hip}`;
  return `HYG ${row.id}`;
}

/** Minimal CSV parser: HYG quotes some fields but never embeds commas or quotes in them. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = (l) => l.split(',').map((c) => c.replace(/^"(.*)"$/, '$1'));
  const head = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

async function main() {
  const src = process.argv[2];
  const csv = src
    ? await readFile(src, 'utf8')
    : await fetch(HYG_URL).then((r) => {
        if (!r.ok) throw new Error(`HYG download failed: HTTP ${r.status}`);
        return r.text();
      });
  const rows = parseCsv(csv).filter((r) => r.id !== '0' && r.mag !== '' && Number(r.mag) <= MAG_LIMIT);
  rows.sort((a, b) => Number(a.mag) - Number(b.mag));
  const stars = rows.map((r) => [
    round(Number(r.ra), 5), // hours
    round(Number(r.dec), 4), // degrees
    round(Number(r.mag), 2),
    r.ci === '' ? null : round(Number(r.ci), 2), // B−V colour index
    r.proper || null,
    designation(r),
    r.con || null,
  ]);
  const doc = {
    source: 'HYG database v4.1, https://github.com/astronexus/HYG-Database',
    license: 'CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/',
    epoch: 'J2000',
    magLimit: MAG_LIMIT,
    fields: ['raHours', 'decDeg', 'mag', 'bv', 'name', 'designation', 'con'],
    stars,
  };
  await mkdir(dirname(out), { recursive: true });
  // one star per line keeps diffs readable
  const body = JSON.stringify({ ...doc, stars: [] }).replace(
    '"stars":[]',
    `"stars":[\n${stars.map((s) => JSON.stringify(s)).join(',\n')}\n]`,
  );
  await writeFile(out, `${body}\n`);
  console.log(`wrote ${stars.length} stars → ${out}`);
}

await main();
