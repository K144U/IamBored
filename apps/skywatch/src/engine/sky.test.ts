import { describe, expect, it } from 'vitest';
import { skyBodies, skyState, sunAltitude } from './sky';

const london = { lat: 51.4769, lon: -0.0005, heightM: 45 };

describe('sky bodies', () => {
  it('Sun is high at noon and below the horizon at midnight (London, June)', () => {
    expect(sunAltitude(new Date('2019-06-21T12:00:00Z'), london)).toBeGreaterThan(60);
    expect(sunAltitude(new Date('2019-06-21T00:00:00Z'), london)).toBeLessThan(-10);
  });

  it('Sun azimuth is roughly south at local noon', () => {
    const sun = skyBodies(new Date('2019-06-21T12:00:00Z'), london).find((b) => b.id === 'sun')!;
    expect(sun.az).toBeGreaterThan(170);
    expect(sun.az).toBeLessThan(190);
  });

  it('returns all bodies with sensible magnitudes', () => {
    const bodies = skyBodies(new Date('2026-11-04T20:00:00Z'), london);
    expect(bodies.map((b) => b.id)).toEqual(['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn']);
    const venus = bodies.find((b) => b.id === 'venus')!;
    expect(venus.mag).toBeLessThan(-3);
    const moon = bodies.find((b) => b.id === 'moon')!;
    expect(moon.phase).toBeGreaterThanOrEqual(0);
    expect(moon.phase).toBeLessThanOrEqual(1);
  });

  it('names twilight stages', () => {
    expect(skyState(5)).toBe('Day');
    expect(skyState(-3)).toBe('Civil twilight');
    expect(skyState(-9)).toBe('Nautical twilight');
    expect(skyState(-15)).toBe('Astronomical twilight');
    expect(skyState(-30)).toBe('Night');
  });
});
