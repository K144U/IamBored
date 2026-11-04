// Turn a raw GPS track into clean segments, and catch obvious cheating.
import { distanceM } from './geo';
import type { Rules, TrackPoint } from './types';

export interface CleanResult {
  ok: boolean;
  reason?: string;
  warnings: string[];
  segments: TrackPoint[][];
  distanceM: number;
  movingS: number;
  avgKmh: number;
}

export function cleanTrack(points: TrackPoint[], rules: Rules): CleanResult {
  const fail = (reason: string): CleanResult => ({
    ok: false,
    reason,
    warnings: [],
    segments: [],
    distanceM: 0,
    movingS: 0,
    avgKmh: 0,
  });

  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90);
  if (pts.length < 10) return fail('Too few GPS points to be a run.');
  if (pts.some((p) => p.t === undefined || !Number.isFinite(p.t))) {
    return fail('No timestamps. This looks like a planned route, not a recorded run.');
  }
  pts.sort((a, b) => a.t! - b.t!);

  const warnings: string[] = [];
  const segments: TrackPoint[][] = [[pts[0]]];
  let last = pts[0];
  let dropped = 0;
  let dist = 0;
  let moving = 0;

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const d = distanceM(last.lat, last.lon, p.lat, p.lon);
    const dt = (p.t! - last.t!) / 1000;
    if (d < 0.5) continue; // standing still / duplicate
    const kmh = dt > 0 ? (d / dt) * 3.6 : Infinity;
    if (d > rules.gapM) {
      // Signal lost (tunnel, phone pocketed...): start a new segment, never claim across the gap.
      if (kmh > rules.maxPointSpeedKmh) dropped++;
      segments.push([p]);
      last = p;
      continue;
    }
    if (kmh > rules.maxPointSpeedKmh) {
      dropped++;
      continue;
    }
    segments[segments.length - 1].push(p);
    dist += d;
    if (kmh > 1.5) moving += dt;
    last = p;
  }

  const kept = segments.filter((s) => s.length >= 2);
  if (dropped) warnings.push(`Removed ${dropped} GPS glitch point${dropped > 1 ? 's' : ''}.`);
  if (kept.length > 1) warnings.push(`GPS gaps split the run into ${kept.length} parts. No land is claimed across a gap.`);
  if (dist < 200) return fail('Shorter than 200 m.');
  const avgKmh = moving > 0 ? (dist / moving) * 3.6 : 0;
  if (avgKmh > rules.maxAvgSpeedKmh) {
    return fail(`Average moving speed ${avgKmh.toFixed(1)} km/h is too fast for running. Bike or car?`);
  }
  if (dropped > pts.length * 0.2) return fail('Too many impossible jumps in the GPS track.');
  return { ok: true, warnings, segments: kept, distanceM: dist, movingS: moving, avgKmh };
}
