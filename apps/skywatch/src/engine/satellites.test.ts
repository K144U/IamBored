import { describe, expect, it } from 'vitest';
import { twoline2satrec } from 'satellite.js';
import { ISS_2019, T_2019 } from '../test/fixtures';
import { classify, predictPasses, satState, satrecFromOmm, sunEci, toGeodetic } from './satellites';

const iss = satrecFromOmm(ISS_2019)!;
const london = { lat: 51.4769, lon: -0.0005, heightM: 45 };

describe('satellite engine', () => {
  it('parses OMM JSON the same as the equivalent TLE', () => {
    const tle = twoline2satrec(
      '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
      '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
    );
    const a = satState(iss, T_2019, toGeodetic(london))!;
    const b = satState(tle, T_2019, toGeodetic(london))!;
    expect(a.az).toBeCloseTo(b.az, 3);
    expect(a.el).toBeCloseTo(b.el, 3);
  });

  it('gives a realistic ISS orbit', () => {
    const s = satState(iss, T_2019, toGeodetic(london))!;
    expect(s.altKm).toBeGreaterThan(380);
    expect(s.altKm).toBeLessThan(440);
    expect(s.speedKms).toBeGreaterThan(7.5);
    expect(s.speedKms).toBeLessThan(7.8);
    expect(Math.abs(s.lat)).toBeLessThanOrEqual(51.7);
  });

  it('puts the satellite straight overhead when standing under it', () => {
    const sub = satState(iss, T_2019, toGeodetic(london))!;
    const under = { lat: sub.lat, lon: sub.lon, heightM: 0 };
    const s = satState(iss, T_2019, toGeodetic(under))!;
    expect(s.el).toBeGreaterThan(89.5);
    expect(s.rangeKm).toBeCloseTo(sub.altKm, 0);
  });

  it('is below the horizon from the opposite side of the Earth', () => {
    const sub = satState(iss, T_2019, toGeodetic(london))!;
    const antipode = { lat: -sub.lat, lon: sub.lon > 0 ? sub.lon - 180 : sub.lon + 180, heightM: 0 };
    expect(satState(iss, T_2019, toGeodetic(antipode))!.el).toBeLessThan(-80);
  });

  it('computes shadow: the night side of Earth is dark, the day side lit', () => {
    let lit = 0;
    let dark = 0;
    // sample one full orbit (~92 min)
    for (let m = 0; m < 92; m++) {
      const d = new Date(T_2019.getTime() + m * 60_000);
      const s = satState(iss, d, toGeodetic(london), sunEci(d))!;
      if (s.shadow < 0.5) lit++;
      else dark++;
    }
    // ISS spends roughly 55-65 % of a June orbit in sunlight
    expect(lit).toBeGreaterThan(40);
    expect(dark).toBeGreaterThan(20);
  });

  it('classifies visibility', () => {
    expect(classify({ el: -1, shadow: 0 }, -20)).toBe('below');
    expect(classify({ el: 30, shadow: 1 }, -20)).toBe('eclipsed');
    expect(classify({ el: 30, shadow: 0 }, 10)).toBe('daylight');
    expect(classify({ el: 30, shadow: 0 }, -10)).toBe('visible');
  });

  it('predicts passes with consistent rise / max / set', () => {
    const passes = predictPasses(iss, london, T_2019, { hours: 24, minMaxEl: 0 });
    // ISS passes over London several times a day
    expect(passes.length).toBeGreaterThanOrEqual(3);
    expect(passes.length).toBeLessThanOrEqual(8);
    const obs = toGeodetic(london);
    for (const p of passes) {
      expect(p.rise.getTime()).toBeLessThan(p.max.getTime());
      expect(p.max.getTime()).toBeLessThan(p.set.getTime());
      const dur = (p.set.getTime() - p.rise.getTime()) / 60_000;
      expect(dur).toBeGreaterThan(0.5);
      expect(dur).toBeLessThan(12);
      if (!p.inProgress) expect(Math.abs(satState(iss, p.rise, obs)!.el)).toBeLessThan(0.1);
      expect(Math.abs(satState(iss, p.set, obs)!.el)).toBeLessThan(0.1);
      // the max really is the highest point
      for (let t = p.rise.getTime(); t < p.set.getTime(); t += 10_000) {
        expect(satState(iss, new Date(t), obs)!.el).toBeLessThanOrEqual(p.maxEl + 0.05);
      }
    }
  });

  it('June in London: ISS passes in the short night can be visible', () => {
    const passes = predictPasses(iss, london, T_2019, { hours: 48, minMaxEl: 10 });
    for (const p of passes) {
      if (p.visibleFrom) {
        expect(p.visibleFrom.getTime()).toBeGreaterThanOrEqual(p.rise.getTime());
        expect(p.visibleTo!.getTime()).toBeLessThanOrEqual(p.set.getTime());
      }
    }
  });
});
