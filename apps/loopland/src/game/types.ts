export interface TrackPoint {
  lat: number;
  lon: number;
  /** ms since epoch; required for recorded runs */
  t?: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
}

export interface Activity {
  id: string;
  playerId: string;
  name: string;
  /** ms since epoch */
  startedAt: number;
  source: string;
  points: TrackPoint[];
  /**
   * when this file was added (ms). Re-uploading an edited export of the same run (e.g. cropped on
   * Strava) makes a newer version; the newest upload is the one that counts. Missing on old data.
   */
  uploadedAt?: number;
}

export interface Rules {
  /** H3 resolution of game cells (11 ≈ 25 m hexes) */
  res: number;
  /** days without a visit before land starts fading */
  fadeDays: number;
  /** days without a visit before land goes neutral */
  neutralDays: number;
  /** start and end closer than this (m) close the loop automatically */
  autoCloseM: number;
  /** ignore enclosures smaller than this many cells (GPS noise) */
  minEnclosed: number;
  /** a jump faster than this between two points is dropped (km/h) */
  maxPointSpeedKmh: number;
  /** a whole run faster than this (moving average) is rejected (km/h) */
  maxAvgSpeedKmh: number;
  /** gaps longer than this (m) split the track: no claiming across a gap */
  gapM: number;
}

export const DEFAULT_RULES: Rules = {
  res: 11,
  fadeDays: 14,
  neutralDays: 30,
  autoCloseM: 75,
  minEnclosed: 3,
  maxPointSpeedKmh: 30,
  maxAvgSpeedKmh: 22,
  gapM: 200,
};
