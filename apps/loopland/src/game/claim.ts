// The LoopLand game engine: Paper.io rules on an H3 hex grid.
//
// A run claims every area it ENCLOSES: loops that cross themselves, runs that
// end where they started, and excursions that leave your land and come back.
// Enclosing someone else's land steals it. Land you don't visit fades and
// eventually goes neutral.
import { cellToLatLng, getHexagonAreaAvg, gridDisk, gridPathCells, latLngToCell, polygonToCells } from 'h3-js';
import { cleanTrack } from './clean';
import { distanceM, offset } from './geo';
import { DEFAULT_RULES, type Activity, type Rules, type TrackPoint } from './types';

const DAY = 86_400_000;

export interface Cell {
  owner: string;
  claimedAt: number;
  refreshedAt: number;
  activityId: string;
}

export type CellStatus = 'owned' | 'fading' | 'neutral';

export interface ClaimResult {
  activityId: string;
  playerId: string;
  accepted: boolean;
  reason?: string;
  warnings: string[];
  distanceM: number;
  avgKmh: number;
  endedAt: number;
  segments: TrackPoint[][];
  /** cells the run passed through */
  trail: string[];
  /** cells that became this player's (incl. stolen ones) */
  claimed: string[];
  /** claimed cells grouped in flood-fill order, for the replay animation */
  waves: string[][];
  /** cells taken from each other player */
  stolen: Record<string, number>;
  /** own cells that were refreshed */
  refreshed: number;
}

export interface PlayerStats {
  cells: number;
  fading: number;
  areaKm2: number;
}

function neighbors(h: string): string[] {
  return gridDisk(h, 1);
}

function path(a: string, b: string): string[] {
  try {
    return gridPathCells(a, b);
  } catch {
    return [a, b];
  }
}

/** Flood-fill from the region border through non-wall cells; returns everything NOT reached. */
function enclosedBy(region: Set<string>, isWall: (h: string) => boolean): Set<string> {
  const reached = new Set<string>();
  const queue: string[] = [];
  for (const h of region) {
    if (isWall(h)) continue;
    if (neighbors(h).some((n) => !region.has(n))) {
      reached.add(h);
      queue.push(h);
    }
  }
  while (queue.length) {
    const h = queue.pop()!;
    for (const n of neighbors(h)) {
      if (region.has(n) && !reached.has(n) && !isWall(n)) {
        reached.add(n);
        queue.push(n);
      }
    }
  }
  const out = new Set<string>();
  for (const h of region) if (!isWall(h) && !reached.has(h)) out.add(h);
  return out;
}

/** Split a set of cells into connected components. */
function components(cells: Set<string>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const h = queue.pop()!;
      comp.push(h);
      for (const n of neighbors(h)) {
        if (cells.has(n) && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

export class Game {
  readonly cells = new Map<string, Cell>();
  readonly cellAreaKm2: number;

  constructor(readonly rules: Rules = DEFAULT_RULES) {
    this.cellAreaKm2 = getHexagonAreaAvg(rules.res, 'km2');
  }

  status(cell: Cell, now: number): CellStatus {
    const age = (now - cell.refreshedAt) / DAY;
    if (age > this.rules.neutralDays) return 'neutral';
    if (age > this.rules.fadeDays) return 'fading';
    return 'owned';
  }

  /** Who owns this cell at time `now` (null = neutral). */
  ownerAt(h: string, now: number): string | null {
    const c = this.cells.get(h);
    return c && this.status(c, now) !== 'neutral' ? c.owner : null;
  }

  stats(now: number): Map<string, PlayerStats> {
    const out = new Map<string, PlayerStats>();
    for (const c of this.cells.values()) {
      const st = this.status(c, now);
      if (st === 'neutral') continue;
      const s = out.get(c.owner) ?? { cells: 0, fading: 0, areaKm2: 0 };
      s.cells++;
      if (st === 'fading') s.fading++;
      s.areaKm2 += this.cellAreaKm2;
      out.set(c.owner, s);
    }
    return out;
  }

  /** Cells per player and status, for rendering. */
  territory(now: number): Map<string, { owned: string[]; fading: string[] }> {
    const out = new Map<string, { owned: string[]; fading: string[] }>();
    for (const [h, c] of this.cells) {
      const st = this.status(c, now);
      if (st === 'neutral') continue;
      const t = out.get(c.owner) ?? { owned: [], fading: [] };
      (st === 'owned' ? t.owned : t.fading).push(h);
      out.set(c.owner, t);
    }
    return out;
  }

  apply(activity: Activity): ClaimResult {
    const { rules } = this;
    const clean = cleanTrack(activity.points, rules);
    const base: ClaimResult = {
      activityId: activity.id,
      playerId: activity.playerId,
      accepted: clean.ok,
      reason: clean.reason,
      warnings: clean.warnings,
      distanceM: clean.distanceM,
      avgKmh: clean.avgKmh,
      endedAt: activity.startedAt,
      segments: clean.segments,
      trail: [],
      claimed: [],
      waves: [],
      stolen: {},
      refreshed: 0,
    };
    if (!clean.ok) return base;

    const P = activity.playerId;
    const segs = clean.segments;
    const lastSeg = segs[segs.length - 1];
    const T = lastSeg[lastSeg.length - 1].t!;
    base.endedAt = T;

    // 1 ── trail: a gap-free line of cells along the run
    const trail = new Set<string>();
    for (const seg of segs) {
      let prev: string | null = null;
      for (const p of seg) {
        const h = latLngToCell(p.lat, p.lon, rules.res);
        if (prev && h !== prev) for (const c of path(prev, h)) trail.add(c);
        else trail.add(h);
        prev = h;
      }
    }
    // a run that ends where it started closes its loop
    if (segs.length === 1) {
      const a = segs[0][0];
      const b = segs[0][segs[0].length - 1];
      if (distanceM(a.lat, a.lon, b.lat, b.lon) <= rules.autoCloseM) {
        for (const c of path(latLngToCell(b.lat, b.lon, rules.res), latLngToCell(a.lat, a.lon, rules.res))) {
          trail.add(c);
        }
      }
    }
    base.trail = [...trail];

    // 2 ── your land that touches this run (connected components)
    const isOwn = (h: string) => this.ownerAt(h, T) === P;
    const land = new Set<string>();
    const queue: string[] = [];
    for (const h of trail) {
      for (const n of neighbors(h)) {
        if (!land.has(n) && isOwn(n)) {
          land.add(n);
          queue.push(n);
        }
      }
    }
    while (queue.length) {
      const h = queue.pop()!;
      for (const n of neighbors(h)) {
        if (!land.has(n) && isOwn(n)) {
          land.add(n);
          queue.push(n);
        }
      }
    }

    // 3 ── a working region around the trail + that land
    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;
    for (const h of [...trail, ...land]) {
      const [lat, lon] = cellToLatLng(h);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
    const lo = offset(minLat, minLon, -100, -100);
    const hi = offset(maxLat, maxLon, 100, 100);
    const region = new Set(
      polygonToCells(
        [
          [lo.lat, lo.lon],
          [lo.lat, hi.lon],
          [hi.lat, hi.lon],
          [hi.lat, lo.lon],
        ],
        rules.res,
      ),
    );
    for (const h of trail) region.add(h);
    for (const h of land) region.add(h);

    // 4 ── Paper.io fill: walls = trail + your touching land; whatever the outside can't reach is enclosed
    const enclosed = enclosedBy(region, (h) => trail.has(h) || land.has(h));
    // keep only pockets the run actually helped close (touching the trail), and not tiny GPS noise
    const pockets = components(enclosed).filter(
      (comp) => comp.length >= rules.minEnclosed && comp.some((h) => neighbors(h).some((n) => trail.has(n))),
    );
    const pocketCells = new Set(pockets.flat());

    // 5 ── trail cells claimed: the ones that border a pocket, or fading land anyone can grab
    const trailClaim = new Set<string>();
    for (const h of trail) {
      if (neighbors(h).some((n) => pocketCells.has(n))) trailClaim.add(h);
      else {
        const c = this.cells.get(h);
        if (c && c.owner !== P && this.status(c, T) === 'fading') trailClaim.add(h);
      }
    }

    // 6 ── refresh: your cells on the trail, and your land enclosed by this loop alone
    const refresh = new Set<string>();
    for (const h of trail) if (isOwn(h)) refresh.add(h);
    if (land.size) {
      for (const h of enclosedBy(region, (x) => trail.has(x))) if (isOwn(h)) refresh.add(h);
    }

    // 7 ── apply
    const claimed: string[] = [];
    const take = (h: string) => {
      const prevOwner = this.ownerAt(h, T);
      if (prevOwner === P) {
        refresh.add(h);
        return;
      }
      if (prevOwner) base.stolen[prevOwner] = (base.stolen[prevOwner] ?? 0) + 1;
      this.cells.set(h, { owner: P, claimedAt: T, refreshedAt: T, activityId: activity.id });
      claimed.push(h);
    };
    for (const h of trailClaim) take(h);
    for (const h of pocketCells) take(h);
    for (const h of refresh) {
      const c = this.cells.get(h);
      if (c && c.owner === P) c.refreshedAt = Math.max(c.refreshedAt, T);
    }
    base.claimed = claimed;
    base.refreshed = refresh.size;
    base.waves = floodWaves(new Set(claimed), trail);
    return base;
  }
}

/** Order claimed cells by distance from the trail: the flood animation. */
function floodWaves(claimed: Set<string>, trail: Set<string>): string[][] {
  const waves: string[][] = [];
  const seen = new Set<string>();
  let frontier = [...claimed].filter((h) => trail.has(h) || neighbors(h).some((n) => trail.has(n)));
  for (const h of frontier) seen.add(h);
  while (frontier.length) {
    waves.push(frontier);
    const next: string[] = [];
    for (const h of frontier) {
      for (const n of neighbors(h)) {
        if (claimed.has(n) && !seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  const rest = [...claimed].filter((h) => !seen.has(h));
  if (rest.length) waves.push(rest);
  return waves;
}

/** Replay a list of activities in time order into a fresh game. */
export function replay(activities: Activity[], rules: Rules = DEFAULT_RULES) {
  const game = new Game(rules);
  const results = [...activities]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((a) => game.apply(a));
  return { game, results };
}
