import './style.css';
import { replay, type ClaimResult, type Game } from './game/claim';
import { DEMO_ORIGIN, DEMO_PLAYERS, demoActivities } from './game/demo';
import { parseActivityFile } from './game/parse';
import { store } from './game/store';
import { DEFAULT_RULES, type Activity, type Player } from './game/types';
import { earlierVersions, resolveVersions } from './game/versions';
import { GameMap } from './ui/map';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const YOU: Player = { id: 'you', name: 'You', color: '#ff2e88' };
const PALETTE = ['#2f80ff', '#ffb000', '#14b86e', '#9b51e0', '#ff6a00', '#00b3c7', '#e0245e', '#6b7a00'];

// ───────────────────────── state ─────────────────────────
let players: Player[] = [YOU];
let activities: Activity[] = [];
let game: Game;
let results: ClaimResult[] = [];
let activePlayer = YOU.id;
const map = new GameMap($('map'));

// ───────────────────────── phone layout: tabs ─────────────────────────
const phone = matchMedia('(max-width: 899px)');
type Tab = 'map' | 'add' | 'board' | 'runs' | 'help';
function setTab(tab: Tab) {
  document.body.dataset.tab = tab;
  for (const v of document.querySelectorAll<HTMLElement>('[data-view]')) v.classList.toggle('active', v.dataset.view === tab);
  for (const b of document.querySelectorAll<HTMLElement>('.tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (tab === 'help' && phone.matches) document.querySelector<HTMLDetailsElement>('.rules')!.open = true;
  document.querySelector('.side')?.scrollTo({ top: 0 });
}
for (const b of document.querySelectorAll<HTMLElement>('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab as Tab));
/** on a phone, animations happen on the map tab */
const showMap = () => {
  if (phone.matches) setTab('map');
};

/** Replay the current version of every run (older uploads of the same run don't count). */
function rebuild() {
  return replay(resolveVersions(activities).current, DEFAULT_RULES);
}

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function refresh() {
  const r = rebuild();
  game = r.game;
  results = r.results;
  map.renderTerritory(game, players, Date.now());
  renderPlayers();
  renderLog();
}

// ───────────────────────── rendering ─────────────────────────
const playerById = (id: string) => players.find((p) => p.id === id);

function renderPlayers() {
  const now = Date.now();
  const stats = game.stats(now);
  const km = new Map<string, number>();
  const runs = new Map<string, number>();
  for (const r of results) {
    if (!r.accepted) continue;
    km.set(r.playerId, (km.get(r.playerId) ?? 0) + r.distanceM / 1000);
    runs.set(r.playerId, (runs.get(r.playerId) ?? 0) + 1);
  }
  const sorted = [...players].sort((a, b) => (stats.get(b.id)?.cells ?? 0) - (stats.get(a.id)?.cells ?? 0));
  $('players').innerHTML = sorted
    .map((p, i) => {
      const s = stats.get(p.id);
      return `<li class="player ${p.id === activePlayer ? 'active' : ''}" data-player="${p.id}">
        <span class="rank">${i + 1}</span>
        <span class="swatch" style="background:${p.color}"></span>
        <span class="pname">${esc(p.name)}</span>
        <span class="pstat"><b>${(s?.areaKm2 ?? 0).toFixed(2)}</b> km²</span>
        <span class="pmeta">${s?.cells ?? 0} cells${s?.fading ? ` · ${s.fading} fading` : ''} · ${runs.get(p.id) ?? 0} runs · ${(km.get(p.id) ?? 0).toFixed(1)} km</span>
      </li>`;
    })
    .join('');
  const active = playerById(activePlayer)!;
  $('active-player').innerHTML = `<span class="swatch" style="background:${active.color}"></span> ${esc(active.name)}`;
  // map chip on phones: who you are, how much you own, your rank
  const rank = sorted.findIndex((p) => p.id === activePlayer) + 1;
  const mine = stats.get(activePlayer);
  $('who').innerHTML = `<span class="hex" style="color:${active.color}">⬢</span> ${esc(active.name)} <small>${(mine?.areaKm2 ?? 0).toFixed(2)} km² · #${rank} of ${players.length}</small>`;
  const n = results.filter((r) => r.accepted).length;
  $('runs-badge').hidden = n === 0;
  $('runs-badge').textContent = String(n);
  $('welcome').hidden = activities.length > 0;
}

function pace(kmh: number) {
  if (!kmh) return '';
  const minPerKm = 60 / kmh;
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

function describe(r: ClaimResult): string {
  if (!r.accepted) return `<span class="bad">Rejected: ${esc(r.reason ?? '')}</span>`;
  const parts: string[] = [];
  if (r.claimed.length) parts.push(`<b>+${(r.claimed.length * game.cellAreaKm2).toFixed(3)} km²</b> (${r.claimed.length} cells)`);
  else parts.push('No loop closed, so no new land');
  const stolen = Object.entries(r.stolen)
    .map(([id, n]) => `${n} from ${esc(playerById(id)?.name ?? id)}`)
    .join(', ');
  if (stolen) parts.push(`stole ${stolen}`);
  if (r.refreshed) parts.push(`refreshed ${r.refreshed}`);
  return parts.join(' · ');
}

function versionsHtml(current: Activity, older: Activity[]) {
  const km = (a: Activity) => {
    let m = 0;
    for (let i = 1; i < a.points.length; i++) {
      const p = a.points[i - 1];
      const q = a.points[i];
      const dy = (q.lat - p.lat) * 111_320;
      const dx = (q.lon - p.lon) * 111_320 * Math.cos((p.lat * Math.PI) / 180);
      m += Math.hypot(dx, dy);
    }
    return (m / 1000).toFixed(2);
  };
  return `<details class="versions">
    <summary>${older.length} older upload${older.length > 1 ? 's' : ''} of this run</summary>
    <ul>${older
      .map(
        (o) => `<li><span>${esc(o.name)} · ${km(o)} km · ${o.points.length} points${o.uploadedAt ? ` · uploaded ${esc(fmtWhen(o.uploadedAt))}` : ''}</span>
        <span class="v-actions"><button class="link" data-use="${o.id}">Use this version</button><button class="link danger" data-delete-version="${o.id}">Delete</button></span></li>`,
      )
      .join('')}</ul>
    <p class="v-note">Only the latest version (${km(current)} km) counts on the map.</p>
  </details>`;
}

function renderLog() {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const { older } = resolveVersions(activities);
  const list = [...results].reverse();
  $('log').innerHTML = list.length
    ? list
        .map((r) => {
          const a = byId.get(r.activityId)!;
          const p = playerById(r.playerId);
          const when = fmtWhen(a.startedAt);
          const prev = older.get(a.id) ?? [];
          return `<li class="entry ${r.accepted ? '' : 'rejected'}">
            <div class="entry-head">
              <span class="swatch" style="background:${p?.color ?? '#888'}"></span>
              <b>${esc(p?.name ?? '?')}</b> · ${esc(a.name)}
              ${prev.length ? `<span class="latest" title="Uploaded ${a.uploadedAt ? esc(fmtWhen(a.uploadedAt)) : ''}">Latest of ${prev.length + 1} uploads</span>` : ''}
              <span class="when">${when}</span>
            </div>
            <div class="entry-body">${r.accepted ? `${(r.distanceM / 1000).toFixed(2)} km · ${pace(r.avgKmh)} · ` : ''}${describe(r)}</div>
            ${r.warnings.length ? `<div class="entry-warn">${r.warnings.map(esc).join(' ')}</div>` : ''}
            <div class="entry-actions">
              ${r.accepted ? `<button class="link" data-replay="${r.activityId}">▶ Replay</button>` : ''}
              <button class="link danger" data-delete="${r.activityId}">Remove${prev.length ? ' all versions' : ''}</button>
            </div>
            ${prev.length ? versionsHtml(a, prev) : ''}
          </li>`;
        })
        .join('')
    : '<li class="empty">No runs yet. Drop a GPX file or load the demo.</li>';
}

function toast(html: string, kind: 'ok' | 'bad' = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 5200);
  setTimeout(() => el.remove(), 5800);
}

// ───────────────────────── actions ─────────────────────────
async function addActivities(incoming: Activity[], animate = true, fitAll = false) {
  if (!incoming.length) return;
  const ids = new Set(incoming.map((a) => a.id));
  const before = rebuild();
  const previous = activities.filter((a) => !ids.has(a.id));
  // a new export of a run that's already here (e.g. cropped on Strava) replaces it
  for (const a of incoming) {
    const older = earlierVersions(a, previous);
    if (!older.length || !a.uploadedAt) continue;
    const last = older.sort((x, y) => (y.uploadedAt ?? 0) - (x.uploadedAt ?? 0))[0];
    toast(
      `<b>${esc(a.name)}</b> is a newer version of a run you already added${last.uploadedAt ? ` (uploaded ${esc(fmtWhen(last.uploadedAt))})` : ''}. ` +
        'The new one now counts; the old one is kept under Runs.',
    );
  }
  activities = [...previous, ...incoming];
  await store.putActivities(incoming);
  const after = rebuild();
  // only uploads that ended up as a run's current version have results
  const newActs = incoming.filter((a) => after.results.some((r) => r.activityId === a.id));
  if (!newActs.length) {
    refresh();
    return;
  }
  // The newest of the uploaded runs gets the animation.
  const newest = [...newActs].sort((a, b) => b.startedAt - a.startedAt)[0];
  const res = after.results.find((r) => r.activityId === newest.id)!;
  for (const a of newActs) {
    const r = after.results.find((x) => x.activityId === a.id)!;
    if (!r.accepted) toast(`<b>${esc(a.name)}</b>: ${esc(r.reason ?? 'rejected')}`, 'bad');
  }
  if (animate && res.accepted) {
    showMap();
    map.renderTerritory(before.game, players, Date.now());
    map.fitTo([res]);
    const color = playerById(res.playerId)?.color ?? '#333';
    await map.replay(res, color);
    toast(`<b>${esc(newest.name)}</b>: ${describe(res)}`);
  } else {
    showMap();
    map.fitTo(after.results.filter((r) => r.accepted));
  }
  refresh();
  map.showTrail(res.accepted ? res : null, playerById(res.playerId)?.color);
  if (fitAll) map.fitTo(results.filter((r) => r.accepted));
}

function fingerprint(a: Activity) {
  const p = a.points[0];
  return `${a.startedAt}:${a.points.length}:${p?.lat.toFixed(5)}:${p?.lon.toFixed(5)}`;
}

async function handleFiles(files: FileList | File[]) {
  const known = new Set(activities.map(fingerprint));
  const out: Activity[] = [];
  for (const file of Array.from(files)) {
    try {
      const parsed = parseActivityFile(await file.text(), file.name);
      const a: Activity = {
        id: crypto.randomUUID(),
        playerId: activePlayer,
        name: parsed.name,
        startedAt: parsed.points.find((p) => p.t !== undefined)?.t ?? Date.now(),
        source: parsed.format,
        points: parsed.points,
        // + index keeps the order of a multi-file pick
        uploadedAt: Date.now() + out.length,
      };
      if (known.has(fingerprint(a))) {
        toast(`<b>${esc(file.name)}</b> is already on the map.`, 'bad');
        continue;
      }
      known.add(fingerprint(a));
      out.push(a);
    } catch (err) {
      toast(esc((err as Error).message), 'bad');
    }
  }
  await addActivities(out);
}

async function loadDemo() {
  const missing = DEMO_PLAYERS.filter((d) => !players.some((p) => p.id === d.id));
  players = [...players, ...missing];
  await store.putPlayers(players);
  const demo = demoActivities(YOU.id);
  activities = activities.filter((a) => !a.id.startsWith('demo-'));
  // all but the last run instantly, then animate the newest one
  const last = demo[demo.length - 1];
  activities.push(...demo.slice(0, -1));
  await store.putActivities(demo.slice(0, -1));
  refresh();
  await addActivities([last], true, true);
  toast(`Demo loaded at ${DEMO_ORIGIN.label}. Tap ▶ Replay on any run.`);
}

// ───────────────────────── events ─────────────────────────
const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files.length) void handleFiles(e.dataTransfer.files);
});
// allow dropping anywhere on the page too
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files.length && !drop.contains(e.target as Node)) void handleFiles(e.dataTransfer.files);
});
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) void handleFiles(input.files);
  input.value = '';
});

$('btn-demo').addEventListener('click', () => void loadDemo());
document.querySelector('[data-demo]')?.addEventListener('click', () => void loadDemo());
$('who').addEventListener('click', () => setTab('board'));
$('btn-reset').addEventListener('click', async () => {
  if (!confirm('Delete all runs and players from this browser?')) return;
  map.stopAnimation();
  await store.clear();
  players = [YOU];
  activities = [];
  activePlayer = YOU.id;
  await store.putPlayers(players);
  refresh();
  map.showTrail(null);
});

$('players').addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>('[data-player]');
  if (!li) return;
  activePlayer = li.dataset.player!;
  renderPlayers();
  if (phone.matches) toast(`New runs will be added as <b>${esc(playerById(activePlayer)!.name)}</b>.`);
});

$('add-player').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('new-player');
  const name = input.value.trim().slice(0, 24);
  if (!name) return;
  const p: Player = { id: crypto.randomUUID(), name, color: PALETTE[(players.length - 1) % PALETTE.length] };
  players.push(p);
  activePlayer = p.id;
  input.value = '';
  await store.putPlayers(players);
  renderPlayers();
});

$('log').addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const rid = t.dataset.replay;
  const did = t.dataset.delete;
  if (rid) {
    const r = results.find((x) => x.activityId === rid);
    if (!r) return;
    showMap();
    map.fitTo([r]);
    const color = playerById(r.playerId)?.color ?? '#333';
    await map.replay(r, color);
    map.showTrail(r, color);
  } else if (did) {
    // removing a run removes all its uploaded versions
    const gone = [did, ...(resolveVersions(activities).older.get(did) ?? []).map((a) => a.id)];
    activities = activities.filter((a) => !gone.includes(a.id));
    for (const id of gone) await store.deleteActivity(id);
    refresh();
    map.showTrail(null);
  } else if (t.dataset.use) {
    // make an older version current again by marking it as the latest upload
    const a = activities.find((x) => x.id === t.dataset.use);
    if (!a) return;
    a.uploadedAt = Date.now();
    await store.putActivities([a]);
    refresh();
    toast(`Now using the version of <b>${esc(a.name)}</b> with ${a.points.length} GPS points.`);
  } else if (t.dataset.deleteVersion) {
    const id = t.dataset.deleteVersion;
    activities = activities.filter((a) => a.id !== id);
    await store.deleteActivity(id);
    refresh();
  }
});

map.onCellClick(DEFAULT_RULES.res, (h3, latlng) => {
  const c = game.cells.get(h3);
  const now = Date.now();
  if (!c || game.status(c, now) === 'neutral') return;
  const p = playerById(c.owner);
  const st = game.status(c, now);
  const days = Math.floor((now - c.refreshedAt) / 86_400_000);
  map.map.openPopup(
    `<b style="color:${p?.color}">${esc(p?.name ?? '?')}</b><br>${st === 'fading' ? 'Fading: anyone can grab it by running through' : 'Owned'}<br><small>last visited ${days === 0 ? 'today' : `${days} day${days > 1 ? 's' : ''} ago`}</small>`,
    latlng,
  );
});

// ───────────────────────── start ─────────────────────────
setTab('map');
(async () => {
  const saved = await store.load();
  if (saved.players.length) players = saved.players.some((p) => p.id === YOU.id) ? saved.players : [YOU, ...saved.players];
  else await store.putPlayers(players);
  activities = saved.activities;
  refresh();
  if (results.some((r) => r.accepted)) map.fitTo(results.filter((r) => r.accepted));
})();
