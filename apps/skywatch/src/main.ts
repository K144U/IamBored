import './style.css';
import type { OMMJsonObject, SatRec } from 'satellite.js';
import { GROUPS, loadGroup, type GroupData } from './data/celestrak';
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
import { compass, esc, fmtAgo, fmtDay, fmtDuration, fmtTime, fmtUtc } from './ui/format';
import { Radar, type RadarObject } from './ui/radar';
import type { SatSample, WorkerRequest, WorkerResponse } from './workers/propagate.worker';

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
type Place = Observer & { label: string };
const DEFAULT_PLACE: Place = { lat: 51.4769, lon: -0.0005, heightM: 45, label: 'Greenwich (default)' };

function initialPlace(): Place {
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon, heightM: 0, label: 'From link' };
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
  renderGroups();
}

// ───────────────────────── radar ─────────────────────────
const radar = new Radar($<HTMLCanvasElement>('radar'), (key) => select(key));

function updateRadar() {
  const objs: RadarObject[] = [];
  for (const r of rows) {
    if (visibleOnly && r.status !== 'visible' && r.key !== selected) continue;
    objs.push({ key: r.key, kind: 'sat', az: r.az, el: r.el, label: r.name, status: r.status, important: r.important });
  }
  for (const b of bodies) {
    objs.push({ key: `body:${b.id}`, kind: 'body', az: b.az, el: b.el, label: b.name, symbol: b.symbol, mag: b.mag });
  }
  radar.setObjects(objs);
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
        <dt>Direction</dt><dd>${b.az.toFixed(1)}° ${compass(b.az)}</dd>
        <dt>Elevation</dt><dd>${b.el.toFixed(1)}°${b.el < 0 ? ' (below horizon)' : ''}</dd>
        <dt>Brightness</dt><dd>mag ${b.mag.toFixed(1)}</dd>
        ${b.phase !== undefined ? `<dt>Illuminated</dt><dd>${Math.round(b.phase * 100)} %</dd>` : ''}
      </dl>
      ${b.id === 'sun' ? '<p class="warn">Never look at the Sun directly.</p>' : ''}`;
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
      <dt>Direction</dt><dd>${s.az.toFixed(1)}° ${compass(s.az)}</dd>
      <dt>Elevation</dt><dd>${s.el.toFixed(1)}°</dd>
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
              <td>${p.visibleFrom ? `<span class="star" title="Visible ${fmtTime(p.visibleFrom, false)}–${fmtTime(p.visibleTo!, false)}">★ visible</span>` : ''}</td></tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="hint">No passes above 10° in the next 48 h.</p>'
    }`;
}

function renderSky() {
  const sun = bodies.find((b) => b.id === 'sun');
  $('sky-state').textContent = sun ? `${skyState(sun.el)} · Sun ${sun.el.toFixed(0)}°` : '';
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
  $('loc-label').textContent = `${place.label} · ${place.lat.toFixed(3)}°, ${place.lon.toFixed(3)}°`;
  $('loc-banner').hidden = place.label !== DEFAULT_PLACE.label;
}

// "Next visible ISS pass" highlight
let highlightAt = 0;
function refreshHighlight(force = false) {
  const t = now();
  if (!force && t.getTime() - highlightAt < 10 * 60_000) return;
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
  highlightAt = t.getTime();
  const rec = satrecFor(iss);
  const pass = rec ? predictPasses(rec, place, t, { hours: 72, minMaxEl: 10 }).find((p) => p.visibleFrom) : undefined;
  el.hidden = false;
  el.innerHTML = pass
    ? `<b>Next visible ISS pass:</b> ${fmtDay(pass.visibleFrom!, t)} ${fmtTime(pass.visibleFrom!, false)}, up to ${pass.maxEl.toFixed(0)}°, ${compass(pass.riseAz)} → ${compass(pass.setAz)} <button class="link" data-key="sat:${iss.NORAD_CAT_ID}">show</button>`
    : '<b>ISS:</b> no visible passes in the next 3 days from here.';
}

// ───────────────────────── events ─────────────────────────
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const row = target.closest<HTMLElement>('[data-key]');
  if (row && !target.closest('canvas')) select(row.dataset.key === selected && row.tagName === 'TR' ? null : row.dataset.key!);
});

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

function setPlace(p: Place) {
  place = p;
  save('place', p);
  passCache = null;
  renderPlace();
  updateTrail(true);
  refreshHighlight(true);
  tick();
}

$('btn-geo').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation is not available in this browser.');
  $('btn-geo').textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('btn-geo').textContent = 'Use my location';
      // ~100 m precision is plenty for the sky, and kinder to your privacy.
      const r = (x: number) => Math.round(x * 1000) / 1000;
      setPlace({ lat: r(pos.coords.latitude), lon: r(pos.coords.longitude), heightM: pos.coords.altitude ?? 0, label: 'My location' });
    },
    (err) => {
      $('btn-geo').textContent = 'Use my location';
      alert(`Could not get your location: ${err.message}`);
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
  );
});

$('loc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const m = $<HTMLInputElement>('loc-input').value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  const lat = m ? Number(m[1]) : Number.NaN;
  const lon = m ? Number(m[2]) : Number.NaN;
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return alert('Enter latitude, longitude, e.g. 40.71, -74.01');
  setPlace({ lat, lon, heightM: 0, label: 'Custom' });
});

function applyNight(on: boolean) {
  document.documentElement.dataset.night = on ? '1' : '';
  $('btn-night').setAttribute('aria-pressed', String(on));
  radar.refreshTheme();
}
let night = store('night', false);
applyNight(night);
$('btn-night').addEventListener('click', () => {
  night = !night;
  save('night', night);
  applyNight(night);
});

// ───────────────────────── start ─────────────────────────
renderPlace();
renderGroups();
renderDetails();
if (Number.isFinite(simStart)) $('sim-note').hidden = false;
void syncClock();
for (const g of enabled) void enableGroup(g);
tick();
setInterval(tick, 1000);
setInterval(() => refreshHighlight(), 60_000);
