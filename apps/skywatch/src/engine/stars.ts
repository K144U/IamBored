// Bright stars (mag ≤ 4.5, from public/data/stars.json) → azimuth/elevation.
//
// One astronomy-engine rotation matrix per frame (J2000 equator → observer's horizon, including
// precession, nutation and Earth rotation) and then a cheap 3×3 multiply per star, so ~900 stars
// cost well under a millisecond.
import { Observer as AObserver, Refraction, Rotation_EQJ_HOR } from 'astronomy-engine';
import type { Observer } from './satellites';

export interface Star {
  /** stable index into the catalogue */
  id: number;
  /** proper name (Sirius) or designation (α CMa) */
  name: string;
  designation: string;
  con: string | null;
  mag: number;
  /** B−V colour index (null when unknown) */
  bv: number | null;
  /** J2000 unit vector */
  x: number;
  y: number;
  z: number;
}

export interface StarPosition {
  star: Star;
  az: number;
  el: number;
}

/** Shape of stars.json, see scripts/build-stars.mjs. */
export interface StarCatalogFile {
  source: string;
  license: string;
  fields: string[];
  stars: [number, number, number, number | null, string | null, string, string | null][];
}

const RAD = Math.PI / 180;

export function parseCatalog(doc: StarCatalogFile): Star[] {
  if (!Array.isArray(doc?.stars)) throw new Error('Bad star catalogue');
  return doc.stars.map(([raH, dec, mag, bv, name, designation, con], id) => {
    const ra = raH * 15 * RAD;
    const d = dec * RAD;
    return {
      id,
      name: name ?? designation,
      designation,
      con,
      mag,
      bv,
      x: Math.cos(d) * Math.cos(ra),
      y: Math.cos(d) * Math.sin(ra),
      z: Math.sin(d),
    };
  });
}

type Matrix = number[][];

/** J2000 equator → observer's horizon (precession, nutation, Earth rotation), for one moment. */
export function horizonMatrix(date: Date, observer: Observer): Matrix {
  return Rotation_EQJ_HOR(date, new AObserver(observer.lat, observer.lon, observer.heightM)).rot;
}

/** Rotate one J2000 unit vector to azimuth/elevation (with standard refraction). */
export function toAzEl(m: Matrix, x: number, y: number, z: number): { az: number; el: number } {
  // astronomy-engine stores rotations so that out_i = Σ_j rot[j][i] · in_j.
  // Horizontal frame: x = north, y = west, z = zenith.
  const n = m[0][0] * x + m[1][0] * y + m[2][0] * z;
  const w = m[0][1] * x + m[1][1] * y + m[2][1] * z;
  const up = m[0][2] * x + m[1][2] * y + m[2][2] * z;
  const geo = Math.asin(Math.max(-1, Math.min(1, up))) / RAD;
  // refraction is skipped deep below the horizon, where it is meaningless
  const el = geo > -5 ? geo + Refraction('normal', geo) : geo;
  let az = Math.atan2(-w, n) / RAD;
  if (az < 0) az += 360;
  return { az, el };
}

/**
 * Horizontal positions of the stars at `date`, with standard refraction.
 * Stars below `minEl` (degrees) are dropped.
 */
export function starPositions(stars: Star[], date: Date, observer: Observer, minEl = 0): StarPosition[] {
  const m = horizonMatrix(date, observer);
  const out: StarPosition[] = [];
  for (const s of stars) {
    const { az, el } = toAzEl(m, s.x, s.y, s.z);
    if (el >= minEl) out.push({ star: s, az, el });
  }
  return out;
}

// ───────────────────────── constellation stick figures ─────────────────────────

/** Shape of constellations.json, see scripts/build-constellations.mjs. */
export interface ConstellationFile {
  license: string;
  figures: { id: string; lines: [number, number][][] }[];
}

export interface Figure {
  /** IAU abbreviation */
  id: string;
  /** polylines of J2000 unit vectors */
  lines: [number, number, number][][];
}

const unit = (raH: number, dec: number): [number, number, number] => {
  const ra = raH * 15 * RAD;
  const d = dec * RAD;
  return [Math.cos(d) * Math.cos(ra), Math.cos(d) * Math.sin(ra), Math.sin(d)];
};

export function parseConstellations(doc: ConstellationFile): Figure[] {
  if (!Array.isArray(doc?.figures)) throw new Error('Bad constellation file');
  return doc.figures.map((f) => ({ id: f.id, lines: f.lines.map((l) => l.map(([ra, dec]) => unit(ra, dec))) }));
}

/** Stick figures as az/el polylines for the radar. Lines entirely below the horizon are dropped. */
export function figureLines(figures: Figure[], date: Date, observer: Observer): { az: number; el: number }[][] {
  const m = horizonMatrix(date, observer);
  const out: { az: number; el: number }[][] = [];
  for (const f of figures) {
    for (const line of f.lines) {
      const pts = line.map(([x, y, z]) => toAzEl(m, x, y, z));
      if (pts.some((p) => p.el > 0)) out.push(pts);
    }
  }
  return out;
}

/** Approximate star colour from the B−V index (blue-white → orange-red), as an "r,g,b" string. */
export function bvToRgb(bv: number | null): string {
  if (bv === null || !Number.isFinite(bv)) return '255,255,255';
  const stops: [number, [number, number, number]][] = [
    [-0.3, [155, 176, 255]],
    [0.0, [202, 215, 255]],
    [0.3, [248, 247, 255]],
    [0.6, [255, 244, 234]],
    [1.0, [255, 210, 161]],
    [1.5, [255, 180, 120]],
    [2.0, [255, 160, 90]],
  ];
  const x = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], bv));
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i];
    const [x0, c0] = stops[i - 1];
    if (x <= x1) {
      const f = (x - x0) / (x1 - x0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(',');
    }
  }
  return stops[stops.length - 1][1].join(',');
}

/**
 * Faintest star magnitude worth drawing for a given Sun altitude: none in daylight, only the
 * brightest in civil twilight, everything in the catalogue once it is dark.
 */
export function starMagLimit(sunAltDeg: number): number {
  if (sunAltDeg > -2) return -Infinity;
  if (sunAltDeg > -6) return 1;
  if (sunAltDeg > -12) return 3;
  return 4.5;
}

/** IAU constellation abbreviations → names. */
export const CONSTELLATIONS: Record<string, string> = {
  And: 'Andromeda', Ant: 'Antlia', Aps: 'Apus', Aqr: 'Aquarius', Aql: 'Aquila', Ara: 'Ara', Ari: 'Aries',
  Aur: 'Auriga', Boo: 'Boötes', Cae: 'Caelum', Cam: 'Camelopardalis', Cnc: 'Cancer', CVn: 'Canes Venatici',
  CMa: 'Canis Major', CMi: 'Canis Minor', Cap: 'Capricornus', Car: 'Carina', Cas: 'Cassiopeia',
  Cen: 'Centaurus', Cep: 'Cepheus', Cet: 'Cetus', Cha: 'Chamaeleon', Cir: 'Circinus', Col: 'Columba',
  Com: 'Coma Berenices', CrA: 'Corona Australis', CrB: 'Corona Borealis', Crv: 'Corvus', Crt: 'Crater',
  Cru: 'Crux', Cyg: 'Cygnus', Del: 'Delphinus', Dor: 'Dorado', Dra: 'Draco', Equ: 'Equuleus',
  Eri: 'Eridanus', For: 'Fornax', Gem: 'Gemini', Gru: 'Grus', Her: 'Hercules', Hor: 'Horologium',
  Hya: 'Hydra', Hyi: 'Hydrus', Ind: 'Indus', Lac: 'Lacerta', Leo: 'Leo', LMi: 'Leo Minor', Lep: 'Lepus',
  Lib: 'Libra', Lup: 'Lupus', Lyn: 'Lynx', Lyr: 'Lyra', Men: 'Mensa', Mic: 'Microscopium',
  Mon: 'Monoceros', Mus: 'Musca', Nor: 'Norma', Oct: 'Octans', Oph: 'Ophiuchus', Ori: 'Orion',
  Pav: 'Pavo', Peg: 'Pegasus', Per: 'Perseus', Phe: 'Phoenix', Pic: 'Pictor', Psc: 'Pisces',
  PsA: 'Piscis Austrinus', Pup: 'Puppis', Pyx: 'Pyxis', Ret: 'Reticulum', Sge: 'Sagitta',
  Sgr: 'Sagittarius', Sco: 'Scorpius', Scl: 'Sculptor', Sct: 'Scutum', Ser: 'Serpens', Sex: 'Sextans',
  Tau: 'Taurus', Tel: 'Telescopium', Tri: 'Triangulum', TrA: 'Triangulum Australe', Tuc: 'Tucana',
  UMa: 'Ursa Major', UMi: 'Ursa Minor', Vel: 'Vela', Vir: 'Virgo', Vol: 'Volans', Vul: 'Vulpecula',
};
