import { describe, expect, it } from 'vitest';
import {
  azElFromEnu,
  cameraDirection,
  cameraFrame,
  deviceAxes,
  dot,
  enuFromAzEl,
  projectToScreen,
  rotateAzimuth,
  screenAxes,
  sepDeg,
  smoothDirection,
  type Vec3,
} from './pointing';

const close = (v: Vec3, w: Vec3, eps = 1e-9) => v.forEach((x, i) => expect(x).toBeCloseTo(w[i], -Math.log10(eps)));

describe('device orientation → pointing', () => {
  it('flat on a table, screen up: the camera looks straight down', () => {
    close(cameraDirection(deviceAxes(0, 0, 0)), [0, 0, -1]);
  });

  it('held upright in portrait, facing north/east/west: camera on the horizon', () => {
    close(cameraDirection(deviceAxes(0, 90, 0)), [0, 1, 0]); // north
    close(cameraDirection(deviceAxes(270, 90, 0)), [1, 0, 0]); // alpha counts anticlockwise: 270 → east
    close(cameraDirection(deviceAxes(90, 90, 0)), [-1, 0, 0]); // west
  });

  it('tilting the top back (beta > 90) raises the camera above the horizon', () => {
    const { az, el } = azElFromEnu(cameraDirection(deviceAxes(0, 135, 0)));
    expect(el).toBeCloseTo(45);
    expect(Math.min(az, 360 - az)).toBeLessThan(1e-6);
  });

  it('pointing at the zenith is stable whatever alpha says (no gimbal lock)', () => {
    for (const alpha of [0, 77, 190, 300]) expect(azElFromEnu(cameraDirection(deviceAxes(alpha, 180, 0))).el).toBeCloseTo(90);
  });

  it('device axes stay orthonormal', () => {
    const a = deviceAxes(37, 61, -23);
    expect(dot(a.x, a.y)).toBeCloseTo(0);
    expect(dot(a.y, a.z)).toBeCloseTo(0);
    expect(dot(a.x, a.x)).toBeCloseTo(1);
  });

  it('screen axes follow the screen rotation', () => {
    const axes = deviceAxes(0, 90, 0); // upright, facing north
    const portrait = screenAxes(axes, 0);
    close(portrait.up, [0, 0, 1]);
    close(portrait.right, [1, 0, 0]);
    // phone turned anticlockwise into landscape: its right edge now points up
    const land = screenAxes(deviceAxes(0, 90, 0), 90);
    close(land.up, axes.x);
  });
});

describe('direction helpers', () => {
  it('az/el round-trip and separation', () => {
    const v = enuFromAzEl(123, 45);
    const { az, el } = azElFromEnu(v);
    expect(az).toBeCloseTo(123);
    expect(el).toBeCloseTo(45);
    expect(sepDeg(enuFromAzEl(0, 0), enuFromAzEl(90, 0))).toBeCloseTo(90);
  });

  it('rotateAzimuth turns clockwise and keeps elevation', () => {
    const { az, el } = azElFromEnu(rotateAzimuth(enuFromAzEl(350, 20), 15));
    expect(az).toBeCloseTo(5);
    expect(el).toBeCloseTo(20);
  });

  it('smoothing moves part of the way and never wraps the long way round', () => {
    const a = enuFromAzEl(359, 0);
    const b = enuFromAzEl(1, 0);
    const s = smoothDirection(a, b, 200, 200);
    const { az } = azElFromEnu(s);
    expect(Math.min(az, 360 - az)).toBeLessThan(1); // between 359 and 1, not via 180
  });

  it('projects the view centre to the middle and things to the right to +x', () => {
    const f = cameraFrame(enuFromAzEl(0, 0), [0, 0, 1]);
    expect(projectToScreen(f.forward, f.forward, f.right, f.up, 500)).toEqual({ x: 0, y: -0 });
    const p = projectToScreen(enuFromAzEl(10, 5), f.forward, f.right, f.up, 500)!;
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(0); // higher up = smaller y
    expect(p.x).toBeCloseTo(500 * Math.tan((10 * Math.PI) / 180), 0);
    expect(projectToScreen(enuFromAzEl(180, 0), f.forward, f.right, f.up, 500)).toBeNull();
  });
});

describe('magnetic declination', async () => {
  const { declination } = await import('./declination');
  it('matches WMM2025 for a few cities', () => {
    const d = new Date('2026-11-04T00:00:00Z');
    expect(declination(51.5, -0.1, d)).toBeCloseTo(1.2, 0); // London: a little east
    expect(declination(40.7, -74, d)).toBeCloseTo(-12.5, 0); // New York: west
    expect(declination(39.9, 116.4, d)).toBeCloseTo(-7.6, 0); // Beijing: west
    expect(Number.isFinite(declination(51.5, -0.1, new Date('2019-06-05')))).toBe(true); // outside the model years
  });
});
