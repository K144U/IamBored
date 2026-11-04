// Satellite math: SGP4 propagation, look angles, sunlight and pass prediction.
// Pure functions, shared by the main thread, the Web Worker and the tests.
import {
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  jday,
  json2satrec,
  propagate,
  shadowFraction,
  sunPos,
  type GeodeticLocation,
  type OMMJsonObject,
  type SatRec,
} from 'satellite.js';
import { sunAltitude } from './sky';

const DEG = Math.PI / 180;

export interface Observer {
  /** degrees */
  lat: number;
  /** degrees */
  lon: number;
  /** metres above the ellipsoid */
  heightM: number;
}

export type SatStatus = 'visible' | 'daylight' | 'eclipsed' | 'below';

export interface SatState {
  /** degrees, 0 = north, 90 = east */
  az: number;
  /** degrees above the horizon */
  el: number;
  rangeKm: number;
  altKm: number;
  /** sub-satellite point, degrees */
  lat: number;
  lon: number;
  speedKms: number;
  /** 0 = fully sunlit, 1 = full shadow (umbra) */
  shadow: number;
}

export function toGeodetic(o: Observer): GeodeticLocation {
  return { latitude: o.lat * DEG, longitude: o.lon * DEG, height: o.heightM / 1000 };
}

export function satrecFromOmm(omm: OMMJsonObject): SatRec | null {
  try {
    const rec = json2satrec(omm);
    return rec.error ? null : rec;
  } catch {
    return null;
  }
}

/** Sun position (AU, ECI) for shadow calculations. */
export function sunEci(date: Date) {
  return sunPos(jday(date)).rsun;
}

export function satState(
  satrec: SatRec,
  date: Date,
  obs: GeodeticLocation,
  sun?: ReturnType<typeof sunEci>,
): SatState | null {
  const pv = propagate(satrec, date, { communityDecayCheckEnabled: true });
  if (!pv) return null;
  const gmst = gstime(date);
  const ecf = eciToEcf(pv.position, gmst);
  const look = ecfToLookAngles(obs, ecf);
  const geo = eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  let az = look.azimuth / DEG;
  if (az < 0) az += 360;
  return {
    az,
    el: look.elevation / DEG,
    rangeKm: look.rangeSat,
    altKm: geo.height,
    lat: geo.latitude / DEG,
    lon: ((geo.longitude / DEG + 540) % 360) - 180,
    speedKms: Math.hypot(v.x, v.y, v.z),
    shadow: sun ? shadowFraction(sun, pv.position) : 0,
  };
}

/**
 * Can you see it with your eyes? Above the horizon, lit by the Sun,
 * and your sky is dark enough (Sun below -6°, end of civil twilight).
 */
export function classify(state: Pick<SatState, 'el' | 'shadow'>, sunAltDeg: number): SatStatus {
  if (state.el <= 0) return 'below';
  if (state.shadow >= 0.5) return 'eclipsed';
  if (sunAltDeg > -6) return 'daylight';
  return 'visible';
}

export interface Pass {
  rise: Date;
  riseAz: number;
  max: Date;
  maxEl: number;
  maxAz: number;
  set: Date;
  setAz: number;
  /** true if the pass was already in progress at the search start */
  inProgress: boolean;
  /** part of the pass where it is sunlit and your sky is dark */
  visibleFrom?: Date;
  visibleTo?: Date;
}

function elevationAt(satrec: SatRec, t: number, obs: GeodeticLocation): number {
  const s = satState(satrec, new Date(t), obs);
  return s ? s.el : -90;
}

function azAt(satrec: SatRec, t: number, obs: GeodeticLocation): number {
  return satState(satrec, new Date(t), obs)?.az ?? 0;
}

/** Bisection for the moment elevation crosses 0 between a (below/above) and b (the opposite). */
function bisectHorizon(satrec: SatRec, a: number, b: number, obs: GeodeticLocation): number {
  const fa = elevationAt(satrec, a, obs);
  for (let i = 0; i < 30 && b - a > 500; i++) {
    const m = (a + b) / 2;
    const fm = elevationAt(satrec, m, obs);
    if (fm > 0 === fa > 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Golden-section search for the maximum elevation inside [a, b]. */
function goldenMax(satrec: SatRec, a: number, b: number, obs: GeodeticLocation): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = elevationAt(satrec, c, obs);
  let fd = elevationAt(satrec, d, obs);
  while (b - a > 500) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = elevationAt(satrec, c, obs);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = elevationAt(satrec, d, obs);
    }
  }
  return (a + b) / 2;
}

export interface PassOptions {
  hours?: number;
  /** only keep passes that climb at least this high (degrees) */
  minMaxEl?: number;
  /** coarse scan step in seconds */
  stepS?: number;
  /** compute the visible (sunlit + dark sky) window of each pass */
  withVisibility?: boolean;
}

export function predictPasses(
  satrec: SatRec,
  observer: Observer,
  start: Date,
  opts: PassOptions = {},
): Pass[] {
  const { hours = 24, minMaxEl = 10, stepS = 30, withVisibility = true } = opts;
  const obs = toGeodetic(observer);
  const t0 = start.getTime();
  const tEnd = t0 + hours * 3600_000;
  const step = stepS * 1000;
  const passes: Pass[] = [];

  let prevT = t0;
  let prevEl = elevationAt(satrec, t0, obs);
  let riseT: number | null = prevEl > 0 ? t0 : null;
  const inProgressAtStart = prevEl > 0;

  for (let t = t0 + step; t <= tEnd + step; t += step) {
    const el = elevationAt(satrec, t, obs);
    if (prevEl <= 0 && el > 0) {
      riseT = bisectHorizon(satrec, prevT, t, obs);
    } else if (prevEl > 0 && el <= 0 && riseT !== null) {
      const setT = bisectHorizon(satrec, prevT, t, obs);
      const maxT = goldenMax(satrec, riseT, setT, obs);
      const maxState = satState(satrec, new Date(maxT), obs);
      if (maxState && maxState.el >= minMaxEl) {
        const pass: Pass = {
          rise: new Date(riseT),
          riseAz: azAt(satrec, riseT, obs),
          max: new Date(maxT),
          maxEl: maxState.el,
          maxAz: maxState.az,
          set: new Date(setT),
          setAz: azAt(satrec, setT, obs),
          inProgress: inProgressAtStart && riseT === t0,
        };
        if (withVisibility) addVisibility(satrec, observer, obs, pass);
        passes.push(pass);
      }
      riseT = null;
    }
    prevT = t;
    prevEl = el;
    // Geostationary or very high orbits never set: stop after one "pass".
    if (t > tEnd && riseT === null) break;
  }
  return passes;
}

function addVisibility(satrec: SatRec, observer: Observer, obs: GeodeticLocation, pass: Pass) {
  const a = pass.rise.getTime();
  const b = pass.set.getTime();
  const step = Math.max(5_000, (b - a) / 120);
  for (let t = a; t <= b; t += step) {
    const d = new Date(t);
    const s = satState(satrec, d, obs, sunEci(d));
    if (!s) continue;
    if (classify(s, sunAltitude(d, observer)) === 'visible') {
      if (!pass.visibleFrom) pass.visibleFrom = d;
      pass.visibleTo = d;
    }
  }
}

/** Positions over a time window, for drawing a trail on the radar. */
export function trackAzEl(
  satrec: SatRec,
  observer: Observer,
  from: Date,
  to: Date,
  stepS = 15,
): { t: number; az: number; el: number }[] {
  const obs = toGeodetic(observer);
  const out: { t: number; az: number; el: number }[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += stepS * 1000) {
    const s = satState(satrec, new Date(t), obs);
    if (s) out.push({ t, az: s.az, el: s.el });
  }
  return out;
}

export function ommEpochAgeDays(omm: OMMJsonObject, now: Date): number {
  const epoch = Date.parse(omm.EPOCH.endsWith('Z') ? omm.EPOCH : `${omm.EPOCH}Z`);
  return (now.getTime() - epoch) / 86_400_000;
}
