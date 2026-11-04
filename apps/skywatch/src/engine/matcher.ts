// "What's That?" matcher: which known object is the user most likely pointing at?
// See docs/SKYWATCH_PLAN.md §7.2–7.5.
import { azElFromEnu, enuFromAzEl, norm, RAD, sepDeg, sub, scale, type Vec3 } from './pointing';

export type CandidateKind = 'sat' | 'moon' | 'planet' | 'star' | 'sun';

export interface Candidate {
  key: string;
  name: string;
  kind: CandidateKind;
  az: number;
  el: number;
  /** visual magnitude when known */
  mag?: number;
  /** ENU direction now */
  dir: Vec3;
  /** apparent motion: change of `dir` per second (rad/s) */
  vel: Vec3;
  /** brighter-than-usual satellites (ISS, Tiangong, Hubble) */
  important?: boolean;
}

export interface Match {
  c: Candidate;
  /** degrees from where the phone points */
  sep: number;
  score: number;
  /** 0..1, share of the total score */
  confidence: number;
}

/**
 * How likely you noticed this object at all. Bright things win; moving satellites catch the eye.
 * Rough, by design: the spatial term does most of the work once calibrated.
 */
export function prior(c: Candidate): number {
  if (c.kind === 'moon') return 20;
  if (c.kind === 'sun') return 0; // never a candidate: nobody should be pointing a phone camera at it
  if (c.kind === 'sat') return c.important ? 6 : 2;
  const mag = c.mag ?? 3;
  // ×2.5 per magnitude would make Venus 1000× a 3rd-mag star; flatten it to ×1.6
  return Math.min(12, 1.6 ** -(mag - 1));
}

/** Spatial score: a Gaussian with the expected pointing error σ. */
export const spatial = (sepDegrees: number, sigma: number) => Math.exp(-(sepDegrees ** 2) / (2 * sigma ** 2));

/** Degrees per second of an angular-velocity vector. */
export const rateDeg = (vel: Vec3) => norm(vel) / RAD;

/**
 * How well an observed apparent motion matches a predicted one (both rad/s vectors).
 * The tolerance grows with speed: following a fast light by hand is sloppy.
 */
export function motionScore(observed: Vec3, predicted: Vec3): number {
  const diff = rateDeg(sub(observed, predicted));
  const tol = 0.12 + 0.3 * Math.max(rateDeg(observed), rateDeg(predicted));
  return Math.max(0.02, Math.exp(-(diff ** 2) / (2 * tol ** 2)));
}

export interface ScoreResult {
  matches: Match[];
  /** best candidate is still far outside the error cone */
  nothingObvious: boolean;
}

export function scoreCandidates(
  pointing: Vec3,
  candidates: Candidate[],
  sigma: number,
  motion: Vec3 | null = null,
): ScoreResult {
  const scored: Match[] = [];
  let bestSpatial = 0;
  for (const c of candidates) {
    const p = prior(c);
    if (p <= 0) continue;
    const sep = sepDeg(pointing, c.dir);
    if (sep > 4 * sigma) continue;
    const s = spatial(sep, sigma);
    bestSpatial = Math.max(bestSpatial, s);
    const score = s * p * (motion ? motionScore(motion, c.vel) : 1);
    scored.push({ c, sep, score, confidence: 0 });
  }
  const total = scored.reduce((a, m) => a + m.score, 0);
  for (const m of scored) m.confidence = total > 0 ? m.score / total : 0;
  scored.sort((a, b) => b.score - a.score);
  // more than ~2σ away from everything: probably a plane, a faint satellite, or the compass is off
  return { matches: scored.slice(0, 3), nothingObvious: bestSpatial < 0.135 };
}

/**
 * Apparent motion from pointing samples taken while the user follows a light.
 * Uses the first and last quarter of the window (averaged) to beat hand jitter.
 */
export function fitMotion(samples: { t: number; v: Vec3 }[]): Vec3 | null {
  if (samples.length < 4) return null;
  const dt = (samples[samples.length - 1].t - samples[0].t) / 1000;
  if (dt < 1) return null;
  const q = Math.max(1, Math.floor(samples.length / 4));
  const avg = (part: { t: number; v: Vec3 }[]) => {
    const s = part.reduce<Vec3>((a, x) => [a[0] + x.v[0], a[1] + x.v[1], a[2] + x.v[2]], [0, 0, 0]);
    const t = part.reduce((a, x) => a + x.t, 0) / part.length;
    return { v: scale(s, 1 / part.length), t };
  };
  const a = avg(samples.slice(0, q));
  const b = avg(samples.slice(-q));
  return scale(sub(b.v, a.v), 1000 / (b.t - a.t));
}

/** Compass direction of a motion vector at a given pointing direction, e.g. "NE", plus rate. */
export function describeMotion(dir: Vec3, vel: Vec3): { rate: number; towardsAz: number } {
  const rate = rateDeg(vel);
  const ahead = azElFromEnu([dir[0] + vel[0] * 30, dir[1] + vel[1] * 30, dir[2] + vel[2] * 30]);
  return { rate, towardsAz: ahead.az };
}

// ───────────────────────── calibration ─────────────────────────

export interface Calibration {
  /** add to the measured azimuth / elevation (degrees) */
  dAz: number;
  dEl: number;
  at: number;
  lat: number;
  lon: number;
  /** what it was calibrated on, e.g. "Jupiter" */
  on: string;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function makeCalibration(
  measured: Vec3,
  truth: Vec3,
  on: string,
  at: number,
  place: { lat: number; lon: number },
): Calibration {
  const m = azElFromEnu(measured);
  const t = azElFromEnu(truth);
  return { dAz: wrap180(t.az - m.az), dEl: t.el - m.el, at, lat: place.lat, lon: place.lon, on };
}

export function applyCalibration(v: Vec3, cal: Calibration | null): Vec3 {
  if (!cal) return v;
  const { az, el } = azElFromEnu(v);
  return enuFromAzEl(az + cal.dAz, Math.max(-90, Math.min(90, el + cal.dEl)));
}

/** A calibration is trusted for 12 hours and within ~100 km (the magnetic environment changes). */
export function calibrationValid(cal: Calibration | null, now: number, place: { lat: number; lon: number }): boolean {
  if (!cal) return false;
  if (now - cal.at > 12 * 3600_000 || now < cal.at) return false;
  const dLat = (place.lat - cal.lat) * 111;
  const dLon = (place.lon - cal.lon) * 111 * Math.cos(place.lat * RAD);
  return Math.hypot(dLat, dLon) < 100;
}

/** Expected pointing error σ (degrees): ~12° on the raw compass, ~3° after a one-point calibration. */
export const pointingSigma = (calibrated: boolean) => (calibrated ? 3 : 12);
