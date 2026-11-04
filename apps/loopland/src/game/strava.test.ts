import { describe, expect, it } from 'vitest';
import { stravaToActivity, streamsToPoints, type StravaRun } from './strava';
import { sameRun } from './versions';

const run: StravaRun = { id: 123, name: 'Morning Run', type: 'Run', start: '2026-11-01T07:00:00Z', km: 1.1, minutes: 6, gps: true };
const streams = {
  latlng: [
    [40.78, -73.97],
    [40.781, -73.969],
    [40.782, -73.968],
  ] as [number, number][],
  time: [0, 30, 60],
};

describe('Strava import', () => {
  it('timestamps every point from the start time plus the time stream', () => {
    const pts = streamsToPoints(run.start, streams);
    expect(pts).toHaveLength(3);
    expect(pts[2]).toEqual({ lat: 40.782, lon: -73.968, t: Date.parse('2026-11-01T07:01:00Z') });
  });

  it('makes a LoopLand run with a stable id, and refuses empty tracks', () => {
    const a = stravaToActivity(run, streams, 'you', 99)!;
    expect(a.id).toBe('strava-123');
    expect(a.source).toBe('strava');
    expect(a.startedAt).toBe(Date.parse(run.start));
    expect(a.uploadedAt).toBe(99);
    expect(stravaToActivity(run, { latlng: [], time: [] }, 'you', 1)).toBeNull();
  });

  it("a Strava import and a GPX of the same run are versions of one run", () => {
    const a = stravaToActivity(run, streams, 'you', 1)!;
    const gpx = { ...a, id: 'file-1', source: 'gpx' };
    expect(sameRun(a, gpx)).toBe(true);
  });
});
