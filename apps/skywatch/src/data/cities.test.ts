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
