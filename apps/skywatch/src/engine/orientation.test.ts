import { describe, expect, it } from 'vitest';
import {
  alignToCompass,
  angleDiff,
  azElToVec,
  coverFocal,
  eulerToMatrix,
  focalForFov,
  mul,
  poseFromAzEl,
  poseFromMatrix,
  project,
  separation,
  smoothPose,
  vecToAzEl,
  yawMatrix,
  type Mat3,
} from './orientation';

const camera = (alpha: number, beta: number, gamma: number, screen = 0) =>
  vecToAzEl(poseFromMatrix(eulerToMatrix(alpha, beta, gamma), screen).forward);

describe('device orientation → where the camera points', () => {
  it('phone held upright, alpha 0: camera looks north at the horizon', () => {
    const c = camera(0, 90, 0);
    expect(c.el).toBeCloseTo(0, 5);
    expect(Math.abs(angleDiff(c.az, 0))).toBeLessThan(1e-6);
  });

  it('alpha turns counter-clockwise: alpha 90 → camera looks west', () => {
    expect(camera(90, 90, 0).az).toBeCloseTo(270, 5);
    expect(camera(270, 90, 0).az).toBeCloseTo(90, 5);
  });

  it('phone flat, screen up: camera looks straight down', () => {
    expect(camera(0, 0, 0).el).toBeCloseTo(-90, 5);
  });

  it('tilting the top back past upright raises the camera toward the sky', () => {
    expect(camera(0, 135, 0).el).toBeCloseTo(45, 5);
    expect(camera(0, 180, 0).el).toBeCloseTo(90, 5);
  });

  it('screen up vector is the sky when held upright in portrait', () => {
    const p = poseFromMatrix(eulerToMatrix(0, 90, 0), 0);
    expect(vecToAzEl(p.up).el).toBeCloseTo(90, 5);
    expect(vecToAzEl(p.right).az).toBeCloseTo(90, 5); // screen right = east when facing north
  });

  it('landscape (screen angle 90): camera unchanged, screen axes rotate', () => {
    // phone turned counter-clockwise and held up facing north:
    // device x (right edge) → up, device y (top edge) → west, device z → south
    const R: Mat3 = [0, -1, 0, 0, 0, -1, 1, 0, 0];
    const p = poseFromMatrix(R, 90);
    expect(vecToAzEl(p.forward).az).toBeCloseTo(0, 6);
    expect(vecToAzEl(p.forward).el).toBeCloseTo(0, 6);
    expect(vecToAzEl(p.up).el).toBeCloseTo(90, 6);
    expect(vecToAzEl(p.right).az).toBeCloseTo(90, 6);
  });

  it('pose basis is orthonormal for arbitrary angles', () => {
    for (const [a, b, g] of [[10, 70, -20], [200, 120, 35], [333, 95, 80]]) {
      const p = poseFromMatrix(eulerToMatrix(a, b, g), 0);
      for (const v of [p.forward, p.right, p.up]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      expect(p.forward[0] * p.up[0] + p.forward[1] * p.up[1] + p.forward[2] * p.up[2]).toBeCloseTo(0, 9);
    }
  });
});

describe('compass alignment (iOS) and yaw', () => {
  it('aligns an arbitrary-alpha matrix to the compass heading', () => {
    const R = eulerToMatrix(37, 100, 5); // alpha relative to some unknown start
    const fixed = alignToCompass(R, 123);
    expect(vecToAzEl(mul(fixed, [0, 0, -1])).az).toBeCloseTo(123, 6);
    // elevation is untouched
    expect(vecToAzEl(mul(fixed, [0, 0, -1])).el).toBeCloseTo(vecToAzEl(mul(R, [0, 0, -1])).el, 9);
  });

  it('yawMatrix adds to azimuth (magnetic → true north with declination)', () => {
    const v = mul(yawMatrix(14.9), azElToVec(10, 20));
    const r = vecToAzEl(v);
    expect(r.az).toBeCloseTo(24.9, 6);
    expect(r.el).toBeCloseTo(20, 6);
  });

  it('angleDiff wraps correctly', () => {
    expect(angleDiff(350, 10)).toBeCloseTo(20);
    expect(angleDiff(10, 350)).toBeCloseTo(-20);
    expect(angleDiff(0, 180)).toBeCloseTo(180);
  });
});

describe('projection', () => {
  const pose = poseFromAzEl(180, 30);
  const f = focalForFov(800, 60);

  it('the point you look at lands in the centre', () => {
    const p = project(azElToVec(180, 30), pose, f, 200, 400)!;
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(400, 6);
  });

  it('right and up go the right way', () => {
    // facing south, west (az 190) is to the right
    expect(project(azElToVec(190, 30), pose, f, 200, 400)!.x).toBeGreaterThan(200);
    expect(project(azElToVec(180, 40), pose, f, 200, 400)!.y).toBeLessThan(400);
  });

  it('half the field of view reaches the edge', () => {
    const p = project(azElToVec(180, 60), pose, f, 200, 400)!;
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('things behind you are not drawn', () => {
    expect(project(azElToVec(0, 10), pose, f, 200, 400)).toBeNull();
  });

  it('cover-fit focal: a 4:3 portrait video filling a tall phone keeps its full vertical FOV', () => {
    const fc = coverFocal(1440, 1920, 390, 844, 64);
    expect(fc).toBeCloseTo(focalForFov(844, 64), 6);
  });

  it('separation and smoothing behave', () => {
    expect(separation(azElToVec(0, 0), azElToVec(90, 0))).toBeCloseTo(90, 6);
    const a = poseFromAzEl(100, 20);
    const b = poseFromAzEl(110, 20);
    const s = smoothPose(a, b, 0.5);
    const az = vecToAzEl(s.forward).az;
    expect(az).toBeGreaterThan(104);
    expect(az).toBeLessThan(106);
  });
});
