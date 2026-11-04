// Turning a Strava activity (from kittu.pro's /api/strava, see the kittu.pro repo) into a LoopLand run.
import type { Activity, TrackPoint } from './types';

/** One entry of /api/strava/activities */
export interface StravaRun {
  id: number;
  name: string;
  type: string;
  /** ISO start time */
  start: string;
  km: number;
  minutes: number;
  /** false for treadmill / manual entries: nothing to put on a map */
  gps: boolean;
}

/** What /api/strava/streams returns: positions and seconds since the start, index by index. */
export interface StravaStreams {
  latlng: [number, number][];
  time: number[];
}

export const stravaActivityId = (id: number) => `strava-${id}`;

export function streamsToPoints(startIso: string, s: StravaStreams): TrackPoint[] {
  const t0 = Date.parse(startIso);
  const n = Math.min(s.latlng.length, s.time.length);
  const out: TrackPoint[] = [];
  for (let i = 0; i < n; i++) {
    const [lat, lon] = s.latlng[i];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ lat, lon, t: Number.isFinite(t0) ? t0 + s.time[i] * 1000 : undefined });
  }
  return out;
}

export function stravaToActivity(run: StravaRun, streams: StravaStreams, playerId: string, uploadedAt: number): Activity | null {
  const points = streamsToPoints(run.start, streams);
  if (points.length < 2) return null;
  return {
    id: stravaActivityId(run.id),
    playerId,
    name: run.name,
    startedAt: points[0].t ?? Date.parse(run.start),
    source: 'strava',
    points,
    uploadedAt,
  };
}
