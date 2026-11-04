// Where is the phone pointing? Vectors are in the observer's ENU frame (x = east, y = north, z = up).
//
// The W3C DeviceOrientation angles describe the rotation R = Rz(alpha)·Rx(beta)·Ry(gamma) that takes
// the device frame (x = right edge, y = top edge, z = out of the screen) to the Earth frame. The back
// camera looks along the device's −z axis. Working with the full rotation (instead of treating alpha
// as a heading) keeps it stable when the phone points near the zenith.

export type Vec3 = [number, number, number];

export const RAD = Math.PI / 180;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

export function enuFromAzEl(az: number, el: number): Vec3 {
  const a = az * RAD;
  const e = el * RAD;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}

export function azElFromEnu(v: Vec3): { az: number; el: number } {
  const n = normalize(v);
  let az = Math.atan2(n[0], n[1]) / RAD;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, n[2]))) / RAD };
}

/** Angle between two directions, degrees. */
export function sepDeg(a: Vec3, b: Vec3): number {
  const c = dot(a, b) / (norm(a) * norm(b) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

export interface DeviceAxes {
  /** right edge of the device */
  x: Vec3;
  /** top edge of the device */
  y: Vec3;
  /** out of the screen, towards the user */
  z: Vec3;
}

/** Device axes in ENU from DeviceOrientation angles (degrees). Alpha must be relative to north. */
export function deviceAxes(alpha: number, beta: number, gamma: number): DeviceAxes {
  const [ca, sa] = [Math.cos(alpha * RAD), Math.sin(alpha * RAD)];
  const [cb, sb] = [Math.cos(beta * RAD), Math.sin(beta * RAD)];
  const [cg, sg] = [Math.cos(gamma * RAD), Math.sin(gamma * RAD)];
  // columns of R = Rz(alpha) · Rx(beta) · Ry(gamma)
  return {
    x: [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg],
    y: [-sa * cb, ca * cb, sb],
    z: [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg],
  };
}

/** The back camera's direction. */
export const cameraDirection = (axes: DeviceAxes): Vec3 => scale(axes.z, -1);

/**
 * Screen "right" and "up" in ENU, allowing for the screen being rotated by `screenAngle`
 * degrees (screen.orientation.angle: 90 when the phone is turned anticlockwise to landscape).
 */
export function screenAxes(axes: DeviceAxes, screenAngle: number): { right: Vec3; up: Vec3 } {
  const c = Math.cos(screenAngle * RAD);
  const s = Math.sin(screenAngle * RAD);
  return {
    right: sub(scale(axes.x, c), scale(axes.y, s)),
    up: add(scale(axes.x, s), scale(axes.y, c)),
  };
}

/** Turn a direction clockwise (as seen from above) by `deg` degrees of azimuth. */
export function rotateAzimuth(v: Vec3, deg: number): Vec3 {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

/**
 * Exponential smoothing of a direction (not of angles, which wrap at 360°).
 * `tauMs` is the time constant; ~200 ms takes the jitter out without feeling laggy.
 */
export function smoothDirection(prev: Vec3 | null, next: Vec3, dtMs: number, tauMs = 200): Vec3 {
  if (!prev) return normalize(next);
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return normalize(add(prev, scale(sub(next, prev), k)));
}

/**
 * Pinhole (gnomonic) projection of `target` onto a screen whose centre looks along `forward`.
 * Returns pixel offsets from the screen centre (y grows downwards), or null when the target is behind.
 */
export function projectToScreen(
  target: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  focalPx: number,
): { x: number; y: number } | null {
  const depth = dot(target, forward);
  if (depth < 0.05) return null;
  return { x: (focalPx * dot(target, right)) / depth, y: (-focalPx * dot(target, up)) / depth };
}

/**
 * Rebuild an orthonormal camera frame (forward, right, up) after `forward` was corrected
 * (declination, calibration), keeping the phone's roll from `roughUp`.
 */
export function cameraFrame(forward: Vec3, roughUp: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const f = normalize(forward);
  let up = sub(roughUp, scale(f, dot(roughUp, f)));
  if (norm(up) < 1e-6) up = Math.abs(f[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  up = normalize(up);
  return { forward: f, right: normalize(cross(f, up)), up };
}
