import { describe, expect, it } from 'vitest';
import { declination } from './declination';

describe('magnetic declination (WMM2025)', () => {
  it('matches known values within a degree', () => {
    const d = new Date('2026-11-04T00:00:00Z');
    expect(declination(47.6, -122.3, d)).toBeGreaterThan(14); // Seattle ≈ +15° E
    expect(declination(47.6, -122.3, d)).toBeLessThan(16);
    expect(Math.abs(declination(51.5, -0.12, d))).toBeLessThan(2.5); // London ≈ +1°
    expect(declination(40.71, -74.01, d)).toBeLessThan(-11); // New York ≈ −12.5° (west)
    expect(declination(40.71, -74.01, d)).toBeGreaterThan(-14);
  });
});
