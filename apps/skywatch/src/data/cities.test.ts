import { describe, expect, it } from 'vitest';
import { CITIES, cityLabel, findCity, parseLatLon } from './cities';
import { fmtIn } from '../ui/format';

describe('city lookup', () => {
  it('finds cities by label, name, prefix and without accents', () => {
    expect(findCity('London, UK')?.name).toBe('London');
    expect(findCity('new york')?.lat).toBeCloseTo(40.71);
    expect(findCity('sao paulo')?.name).toBe('São Paulo');
    expect(findCity('zur')?.name).toBe('Zürich');
    expect(findCity('Atlantis')).toBeNull();
    expect(findCity('  ')).toBeNull();
  });

  it('has unique labels and valid coordinates', () => {
    expect(new Set(CITIES.map(cityLabel)).size).toBe(CITIES.length);
    for (const c of CITIES) {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
    }
  });

  it('parses coordinates and rejects nonsense', () => {
    expect(parseLatLon('40.71, -74.01')).toEqual({ lat: 40.71, lon: -74.01 });
    expect(parseLatLon('-33.9 151.2')).toEqual({ lat: -33.9, lon: 151.2 });
    expect(parseLatLon('91, 0')).toBeNull();
    expect(parseLatLon('London')).toBeNull();
  });
});

describe('countdown', () => {
  it('reads naturally', () => {
    expect(fmtIn(10_000)).toBe('now');
    expect(fmtIn(4 * 60_000)).toBe('in 4 min');
    expect(fmtIn(125 * 60_000)).toBe('in 2 h 05 min');
    expect(fmtIn(3 * 86_400_000)).toBe('in 3 days');
  });
});

describe('time zones', async () => {
  const { setTimeZone, fmtDay, fmtTime, tzName, timeZone } = await import('../ui/format');
  const { nearestCity } = await import('./cities');

  it('every city has a valid IANA zone', () => {
    for (const c of CITIES) expect(() => new Intl.DateTimeFormat('en', { timeZone: c.tz })).not.toThrow();
  });

  it('formats in the observer zone, including the day boundary', () => {
    const t = new Date('2019-06-05T17:30:00Z'); // 02:30 next day in Tokyo, 13:30 in New York
    setTimeZone('Asia/Tokyo');
    expect(fmtTime(t, false)).toMatch(/02:30|2:30/);
    expect(fmtDay(t, new Date('2019-06-05T10:00:00Z'))).toBe('Tomorrow');
    expect(tzName(t)).toMatch(/GMT\+9|JST/);
    setTimeZone('America/New_York');
    expect(fmtDay(t, new Date('2019-06-05T10:00:00Z'))).toBe('Today');
    setTimeZone('Not/AZone');
    expect(timeZone()).toBeUndefined();
    setTimeZone(undefined);
  });

  it('guesses a zone from the nearest city, but not in the middle of nowhere', () => {
    expect(nearestCity(39.95, 116.3)?.tz).toBe('Asia/Shanghai');
    expect(nearestCity(-48, -120)).toBeNull(); // South Pacific
  });
});
