// Several uploads of the same run (an edited Strava export, a re-export from the watch) must not
// claim twice. Strava's GPX has no activity id, so runs are matched by time instead: one person
// can't run two runs at the same moment. The newest upload of a run is its current version.
import type { Activity } from './types';

export interface TimeRange {
  start: number;
  end: number;
}

export function timeRange(a: Activity): TimeRange {
  let start = Infinity;
  let end = -Infinity;
  for (const p of a.points) {
    if (p.t === undefined) continue;
    if (p.t < start) start = p.t;
    if (p.t > end) end = p.t;
  }
  return Number.isFinite(start) ? { start, end } : { start: a.startedAt, end: a.startedAt };
}

/** Same player, and their times overlap by at least half of the shorter run (min. 1 minute). */
export function sameRun(a: Activity, b: Activity): boolean {
  if (a.playerId !== b.playerId || a.id === b.id) return false;
  const ra = timeRange(a);
  const rb = timeRange(b);
  const overlap = Math.min(ra.end, rb.end) - Math.max(ra.start, rb.start);
  const shorter = Math.max(60_000, Math.min(ra.end - ra.start, rb.end - rb.start));
  return overlap >= shorter / 2;
}

export interface Versions {
  /** the version of each run that counts (the newest upload) */
  current: Activity[];
  /** current activity id → its older versions, newest first */
  older: Map<string, Activity[]>;
}

/** Group uploads of the same run; the most recently uploaded one is current. */
export function resolveVersions(activities: Activity[]): Versions {
  // uploads without a timestamp (older data, the demo) keep their order, before any timestamped one
  const order = new Map(activities.map((a, i) => [a.id, i]));
  const newer = (a: Activity, b: Activity) =>
    (a.uploadedAt ?? -1) - (b.uploadedAt ?? -1) || order.get(a.id)! - order.get(b.id)!;
  const groups: Activity[][] = [];
  for (const a of activities) {
    // a run can bridge two groups (e.g. an un-cropped export overlapping two short ones): merge them
    const hits = groups.filter((g) => g.some((b) => sameRun(a, b)));
    const merged = [a, ...hits.flat()];
    for (const h of hits) groups.splice(groups.indexOf(h), 1);
    groups.push(merged);
  }
  const current: Activity[] = [];
  const older = new Map<string, Activity[]>();
  for (const g of groups) {
    const sorted = [...g].sort((x, y) => newer(y, x));
    current.push(sorted[0]);
    if (sorted.length > 1) older.set(sorted[0].id, sorted.slice(1));
  }
  current.sort((x, y) => order.get(x.id)! - order.get(y.id)!);
  return { current, older };
}

/** Existing uploads that a new file would replace. */
export const earlierVersions = (incoming: Activity, existing: Activity[]) => existing.filter((a) => sameRun(incoming, a));
