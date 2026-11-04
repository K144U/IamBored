import { readFileSync } from 'node:fs';
import { Body, DefineStar, Equator, Horizon, Observer as AObserver } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import {
  bvToRgb,
  CONSTELLATIONS,
  figureLines,
  parseCatalog,
  parseConstellations,
  starMagLimit,
  starPositions,
  type ConstellationFile,
  type StarCatalogFile,
} from './stars';

const doc = JSON.parse(
  readFileSync(new URL('../../public/data/stars.json', import.meta.url), 'utf8'),
) as StarCatalogFile;
const stars = parseCatalog(doc);
const london = { lat: 51.4769, lon: -0.0005, heightM: 45 };
const byName = (n: string) => stars.find((s) => s.name === n)!;

/** angular distance between two az/el directions, degrees */
function sep(a: { az: number; el: number }, b: { az: number; el: number }) {
  const r = Math.PI / 180;
  const c =
    Math.sin(a.el * r) * Math.sin(b.el * r) + Math.cos(a.el * r) * Math.cos(b.el * r) * Math.cos((a.az - b.az) * r);
  return Math.acos(Math.min(1, c)) / r;
}

describe('star catalogue', () => {
  it('has the naked-eye stars, brightest first, with attribution', () => {
    expect(stars.length).toBeGreaterThan(850);
    expect(stars.length).toBeLessThan(1000);
    expect(stars[0].name).toBe('Sirius');
    expect(stars.every((s) => s.mag <= 4.5)).toBe(true);
    for (const n of ['Polaris', 'Vega', 'Betelgeuse', 'Rigel', 'Arcturus', 'Capella']) expect(byName(n)).toBeDefined();
    expect(doc.license).toMatch(/CC BY-SA/);
  });

  it('rejects a malformed file', () => {
    expect(() => parseCatalog({} as StarCatalogFile)).toThrow();
  });
});

describe('star positions', () => {
  it('matches astronomy-engine (precession, nutation, refraction) within 0.01°', () => {
    const date = new Date('2026-11-04T22:00:00Z');
    const obs = new AObserver(london.lat, london.lon, london.heightM);
    const all = starPositions(stars, date, london, -90);
    let checked = 0;
    for (const name of ['Sirius', 'Vega', 'Polaris', 'Betelgeuse', 'Capella', 'Deneb', 'Altair', 'Aldebaran']) {
      const s = byName(name);
      const raH = Math.atan2(s.y, s.x) / (Math.PI / 12);
      const dec = (Math.asin(s.z) * 180) / Math.PI;
      DefineStar(Body.Star1, (raH + 24) % 24, dec, 1000);
      const eq = Equator(Body.Star1, date, obs, true, true);
      const hor = Horizon(date, obs, eq.ra, eq.dec, 'normal');
      // below the horizon astronomy-engine still adds refraction, so compare only stars that are up
      if (hor.altitude < 1) continue;
      const ours = all.find((p) => p.star === s)!;
      expect(sep(ours, { az: hor.azimuth, el: hor.altitude })).toBeLessThan(0.01);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('puts Polaris at about the observer latitude, due north', () => {
    for (const lat of [10, 40, 51.5, 70]) {
      const p = starPositions(stars, new Date('2026-11-04T20:00:00Z'), { lat, lon: 0, heightM: 0 }, -90).find(
        (x) => x.star.name === 'Polaris',
      )!;
      expect(Math.abs(p.el - lat)).toBeLessThan(1);
      expect(Math.min(p.az, 360 - p.az)).toBeLessThan(2);
    }
  });

  it('drops stars below the cut-off, and roughly half the sky is up', () => {
    const up = starPositions(stars, new Date('2026-11-04T22:00:00Z'), london);
    expect(up.every((p) => p.el >= 0)).toBe(true);
    expect(up.length).toBeGreaterThan(stars.length * 0.3);
    expect(up.length).toBeLessThan(stars.length * 0.7);
  });
});

describe('star display helpers', () => {
  it('hides stars in daylight and shows more as the sky darkens', () => {
    expect(starMagLimit(10)).toBe(-Infinity);
    expect(starMagLimit(-4)).toBeLessThan(starMagLimit(-9));
    expect(starMagLimit(-20)).toBe(4.5);
  });

  it('colours hot stars blue and cool stars orange', () => {
    const [rb, , bb] = bvToRgb(-0.2).split(',').map(Number);
    const [ro, , bo] = bvToRgb(1.6).split(',').map(Number);
    expect(bb).toBeGreaterThan(rb);
    expect(ro).toBeGreaterThan(bo);
    expect(bvToRgb(null)).toBe('255,255,255');
  });
});

describe('constellations', () => {
  it('names every constellation used by the catalogue', () => {
    expect(Object.keys(CONSTELLATIONS)).toHaveLength(88);
    for (const s of stars) if (s.con) expect(CONSTELLATIONS[s.con], s.con).toBeDefined();
  });
});

describe('constellation figures', () => {
  const figDoc = JSON.parse(
    readFileSync(new URL('../../public/data/constellations.json', import.meta.url), 'utf8'),
  ) as ConstellationFile;
  const figures = parseConstellations(figDoc);

  it('covers the constellations and carries its licence', () => {
    expect(new Set(figures.map((f) => f.id)).size).toBeGreaterThanOrEqual(88);
    expect(figDoc.license).toMatch(/BSD/);
  });

  it("Orion's figure passes through Betelgeuse and Rigel", () => {
    const ori = figures.find((f) => f.id === 'Ori')!;
    const pts = ori.lines.flat();
    for (const name of ['Betelgeuse', 'Rigel']) {
      const s = byName(name);
      const best = Math.min(...pts.map((p) => Math.acos(Math.min(1, p[0] * s.x + p[1] * s.y + p[2] * s.z)) * (180 / Math.PI)));
      expect(best).toBeLessThan(0.05);
    }
  });

  it('only returns lines that reach above the horizon', () => {
    const lines = figureLines(figures, new Date('2026-01-15T23:00:00Z'), london);
    expect(lines.length).toBeGreaterThan(50);
    expect(lines.every((l) => l.some((p) => p.el > 0))).toBe(true);
  });
});
