import './style.css';
import type { OMMJsonObject, SatRec } from 'satellite.js';
import { GROUPS, loadGroup, type GroupData } from './data/celestrak';
import { CITIES, cityLabel, findCity, nearestCity, parseLatLon } from './data/cities';
import {
  classify,
  ommEpochAgeDays,
  predictPasses,
  satState,
  satrecFromOmm,
  sunEci,
  toGeodetic,
  trackAzEl,
  type Observer,
  type Pass,
  type SatStatus,
} from './engine/satellites';
import { skyBodies, skyState, sunAltitude, type BodyPosition } from './engine/sky';
import {
  bvToRgb,
  CONSTELLATIONS,
  figureLines,
  parseCatalog,
  parseConstellations,
  type ConstellationFile,
  type Figure,
  starMagLimit,
  starPositions,
  type Star,
  type StarCatalogFile,
  type StarPosition,
} from './engine/stars';
import { compass, esc, fmtAgo, fmtDay, fmtDuration, fmtIn, fmtTime, fmtUtc, setTimeZone, tzName, whereToLook } from './ui/format';
import { Radar, type RadarObject } from './ui/radar';
import type { Candidate } from './engine/matcher';
import { enuFromAzEl, type Vec3 } from './engine/pointing';
import { buildIcs, downloadIcs, type IcsEvent } from './ui/ics';
import { WhatsThat } from './ui/whatsthat';
import type { PassItem, SatSample, WorkerRequest, WorkerResponse } from './workers/propagate.worker';

// ───────────────────────── helpers ─────────────────────────
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function store<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`skywatch:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`skywatch:${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ───────────────────────── time ─────────────────────────
// ?t=2026-11-04T20:00:00Z starts the clock at a given moment (handy for testing / sharing).
const params = new URLSearchParams(location.search);
const loadedAt = Date.now();
const simStart = params.get('t') ? Date.parse(params.get('t')!) : Number.NaN;
let clockOffset = 0;
const now = () =>
  new Date(Number.isFinite(simStart) ? simStart + (Date.now() - loadedAt) : Date.now() + clockOffset);

async function syncClock() {
  if (Number.isFinite(simStart)) return;
  try {
    const t0 = Date.now();
    const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
    const header = res.headers.get('date');
    if (!header) return;
    const server = Date.parse(header) + 500; // Date header has 1 s resolution
    const offset = server - (t0 + Date.now()) / 2;
    if (Math.abs(offset) > 1500) clockOffset = offset;
  } catch {
    /* offline: trust the device clock */
  }
}

// ───────────────────────── location ─────────────────────────
/** `tz`: IANA time zone for showing times; missing = this device's zone */
type Place = Observer & { label: string; tz?: string };
const DEFAULT_PLACE: Place = { lat: 51.4769, lon: -0.0005, heightM: 45, label: 'Greenwich (default)', tz: 'Europe/London' };

function initialPlace(): Place {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon, heightM: 0, label: 'From link', tz: nearestCity(lat, lon)?.tz };
  }
  return store<Place>('place', DEFAULT_PLACE);
}
let place = initialPlace();

// ───────────────────────── state ─────────────────────────
interface SatRow {
  key: string;
  norad: number;
  name: string;
  omm: OMMJsonObject;
  az: number;
  el: number;
  rangeKm: number;
  altKm: number;
  status: SatStatus;
  important: boolean;
}

const data = new Map<string, GroupData>();
const groupErrors = new Map<string, string>();
const enabled = new Set<string>(store<string[]>('groups', ['stations', 'visual']));
let rows: SatRow[] = [];
let bodies: BodyPosition[] = [];
let sunAlt = 0;
let totalTracked = 0;
let calcMs = 0;
let selected: string | null = null;
let visibleOnly = store('visibleOnly', false);
let showStars = store('stars', true);
let stars: Star[] = [];
let starsUp: StarPosition[] = [];
let showLines = store('constellations', true);
let figures: Figure[] = [];
const satrecCache = new Map<number, SatRec | null>();

const IMPORTANT = /^(ISS \(ZARYA\)|CSS \(TIANHE\)|HST)$/;

function satrecFor(omm: OMMJsonObject): SatRec | null {
  const id = Number(omm.NORAD_CAT_ID);
  if (!satrecCache.has(id)) satrecCache.set(id, satrecFromOmm(omm));
  return satrecCache.get(id)!;
}

// ───────────────────────── worker ─────────────────────────
const worker = new Worker(new URL('./workers/propagate.worker.ts', import.meta.url), { type: 'module' });
const post = (msg: WorkerRequest) => worker.postMessage(msg);
let reqId = 0;
let busy = false;

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const msg = e.data;
  if (msg.type === 'loaded') {
    renderGroups();
    schedulePasses();
  } else if (msg.type === 'passes') {
    if (msg.reqId !== passesReq) return;
    onPasses(msg.items);
  } else if (msg.type === 'result') {
    busy = false;
    if (msg.reqId !== reqId) return;
    totalTracked = msg.total;
    calcMs = msg.ms;
    onSamples(msg.samples, new Date(msg.time));
  }
};

function onSamples(samples: SatSample[], at: Date) {
  sunAlt = sunAltitude(at, place);
  const seen = new Set<number>();
  const out: SatRow[] = [];
  for (const s of samples) {
    const omm = data.get(s.g)?.records[s.i];
    if (!omm) continue;
    const norad = Number(omm.NORAD_CAT_ID);
    if (seen.has(norad)) continue; // same satellite in several groups
    seen.add(norad);
    out.push({
      key: `sat:${norad}`,
      norad,
      name: omm.OBJECT_NAME,
      omm,
      az: s.az,
      el: s.el,
      rangeKm: s.rangeKm,
      altKm: s.altKm,
      status: classify(s, sunAlt),
      important: IMPORTANT.test(omm.OBJECT_NAME),
    });
  }
  out.sort((a, b) => b.el - a.el);
  rows = out;
  bodies = skyBodies(at, place);
  updateStars(at);
  updateRadar();
  renderOverhead();
  renderSky();
  renderDetails();
  renderStatus();
}

function tick() {
  $('clock-local').textContent = fmtTime(now());
  $('clock-utc').textContent = fmtUtc(now());
  if (busy) return;
  busy = true;
  post({ type: 'compute', reqId: ++reqId, time: now().getTime(), observer: place, minEl: 0 });
}

// ───────────────────────── data loading ─────────────────────────
async function enableGroup(group: string) {
  groupErrors.delete(group);
  renderGroups();
  try {
    const gd = await loadGroup(group);
    if (!enabled.has(group)) return;
    data.set(group, gd);
    post({ type: 'load', group, records: gd.records });
    refreshHighlight();
  } catch (err) {
    groupErrors.set(group, (err as Error).message);
  }
  renderGroups();
}

function disableGroup(group: string) {
  data.delete(group);
  post({ type: 'unload', group });
  schedulePasses();
  renderGroups();
}

// ───────────────────────── radar ─────────────────────────
const radar = new Radar($<HTMLCanvasElement>('radar'), (key) => {
  // a tiny tick so a tap on a busy radar feels confirmed (Android; iOS ignores it)
  if (key && key !== selected) navigator.vibrate?.(8);
  select(key);
});
radar.onZoom = (z) => {
  $('zoom-reset').hidden = z <= 1.01;
};
$('zoom-in').addEventListener('click', () => radar.zoomBy(1.6));
$('zoom-out').addEventListener('click', () => radar.zoomBy(1 / 1.6));
$('zoom-reset').addEventListener('click', () => radar.resetZoom());

function updateRadar() {
  const objs: RadarObject[] = [];
  for (const r of rows) {
    if (visibleOnly && r.status !== 'visible' && r.key !== selected) continue;
    objs.push({ key: r.key, kind: 'sat', az: r.az, el: r.el, label: r.name, status: r.status, important: r.important });
  }
  for (const b of bodies) {
    objs.push({ key: `body:${b.id}`, kind: 'body', az: b.az, el: b.el, label: b.name, symbol: b.symbol, mag: b.mag });
  }
  for (const p of starsUp) {
    objs.push({
      key: `star:${p.star.id}`,
      kind: 'star',
      az: p.az,
      el: p.el,
      label: p.star.name,
      mag: p.star.mag,
      rgb: bvToRgb(p.star.bv),
      // named stars get labels on the radar (how faint depends on the zoom)
      important: p.star.name !== p.star.designation,
    });
  }
  radar.setObjects(objs);
}

// ───────────────────────── visible passes (Passes tab) ─────────────────────────
/** groups worth scanning: bright enough to see; Starlink and new launches would swamp the list */
const PASS_GROUPS = ['stations', 'visual'];
const PASS_HOURS = 48;
interface PassRow {
  key: string;
  norad: number;
  name: string;
  station: boolean;
  pass: Pass;
}
let passRows: PassRow[] = [];
let passesReq = 0;
let passesState: 'idle' | 'computing' | 'done' = 'idle';
let passesAt = 0;
let passesTimer: number | undefined;
let stationsOnly = store('passesStations', false);

/** debounced: groups load one by one, and the location can change twice in a row */
function schedulePasses() {
  clearTimeout(passesTimer);
  passesTimer = window.setTimeout(() => {
    const groups = PASS_GROUPS.filter((g) => data.has(g));
    if (!groups.length) {
      passRows = [];
      passesState = 'idle';
      renderPasses();
      return;
    }
    passesState = 'computing';
    passesAt = now().getTime();
    post({ type: 'passes', reqId: ++passesReq, time: passesAt, observer: place, hours: PASS_HOURS, groups });
    renderPasses();
  }, 400);
}

function onPasses(items: PassItem[]) {
  const seen = new Set<number>();
  passRows = [];
  for (const { g, i, pass } of items) {
    const omm = data.get(g)?.records[i];
    if (!omm) continue;
    const norad = Number(omm.NORAD_CAT_ID);
    // the same satellite can be in two groups; keep one copy of each pass
    const id = norad * 1e13 + pass.visibleFrom!.getTime();
    if (seen.has(id)) continue;
    seen.add(id);
    passRows.push({ key: `sat:${norad}`, norad, name: omm.OBJECT_NAME, station: g === 'stations', pass });
  }
  passRows.sort((a, b) => a.pass.visibleFrom!.getTime() - b.pass.visibleFrom!.getTime());
  passesState = 'done';
  renderPasses();
}

function visiblePassRows(t: Date) {
  return passRows.filter((r) => r.pass.visibleTo! > t && (!stationsOnly || r.station || IMPORTANT.test(r.name)));
}

function passEvent(r: PassRow): IcsEvent {
  const p = r.pass;
  const from = p.visibleFrom!;
  const to = p.visibleTo!;
  const mins = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000));
  return {
    uid: `${r.norad}-${from.getTime()}@skywatch.iambored`,
    start: from,
    end: to,
    summary: `${r.name} pass, up to ${p.maxEl.toFixed(0)}°`,
    description:
      `Look ${compass(p.visibleFromAz ?? p.riseAz)} at ${Math.max(0, p.visibleFromEl ?? 0).toFixed(0)}° above the horizon. ` +
      `It climbs to ${p.maxEl.toFixed(0)}° and fades in the ${compass(p.visibleToAz ?? p.setAz)} about ${mins} min later. ` +
      `Predicted by SkyWatch for ${place.label} (${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}).`,
    alarmMinutes: 10,
  };
}

function renderPasses() {
  const t = now();
  const list = visiblePassRows(t);
  const box = $('passes-list');
  const badge = $('passes-badge');
  // badge: passes starting within the next 3 hours
  const soon = list.filter((r) => r.pass.visibleFrom!.getTime() - t.getTime() < 3 * 3600_000).length;
  badge.hidden = soon === 0;
  badge.textContent = String(soon);
  $<HTMLButtonElement>('passes-ics').disabled = list.length === 0;
  $('passes-count').textContent = passesState === 'done' ? `${list.length} in ${PASS_HOURS} h` : '';
  if (passesState === 'computing' && !list.length) {
    box.innerHTML = '<p class="empty">Working out passes for the next 2 days…</p>';
    return;
  }
  if (!list.length) {
    box.innerHTML = `<p class="empty">${
      passesState === 'idle'
        ? 'Turn on "Space stations" or "Brightest" in Settings to see passes.'
        : 'No visible passes in the next 2 days from here. Satellites are only visible in twilight or at night, when they are still in sunlight.'
    }</p>`;
    return;
  }
  let day = '';
  const html: string[] = [];
  list.forEach((r) => {
    const p = r.pass;
    const from = p.visibleFrom!;
    const d = fmtDay(from, t);
    if (d !== day) {
      day = d;
      html.push(`<h3 class="pass-day">${esc(d)}</h3>`);
    }
    const live = from <= t;
    const mins = Math.max(1, Math.round((p.visibleTo!.getTime() - from.getTime()) / 60_000));
    html.push(`<div class="pass-row${live ? ' live' : ''}${r.station || IMPORTANT.test(r.name) ? ' imp' : ''}${r.key === selected ? ' sel' : ''}" data-key="${r.key}">
      <div class="pass-when"><b>${fmtTime(from, false)}</b><small>${live ? 'now!' : fmtIn(from.getTime() - t.getTime())}</small></div>
      <div class="pass-what"><span class="pass-name">${esc(r.name)}</span>
        <small>up to ${p.maxEl.toFixed(0)}° · ${compass(p.visibleFromAz ?? p.riseAz)} → ${compass(p.visibleToAz ?? p.setAz)} · ${mins} min</small></div>
      <button class="icon-btn cal" data-cal="${passRows.indexOf(r)}" aria-label="Add ${esc(r.name)} pass to calendar">📅</button>
    </div>`);
  });
  box.innerHTML = html.join('');
}

$<HTMLInputElement>('passes-stations').checked = stationsOnly;
$('passes-stations').addEventListener('change', (e) => {
  stationsOnly = (e.target as HTMLInputElement).checked;
  save('passesStations', stationsOnly);
  renderPasses();
});
$('passes-ics').addEventListener('click', () => {
  const list = visiblePassRows(now());
  if (list.length) downloadIcs('skywatch-passes.ics', buildIcs(list.map(passEvent)));
});
$('passes-list').addEventListener(
  'click',
  (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-cal]');
    if (!btn) return;
    e.stopPropagation(); // don't also select the row
    const r = passRows[Number(btn.dataset.cal)];
    if (r) downloadIcs(`skywatch-${r.norad}.ics`, buildIcs([passEvent(r)]));
  },
  true,
);

// ───────────────────────── What's That? ─────────────────────────
/** apparent motion per second, as a change of the ENU unit vector */
const velocity = (a: Vec3, b: Vec3): Vec3 => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];

function wtCandidates(at: Date): Candidate[] {
  const out: Candidate[] = [];
  const at1 = new Date(at.getTime() + 1000);
  const obs = toGeodetic(place);
  const [sun0, sun1] = [sunEci(at), sunEci(at1)];
  for (const r of rows) {
    // only satellites you could actually see now
    if (r.status !== 'visible') continue;
    const rec = satrecFor(r.omm);
    const s0 = rec && satState(rec, at, obs, sun0);
    const s1 = rec && satState(rec, at1, obs, sun1);
    if (!s0 || !s1) continue;
    const dir = enuFromAzEl(s0.az, s0.el);
    out.push({ key: r.key, name: r.name, kind: 'sat', az: s0.az, el: s0.el, dir, vel: velocity(dir, enuFromAzEl(s1.az, s1.el)), important: r.important });
  }
  const b1 = skyBodies(at1, place);
  skyBodies(at, place).forEach((b, i) => {
    const dir = enuFromAzEl(b.az, b.el);
    const kind = b.id === 'sun' ? 'sun' : b.id === 'moon' ? 'moon' : 'planet';
    out.push({ key: `body:${b.id}`, name: b.name, kind, az: b.az, el: b.el, mag: b.mag, dir, vel: velocity(dir, enuFromAzEl(b1[i].az, b1[i].el)) });
  });
  const bright = stars.filter((s) => s.mag <= 3);
  const p1 = new Map(starPositions(bright, at1, place, -5).map((p) => [p.star.id, p]));
  for (const p of starPositions(bright, at, place, -5)) {
    const q = p1.get(p.star.id);
    const dir = enuFromAzEl(p.az, p.el);
    out.push({ key: `star:${p.star.id}`, name: p.star.name, kind: 'star', az: p.az, el: p.el, mag: p.star.mag, dir, vel: q ? velocity(dir, enuFromAzEl(q.az, q.el)) : [0, 0, 0] });
  }
  return out;
}

/** direction of whatever is selected on the radar, so the Identify view can point the way */
function wtTarget(at: Date): { name: string; dir: Vec3 } | null {
  if (!selected) return null;
  if (selected.startsWith('sat:')) {
    const omm = selectedOmm();
    const rec = omm && satrecFor(omm);
    const s = rec && satState(rec, at, toGeodetic(place), sunEci(at));
    return s && omm ? { name: omm.OBJECT_NAME, dir: enuFromAzEl(s.az, s.el) } : null;
  }
  if (selected.startsWith('body:')) {
    const b = skyBodies(at, place).find((x) => `body:${x.id}` === selected);
    return b ? { name: b.name, dir: enuFromAzEl(b.az, b.el) } : null;
  }
  if (selected.startsWith('star:')) {
    const st = stars[Number(selected.slice(5))];
    const p = st && starPositions([st], at, place, -90)[0];
    return p ? { name: st.name, dir: enuFromAzEl(p.az, p.el) } : null;
  }
  return null;
}

const whatsThat = new WhatsThat({
  now,
  observer: () => place,
  candidates: wtCandidates,
  lines: (at) =>
    showLines && figures.length && starMagLimit(sunAlt) >= 3
      ? figureLines(figures, at, place).map((l) => l.map((p) => enuFromAzEl(p.az, p.el)))
      : [],
  target: wtTarget,
  show: (key) => {
    select(key);
    setTab('radar');
  },
  load: store,
  save,
});

// ───────────────────────── stars ─────────────────────────
function updateStars(at: Date) {
  if (!showStars || !stars.length) {
    starsUp = [];
    return;
  }
  // the brighter the sky, the fewer stars are worth drawing (a selected star always stays)
  const limit = starMagLimit(sunAlt);
  starsUp = starPositions(stars, at, place).filter((p) => p.star.mag <= limit || `star:${p.star.id}` === selected);
  // stick figures only once the sky is dark enough to show their stars
  radar.setLines(showLines && figures.length && limit >= 3 ? figureLines(figures, at, place) : []);
}

async function loadStars() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/stars.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stars = parseCatalog((await res.json()) as StarCatalogFile);
    updateStars(now());
    updateRadar();
  } catch (err) {
    console.warn('Star catalogue unavailable:', err);
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/constellations.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    figures = parseConstellations((await res.json()) as ConstellationFile);
    updateStars(now());
  } catch (err) {
    console.warn('Constellation figures unavailable:', err);
  }
}

let trailFor: string | null = null;
let trailAt = 0;
function updateTrail(force = false) {
  const omm = selectedOmm();
  if (!omm) {
    radar.setTrail([]);
    trailFor = null;
    return;
  }
  const t = now();
  if (!force && trailFor === selected && t.getTime() - trailAt < 15_000) return;
  const rec = satrecFor(omm);
  if (!rec) return;
  radar.setTrail(trackAzEl(rec, place, new Date(t.getTime() - 5 * 60_000), new Date(t.getTime() + 10 * 60_000)));
  trailFor = selected;
  trailAt = t.getTime();
}

// ───────────────────────── selection ─────────────────────────
let passCache: { key: string; at: number; passes: Pass[] } | null = null;

function selectedOmm(): OMMJsonObject | null {
  if (!selected?.startsWith('sat:')) return null;
  const norad = Number(selected.slice(4));
  for (const gd of data.values()) {
    const omm = gd.records.find((r) => Number(r.NORAD_CAT_ID) === norad);
    if (omm) return omm;
  }
  return null;
}

function select(key: string | null) {
  selected = key;
  document.body.classList.toggle('has-sel', key !== null);
  if (key === null) $('sheet').classList.remove('expanded');
  radar.setSelected(key);
  passCache = null;
  updateTrail(true);
  updateRadar();
  renderDetails();
  renderOverhead();
}

function passesFor(omm: OMMJsonObject): Pass[] {
  const t = now().getTime();
  if (passCache && passCache.key === selected && t - passCache.at < 10 * 60_000) return passCache.passes;
  const rec = satrecFor(omm);
  const passes = rec ? predictPasses(rec, place, new Date(t), { hours: 48, minMaxEl: 10 }).slice(0, 8) : [];
  passCache = { key: selected!, at: t, passes };
  return passes;
}

// ───────────────────────── rendering ─────────────────────────
const STATUS_TEXT: Record<SatStatus, string> = {
  visible: 'VISIBLE',
  daylight: 'SUNLIT',
  eclipsed: 'SHADOW',
  below: 'BELOW',
};

function badge(status: SatStatus) {
  return `<span class="badge ${status}">${STATUS_TEXT[status]}</span>`;
}

function renderOverhead() {
  const list = visibleOnly ? rows.filter((r) => r.status === 'visible') : rows;
  const visibleCount = rows.filter((r) => r.status === 'visible').length;
  $('overhead-count').textContent = `${rows.length} up · ${visibleCount} visible`;
  const badgeEl = $('tab-badge');
  badgeEl.hidden = visibleCount === 0;
  badgeEl.textContent = String(visibleCount);
  const body = $('overhead-body');
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">${
      data.size ? (visibleOnly ? 'Nothing visible to the eye right now.' : 'Nothing above the horizon.') : 'Loading satellites…'
    }</td></tr>`;
    return;
  }
  body.innerHTML = list
    .slice(0, 120)
    .map(
      (r) => `<tr data-key="${r.key}" class="${r.key === selected ? 'sel' : ''}${r.important ? ' imp' : ''}">
        <td class="name">${esc(r.name)}</td>
        <td class="num">${r.el.toFixed(0)}°</td>
        <td class="num">${r.az.toFixed(0)}° ${compass(r.az)}</td>
        <td class="num">${Math.round(r.rangeKm).toLocaleString()} km</td>
        <td>${badge(r.status)}</td></tr>`,
    )
    .join('');
}

function renderDetails() {
  const box = $('details');
  if (!selected) {
    box.innerHTML = `<p class="hint">Tap a dot on the radar or a row in the list.</p>`;
    return;
  }
  const t = now();
  if (selected.startsWith('body:')) {
    const b = bodies.find((x) => `body:${x.id}` === selected);
    if (!b) return;
    box.innerHTML = `<h3>${b.symbol} ${b.name}</h3>
      <dl class="kv">
        <dt>Where</dt><dd class="look">${whereToLook(b.az, b.el)}</dd>
        <dt>Exactly</dt><dd>${b.az.toFixed(1)}° ${compass(b.az)}, ${b.el.toFixed(1)}° up</dd>
        <dt>Brightness</dt><dd>mag ${b.mag.toFixed(1)}</dd>
        ${b.phase !== undefined ? `<dt>Illuminated</dt><dd>${Math.round(b.phase * 100)} %</dd>` : ''}
      </dl>
      ${b.id === 'sun' ? '<p class="warn">Never look at the Sun directly.</p>' : ''}`;
    return;
  }
  if (selected.startsWith('star:')) {
    const s = stars[Number(selected.slice(5))];
    if (!s) return;
    const p = starPositions([s], t, place, -90)[0];
    const con = s.con ? (CONSTELLATIONS[s.con] ?? s.con) : null;
    box.innerHTML = `<h3><span class="star-chip" style="background:rgb(${bvToRgb(s.bv)})"></span>${esc(s.name)}</h3>
      <dl class="kv">
        ${s.name !== s.designation ? `<dt>Designation</dt><dd>${esc(s.designation)}</dd>` : ''}
        ${con ? `<dt>Constellation</dt><dd>${esc(con)}</dd>` : ''}
        <dt>Where</dt><dd class="look">${whereToLook(p.az, p.el)}</dd>
        <dt>Exactly</dt><dd>${p.az.toFixed(1)}° ${compass(p.az)}, ${p.el.toFixed(1)}° up</dd>
        <dt>Brightness</dt><dd>mag ${s.mag.toFixed(1)}</dd>
        ${s.bv !== null ? `<dt>Colour</dt><dd>${starColourName(s.bv)} (B−V ${s.bv.toFixed(2)})</dd>` : ''}
      </dl>
      ${sunAlt > -6 ? '<p class="hint">The sky is still bright, so this star may be hard to see.</p>' : ''}`;
    return;
  }
  const omm = selectedOmm();
  const rec = omm ? satrecFor(omm) : null;
  if (!omm || !rec) {
    box.innerHTML = `<p class="hint">Satellite data unavailable.</p>`;
    return;
  }
  const s = satState(rec, t, toGeodetic(place), sunEci(t));
  if (!s) {
    box.innerHTML = `<h3>${esc(omm.OBJECT_NAME)}</h3><p class="warn">Propagation failed (decayed or bad data).</p>`;
    return;
  }
  const status = classify(s, sunAlt);
  const age = ommEpochAgeDays(omm, t);
  const passes = passesFor(omm);
  updateTrail();
  box.innerHTML = `<h3>${esc(omm.OBJECT_NAME)} ${badge(status)}</h3>
    <dl class="kv">
      <dt>Where</dt><dd class="look">${whereToLook(s.az, s.el)}</dd>
      <dt>Exactly</dt><dd>${s.az.toFixed(1)}° ${compass(s.az)}, ${s.el.toFixed(1)}° up</dd>
      <dt>Distance</dt><dd>${Math.round(s.rangeKm).toLocaleString()} km</dd>
      <dt>Altitude</dt><dd>${Math.round(s.altKm).toLocaleString()} km</dd>
      <dt>Speed</dt><dd>${s.speedKms.toFixed(2)} km/s</dd>
      <dt>Over</dt><dd>${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°</dd>
      <dt>NORAD / Intl</dt><dd>${omm.NORAD_CAT_ID} / ${esc(omm.OBJECT_ID)}</dd>
      <dt>Orbit data</dt><dd class="${age > 3 ? 'warn' : ''}">${age.toFixed(1)} days old${age > 3 ? ' (may be inaccurate)' : ''}</dd>
    </dl>
    <h4>Next passes <small>(above 10°, 48 h)</small></h4>
    ${
      passes.length
        ? `<table class="passes"><thead><tr><th>When</th><th>Max</th><th>Path</th><th>Length</th><th></th></tr></thead><tbody>${passes
            .map(
              (p) => `<tr class="${p.visibleFrom ? 'vis' : ''}">
              <td>${fmtDay(p.rise, t)} ${fmtTime(p.rise, false)}</td>
              <td class="num">${p.maxEl.toFixed(0)}°</td>
              <td>${compass(p.riseAz)} → ${compass(p.setAz)}</td>
              <td class="num">${fmtDuration(p.set.getTime() - p.rise.getTime())}</td>
              <td>${p.visibleFrom ? `<span class="star" title="Visible ${fmtTime(p.visibleFrom, false)}–${fmtTime(p.visibleTo!, false)}">★<span class="star-text"> visible</span></span>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="hint">No passes above 10° in the next 48 h.</p>'
    }`;
}

function starColourName(bv: number) {
  if (bv < 0) return 'blue-white';
  if (bv < 0.3) return 'white';
  if (bv < 0.6) return 'yellow-white';
  if (bv < 1.0) return 'yellow';
  if (bv < 1.4) return 'orange';
  return 'red-orange';
}

function renderSky() {
  const sun = bodies.find((b) => b.id === 'sun');
  $('sky-state').innerHTML = sun ? `<span>${skyState(sun.el)}</span><span class="ss-sun"> · Sun ${sun.el.toFixed(0)}°</span>` : '';
  $('sky-body').innerHTML = bodies
    .map(
      (b) => `<tr data-key="body:${b.id}" class="${b.el < 0 ? 'down' : ''}${`body:${b.id}` === selected ? ' sel' : ''}">
      <td>${b.symbol} ${b.name}</td>
      <td class="num">${b.el.toFixed(0)}°</td>
      <td class="num">${b.az.toFixed(0)}° ${compass(b.az)}</td>
      <td class="num">${b.phase !== undefined ? `${Math.round(b.phase * 100)} %` : `mag ${b.mag.toFixed(1)}`}</td></tr>`,
    )
    .join('');
}

function renderGroups() {
  const t = Date.now();
  $('groups').innerHTML = GROUPS.map((g) => {
    const gd = data.get(g.id);
    const err = groupErrors.get(g.id);
    const on = enabled.has(g.id);
    let info = '';
    if (err) info = `<span class="warn">${esc(err)}</span>`;
    else if (gd) {
      const stale = gd.fetchedAt && t - gd.fetchedAt > 3 * 86_400_000;
      const src = { live: 'live', cache: 'cached', snapshot: 'daily snapshot', 'stale-cache': 'offline cache' }[gd.source];
      info = `${gd.records.length.toLocaleString()} objects · ${src}${gd.fetchedAt ? ` · ${fmtAgo(t - gd.fetchedAt)}` : ''}`;
      if (stale) info = `<span class="warn">${info} (old)</span>`;
    } else if (on) info = 'loading…';
    else if (g.big) info = 'large download';
    return `<label class="group"><input type="checkbox" data-group="${g.id}" ${on ? 'checked' : ''}>
      <span>${g.label}</span><small>${info}</small></label>`;
  }).join('');
}

function renderStatus() {
  $('status').textContent = `Tracking ${totalTracked.toLocaleString()} objects · ${rows.length} above horizon · calc ${calcMs.toFixed(0)} ms`;
}

function renderPlace() {
  // places saved before time zones existed: recover the zone from a city label
  const tz = place.tz ?? (place.label.includes(', ') ? findCity(place.label)?.tz : undefined);
  setTimeZone(tz);
  $('loc-label').textContent = `${place.label} · ${place.lat.toFixed(3)}°, ${place.lon.toFixed(3)}°`;
  $('loc-tz').textContent = tz
    ? `Times are shown in local time there (${tzName(now())}).`
    : "Times are shown in this device's time zone.";
  $('clock-local').title = tz ? `Local time at ${place.label}` : 'Your device time';
  $('onboard').hidden = place.label !== DEFAULT_PLACE.label;
}

// "Next visible ISS pass" highlight
let highlightAt = 0;
let highlightPass: { norad: string; pass: Pass | undefined } | null = null;
function refreshHighlight(force = false) {
  const t = now();
  let iss: OMMJsonObject | undefined;
  for (const gd of data.values()) {
    iss = gd.records.find((r) => r.OBJECT_NAME === 'ISS (ZARYA)');
    if (iss) break;
  }
  const el = $('highlight');
  if (!iss) {
    el.hidden = true;
    return;
  }
  // predicting 3 days of passes is the slow part: redo it every 10 min, or when the pass is over
  const stale = highlightPass?.pass && highlightPass.pass.visibleTo! < t;
  if (force || stale || !highlightPass || t.getTime() - highlightAt > 10 * 60_000) {
    highlightAt = t.getTime();
    const rec = satrecFor(iss);
    const pass = rec ? predictPasses(rec, place, t, { hours: 72, minMaxEl: 10 }).find((p) => p.visibleFrom) : undefined;
    highlightPass = { norad: String(iss.NORAD_CAT_ID), pass };
  }
  const { pass, norad } = highlightPass!;
  el.hidden = false;
  el.innerHTML = pass
    ? `<b>${pass.visibleFrom! <= t ? 'The ISS is passing now!' : `Next visible ISS pass ${fmtIn(pass.visibleFrom!.getTime() - t.getTime())}:`}</b> ${fmtDay(pass.visibleFrom!, t)} ${fmtTime(pass.visibleFrom!, false)}, up to ${pass.maxEl.toFixed(0)}°, ${compass(pass.riseAz)} → ${compass(pass.setAz)} <button class="link" data-key="sat:${norad}">show</button>`
    : '<b>ISS:</b> no visible passes in the next 3 days from here.';
}

// ───────────────────────── events ─────────────────────────
const phone = matchMedia('(max-width: 899px)');

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const row = target.closest<HTMLElement>('[data-key]');
  if (row && !target.closest('canvas')) {
    const key = row.dataset.key === selected && row.tagName === 'TR' && !phone.matches ? null : row.dataset.key!;
    select(key);
    // on a phone, show the pick on the radar with its details sheet
    if (key && phone.matches) setTab('radar');
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'locate') locate(target.closest('button')!);
  if (action === 'pick-city') {
    setTab('settings');
    $('loc-input').focus();
  }
});

// ───────────────────────── tabs (phone layout) ─────────────────────────
type Tab = 'radar' | 'identify' | 'passes' | 'list' | 'settings';
function setTab(tab: Tab) {
  document.body.dataset.tab = tab;
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.classList.toggle('active', v.dataset.view === tab);
  for (const b of document.querySelectorAll<HTMLElement>('.tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (phone.matches) window.scrollTo({ top: 0 });
  whatsThat.setVisible(tab === 'identify' && phone.matches);
}
for (const b of document.querySelectorAll<HTMLElement>('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab as Tab));

// ───────────────────────── details sheet (phone layout) ─────────────────────────
const sheet = $('sheet');
$('sheet-close').addEventListener('click', () => select(null));
$('sheet-grip').addEventListener('click', () => sheet.classList.toggle('expanded'));
{
  // swipe the sheet's top bar: up expands, down shrinks or closes
  let startY: number | null = null;
  const bar = sheet.querySelector<HTMLElement>('.sheet-bar')!;
  bar.addEventListener('touchstart', (e) => (startY = e.touches[0].clientY), { passive: true });
  bar.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy < -30) sheet.classList.add('expanded');
    else if (dy > 30) {
      if (sheet.classList.contains('expanded')) sheet.classList.remove('expanded');
      else select(null);
    }
  });
}

$('groups').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const g = input.dataset.group!;
  if (input.checked) {
    enabled.add(g);
    void enableGroup(g);
  } else {
    enabled.delete(g);
    disableGroup(g);
  }
  save('groups', [...enabled]);
});

$<HTMLInputElement>('visible-only').checked = visibleOnly;
$('visible-only').addEventListener('change', (e) => {
  visibleOnly = (e.target as HTMLInputElement).checked;
  save('visibleOnly', visibleOnly);
  updateRadar();
  renderOverhead();
});

$<HTMLInputElement>('show-lines').checked = showLines;
$('show-lines').addEventListener('change', (e) => {
  showLines = (e.target as HTMLInputElement).checked;
  save('constellations', showLines);
  updateStars(now());
});

$<HTMLInputElement>('show-stars').checked = showStars;
$('show-stars').addEventListener('change', (e) => {
  showStars = (e.target as HTMLInputElement).checked;
  save('stars', showStars);
  if (!showStars && selected?.startsWith('star:')) select(null);
  updateStars(now());
  updateRadar();
});

function setPlace(p: Place) {
  place = p;
  save('place', p);
  passCache = null;
  schedulePasses();
  renderPlace();
  updateTrail(true);
  refreshHighlight(true);
  tick();
}

function locMsg(text: string, warn = false) {
  const el = $('loc-msg');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

function locate(btn: HTMLElement) {
  if (!navigator.geolocation) {
    setTab('settings');
    return locMsg('This browser cannot share its location. Type a city instead.', true);
  }
  const label = btn.textContent;
  btn.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.textContent = label;
      // ~100 m precision is plenty for the sky, and kinder to your privacy.
      const r = (x: number) => Math.round(x * 1000) / 1000;
      setPlace({ lat: r(pos.coords.latitude), lon: r(pos.coords.longitude), heightM: pos.coords.altitude ?? 0, label: 'My location' });
      locMsg('Location set. It stays in this browser.');
    },
    (err) => {
      btn.textContent = label;
      setTab('settings');
      locMsg(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission was refused. Type a city instead, or allow location in your browser settings.'
          : `Could not get your location (${err.message}). Type a city instead.`,
        true,
      );
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
  );
}

$('city-list').innerHTML = CITIES.map((c) => `<option value="${esc(cityLabel(c))}"></option>`).join('');

$('loc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('loc-input');
  const text = input.value;
  const ll = parseLatLon(text);
  const city = ll ? null : findCity(text);
  if (ll) setPlace({ ...ll, heightM: 0, label: 'Custom', tz: nearestCity(ll.lat, ll.lon)?.tz });
  else if (city) setPlace({ lat: city.lat, lon: city.lon, heightM: 0, label: cityLabel(city), tz: city.tz });
  else return locMsg('Not found. Try a big city nearby, or type latitude, longitude (e.g. 40.71, -74.01).', true);
  input.value = '';
  input.blur();
  locMsg('Location set. It stays in this browser.');
  if (phone.matches) setTab('radar');
});

// ───────────────────────── keep the screen on ─────────────────────────
type WakeLock = { release(): Promise<void> };
const wakeApi = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } }).wakeLock;
let keepAwake = store('keepAwake', false);
let wakeLock: WakeLock | null = null;
async function syncWakeLock() {
  if (!wakeApi) return;
  if (keepAwake && document.visibilityState === 'visible' && !wakeLock) {
    try {
      wakeLock = await wakeApi.request('screen');
      // the browser drops the lock whenever the tab is hidden
      (wakeLock as unknown as EventTarget).addEventListener?.('release', () => (wakeLock = null));
    } catch {
      wakeLock = null;
    }
  } else if (!keepAwake && wakeLock) {
    await wakeLock.release().catch(() => undefined);
    wakeLock = null;
  }
}
if (wakeApi) {
  $('wake-row').hidden = false;
  $<HTMLInputElement>('keep-awake').checked = keepAwake;
  $('keep-awake').addEventListener('change', (e) => {
    keepAwake = (e.target as HTMLInputElement).checked;
    save('keepAwake', keepAwake);
    void syncWakeLock();
  });
  document.addEventListener('visibilitychange', () => void syncWakeLock());
  void syncWakeLock();
}

function applyNight(on: boolean) {
  document.documentElement.dataset.night = on ? '1' : '';
  $('btn-night').setAttribute('aria-pressed', String(on));
  $('btn-night').setAttribute('aria-label', on ? 'Night mode on' : 'Night mode off');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#000000' : '#05080d');
  radar.refreshTheme();
}
let night = store('night', false);
applyNight(night);
$('btn-night').addEventListener('click', () => {
  night = !night;
  save('night', night);
  applyNight(night);
});

// ───────────────────────── first-visit guide & the big "Point at the sky" button ─────────────────────────
const guide = $('guide');
const guideSteps = [...guide.querySelectorAll<HTMLElement>('.guide-step')];
let guideAt = 0;
function showGuideStep(i: number) {
  guideAt = i;
  guideSteps.forEach((el, k) => (el.hidden = k !== i));
  guide.querySelectorAll('.guide-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
  $('guide-next').textContent = i === guideSteps.length - 1 ? "Let's go" : 'Next';
  $('guide-skip').hidden = i === guideSteps.length - 1;
}
function openGuide() {
  showGuideStep(0);
  guide.hidden = false;
  $('guide-next').focus();
}
function closeGuide() {
  guide.hidden = true;
  save('guided', true);
}
$('guide-next').addEventListener('click', () => (guideAt < guideSteps.length - 1 ? showGuideStep(guideAt + 1) : closeGuide()));
$('guide-skip').addEventListener('click', closeGuide);
guide.addEventListener('keydown', (e) => e.key === 'Escape' && closeGuide());
$('btn-help').addEventListener('click', openGuide);

// one tap: switch to the Point tab and turn on the motion sensors and the camera
$('btn-point').addEventListener('click', () => {
  setTab('identify');
  void whatsThat.begin(true);
});

// ───────────────────────── start ─────────────────────────
setTab('radar');
if (!store('guided', false) && !Number.isFinite(simStart)) openGuide();
renderPlace();
renderPasses();
renderGroups();
renderDetails();
if (Number.isFinite(simStart)) $('sim-note').hidden = false;
void syncClock();
void loadStars();
for (const g of enabled) void enableGroup(g);
tick();
setInterval(tick, 1000);
setInterval(() => refreshHighlight(), 60_000);
setInterval(() => {
  if (passesState === 'done' && now().getTime() - passesAt > 30 * 60_000) schedulePasses();
  else renderPasses();
}, 30_000);
