import { describe, expect, it } from 'vitest';
import type { Activity } from './types';
import { earlierVersions, resolveVersions, sameRun, timeRange } from './versions';

const T0 = Date.UTC(2026, 10, 1, 7, 0, 0);
function run(id: string, startMin: number, endMin: number, extra: Partial<Activity> = {}): Activity {
  const points = [];
  for (let m = startMin; m <= endMin; m++) points.push({ lat: 40.78, lon: -73.96 + m * 1e-4, t: T0 + m * 60_000 });
  return { id, playerId: 'you', name: id, startedAt: T0 + startMin * 60_000, source: 'gpx', points, ...extra };
}

describe('run versions', () => {
  it('a cropped re-export of the same run is the same run', () => {
    const original = run('orig', 0, 40);
    const cropped = run('crop', 5, 38); // start and end trimmed on Strava
    expect(sameRun(original, cropped)).toBe(true);
    expect(timeRange(cropped)).toEqual({ start: T0 + 5 * 60_000, end: T0 + 38 * 60_000 });
  });

  it('back-to-back runs, other players and far-apart times are different runs', () => {
    expect(sameRun(run('a', 0, 30), run('b', 31, 60))).toBe(false);
    expect(sameRun(run('a', 0, 30), run('b', 0, 30, { playerId: 'nova' }))).toBe(false);
    expect(sameRun(run('a', 0, 30), run('b', 25, 90))).toBe(false); // 5 min overlap of a 30 min run
  });

  it('the newest upload is current and the others are kept as older versions', () => {
    const v1 = run('v1', 0, 40, { uploadedAt: 1000 });
    const other = run('other', 120, 150, { uploadedAt: 1500 });
    const v2 = run('v2', 5, 38, { uploadedAt: 2000 });
    const { current, older } = resolveVersions([v1, other, v2]);
    expect(current.map((a) => a.id)).toEqual(['other', 'v2']);
    expect(older.get('v2')!.map((a) => a.id)).toEqual(['v1']);
  });

  it('re-uploading the original later makes it current again (newest upload wins)', () => {
    const v1 = run('v1', 0, 40, { uploadedAt: 1000 });
    const v2 = run('v2', 5, 38, { uploadedAt: 2000 });
    const v1again = run('v1b', 0, 40, { uploadedAt: 3000 });
    const { current, older } = resolveVersions([v1, v2, v1again]);
    expect(current.map((a) => a.id)).toEqual(['v1b']);
    expect(older.get('v1b')!.map((a) => a.id)).toEqual(['v2', 'v1']);
  });

  it('uploads without timestamps (old data, demo) keep their order and lose to timestamped ones', () => {
    const old = run('old', 0, 40);
    const fresh = run('fresh', 2, 40, { uploadedAt: 10 });
    expect(resolveVersions([old, fresh]).current.map((a) => a.id)).toEqual(['fresh']);
    expect(resolveVersions([run('x', 0, 10), run('y', 0, 10)]).current.map((a) => a.id)).toEqual(['y']);
  });

  it('finds what a new file would replace', () => {
    const existing = [run('a', 0, 40), run('b', 100, 140)];
    expect(earlierVersions(run('new', 3, 41), existing).map((a) => a.id)).toEqual(['a']);
  });
});
