// Polar "sky radar": zenith in the centre, horizon at the rim, north up, east right.
import type { SatStatus } from '../engine/satellites';

export interface RadarObject {
  key: string;
  kind: 'sat' | 'body' | 'star';
  az: number;
  el: number;
  label?: string;
  status?: SatStatus;
  /** always show the label (e.g. ISS) */
  important?: boolean;
  symbol?: string;
  mag?: number;
  /** star colour as "r,g,b" (from its B−V index) */
  rgb?: string;
}

interface Theme {
  bg: string;
  grid: string;
  gridStrong: string;
  text: string;
  accent: string;
  visible: string;
  daylight: string;
  eclipsed: string;
  sun: string;
  moon: string;
  planet: string;
  select: string;
  /** when set (night mode), every star is drawn in this colour */
  starTint: string;
}

function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v('--radar-bg'),
    grid: v('--radar-grid'),
    gridStrong: v('--radar-grid-strong'),
    text: v('--text-dim'),
    accent: v('--accent'),
    visible: v('--sat-visible'),
    daylight: v('--sat-daylight'),
    eclipsed: v('--sat-eclipsed'),
    sun: v('--sun'),
    moon: v('--moon'),
    planet: v('--planet'),
    select: v('--select'),
    starTint: v('--star-tint'),
  };
}

export class Radar {
  private ctx: CanvasRenderingContext2D;
  private objects: RadarObject[] = [];
  private trail: { az: number; el: number }[] = [];
  private selected: string | null = null;
  private theme: Theme = readTheme();
  private size = 0;
  private dpr = 1;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSelect: (key: string | null) => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    canvas.addEventListener('click', (e) => this.handleClick(e));
    this.resize();
    const loop = () => {
      this.draw(performance.now());
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  refreshTheme() {
    this.theme = readTheme();
  }

  setObjects(objs: RadarObject[]) {
    this.objects = objs;
  }

  setTrail(points: { az: number; el: number }[]) {
    this.trail = points;
  }

  setSelected(key: string | null) {
    this.selected = key;
  }

  private resize() {
    const box = this.canvas.parentElement!.getBoundingClientRect();
    const size = Math.max(200, Math.floor(Math.min(box.width, box.height || box.width)));
    this.dpr = window.devicePixelRatio || 1;
    this.size = size;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.canvas.width = size * this.dpr;
    this.canvas.height = size * this.dpr;
  }

  private geom() {
    const c = this.size / 2;
    return { cx: c, cy: c, R: c - 26 };
  }

  project(az: number, el: number) {
    const { cx, cy, R } = this.geom();
    const r = ((90 - Math.max(el, -2)) / 90) * R;
    const a = (az * Math.PI) / 180;
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
  }

  private handleClick(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // satellites, Sun, Moon and planets win over the (many) background stars
    const nearest = (stars: boolean, maxD: number) => {
      let best: RadarObject | null = null;
      let bestD = maxD;
      for (const o of this.objects) {
        if (o.el < 0 || (o.kind === 'star') !== stars) continue;
        const p = this.project(o.az, o.el);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      return best;
    };
    const best = nearest(false, 16) ?? nearest(true, 12);
    this.onSelect(best ? best.key : null);
  }

  /** label boxes placed this frame, to avoid overlapping text */
  private placed: { x: number; y: number; w: number; h: number }[] = [];

  private draw(now: number) {
    const { ctx, theme: t } = this;
    this.placed = [];
    const { cx, cy, R } = this.geom();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);

    // background disc
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, t.bg);
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // elevation rings (0°, 30°, 60°) and azimuth spokes
    ctx.lineWidth = 1;
    for (const el of [0, 30, 60]) {
      ctx.strokeStyle = el === 0 ? t.gridStrong : t.grid;
      ctx.beginPath();
      ctx.arc(cx, cy, ((90 - el) / 90) * R, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = t.grid;
    for (let az = 0; az < 360; az += 30) {
      const p = this.project(az, 0);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = t.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      const a = (az * Math.PI) / 180;
      ctx.fillText(label, cx + (R + 14) * Math.sin(a), cy - (R + 14) * Math.cos(a));
    }
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.fillStyle = t.text;
    ctx.fillText('30°', cx + 3, cy - (60 / 90) * R + 9);
    ctx.fillText('60°', cx + 3, cy - (30 / 90) * R + 9);

    // sweep
    if (!this.reducedMotion) {
      const ang = ((now / 4000) % 1) * Math.PI * 2 - Math.PI / 2;
      const sweep = ctx.createConicGradient(ang - 0.6, cx, cy);
      sweep.addColorStop(0, 'rgba(0,0,0,0)');
      sweep.addColorStop(0.095, t.grid);
      sweep.addColorStop(0.0955, 'rgba(0,0,0,0)');
      ctx.fillStyle = sweep;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, ang - 0.6, ang);
      ctx.closePath();
      ctx.fill();
    }

    // selected trail
    if (this.trail.length > 1) {
      ctx.strokeStyle = t.select;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let pen = false;
      for (const pt of this.trail) {
        if (pt.el < 0) {
          pen = false;
          continue;
        }
        const p = this.project(pt.az, pt.el);
        if (pen) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // stars: size and opacity by magnitude, tinted by colour index
    for (const o of this.objects) {
      if (o.kind !== 'star' || o.el < 0) continue;
      const p = this.project(o.az, o.el);
      const mag = o.mag ?? 4;
      const r = Math.max(0.7, 2.4 - 0.4 * mag);
      const alpha = Math.min(1, Math.max(0.35, 1 - mag * 0.13));
      ctx.fillStyle = t.starTint || `rgba(${o.rgb ?? '255,255,255'},${alpha})`;
      if (t.starTint) ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // satellites (dim ones first so visible ones draw on top)
    const order: Record<string, number> = { eclipsed: 0, daylight: 1, visible: 2 };
    const sats = this.objects
      .filter((o) => o.kind === 'sat' && o.el >= 0)
      .sort((a, b) => (order[a.status ?? 'eclipsed'] ?? 0) - (order[b.status ?? 'eclipsed'] ?? 0));
    for (const o of sats) {
      const p = this.project(o.az, o.el);
      const color = o.status === 'visible' ? t.visible : o.status === 'daylight' ? t.daylight : t.eclipsed;
      const r = o.important ? 4.5 : o.status === 'visible' ? 2.6 : 1.8;
      if (o.status === 'visible') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (o.important && o.label) this.label(o.label, p.x, p.y, color);
    }

    // Sun, Moon, planets
    for (const o of this.objects) {
      if (o.kind !== 'body' || o.el < 0) continue;
      const p = this.project(o.az, o.el);
      const color = o.key === 'body:sun' ? t.sun : o.key === 'body:moon' ? t.moon : t.planet;
      const r = o.key === 'body:sun' || o.key === 'body:moon' ? 7 : 3.5;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // reserve the dot itself so optional star labels don't cover it
      this.placed.push({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r });
      this.label(o.label ?? '', p.x, p.y, color);
    }

    // names of the brightest stars, only where there is room
    for (const o of this.objects) {
      if (o.kind !== 'star' || !o.important || o.el < 0 || o.key === this.selected) continue;
      const p = this.project(o.az, o.el);
      this.label(o.label ?? '', p.x, p.y, t.text, true);
    }

    // selection ring
    const sel = this.objects.find((o) => o.key === this.selected);
    if (sel && sel.el >= 0) {
      const p = this.project(sel.az, sel.el);
      const pulse = this.reducedMotion ? 0 : Math.sin(now / 250) * 2;
      ctx.strokeStyle = t.select;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      if ((!sel.important && sel.kind === 'sat') || sel.kind === 'star') this.label(sel.label ?? '', p.x, p.y, t.select);
    }
  }

  /** `optional` labels are skipped instead of overlapping an earlier one */
  private label(text: string, x: number, y: number, color: string, optional = false) {
    const { ctx } = this;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 6;
    const h = 14;
    // try a few positions around the dot until one doesn't overlap an earlier label
    const spots = [
      [8, 0], [8, 15], [8, -15], [-w - 8, 0], [-w - 8, 15], [-w - 8, -15], [8, 30], [8, -30],
    ];
    let [dx, dy] = spots[0];
    let found = false;
    // optional labels stay level with their dot and inside the canvas
    for (const [sx, sy] of optional ? spots.filter(([, sy]) => sy === 0) : spots) {
      const bx = x + sx;
      const by = y + sy - h / 2;
      if (optional && (bx < 0 || bx + w > this.size)) continue;
      const hit = this.placed.some((b) => bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y);
      if (!hit) {
        [dx, dy] = [sx, sy];
        found = true;
        break;
      }
    }
    if (optional && !found) return;
    const bx = x + dx;
    const by = y + dy - h / 2;
    this.placed.push({ x: bx, y: by, w, h });
    if (dy !== 0) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(dx > 0 ? bx : bx + w, y + dy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = color;
    ctx.fillText(text, bx + 3, y + dy);
  }
}
