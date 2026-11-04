// "What's That?": point the phone at a light, get the most likely objects. See docs/SKYWATCH_PLAN.md §7.
import { declination } from '../engine/declination';
import {
  applyCalibration,
  calibrationValid,
  describeMotion,
  fitMotion,
  makeCalibration,
  pointingSigma,
  rateDeg,
  scoreCandidates,
  type Calibration,
  type Candidate,
  type ScoreResult,
} from '../engine/matcher';
import {
  azElFromEnu,
  cameraDirection,
  cameraFrame,
  deviceAxes,
  dot,
  enuFromAzEl,
  projectToScreen,
  RAD,
  rotateAzimuth,
  screenAxes,
  sepDeg,
  smoothDirection,
  type Vec3,
} from '../engine/pointing';
import type { Observer } from '../engine/satellites';
import { compass, esc } from './format';

export interface WhatsThatDeps {
  now(): Date;
  observer(): Observer;
  /** everything worth matching right now (with apparent motion) */
  candidates(at: Date): Candidate[];
  /** constellation stick figures as ENU polylines (empty when off or too bright) */
  lines(at: Date): Vec3[][];
  /** the object selected on the radar, so the view can point the way to it */
  target(at: Date): { name: string; dir: Vec3 } | null;
  show(key: string): void;
  load<T>(key: string, fallback: T): T;
  save(key: string, value: unknown): void;
}

type Mode = 'idle' | 'waiting' | 'sensor' | 'drag';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** the phone camera's long side covers roughly this many degrees (unknown on the web, ~60–70° on most phones) */
const LONG_SIDE_FOV = 64;

function screenAngle(): number {
  const a = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return Number(a) || 0;
}

export class WhatsThat {
  private mode: Mode = 'idle';
  private visible = false;
  /** smoothed camera direction and screen-up, before declination and calibration */
  private raw: Vec3 | null = null;
  private rawUp: Vec3 = [0, 0, 1];
  private lastEvent = 0;
  private gotAbsolute = false;
  /** iOS: webkitCompassHeading − (relative) azimuth */
  private iosOffset: number | null = null;
  private compassAccuracy: number | null = null;
  private cal: Calibration | null;
  private dragAz = 180;
  private dragEl = 25;
  private cands: Candidate[] = [];
  private figs: Vec3[][] = [];
  private candsAt = 0;
  private result: ScoreResult = { matches: [], nothingObvious: true };
  private tracking: { t: number; v: Vec3 }[] | null = null;
  private motion: { vel: Vec3; until: number } | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private waitTimer = 0;
  private listAt = 0;
  private message = '';
  private messageUntil = 0;
  /** the other guesses below the best one are folded away until asked for */
  private showMore = false;

  private root = $('wt');
  private canvas = $<HTMLCanvasElement>('wt-canvas');
  private ctx = this.canvas.getContext('2d')!;
  private video = $<HTMLVideoElement>('wt-video');

  constructor(private deps: WhatsThatDeps) {
    this.cal = deps.load<Calibration | null>('calibration', null);
    $('wt-go').addEventListener('click', () => void this.begin(true));
    $('wt-camera').addEventListener('click', () => void (this.stream ? this.stopCamera() : this.startCamera()));
    $('wt-cal').addEventListener('click', () => this.calibrate());
    $('wt-matches').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const key = t.closest<HTMLElement>('[data-show]')?.dataset.show;
      if (key) deps.show(key);
      if (t.closest('[data-more]')) {
        this.showMore = !this.showMore;
        this.listAt = 0; // redraw now
      }
    });
    $('wt-hint').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-reset-cal]')) {
        this.cal = null;
        deps.save('calibration', null);
        this.note('Calibration cleared.');
      }
    });
    const track = $('wt-track');
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.tracking = [];
      this.motion = null;
      track.classList.add('on');
    });
    const stopTrack = () => {
      if (!this.tracking) return;
      const vel = fitMotion(this.tracking);
      this.tracking = null;
      track.classList.remove('on');
      if (vel) {
        this.motion = { vel, until: performance.now() + 20_000 };
        const rate = rateDeg(vel);
        this.note(
          rate < 0.08
            ? 'You held still: that suits a star or planet.'
            : `You followed something moving ${rate.toFixed(1)}°/s. Matches are now weighted by motion.`,
          20_000,
        );
      } else this.note('Hold the button for at least a second while you follow the light.');
    };
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) track.addEventListener(ev, stopTrack);
    track.addEventListener('contextmenu', (e) => e.preventDefault());

    // drag to look around when there are no motion sensors (desktop, or permission refused)
    let drag: { x: number; y: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'drag') return;
      drag = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag || this.mode !== 'drag') return;
      const f = this.focal();
      this.dragAz = (this.dragAz - ((e.clientX - drag.x) / f) / RAD + 360) % 360;
      this.dragEl = Math.max(-10, Math.min(90, this.dragEl + ((e.clientY - drag.y) / f) / RAD));
      drag = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', () => (drag = null));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopCamera();
    });
  }

  /** a short status line under the matches; it fades after a while */
  private note(text: string, ms = 7000) {
    this.message = text;
    this.messageUntil = text ? performance.now() + ms : 0;
  }

  /** called when the Identify tab is shown or hidden */
  setVisible(on: boolean) {
    this.visible = on;
    if (on) {
      if (this.mode !== 'idle') this.listen(true);
      this.loop();
    } else {
      this.listen(false);
      this.stopCamera();
      cancelAnimationFrame(this.raf);
    }
  }

  /**
   * One tap does it all: motion sensors and (optionally) the camera. Both permission prompts are asked for
   * straight away, while the tap still counts as a user gesture.
   */
  async begin(camera = true) {
    const cam = camera && !this.stream ? this.startCamera() : Promise.resolve();
    if (this.mode === 'idle') await this.start();
    await cam;
  }

  private async start() {
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    let refused = false;
    if (DOE?.requestPermission) {
      // iOS (and newer Chrome) ask from a tap. Some browsers answer "denied" yet still send events,
      // so listen anyway and only give up if nothing arrives.
      try {
        refused = (await DOE.requestPermission()) !== 'granted';
      } catch {
        refused = true;
      }
    }
    $('wt-start').hidden = true;
    this.mode = 'waiting';
    this.listen(true);
    clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (this.mode !== 'waiting') return;
      this.enterDrag(
        refused
          ? 'Motion access was refused, so drag the sky to look around. You can allow it in the browser settings.'
          : 'No motion sensors found: drag the sky to look around.',
      );
    }, 1500);
    this.loop();
  }

  private enterDrag(msg: string) {
    $('wt-start').hidden = true;
    this.mode = 'drag';
    this.note(msg);
    // start facing the most interesting thing that's up
    const best = this.deps
      .candidates(this.deps.now())
      .filter((c) => c.el > 5 && c.kind !== 'sun')
      .sort((a, b) => (a.kind === 'moon' ? -1 : 0) - (b.kind === 'moon' ? -1 : 0) || (a.mag ?? 5) - (b.mag ?? 5))[0];
    if (best) {
      this.dragAz = (best.az + 6) % 360;
      this.dragEl = Math.max(0, best.el - 3);
    }
    this.loop();
  }

  private listen(on: boolean) {
    const fn = on ? window.addEventListener : window.removeEventListener;
    fn('deviceorientationabsolute', this.onOrient as EventListener);
    fn('deviceorientation', this.onOrient as EventListener);
  }

  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const absolute = e.type === 'deviceorientationabsolute' || e.absolute === true;
    const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number });
    if (absolute) this.gotAbsolute = true;
    else if (this.gotAbsolute) return; // Android sends both; the absolute one has north in it
    const axes = deviceAxes(e.alpha, e.beta, e.gamma);
    let fwd = cameraDirection(axes);
    let up = screenAxes(axes, screenAngle()).up;
    if (!absolute) {
      if (webkit.webkitCompassHeading === undefined || webkit.webkitCompassHeading < 0) return; // no north at all
      this.compassAccuracy = webkit.webkitCompassAccuracy ?? null;
      const { el, az } = azElFromEnu(fwd);
      // iOS reports where the back of the phone faces; it is meaningless when the phone lies flat
      if (Math.abs(el) < 55) {
        const off = wrap180(webkit.webkitCompassHeading - az);
        this.iosOffset = this.iosOffset === null ? off : this.iosOffset + wrap180(off - this.iosOffset) * 0.1;
      }
      if (this.iosOffset === null) {
        this.note('Hold the phone upright for a moment so the compass can find north.');
        return;
      }
      fwd = rotateAzimuth(fwd, this.iosOffset);
      up = rotateAzimuth(up, this.iosOffset);
    }
    const t = performance.now();
    const first = !this.raw;
    const dt = first ? 0 : t - this.lastEvent;
    this.raw = smoothDirection(this.raw, fwd, dt);
    this.rawUp = smoothDirection(first ? null : this.rawUp, up, dt);
    this.lastEvent = t;
    if (this.mode === 'waiting' || this.mode === 'drag') {
      this.mode = 'sensor';
      this.note('');
    }
  };

  private async startCamera() {
    if (this.stream || !navigator.mediaDevices?.getUserMedia) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      this.video.srcObject = this.stream;
      this.video.hidden = false;
      await this.video.play().catch(() => undefined);
      $('wt-camera').setAttribute('aria-pressed', 'true');
      $('wt-camera').textContent = '📷 Camera on';
      this.root.classList.add('cam');
    } catch {
      this.note('No camera (or it was refused), so you get the drawn sky instead. That works just as well.');
    }
  }

  private stopCamera() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
    $('wt-camera').setAttribute('aria-pressed', 'false');
    $('wt-camera').textContent = '📷 Camera off';
    this.root.classList.remove('cam');
  }

  private calibrated() {
    return this.mode === 'sensor' && calibrationValid(this.cal, Date.now(), this.deps.observer());
  }

  /** true-north direction from the sensors, before calibration */
  private measured(at: Date): Vec3 | null {
    if (!this.raw) return null;
    const o = this.deps.observer();
    return rotateAzimuth(this.raw, declination(o.lat, o.lon, at));
  }

  private frame(at: Date) {
    if (this.mode === 'drag') return cameraFrame(enuFromAzEl(this.dragAz, this.dragEl), [0, 0, 1]);
    const m = this.measured(at);
    if (!m) return null;
    const o = this.deps.observer();
    const up = rotateAzimuth(this.rawUp, declination(o.lat, o.lon, at));
    const fwd = this.calibrated() ? applyCalibration(m, this.cal) : m;
    // calibration nudges the view direction; carry the roll over from the sensor's "up"
    return cameraFrame(fwd, up);
  }

  private calibrate() {
    const at = this.deps.now();
    const m = this.measured(at);
    if (this.mode !== 'sensor' || !m) {
      this.note('Calibration needs the motion sensors.');
      return;
    }
    const known = this.cands.filter((c) => (c.kind === 'moon' || c.kind === 'planet' || (c.kind === 'star' && (c.mag ?? 9) < 1.6)) && c.el > 3);
    const pick = scoreCandidates(m, known, pointingSigma(false)).matches.find((x) => x.sep < 25);
    if (!pick) {
      this.note('First point the circle at the Moon, a bright planet or one of the brightest stars, then tap Fix compass.');
      return;
    }
    this.cal = makeCalibration(m, pick.c.dir, pick.c.name, Date.now(), this.deps.observer());
    this.deps.save('calibration', this.cal);
    this.note(`Compass fixed using ${pick.c.name} (it was ${Math.abs(this.cal.dAz).toFixed(0)}° off). Guesses are sharper now.`);
  }

  private focal() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return Math.max(w, h) / 2 / Math.tan((LONG_SIDE_FOV / 2) * RAD);
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (!this.visible) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw() {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();
    if (!this.stream) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#02040a');
      g.addColorStop(1, col('--radar-bg') || '#06221a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.mode === 'idle' || this.mode === 'waiting') {
      this.renderStatus(null);
      return;
    }
    const at = this.deps.now();
    const nowMs = performance.now();
    if (nowMs - this.candsAt > 500) {
      this.cands = this.deps.candidates(at);
      this.figs = this.deps.lines(at);
      this.candsAt = nowMs;
    }
    const fr = this.frame(at);
    if (!fr) return;
    if (this.tracking) this.tracking.push({ t: nowMs, v: fr.forward });
    if (this.motion && nowMs > this.motion.until) this.motion = null;
    const sigma = pointingSigma(this.calibrated()) * (this.mode === 'drag' ? 0.5 : 1);
    this.result = scoreCandidates(fr.forward, this.cands, sigma, this.motion?.vel ?? null);

    const f = this.focal();
    const cx = w / 2;
    const cy = h / 2;
    const P = (v: Vec3) => {
      const p = projectToScreen(v, fr.forward, fr.right, fr.up, f);
      return p ? { x: cx + p.x, y: cy + p.y } : null;
    };
    const night = document.documentElement.dataset.night === '1';

    // horizon, 30° and 60° circles, cardinal points
    ctx.lineWidth = 1;
    for (const el of [0, 30, 60]) {
      ctx.strokeStyle = el === 0 ? col('--radar-grid-strong') : col('--radar-grid');
      ctx.beginPath();
      let pen = false;
      for (let az = 0; az <= 360; az += 2) {
        const p = P(enuFromAzEl(az, el));
        if (!p) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
    }
    ctx.font = '600 14px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col('--accent');
    for (let az = 0; az < 360; az += 45) {
      const p = P(enuFromAzEl(az, 0));
      if (p) ctx.fillText(compass(az), p.x, p.y + 14);
    }

    // constellation figures
    ctx.strokeStyle = col('--constellation');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const line of this.figs) {
      let pen = false;
      for (const v of line) {
        const p = P(v);
        if (!p) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
    }
    ctx.stroke();

    // objects
    const top = new Set(this.result.matches.map((m) => m.c.key));
    for (const c of this.cands) {
      if (c.el < -2) continue;
      const p = P(c.dir);
      if (!p || p.x < -40 || p.x > w + 40 || p.y < -40 || p.y > h + 40) continue;
      const color = night
        ? col('--sat-visible')
        : c.kind === 'sat'
          ? col('--sat-visible')
          : c.kind === 'moon'
            ? col('--moon')
            : c.kind === 'sun'
              ? col('--sun')
              : c.kind === 'planet'
                ? col('--planet')
                : '#e8f0ff';
      const r = c.kind === 'moon' || c.kind === 'sun' ? 10 : c.kind === 'star' ? Math.max(1.5, 3.5 - 0.6 * (c.mag ?? 3)) : 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (c.kind === 'sat' && rateDeg(c.vel) > 0.05) {
        // where it will be in 10 s
        const q = P([c.dir[0] + c.vel[0] * 10, c.dir[1] + c.vel[1] * 10, c.dir[2] + c.vel[2] * 10]);
        if (q) {
          ctx.strokeStyle = color;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      const labelled = top.has(c.key) || c.kind !== 'star' || (c.mag ?? 9) < 1.2;
      if (labelled) {
        ctx.font = `${top.has(c.key) ? '600 ' : ''}12px ui-monospace, Menlo, monospace`;
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const tw = ctx.measureText(c.name).width;
        ctx.fillRect(p.x + r + 4, p.y - 8, tw + 6, 16);
        ctx.fillStyle = color;
        ctx.fillText(c.name, p.x + r + 7, p.y);
      }
    }

    // arrow towards the object picked on the radar
    const tgt = this.deps.target(at);
    if (tgt) {
      const p = P(tgt.dir);
      const inView = p && p.x > 20 && p.x < w - 20 && p.y > 60 && p.y < h - 200;
      if (inView) {
        ctx.strokeStyle = col('--select');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // direction on screen: project onto the screen plane
        const dx = dot(tgt.dir, fr.right);
        const dy = -dot(tgt.dir, fr.up);
        const ang = Math.atan2(dy, dx);
        const rr = Math.min(w, h) * 0.32;
        const ax = cx + Math.cos(ang) * rr;
        const ay = cy + Math.sin(ang) * rr;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.fillStyle = col('--select');
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -10);
        ctx.lineTo(-8, 10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = col('--select');
        ctx.fillText(`${tgt.name} ${Math.round(sepDeg(fr.forward, tgt.dir))}°`, ax - Math.cos(ang) * 30, ay - Math.sin(ang) * 30);
      }
    }

    // crosshair: the circle is the expected pointing error
    const rad = Math.max(18, Math.min(Math.min(w, h) / 2.4, f * Math.tan(sigma * RAD)));
    ctx.strokeStyle = this.tracking ? col('--select') : col('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.stroke();

    this.renderStatus(fr.forward);
    if (nowMs - this.listAt > 300) {
      this.listAt = nowMs;
      this.renderList(fr.forward);
    }
  }

  private renderStatus(fwd: Vec3 | null) {
    const pill = $('wt-status');
    const calBtn = $('wt-cal');
    calBtn.hidden = this.mode === 'drag';
    if (!fwd) {
      pill.textContent = this.mode === 'waiting' ? 'Waiting for motion sensors…' : '';
      return;
    }
    const { az, el } = azElFromEnu(fwd);
    const accuracy = this.mode === 'drag' ? 'drag to look' : this.calibrated() ? 'compass fixed' : 'rough compass';
    pill.textContent = `${compass(az)} · ${el.toFixed(0)}° up · ${accuracy}`;
  }

  private renderList(fwd: Vec3) {
    const { matches, nothingObvious } = this.result;
    const sun = this.cands.find((c) => c.kind === 'sun');
    const items: string[] = [];
    if (sun && sun.el > -1 && sepDeg(fwd, sun.dir) < 25) {
      items.push('<li class="m warn-sun">☀ The Sun is close to where you are pointing. Never look at it, through a camera or not.</li>');
    }
    if (nothingObvious) {
      items.push(
        `<li class="m none">Nothing obvious here.${matches.length ? ' Best guesses:' : ' It could be a plane, a faint satellite or a fainter star' + (this.calibrated() || this.mode === 'drag' ? '.' : ', or the compass is off: aim at the Moon or a bright planet and tap Fix compass.')}</li>`,
      );
    }
    matches.forEach((m, i) => {
      if (i === 1) {
        items.push(
          `<li class="m-more"><button class="link" data-more>${this.showMore ? 'Hide other guesses' : `Other guesses (${matches.length - 1})`}</button></li>`,
        );
      }
      if (i > 0 && !this.showMore) return;
      const c = m.c;
      const type = { sat: 'Satellite', moon: 'Moon', planet: 'Planet', star: 'Star', sun: 'Sun' }[c.kind];
      let look = '';
      if (c.kind === 'sat') {
        const mv = describeMotion(c.dir, c.vel);
        look = `Steady light moving ~${mv.rate.toFixed(1)}°/s towards the ${compass(mv.towardsAz)}.${c.important ? ' Very bright.' : ''}`;
      } else if (c.kind === 'planet') look = 'Bright and steady; planets barely twinkle.';
      else if (c.kind === 'star') look = 'Twinkles, and keeps its place among the other stars.';
      items.push(`<li class="m${i === 0 && !nothingObvious ? ' best' : ''}">
        <span class="m-rank">${i + 1}</span>
        <div class="m-main"><b>${esc(c.name)}</b>
          <small>${type}${c.mag !== undefined ? ` · mag ${c.mag.toFixed(1)}` : ''} · ${m.sep.toFixed(1)}° off</small>
          ${look && i === 0 ? `<small class="m-look">${look}</small>` : ''}</div>
        <span class="m-conf">${m.confidence < 0.01 ? '<1' : Math.round(m.confidence * 100)}%</span>
        <button class="btn m-show" data-show="${esc(c.key)}" aria-label="Show ${esc(c.name)} on the radar">Radar</button>
      </li>`);
    });
    $('wt-matches').innerHTML = items.join('');
    let hint = performance.now() < this.messageUntil ? this.message : '';
    if (!hint) {
      if (this.mode === 'drag') hint = 'Drag the sky to look around.';
      else if (this.compassAccuracy !== null && this.compassAccuracy > 25)
        hint = 'The compass is unsure: wave the phone in a figure-8, away from metal.';
      else if (this.calibrated()) hint = `Compass fixed using ${esc(this.cal!.on)}. <button class="link" data-reset-cal>Undo</button>`;
      else hint = 'Put the circle on a light. Guesses look off? Aim at the Moon, a planet or a bright star and tap 🧭 Fix compass.';
    } else hint = esc(hint);
    $('wt-hint').innerHTML = hint;
  }
}
