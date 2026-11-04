// Helpers to build synthetic GPS tracks (tests and demo data).
import { distanceM, offset } from './geo';
import type { TrackPoint } from './types';

/** Seeded random numbers so demo/test data is identical every time. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrackOptions {
  start: number;
  /** metres per second (3 m/s ≈ 5:33 /km) */
  speed?: number;
  /** seconds between GPS points */
  everyS?: number;
  /** random GPS error in metres */
  jitterM?: number;
  seed?: number;
}

/**
 * Walk along waypoints given as [east, north] metre offsets from an origin,
 * producing a timestamped track like a GPS watch would.
 */
export function trackFromOffsets(
  origin: { lat: number; lon: number },
  waypoints: [number, number][],
  opts: TrackOptions,
): TrackPoint[] {
  const { start, speed = 3, everyS = 2, jitterM = 0, seed = 1 } = opts;
  const rand = rng(seed);
  const pts: TrackPoint[] = [];
  const step = speed * everyS;
  let t = start;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [e0, n0] = waypoints[i];
    const [e1, n1] = waypoints[i + 1];
    const len = Math.hypot(e1 - e0, n1 - n0);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      const je = (rand() - 0.5) * 2 * jitterM;
      const jn = (rand() - 0.5) * 2 * jitterM;
      const p = offset(origin.lat, origin.lon, e0 + (e1 - e0) * f + je, n0 + (n1 - n0) * f + jn);
      pts.push({ ...p, t });
      t += everyS * 1000;
    }
  }
  const [el, nl] = waypoints[waypoints.length - 1];
  pts.push({ ...offset(origin.lat, origin.lon, el, nl), t });
  return pts;
}

/** Closed rectangle centred on (cx, cy) metres from origin, starting at the south-west corner. */
export function rectangle(cx: number, cy: number, w: number, h: number): [number, number][] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

export function trackLengthM(pts: TrackPoint[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distanceM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  return d;
}
