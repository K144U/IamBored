// AR spotting view: camera feed + sky overlay, driven by the phone's motion sensors.
// Falls back to drag-to-look when there are no sensors (desktop) or permission is denied.
import { identify, type Candidate, type Match } from '../engine/identify';
import {
  angleDiff,
  azElToVec,
  coverFocal,
  dot,
  focalForFov,
  poseFromAzEl,
  project,
  rotatePose,
  smoothPose,
  vecToAzEl,
  yawMatrix,
  type Pose,
} from '../engine/orientation';
import { compass, esc, fmtTime } from './format';
import { OrientationSensor } from './sensors';

export interface ArScene {
  /** app clock, ms */
  time: number;
  /** when the objects' positions were computed, ms */
  sampleTime: number;
  objects: Candidate[];
  /** path of the selected satellite (future positions) */
  path: { t: number; az: number; el: number }[];
  pathNote?: string;
  selected: string | null;
  /** magnetic declination at the observer, degrees east */
  declination: number;
}

interface Options {
  getScene: () => ArScene;
  onSelect: (key: string | null) => void;
}

interface Calibration {
  yaw: number;
  target: string;
  at: number;
}

const LS_FOV = 'skywatch:arFov';
const LS_CAL = 'skywatch:arCalibration';
const CAL_MAX_AGE = 6 * 3600_000; // compass drift: recalibrate after a few hours

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class ArView {
  private root = $('ar');
  private video = $<HTMLVideoElement>('ar-video');
  private canvas = $<HTMLCanvasElement>('ar-canvas');
  private ctx = this.canvas.getContext('2d')!;
  private sensor = new OrientationSensor();
  private stream: MediaStream | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private raf = 0;
  private opened = false;
  private mode: 'sensor' | 'drag' = 'sensor';
  private pose: Pose | null = null;
  private drag = { az: 180, el: 30 };
  /** camera field of view along the long side of the video, degrees */
  private fov = load(LS_FOV, 64);
  private calib: Calibration | null = load<Calibration | null>(LS_CAL, null);
  private pendingCalibration: Candidate | null = null;
  private showAll = false;
  private history = new Map<string, { az: number; el: number; t: number; vaz: number; vel: number }>();
  private lastSample = 0;
  private lastHud = 0;
  private hitTargets: { key: string; x: number; y: number }[] = [];
  private matches: Match[] = [];
  private guideText = '';
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private opts: Options) {
    if (this.calib && Date.now() - this.calib.at > CAL_MAX_AGE) this.calib = null;
    $('ar-close').addEventListener('click', () => this.close());
    $('ar-calib').addEventListener('click', () => this.startCalibration());
    $<HTMLInputElement>('ar-fov').value = String(this.fov);
    $('ar-fov').addEventListener('input', (e) => {
      this.fov = Number((e.target as HTMLInputElement).value);
      save(LS_FOV, this.fov);
    });
    $('ar-all').addEventListener('change', (e) => {
      this.showAll = (e.target as HTMLInputElement).checked;
    });
    $('ar-what').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const keyEl = t.closest<HTMLElement>('[data-key]');
      if (keyEl) this.opts.onSelect(keyEl.dataset.key || null);
      if (t.closest('[data-cal-confirm]')) this.confirmCalibration();
      if (t.closest('[data-cal-cancel]')) this.cancelCalibration();
      if (t.closest('[data-cal-reset]')) {
        this.calib = null;
        save(LS_CAL, null);
      }
    });
    this.setupPointer();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('keydown', (e) => {
      if (this.opened && e.key === 'Escape') this.close();
    });
  }

  get isOpen() {
    return this.opened;
  }

  /** Call from a click handler: iOS only allows the sensor prompt inside a user gesture. */
  async open() {
    if (this.opened) return;
    this.opened = true;
    this.root.hidden = false;
    document.body.classList.add('ar-open');
    this.resize();
    this.pose = null;
    this.mode = 'sensor';
    this.hint('');

    // Always listen: some browsers report "denied" yet still deliver events. The answer only changes the hint text.
    const sensorsAllowed = await OrientationSensor.requestPermission();
    this.sensor.start();
    void this.startCamera();
    try {
      this.wakeLock = await (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
    } catch {
      this.wakeLock = null;
    }

    // look at the selected object first when dragging
    const scene = this.opts.getScene();
    const sel = scene.objects.find((o) => o.key === scene.selected && o.el > 0);
    this.drag = sel ? { az: sel.az, el: Math.max(10, sel.el) } : { az: 180, el: 35 };

    setTimeout(() => {
      if (!this.opened || this.sensor.reading) return;
      this.mode = 'drag';
      this.hint(
        sensorsAllowed
          ? 'No motion sensors found: drag to look around, scroll or use the slider to zoom.'
          : 'No motion sensors (or access is blocked): drag to look around. On a phone, allow motion & orientation access and reopen AR.',
      );
    }, 1500);
    const loop = () => {
      if (!this.opened) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    cancelAnimationFrame(this.raf);
    this.sensor.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.root.hidden = true;
    document.body.classList.remove('ar-open');
    this.pendingCalibration = null;
  }

  private async startCamera() {
    this.root.classList.remove('has-video');
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (!this.opened) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      this.root.classList.add('has-video');
    } catch {
      /* no camera / denied: sky-only view */
    }
  }

  private hint(text: string) {
    const el = $('ar-hint');
    el.textContent = text;
    el.hidden = !text;
  }

  private resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.root.clientWidth || window.innerWidth;
    this.h = this.root.clientHeight || window.innerHeight;
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  private focal(): number {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (this.stream && vw && vh) return coverFocal(vw, vh, this.w, this.h, this.fov);
    return focalForFov(Math.max(this.w, this.h), this.fov);
  }

  private sigma(): number {
    if (this.mode === 'drag') return 2;
    if (this.calib) return 3;
    const acc = this.sensor.reading?.accuracy;
    return acc ? Math.max(5, Math.min(25, acc)) : 12;
  }

  // ───────────────────────── input ─────────────────────────
  private setupPointer() {
    let down: { x: number; y: number; az: number; el: number; moved: boolean } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, az: this.drag.az, el: this.drag.el, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) > 6) down.moved = true;
      if (this.mode !== 'drag' || !down.moved) return;
      const degPerPx = (Math.atan(1 / this.focal()) * 180) / Math.PI;
      this.drag.az = (((down.az - dx * degPerPx) % 360) + 360) % 360;
      this.drag.el = Math.max(-10, Math.min(90, down.el + dy * degPerPx));
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (down && !down.moved) this.tap(e.clientX, e.clientY);
      down = null;
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.fov = Math.max(20, Math.min(110, this.fov * (e.deltaY > 0 ? 1.08 : 1 / 1.08)));
        $<HTMLInputElement>('ar-fov').value = String(Math.round(this.fov));
      },
      { passive: false },
    );
  }

  private tap(x: number, y: number) {
    const rect = this.canvas.getBoundingClientRect();
    const px = x - rect.left;
    const py = y - rect.top;
    let best: string | null = null;
    let bestD = 30;
    for (const t of this.hitTargets) {
      const d = Math.hypot(t.x - px, t.y - py);
      if (d < bestD) {
        bestD = d;
        best = t.key;
      }
    }
    if (best) this.opts.onSelect(best);
  }

  // ───────────────────────── calibration ─────────────────────────
  private calibrationTarget(objects: Candidate[]): Candidate | null {
    if (!this.pose) return null;
    const p = vecToAzEl(this.pose.forward);
    const bright = objects.filter(
      (o) => o.kind === 'body' && o.key !== 'body:sun' && o.el > 3 && (o.key === 'body:moon' || (o.mag ?? 9) < 1),
    );
    let best: Candidate | null = null;
    let bestSep = 30;
    for (const o of bright) {
      const sep = Math.acos(Math.max(-1, Math.min(1, dot(azElToVec(p.az, p.el), azElToVec(o.az, o.el))))) * (180 / Math.PI);
      if (sep < bestSep) {
        bestSep = sep;
        best = o;
      }
    }
    return best;
  }

  private startCalibration() {
    if (this.mode === 'drag') {
      this.hint('Calibration is for the phone compass. In drag mode the view is already exact.');
      return;
    }
    const target = this.calibrationTarget(this.opts.getScene().objects);
    if (!target) {
      const any = this.opts.getScene().objects.some(
        (o) => o.kind === 'body' && o.key !== 'body:sun' && o.el > 3 && (o.key === 'body:moon' || (o.mag ?? 9) < 1),
      );
      this.hint(
        any
          ? 'Point roughly at the Moon or a bright planet (Venus, Jupiter, Mars, Saturn), then tap Calibrate.'
          : 'Calibration needs the Moon or a bright planet above the horizon, and none is up right now.',
      );
      return;
    }
    this.pendingCalibration = target;
    this.hint('');
  }

  private confirmCalibration() {
    const target = this.pendingCalibration;
    if (!target || !this.pose) return;
    const fresh = this.opts.getScene().objects.find((o) => o.key === target.key) ?? target;
    const pointing = vecToAzEl(this.pose.forward);
    const delta = angleDiff(pointing.az, fresh.az);
    this.calib = { yaw: (this.calib?.yaw ?? 0) + delta, target: fresh.label, at: Date.now() };
    save(LS_CAL, this.calib);
    this.pendingCalibration = null;
    this.pose = null; // snap to the corrected view
    this.hint(`Calibrated on the ${fresh.label}: corrected the compass by ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}°.`);
    setTimeout(() => this.hint(''), 4000);
  }

  private cancelCalibration() {
    this.pendingCalibration = null;
  }

  // ───────────────────────── frame ─────────────────────────
  private currentPose(scene: ArScene): Pose | null {
    if (this.mode === 'drag') return poseFromAzEl(this.drag.az, this.drag.el);
    const r = this.sensor.reading;
    if (!r) return this.pose;
    const corrected = rotatePose(r.pose, yawMatrix(scene.declination + (this.calib?.yaw ?? 0)));
    return smoothPose(this.pose, corrected, 0.22);
  }

  /** Satellites move ~1°/s; positions arrive once a second, so extrapolate in between. */
  private positionOf(o: Candidate, scene: ArScene): { az: number; el: number } {
    const h = this.history.get(o.key);
    if (!h) return o;
    const dt = Math.min(2000, Math.max(0, scene.time - h.t));
    return { az: (h.az + h.vaz * dt + 360) % 360, el: h.el + h.vel * dt };
  }

  private updateHistory(scene: ArScene) {
    if (scene.sampleTime === this.lastSample) return;
    const next = new Map<string, { az: number; el: number; t: number; vaz: number; vel: number }>();
    for (const o of scene.objects) {
      const prev = this.history.get(o.key);
      let vaz = 0;
      let vel = 0;
      if (prev && scene.sampleTime > prev.t && scene.sampleTime - prev.t < 3000) {
        const dt = scene.sampleTime - prev.t;
        vaz = angleDiff(prev.az, o.az) / dt;
        vel = (o.el - prev.el) / dt;
        if (Math.abs(vaz) * 1000 > 20) vaz = 0; // ignore wild jumps near the zenith
      }
      next.set(o.key, { az: o.az, el: o.el, t: scene.sampleTime, vaz, vel });
    }
    this.history = next;
    this.lastSample = scene.sampleTime;
  }

  private frame() {
    const scene = this.opts.getScene();
    this.updateHistory(scene);
    const pose = this.currentPose(scene);
    this.pose = pose;
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!this.stream) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#02040a');
      g.addColorStop(1, '#0b1626');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (!pose) {
      this.drawCenterText('Waiting for motion sensors…');
      return;
    }
    const f = this.focal();
    const cx = w / 2;
    const cy = h / 2;
    const P = (az: number, el: number) => project(azElToVec(az, el), pose, f, cx, cy);

    this.drawGrid(P);
    this.drawPath(scene, P);
    this.hitTargets = [];
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const label = (text: string, x: number, y: number, color: string, bold = false) => {
      ctx.font = `${bold ? '700 ' : ''}13px ui-monospace, Menlo, monospace`;
      const tw = ctx.measureText(text).width + 8;
      for (const [dx, dy] of [[10, 0], [10, 16], [10, -16], [-tw - 10, 0], [10, 32], [10, -32]]) {
        const bx = x + dx;
        const by = y + dy - 9;
        if (placed.some((b) => bx < b.x + b.w && bx + tw > b.x && by < b.y + b.h && by + 18 > b.y)) continue;
        placed.push({ x: bx, y: by, w: tw, h: 18 });
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(bx, by, tw, 18);
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, bx + 4, y + dy);
        return;
      }
    };

    // selected first so its label wins the space
    const objects = [...scene.objects].sort((a, b) => (b.key === scene.selected ? 1 : 0) - (a.key === scene.selected ? 1 : 0));
    let selectedOnScreen = false;
    for (const o of objects) {
      const isSel = o.key === scene.selected;
      if (o.kind === 'sat' && !isSel && !o.important && !this.showAll && o.status !== 'visible') continue;
      const pos = this.positionOf(o, scene);
      if (pos.el < -5 && !isSel) continue;
      const p = P(pos.az, pos.el);
      if (!p || p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
      if (isSel) selectedOnScreen = true;
      this.hitTargets.push({ key: o.key, x: p.x, y: p.y });
      const color =
        o.key === 'body:sun' ? '#ffd84d'
        : o.key === 'body:moon' ? '#f2f4f8'
        : o.kind === 'body' ? '#ffb0e0'
        : o.status === 'visible' ? '#7dffbf'
        : o.status === 'daylight' ? '#6fb7e0'
        : '#6b7c8f';
      const r = o.kind === 'body' ? (o.key === 'body:moon' || o.key === 'body:sun' ? 9 : 5) : o.important ? 6 : o.status === 'visible' ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = o.status === 'visible' || o.kind === 'body' ? 12 : 0;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isSel) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16 + Math.sin(performance.now() / 220) * 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      const show = isSel || o.kind === 'body' || o.important || o.status === 'visible';
      if (show) {
        const name = o.key === 'body:sun' ? '☉ Sun: never look directly' : o.label;
        label(name, p.x, p.y, isSel ? '#ffe14d' : color, isSel);
      }
    }

    this.guideText = '';
    if (scene.selected && !selectedOnScreen) this.drawGuide(scene, pose, cx, cy);
    this.drawCrosshair(f, cx, cy);
    this.updateHud(scene, pose);
  }

  private drawGrid(P: (az: number, el: number) => { x: number; y: number } | null) {
    const { ctx } = this;
    const line = (el: number, style: string, width: number) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      let pen = false;
      for (let az = 0; az <= 360; az += 2) {
        const p = P(az, el);
        if (!p) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
    };
    line(0, 'rgba(51,255,153,0.8)', 2);
    line(30, 'rgba(51,255,153,0.22)', 1);
    line(60, 'rgba(51,255,153,0.22)', 1);
    ctx.font = '700 15px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let az = 0; az < 360; az += 45) {
      const p = P(az, 0);
      if (!p) continue;
      ctx.fillStyle = az % 90 === 0 ? '#33ff99' : 'rgba(51,255,153,0.7)';
      ctx.fillText(compass(az), p.x, p.y + 6);
    }
    for (const el of [30, 60]) {
      const p = P(vecToAzEl(this.pose!.forward).az, el);
      if (!p) continue;
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(51,255,153,0.6)';
      ctx.fillText(`${el}°`, p.x, p.y + 3);
    }
  }

  private drawPath(scene: ArScene, P: (az: number, el: number) => { x: number; y: number } | null) {
    if (!scene.path.length) return;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,225,77,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    let pen = false;
    for (const pt of scene.path) {
      const p = pt.el >= -1 ? P(pt.az, pt.el) : null;
      if (!p) {
        pen = false;
        continue;
      }
      if (pen) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      pen = true;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // a tick + clock time every minute, so you know where it will be and when
    let lastMinute = -1;
    for (const pt of scene.path) {
      const minute = Math.floor(pt.t / 60_000);
      if (pt.t < scene.time || minute === lastMinute || pt.el < 0) continue;
      lastMinute = minute;
      if (pt.t % 60_000 > 15_000) continue;
      const p = P(pt.az, pt.el);
      if (!p) continue;
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtTime(new Date(pt.t), false), p.x + 6, p.y - 8);
    }
  }

  /** Arrow at the screen edge pointing toward the selected object, with turn instructions. */
  private drawGuide(scene: ArScene, pose: Pose, cx: number, cy: number) {
    const o = scene.objects.find((x) => x.key === scene.selected);
    if (!o) return;
    const pos = this.positionOf(o, scene);
    const here = vecToAzEl(pose.forward);
    const dAz = angleDiff(here.az, pos.az);
    const dEl = pos.el - here.el;
    const v = azElToVec(pos.az, pos.el);
    const z = dot(v, pose.forward);
    let dx = dot(v, pose.right);
    let dy = -dot(v, pose.up);
    if (z < 0.1) {
      dx = Math.sign(dAz) || 1;
      dy = -Math.sign(dEl) * 0.3;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const { ctx, w, h } = this;
    const margin = 56;
    const t = Math.min(Math.abs((w / 2 - margin) / (dx || 1e-6)), Math.abs((h / 2 - margin - 60) / (dy || 1e-6)));
    const ax = cx + dx * t;
    const ay = cy + dy * t;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffe14d';
    ctx.shadowColor = '#ffe14d';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(-10, -14);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const turn = [
      Math.abs(dAz) >= 3 ? `${dAz > 0 ? 'right' : 'left'} ${Math.abs(dAz).toFixed(0)}°` : '',
      Math.abs(dEl) >= 3 ? `${dEl > 0 ? 'up' : 'down'} ${Math.abs(dEl).toFixed(0)}°` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    this.guideText = turn ? `Turn ${turn} to find it${pos.el < 0 ? ' (below the horizon now)' : ''}.` : '';
  }

  private drawCrosshair(f: number, cx: number, cy: number) {
    const { ctx } = this;
    // circle = how far off the compass might be: shrinks after calibration
    const sigma = this.sigma();
    const r = Math.max(18, Math.tan((sigma * Math.PI) / 180) * f);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (r > 40) {
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`±${sigma.toFixed(0)}°`, cx, cy - r - 3);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();
  }

  private drawCenterText(text: string) {
    const { ctx } = this;
    ctx.fillStyle = '#cfe8ff';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.w / 2, this.h / 2);
  }

  private updateHud(scene: ArScene, pose: Pose) {
    const now = performance.now();
    if (now - this.lastHud < 250) return;
    this.lastHud = now;
    const p = vecToAzEl(pose.forward);
    const src =
      this.mode === 'drag'
        ? 'drag mode'
        : this.calib
          ? `calibrated on ${this.calib.target}`
          : `compass ±${this.sigma().toFixed(0)}°, not calibrated`;
    $('ar-facing').innerHTML = `<b>${p.az.toFixed(0)}° ${compass(p.az)}</b> · ${p.el >= 0 ? `${p.el.toFixed(0)}° up` : `${(-p.el).toFixed(0)}° down`}<small>${esc(src)}</small>`;
    $('ar-calib').hidden = this.mode === 'drag';

    const what = $('ar-what');
    if (this.pendingCalibration) {
      const t = this.pendingCalibration;
      what.innerHTML = `<p><b>Calibrate:</b> put the <b>${esc(t.label)}</b> in the middle of the crosshair, hold still, then confirm.</p>
        <div class="ar-row"><button class="ar-btn primary" data-cal-confirm>It's centred: confirm</button><button class="ar-btn" data-cal-cancel>Cancel</button></div>`;
      return;
    }
    const candidates = scene.objects.map((o) => ({ ...o, ...this.positionOf(o, scene) }));
    this.matches = identify(p, candidates, this.sigma(), 3);
    const sel = scene.objects.find((o) => o.key === scene.selected);
    const parts: string[] = [];
    if (sel) {
      parts.push(`<p class="ar-sel"><b>${esc(sel.label)}</b>${scene.pathNote ? ` · ${esc(scene.pathNote)}` : ''} <button class="ar-link" data-key="">clear</button></p>`);
      if (this.guideText) parts.push(`<p class="ar-guide">➜ ${esc(this.guideText)}</p>`);
    }
    if (this.matches.length) {
      parts.push(
        `<p class="ar-title">${this.sigma() > 5 ? `Probably nearby (compass ±${this.sigma().toFixed(0)}°, calibrate to sharpen)` : 'In the crosshair'}</p><ul>${this.matches
          .map(
            (m) => `<li data-key="${m.candidate.key}"><span class="pct">${Math.round(m.confidence * 100)}%</span> ${esc(m.candidate.label)}
              <small>${m.candidate.kind === 'body' ? 'planet / Moon' : m.candidate.status === 'visible' ? 'satellite, sunlit' : 'satellite, hard to see'} · ${m.sepDeg.toFixed(1)}° off</small></li>`,
          )
          .join('')}</ul>`,
      );
    } else {
      parts.push('<p class="ar-title">Point the crosshair at a light to identify it.</p>');
    }
    if (this.calib && this.mode !== 'drag') parts.push('<button class="ar-link" data-cal-reset>reset calibration</button>');
    what.innerHTML = parts.join('');
  }
}
