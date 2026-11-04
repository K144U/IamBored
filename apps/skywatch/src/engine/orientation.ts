// AR math: phone orientation → camera pose → screen projection.
// World frame is ENU: x = east, y = north, z = up. Azimuth is clockwise from north.
// Device frame (W3C DeviceOrientation): x = right edge, y = top edge, z = out of the screen.
// The rear camera looks along the device's -z axis.

export type Vec3 = [number, number, number];
/** 3×3 matrix, row-major */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

const DEG = Math.PI / 180;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
export const matMul = (a: Mat3, b: Mat3): Mat3 => {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
};

export function azElToVec(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
}

export function vecToAzEl(v: Vec3): { az: number; el: number } {
  const n = norm(v);
  let az = Math.atan2(n[0], n[1]) / DEG;
  if (az < 0) az += 360;
  return { az, el: Math.asin(Math.max(-1, Math.min(1, n[2]))) / DEG };
}

/** Angle between two directions, degrees. */
export function separation(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;
}

/** Shortest signed difference b − a between two angles, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (((b - a) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/**
 * W3C DeviceOrientation Euler angles → rotation matrix (device frame → world frame).
 * R = Rz(alpha) · Rx(beta) · Ry(gamma). With absolute alpha, world is ENU.
 */
export function eulerToMatrix(alphaDeg: number, betaDeg: number, gammaDeg: number): Mat3 {
  const a = alphaDeg * DEG;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cb = Math.cos(b), sb = Math.sin(b);
  const cg = Math.cos(g), sg = Math.sin(g);
  return [
    ca * cg - sa * sb * sg, -sa * cb, ca * sg + sa * sb * cg,
    sa * cg + ca * sb * sg, ca * cb, sa * sg - ca * sb * cg,
    -cb * sg, sb, cb * cg,
  ];
}

/** Rotation about the up axis that ADDS `deg` to every azimuth (clockwise seen from above). */
export function yawMatrix(deg: number): Mat3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, s, 0, -s, c, 0, 0, 0, 1];
}

export interface Pose {
  /** where the camera looks */
  forward: Vec3;
  /** screen right */
  right: Vec3;
  /** screen up */
  up: Vec3;
}

/**
 * Camera pose from the device rotation matrix and the screen orientation angle
 * (`screen.orientation.angle`: 0 portrait, 90 landscape turned counter-clockwise, 270 clockwise).
 */
export function poseFromMatrix(R: Mat3, screenAngleDeg = 0): Pose {
  const t = screenAngleDeg * DEG;
  const rightDev: Vec3 = [Math.cos(t), -Math.sin(t), 0];
  const upDev: Vec3 = [Math.sin(t), Math.cos(t), 0];
  return { forward: mul(R, [0, 0, -1]), right: mul(R, rightDev), up: mul(R, upDev) };
}

/** A level camera (no roll) looking at az / el. Used for drag-to-look mode. */
export function poseFromAzEl(azDeg: number, elDeg: number): Pose {
  const forward = azElToVec(azDeg, elDeg);
  const az = azDeg * DEG;
  const right: Vec3 = [Math.cos(az), -Math.sin(az), 0];
  return { forward, right, up: cross(right, forward) };
}

export function rotatePose(p: Pose, m: Mat3): Pose {
  return { forward: mul(m, p.forward), right: mul(m, p.right), up: mul(m, p.up) };
}

/** Exponential smoothing between two poses (k = weight of the new pose), re-orthonormalised. */
export function smoothPose(prev: Pose | null, next: Pose, k: number): Pose {
  if (!prev) return next;
  const lerp = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  // if the pose flipped (big jump), don't smear: snap
  if (dot(prev.forward, next.forward) < 0.5) return next;
  const f = norm(lerp(prev.forward, next.forward));
  let u = lerp(prev.up, next.up);
  const d = dot(u, f);
  u = norm([u[0] - d * f[0], u[1] - d * f[1], u[2] - d * f[2]]);
  return { forward: f, up: u, right: cross(f, u) };
}

/**
 * iOS gives alpha relative to an arbitrary start plus `webkitCompassHeading`
 * (magnetic heading of the rear camera). Rotate R so its camera heading matches the compass.
 */
export function alignToCompass(R: Mat3, compassHeadingDeg: number): Mat3 {
  const { az } = vecToAzEl(mul(R, [0, 0, -1]));
  return matMul(yawMatrix(angleDiff(az, compassHeadingDeg)), R);
}

export interface Projected {
  x: number;
  y: number;
  /** cosine of the angle from the view centre (> 0 = in front) */
  depth: number;
}

/** Pinhole projection. `focal` is in screen pixels. Returns null for points behind the camera. */
export function project(dir: Vec3, pose: Pose, focal: number, cx: number, cy: number): Projected | null {
  const z = dot(dir, pose.forward);
  if (z <= 0.02) return null;
  return {
    x: cx + (dot(dir, pose.right) / z) * focal,
    y: cy - (dot(dir, pose.up) / z) * focal,
    depth: z,
  };
}

/** Focal length (px) for a displayed vertical field of view. */
export function focalForFov(viewHeightPx: number, vFovDeg: number): number {
  return viewHeightPx / 2 / Math.tan((vFovDeg * DEG) / 2);
}

/**
 * Focal length of a camera video shown with `object-fit: cover`.
 * `longSideFovDeg` is the camera's field of view along the longer side of the video frame.
 */
export function coverFocal(videoW: number, videoH: number, viewW: number, viewH: number, longSideFovDeg: number): number {
  const longPx = Math.max(videoW, videoH);
  const fVideo = longPx / 2 / Math.tan((longSideFovDeg * DEG) / 2);
  const scale = Math.max(viewW / videoW, viewH / videoH);
  return fVideo * scale;
}
