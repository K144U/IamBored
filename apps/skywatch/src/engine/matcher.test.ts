import { describe, expect, it } from 'vitest';
import {
  applyCalibration,
  calibrationValid,
  fitMotion,
  makeCalibration,
  motionScore,
  prior,
  scoreCandidates,
  type Candidate,
} from './matcher';
import { azElFromEnu, enuFromAzEl, RAD, sepDeg, type Vec3 } from './pointing';

function cand(key: string, kind: Candidate['kind'], az: number, el: number, mag?: number, rateDegS = 0): Candidate {
  const dir = enuFromAzEl(az, el);
  const ahead = enuFromAzEl(az + rateDegS / Math.cos(el * RAD), el);
  return { key, name: key, kind, az, el, mag, dir, vel: [ahead[0] - dir[0], ahead[1] - dir[1], ahead[2] - dir[2]] };
}

describe('matcher', () => {
  const sky = [
    cand('Jupiter', 'planet', 120, 40, -2.5),
    cand('Rigel', 'star', 130, 35, 0.1),
    cand('Faint', 'star', 121, 41, 4.2),
    cand('ISS', 'sat', 200, 50, undefined, 1),
    cand('Sun', 'sun', 121, 40),
  ];

  it('prefers the bright planet over a faint star right next to it, and never offers the Sun', () => {
    const { matches, nothingObvious } = scoreCandidates(enuFromAzEl(121, 40.5), sky, 3);
    expect(matches[0].c.key).toBe('Jupiter');
    expect(matches.some((m) => m.c.key === 'Sun')).toBe(false);
    expect(nothingObvious).toBe(false);
    const total = matches.reduce((a, m) => a + m.confidence, 0);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('says "nothing obvious" when pointing at empty sky', () => {
    expect(scoreCandidates(enuFromAzEl(300, 60), sky, 3).nothingObvious).toBe(true);
  });

  it('a wide error cone (uncalibrated) still finds the nearby bright thing', () => {
    expect(scoreCandidates(enuFromAzEl(110, 30), sky, 12).matches[0].c.key).toBe('Jupiter');
  });

  it('motion breaks ties: following a moving light favours the satellite', () => {
    const near = [cand('Vega', 'star', 200, 50, 0.0), cand('ISS', 'sat', 201, 50.5, undefined, 1)];
    const still = scoreCandidates(enuFromAzEl(200.5, 50), near, 12);
    const moving = scoreCandidates(enuFromAzEl(200.5, 50), near, 12, near[1].vel);
    expect(moving.matches[0].c.key).toBe('ISS');
    expect(moving.matches[0].confidence).toBeGreaterThan(still.matches.find((m) => m.c.key === 'ISS')!.confidence);
    expect(motionScore([0, 0, 0], [0, 0, 0])).toBeCloseTo(1);
  });

  it('priors: Moon > bright planet > bright star > faint star', () => {
    expect(prior(cand('m', 'moon', 0, 0))).toBeGreaterThan(prior(cand('v', 'planet', 0, 0, -4)));
    expect(prior(cand('v', 'planet', 0, 0, -4))).toBeGreaterThan(prior(cand('s', 'star', 0, 0, 0)));
    expect(prior(cand('s', 'star', 0, 0, 0))).toBeGreaterThan(prior(cand('f', 'star', 0, 0, 4)));
  });
});

describe('motion fit', () => {
  it('recovers a steady 1°/s eastward drift from noisy samples', () => {
    const samples: { t: number; v: Vec3 }[] = [];
    for (let i = 0; i <= 30; i++) {
      const jitter = Math.sin(i * 7.3) * 0.05;
      samples.push({ t: i * 100, v: enuFromAzEl(90 + i * 0.1 + jitter, 30) });
    }
    const vel = fitMotion(samples)!;
    const rate = Math.hypot(...vel) / RAD;
    expect(rate).toBeGreaterThan(0.7);
    expect(rate).toBeLessThan(1.1);
    expect(fitMotion(samples.slice(0, 3))).toBeNull();
  });
});

describe('calibration', () => {
  const place = { lat: 51.5, lon: 0 };
  it('turns a measured direction into the true one, across north', () => {
    const truth = enuFromAzEl(3, 40);
    const measured = enuFromAzEl(352, 37);
    const cal = makeCalibration(measured, truth, 'Jupiter', 0, place);
    expect(cal.dAz).toBeCloseTo(11);
    expect(cal.dEl).toBeCloseTo(3);
    expect(sepDeg(applyCalibration(measured, cal), truth)).toBeLessThan(1e-6);
    // and nearby directions get the same correction
    expect(azElFromEnu(applyCalibration(enuFromAzEl(300, 10), cal)).az).toBeCloseTo(311);
  });

  it('expires after 12 h or 100 km', () => {
    const cal = makeCalibration(enuFromAzEl(0, 0), enuFromAzEl(5, 0), 'Moon', 0, place);
    expect(calibrationValid(cal, 3600_000, place)).toBe(true);
    expect(calibrationValid(cal, 13 * 3600_000, place)).toBe(false);
    expect(calibrationValid(cal, 3600_000, { lat: 52.5, lon: 0 })).toBe(false);
    expect(calibrationValid(null, 0, place)).toBe(false);
  });
});
