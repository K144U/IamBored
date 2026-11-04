// Phone orientation → camera pose (magnetic north). Handles Android (absolute events)
// and iOS (relative alpha + webkitCompassHeading).
import { angleDiff, eulerToMatrix, matMul, mul, poseFromMatrix, vecToAzEl, yawMatrix, type Pose } from '../engine/orientation';

export type SensorMode = 'absolute' | 'compass';

export interface SensorReading {
  pose: Pose;
  mode: SensorMode;
  /** compass accuracy in degrees when the platform reports it (iOS) */
  accuracy?: number;
  at: number;
}

type IosOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

function screenAngle(): number {
  const a = screen.orientation?.angle ?? Number((window as unknown as { orientation?: number }).orientation ?? 0);
  return ((a % 360) + 360) % 360;
}

export class OrientationSensor {
  reading: SensorReading | null = null;
  private off: (() => void)[] = [];
  /** iOS: smoothed offset between relative alpha and the compass */
  private iosOffset: number | null = null;

  /** Must run inside a user gesture: iOS shows a permission prompt. */
  static async requestPermission(): Promise<boolean> {
    const api = (window as unknown as { DeviceOrientationEvent?: PermissionApi }).DeviceOrientationEvent;
    if (api && typeof api.requestPermission === 'function') {
      try {
        return (await api.requestPermission()) === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  start() {
    this.stop();
    let sawAbsolute = false;

    const onAbsolute = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      sawAbsolute = true;
      this.reading = {
        pose: poseFromMatrix(eulerToMatrix(e.alpha, e.beta, e.gamma), screenAngle()),
        mode: 'absolute',
        at: performance.now(),
      };
    };

    const onRelative = (ev: Event) => {
      const e = ev as IosOrientationEvent;
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      const heading = e.webkitCompassHeading;
      if (typeof heading === 'number' && heading >= 0) {
        const R = eulerToMatrix(e.alpha, e.beta, e.gamma);
        const cam = vecToAzEl(mul(R, [0, 0, -1]));
        // The compass is unreliable when pointing near straight up/down: keep the last offset there.
        if (Math.abs(cam.el) < 65 || this.iosOffset === null) {
          const target = angleDiff(cam.az, heading);
          this.iosOffset = this.iosOffset === null ? target : this.iosOffset + angleDiff(this.iosOffset, target) * 0.08;
        }
        this.reading = {
          pose: poseFromMatrix(matMul(yawMatrix(this.iosOffset), R), screenAngle()),
          mode: 'compass',
          accuracy: e.webkitCompassAccuracy !== undefined && e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : undefined,
          at: performance.now(),
        };
      } else if (e.absolute && !sawAbsolute) {
        onAbsolute(e);
      }
    };

    window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener);
    window.addEventListener('deviceorientation', onRelative);
    this.off.push(
      () => window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener),
      () => window.removeEventListener('deviceorientation', onRelative),
    );
  }

  stop() {
    this.off.forEach((f) => f());
    this.off = [];
    this.reading = null;
    this.iosOffset = null;
  }
}
