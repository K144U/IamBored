// Sun, Moon and planets via astronomy-engine.
import { Body, Equator, Horizon, Illumination, Observer as AObserver } from 'astronomy-engine';
import type { Observer } from './satellites';

export interface BodyPosition {
  id: string;
  name: string;
  symbol: string;
  az: number;
  el: number;
  /** visual magnitude (lower = brighter) */
  mag: number;
  /** 0..1 illuminated fraction (Moon) */
  phase?: number;
}

const BODIES: { body: Body; name: string; symbol: string }[] = [
  { body: Body.Sun, name: 'Sun', symbol: '☉' },
  { body: Body.Moon, name: 'Moon', symbol: '☾' },
  { body: Body.Mercury, name: 'Mercury', symbol: '☿' },
  { body: Body.Venus, name: 'Venus', symbol: '♀' },
  { body: Body.Mars, name: 'Mars', symbol: '♂' },
  { body: Body.Jupiter, name: 'Jupiter', symbol: '♃' },
  { body: Body.Saturn, name: 'Saturn', symbol: '♄' },
];

function aobs(o: Observer) {
  return new AObserver(o.lat, o.lon, o.heightM);
}

function horizontal(body: Body, date: Date, o: AObserver) {
  const eq = Equator(body, date, o, true, true);
  const hor = Horizon(date, o, eq.ra, eq.dec, 'normal');
  return { az: hor.azimuth, el: hor.altitude };
}

export function sunAltitude(date: Date, observer: Observer): number {
  return horizontal(Body.Sun, date, aobs(observer)).el;
}

export function skyBodies(date: Date, observer: Observer): BodyPosition[] {
  const o = aobs(observer);
  return BODIES.map(({ body, name, symbol }) => {
    const { az, el } = horizontal(body, date, o);
    const illum = Illumination(body, date);
    return {
      id: name.toLowerCase(),
      name,
      symbol,
      az,
      el,
      mag: illum.mag,
      phase: body === Body.Moon ? illum.phase_fraction : undefined,
    };
  });
}

export type SkyState = 'Day' | 'Civil twilight' | 'Nautical twilight' | 'Astronomical twilight' | 'Night';

export function skyState(sunAltDeg: number): SkyState {
  if (sunAltDeg > 0) return 'Day';
  if (sunAltDeg > -6) return 'Civil twilight';
  if (sunAltDeg > -12) return 'Nautical twilight';
  if (sunAltDeg > -18) return 'Astronomical twilight';
  return 'Night';
}
