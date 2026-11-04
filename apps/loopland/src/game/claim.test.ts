import { latLngToCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { Game, replay } from './claim';
import { offset } from './geo';
import { rectangle, trackFromOffsets } from './testkit';
import { DEFAULT_RULES, type Activity } from './types';

const O = { lat: 40.7812, lon: -73.9665 }; // Central Park, NYC
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 8, 0, 0);
let n = 0;

function run(playerId: string, waypoints: [number, number][], start: number, extra: Partial<Parameters<typeof trackFromOffsets>[2]> = {}): Activity {
  return {
    id: `a${++n}`,
    playerId,
    name: 'test run',
    startedAt: start,
    source: 'test',
    points: trackFromOffsets(O, waypoints, { start, ...extra }),
  };
}

/** cell at metre offset from the origin */
const cellAt = (e: number, nth: number) => {
  const p = offset(O.lat, O.lon, e, nth);
  return latLngToCell(p.lat, p.lon, DEFAULT_RULES.res);
};

describe('claiming', () => {
  it('a closed loop claims the land inside it', () => {
    const g = new Game();
    const r = g.apply(run('A', rectangle(0, 0, 400, 400), T0));
    expect(r.accepted).toBe(true);
    // 400 m × 400 m = 0.16 km² ≈ 74 cells of ~2150 m², plus the trail itself
    expect(r.claimed.length).toBeGreaterThan(70);
    expect(r.claimed.length).toBeLessThan(160);
    expect(g.ownerAt(cellAt(0, 0), T0)).toBe('A');
    expect(g.ownerAt(cellAt(500, 0), T0)).toBe(null);
  });

  it('an out-and-back run claims nothing', () => {
    const g = new Game();
    const r = g.apply(run('A', [[0, 0], [800, 0], [0, 0]], T0));
    expect(r.accepted).toBe(true);
    expect(r.claimed.length).toBe(0);
  });

  it('an open U-shape (start far from end) claims nothing', () => {
    const g = new Game();
    const r = g.apply(run('A', [[0, 0], [0, 400], [400, 400], [400, 0]], T0));
    expect(r.claimed.length).toBe(0);
  });

  it('a nearly-closed loop (start ≈ end) is auto-closed', () => {
    const g = new Game();
    const r = g.apply(run('A', [[0, 0], [400, 0], [400, 400], [0, 400], [0, 50]], T0));
    expect(r.claimed.length).toBeGreaterThan(60);
    expect(g.ownerAt(cellAt(200, 200), T0)).toBe('A');
  });

  it('a figure-8 claims both lobes', () => {
    const g = new Game();
    g.apply(run('A', [[0, 0], [300, 300], [600, 0], [600, 300], [300, 0], [0, 300], [0, 0]], T0));
    expect(g.ownerAt(cellAt(80, 150), T0)).toBe('A');
    expect(g.ownerAt(cellAt(520, 150), T0)).toBe('A');
  });

  it('tiny GPS-noise loops are ignored', () => {
    const g = new Game();
    // pacing back and forth in a 15 m box for a while (plus a straight bit so the run is long enough)
    const wiggle: [number, number][] = [];
    for (let i = 0; i < 20; i++) wiggle.push([i % 2 ? 15 : 0, i % 4 < 2 ? 0 : 15]);
    wiggle.push([300, 0]);
    const r = g.apply(run('A', wiggle, T0, { speed: 2 }));
    expect(r.claimed.length).toBe(0);
  });

  it('stays stable under realistic GPS jitter', () => {
    const clean = new Game().apply(run('A', rectangle(0, 0, 500, 500), T0));
    const noisy = new Game().apply(run('A', rectangle(0, 0, 500, 500), T0, { jitterM: 8, seed: 42 }));
    const ratio = noisy.claimed.length / clean.claimed.length;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });
});

describe('stealing and Paper.io excursions', () => {
  it('looping over someone else’s land steals it', () => {
    const g = new Game();
    g.apply(run('A', rectangle(0, 0, 400, 400), T0));
    const r = g.apply(run('B', rectangle(200, 0, 400, 400), T0 + DAY));
    expect(r.stolen.A).toBeGreaterThan(20);
    expect(g.ownerAt(cellAt(150, 0), T0 + DAY)).toBe('B'); // overlap → B
    expect(g.ownerAt(cellAt(-150, 0), T0 + DAY)).toBe('A'); // A keeps the rest
  });

  it('leaving your land and coming back claims the pocket in between', () => {
    const g = new Game();
    g.apply(run('A', rectangle(0, 0, 400, 400), T0));
    // start inside own land, go out east, loop around, come back in
    const r = g.apply(
      run('A', [[100, -100], [400, -100], [400, 100], [100, 100]], T0 + DAY),
    );
    expect(r.claimed.length).toBeGreaterThan(15);
    expect(g.ownerAt(cellAt(300, 0), T0 + DAY)).toBe('A');
  });

  it('a hole inside your land is not filled unless you run around it (donut rule)', () => {
    const g = new Game();
    g.apply(run('A', rectangle(0, 0, 800, 800), T0));
    g.apply(run('B', rectangle(0, 0, 200, 200), T0 + DAY)); // B steals the middle
    expect(g.ownerAt(cellAt(0, 0), T0 + DAY)).toBe('B');
    // A does a small loop near the far edge of its land, not around B's area
    g.apply(run('A', rectangle(300, 300, 150, 150), T0 + 2 * DAY));
    expect(g.ownerAt(cellAt(0, 0), T0 + 2 * DAY)).toBe('B');
    // ...but running around it takes it back
    g.apply(run('A', rectangle(0, 0, 300, 300), T0 + 3 * DAY));
    expect(g.ownerAt(cellAt(0, 0), T0 + 3 * DAY)).toBe('A');
  });
});

describe('decay', () => {
  it('land fades after 14 days and goes neutral after 30', () => {
    const g = new Game();
    g.apply(run('A', rectangle(0, 0, 400, 400), T0));
    const c = g.cells.get(cellAt(0, 0))!;
    expect(g.status(c, T0 + 10 * DAY)).toBe('owned');
    expect(g.status(c, T0 + 20 * DAY)).toBe('fading');
    expect(g.status(c, T0 + 31 * DAY)).toBe('neutral');
    expect(g.ownerAt(cellAt(0, 0), T0 + 31 * DAY)).toBe(null);
  });

  it('anyone can grab fading land just by running through it', () => {
    const g = new Game();
    g.apply(run('A', rectangle(0, 0, 400, 400), T0));
    const r = g.apply(run('B', [[-300, 0], [300, 0], [-300, 0]], T0 + 20 * DAY));
    expect(r.stolen.A).toBeGreaterThan(5);
    expect(g.ownerAt(cellAt(0, 0), T0 + 20 * DAY)).toBe('B');
  });

  it('running the same loop again keeps the whole area fresh', () => {
    const g = new Game();
    g.apply(run('A', rectangle(0, 0, 400, 400), T0));
    g.apply(run('A', rectangle(0, 0, 400, 400), T0 + 10 * DAY));
    const c = g.cells.get(cellAt(0, 0))!;
    expect(g.status(c, T0 + 20 * DAY)).toBe('owned');
  });
});

describe('anti-cheat & determinism', () => {
  it('rejects runs that are too fast (bike or car)', () => {
    const r = new Game().apply(run('A', rectangle(0, 0, 1000, 1000), T0, { speed: 9 })); // 32 km/h
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/too fast|impossible/i);
  });

  it('rejects planned routes without timestamps', () => {
    const a = run('A', rectangle(0, 0, 400, 400), T0);
    a.points = a.points.map(({ lat, lon }) => ({ lat, lon }));
    const r = new Game().apply(a);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/timestamps/);
  });

  it('drops a single GPS teleport and still counts the run', () => {
    const a = run('A', rectangle(0, 0, 400, 400), T0);
    const mid = Math.floor(a.points.length / 2);
    a.points[mid] = { ...offset(O.lat, O.lon, 5000, 5000), t: a.points[mid].t };
    const r = new Game().apply(a);
    expect(r.accepted).toBe(true);
    expect(r.claimed.length).toBeGreaterThan(70);
  });

  it('every cell has exactly one owner and replays are deterministic', () => {
    const acts = [
      run('A', rectangle(0, 0, 400, 400), T0),
      run('B', rectangle(200, 100, 300, 300), T0 + DAY),
      run('A', [[100, -100], [500, -100], [500, 300], [100, 150]], T0 + 2 * DAY),
    ];
    const a = replay(acts).game;
    const b = replay([...acts].reverse()).game; // replay sorts by time
    expect([...a.cells.entries()]).toEqual([...b.cells.entries()]);
    const stats = a.stats(T0 + 2 * DAY);
    const total = [...stats.values()].reduce((s, x) => s + x.cells, 0);
    expect(total).toBe(a.cells.size);
  });

  it('flood waves cover every claimed cell exactly once', () => {
    const r = new Game().apply(run('A', rectangle(0, 0, 600, 400), T0));
    const flat = r.waves.flat();
    expect(flat.length).toBe(r.claimed.length);
    expect(new Set(flat).size).toBe(flat.length);
    expect(r.waves.length).toBeGreaterThan(3);
  });
});
