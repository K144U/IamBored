# Handover

> Last updated: 2026-11-04, at the end of the second build session (SkyWatch v0.4 stars, phone-first redesign, Passes, What's That? v0.5, smaller touches; LoopLand phone layout).
> Branch: `claude/vigilant-noether-hxgibq` (continues the first session's `claude/peaceful-wright-2tlzr7`; `main` has only the initial commit; no PR opened yet).

### Session log
| # | Branch | What shipped |
|---|---|---|
| 1 | `claude/peaceful-wright-2tlzr7` | Plans, SkyWatch v0.1 (+ passes, worker, Sun/Moon/planets, night mode), LoopLand v0.1 sandbox |
| 2 | `claude/vigilant-noether-hxgibq` | SkyWatch: bright stars (v0.4); mobile-first redesign (tabs, details sheet, city picker, manifest); **Passes** tab with .ics; **What's That?** (v0.5); constellation lines, radar zoom, haptics, observer time zones. LoopLand: phone layout (full-screen map, tabs, ＋ upload, welcome card, manifest) |

## 1. Context: the owner and how we got here
- The owner was **idea hunting** for cool OSINT / hacker-style projects, then decided to build two of them. The full brainstorm is saved in `docs/IDEAS.md`.
- **Hardware:** a PC plus a spare laptop that can be a server. **No SDR, Raspberry Pi or ESP32**, so everything uses public data and the browser.
- Preferences seen so far:
  - likes "hacker-esque" visuals and sky/space and OSINT topics
  - wants things deployable as **webpages**
  - asks for detailed plans, pushed to the repo
- Parked idea: **FlagRun** (CTF IRL for runners), in `docs/IDEAS.md` under "Parked". It might later run as events on the LoopLand map.

## 2. Repo map
```
CLAUDE.md                 short guide (auto-loaded by Claude Code)
README.md                 project index, run + deploy instructions
apps/skywatch/            SkyWatch app (+ README with features/roadmap)
apps/loopland/            LoopLand app (+ README with rules/code map)
site/index.html           landing page linking both apps
scripts/build-site.mjs    builds both apps → dist/ (+ .nojekyll)
scripts/fetch-tle-snapshot.mjs  daily CelesTrak snapshot → apps/skywatch/public/data/tle/ (gitignored)
scripts/build-stars.mjs   one-off HYG → apps/skywatch/public/data/stars.json (committed, CC BY-SA 4.0)
scripts/build-constellations.mjs  one-off d3-celestial → apps/skywatch/public/data/constellations.json (committed, BSD-3)
deploy/pages.yml          GitHub Pages workflow, NOT active yet (see §5)
docs/SKYWATCH_PLAN.md     full SkyWatch design + milestones (v0.1, v0.2, v0.4, v0.5 ticked)
docs/LOOPLAND_PLAN.md     full LoopLand design + milestones (v0.1 ticked)
docs/IDEAS.md             idea backlog
```

## 3. SkyWatch: state
**Built:** v0.1, v0.2 (no magnitude model), v0.4, v0.5 (needs field testing).
- Polar radar canvas (`src/ui/radar.ts`): zenith in the center, N up, **E right** (map-style, not the "looking up" convention), rotating sweep, label collision avoidance, tap to select.
- Data (`src/data/celestrak.ts`):
  - CelesTrak **OMM JSON** per group (`stations`, `visual`, `last-30-days`, `starlink`)
  - IndexedDB cache, fresh for **2 h** (CelesTrak's politeness rule)
  - fallbacks: stale cache, then `./data/tle/<group>.json` (the daily CI snapshot)
  - CelesTrak sends plain text when it rate-limits, so the JSON check fails safely
- Propagation runs in a **Web Worker** (`src/workers/propagate.worker.ts`), once per second, and returns only objects above the horizon.
- Engine (`src/engine/satellites.ts`):
  - SGP4 via satellite.js 7, with `communityDecayCheckEnabled`
  - shadow via `shadowFraction` + `sunPos`
  - status = visible / daylight (sun > −6°) / eclipsed / below
  - pass prediction: 30 s scan (60 s in the worker's Passes search), then bisection for rise/set and golden-section search for the max, plus the visible window (with its start/end az/el). `addVisibility` exits early when the Sun is above −4° at rise, max and set (most daytime passes)
- Sky (`src/engine/sky.ts`): Sun, Moon (phase), Mercury…Saturn via astronomy-engine, plus twilight state.
- **Phone layout** (owner asked for "mobile-centric, easy on the phone"). Everything is CSS under `@media (max-width: 899px)` plus a little JS in `main.ts`; desktop is unchanged.
  - Bottom tab bar (`<nav class="tabs">`): **Radar · Identify · Passes · Up now · Settings** ("Up now" holds both the Overhead list and the Sun/Moon/planets table, both `data-view="list"`). `setTab()` sets `body[data-tab]` and adds `.active` to every `[data-view="<tab>"]`; on phones `.view:not(.active)` is hidden. The details card (`#sheet`) has no `data-view`: on phones it's a fixed bottom sheet shown when `body.has-sel` (set in `select()`), only on the Radar tab. Grip/swipe toggles `.expanded`; swipe down or ✕ deselects.
  - Tapping a row in Up now/Passes (or the ISS "show" link) selects it and jumps to Radar.
  - First-run card `#onboard` shows while the place is the Greenwich default. Location uses `data-action="locate"` buttons (two of them) and an inline `#loc-msg` instead of `alert()`. City search: `src/data/cities.ts` (~100 cities, accent-insensitive prefix match, tested) + `<datalist>`.
  - Touch: radar hit radius 28 px for satellites/bodies and 20 px for stars when `pointerType === 'touch'`. Buttons/toggles/rows ≥ 44 px; inputs 16 px (iOS zooms on smaller).
  - Header on phones: logo + name, local time, sky state (Sun altitude hidden < 480 px), icon-only night button. `viewport-fit=cover` + `env(safe-area-inset-*)` for notches and the home bar.
  - Landscape phones (height ≤ 500 px): radar left at full height, banner + legend right, details as a right-hand side panel, compact tabs.
  - "Keep the screen on" (Screen Wake Lock API; the row only appears where supported; re-acquired on `visibilitychange`).
  - `public/manifest.webmanifest` + `icon.svg`, `icon-192/512.png`, `apple-touch-icon.png` (PNGs rendered from the SVG with Playwright). No service worker yet, so it is "add to home screen", not offline.
  - Night mode also switches `<meta name="theme-color">`.
- **Passes** (`main.ts` "visible passes" section + worker `passes` request): the worker runs `predictPasses` (48 h, 60 s step) for every satellite in `stations` + `visual` and returns only passes with a visible window (~1.3 s for 31 sats on a desktop; expect a few seconds on a phone). Debounced 400 ms after group loads / place changes, recomputed every 30 min. Rows grouped by day with countdowns, "now!" for live passes, a stations-only filter, and 📅 per-pass or "add all" `.ics` (`src/ui/ics.ts`, RFC 5545: CRLF, escaping, 75-octet folding, 10-min `VALARM`; tested). The 📅 listener runs in the capture phase and stops propagation so the row isn't also selected.
- **What's That?** (`src/ui/whatsthat.ts`, engine in `src/engine/pointing.ts`, `matcher.ts`, `declination.ts`; plan §7):
  - Start button → `DeviceOrientationEvent.requestPermission()` if it exists (iOS, and **newer Chromium too**, which refuses it headless). It listens to `deviceorientationabsolute` + `deviceorientation` regardless and only falls back to **drag mode** if no event arrives within 1.5 s.
  - Pointing: full rotation matrix `Rz(α)Rx(β)Ry(γ)`, camera = −z; screen axes from `screen.orientation.angle`; 200 ms vector smoothing. Android: absolute alpha (magnetic). iOS: relative alpha + a slowly-averaged offset to `webkitCompassHeading`, only updated while |el| < 55°. Then **declination** (magvar/WMM2025, year clamped to 2025–2030) and the **calibration** offset (dAz, dEl).
  - Candidates (rebuilt every 500 ms in `main.ts` `wtCandidates`): satellites with status `visible`, Sun/Moon/planets, stars ≤ mag 3, each with a 1-second velocity vector. Sun has prior 0 (never offered; a warning shows when pointing within 25° of it).
  - Score = Gaussian(sep, σ) × prior × motion; σ = 12° raw, 3° calibrated (valid 12 h / 100 km), ×0.5 in drag mode. "Nothing obvious" when the best spatial term < e^−2 (~2σ).
  - **Track**: hold the button, `fitMotion` averages the first and last quarter of samples; the motion term weights matches for 20 s. **Calibrate**: picks the best Moon/planet/star (mag < 1.6) within 25° of the raw direction.
  - Overlay: pinhole projection with a 64° long-side FOV, horizon + 30°/60° circles, cardinal points, constellation lines, objects with 10 s satellite paths, an arrow (or ring) to the radar's selected object, error circle = σ. Optional rear camera (`getUserMedia`), red-filtered in night mode; stopped when the tab is left or the page hidden.
  - Desktop never shows the view (`.wt` hidden ≥ 900 px).
- **Radar zoom**: `Radar` handles pointer events itself (`touch-action: none`): pinch (two pointers), drag-to-pan when zoomed, wheel, double-tap toggles 2.5× / reset; +/−/⟲ buttons. Taps select only when the pointer didn't move > 8 px and no second finger joined. More star names as you zoom (`labelMag` 1 → 3.5). `navigator.vibrate(8)` on a new selection.
- **Constellation lines**: `public/data/constellations.json` (89 figures, 19 KB, 7.7 KB gzipped), drawn on the radar and in Identify once `starMagLimit ≥ 3` (nautical twilight); toggle "Constellation lines" (`skywatch:constellations`). BSD-3: licence text is inside the JSON, credit in footer + README.
- **Time zones**: `Place.tz` (IANA). Cities carry a zone; `?lat&lon` and typed coordinates borrow `nearestCity()` within 500 km; "My location" uses the device zone. `format.ts` `setTimeZone()` drives `fmtTime`/`fmtDay` (day boundaries in that zone). Old saved places recover the zone from a "City, Country" label.
- Stars (`src/engine/stars.ts`, data in `public/data/stars.json`):
  - 925 stars with mag ≤ 4.5 from HYG v4.1: RA/Dec (J2000), mag, B−V, proper name, Bayer designation ("α² Cen"), constellation. Undesignated companions are named after their primary ("Capella B"). 48 KB, 18 KB gzipped, fetched once at startup; if it fails the app just has no stars.
  - One `Rotation_EQJ_HOR` matrix per tick (`horizonMatrix`), then a 3×3 multiply per star (`toAzEl`), plus refraction. ~900 stars cost < 1 ms, so this runs on the main thread, not in the worker.
  - Shown by sky brightness (`starMagLimit`): none while the Sun is above −2°, mag ≤ 1 in civil twilight, ≤ 3 in nautical, all after that. A selected star always stays.
  - Radar: dot size and opacity by magnitude, colour from B−V (all red in night mode via `--star-tint`). Stars with mag ≤ 1 and a proper name get *optional* labels, which are skipped instead of overlapping (`label(..., optional=true)`). Clicks prefer satellites/bodies (16 px) over stars (12 px).
  - Details panel: name, designation, constellation (88-name table in `stars.ts`), direction, elevation, mag, colour. Toggle "Show bright stars" under the legend (stored as `skywatch:stars`).
  - HYG is **CC BY-SA 4.0**: attribution is in the footer, the JSON header and the app README. Keep it if the file changes.
- UI (`src/main.ts`):
  - overhead table, details panel with 48 h passes, "next visible ISS pass" banner
  - location via geolocation (rounded to 3 decimals) or manual entry
  - red night mode, same-origin `HEAD` clock sync
  - URL params `?lat=&lon=&t=`

**Verified:**
- 51 unit tests, including standing under the satellite giving ~90° elevation, the antipode giving < −80°, OMM ≡ TLE, and pass rise/set at 0° ± 0.1°
- What's That? math: device angles → camera direction (flat = down, upright = horizon, zenith stable at any alpha), screen axes under rotation, smoothing across north, pinhole projection; matcher priorities, "nothing obvious", motion tie-break, motion fit from noisy samples, calibration across north and its expiry; declination vs WMM2025 for London/NYC/Beijing
- Playwright What's That?: drag fallback faces Jupiter; simulated `deviceorientationabsolute` events aimed at Jupiter with an 8° compass error → Jupiter 60 % at 3.9°; Calibrate → "compass was 8° off", re-aim → Jupiter 100 % at 0.6°; empty sky → "Nothing obvious"; Radar button → radar with the sheet
- Passes: 66 visible passes for 31 fake sats in 1.3 s; .ics downloads; tapping a pass jumps to the radar; times in Beijing time for a Beijing link
- radar zoom buttons, pan without selecting, reset; constellation figures pass through Betelgeuse and Rigel within 0.05°; time zones incl. a day boundary in Tokyo
- stars: matches astronomy-engine's own `DefineStar` → `Equator` → `Horizon` within 0.01° for stars above the horizon; Polaris at elevation ≈ latitude and due north at 10°–70° latitude; catalogue sanity (Sirius first, 88 constellations)
- phone flows in Playwright (iPhone 13, iPhone SE, iPhone 13 landscape, desktop 1280 px): first run → Pick a city → "tok" → Tokyo → back on Radar; ISS "show" → sheet → expand → close; list row → Radar with sheet; Planets tab; night mode. No horizontal overflow, no console errors.
- star layer screenshots: London January night (Orion and Sirius due south, Capella at the zenith), Beijing twilight, London noon (no stars), red night mode, iPhone 13
- Playwright screenshots at desktop and iPhone 13 sizes, no horizontal overflow
- production build served from a sub-path, with the snapshot fallback exercised

**Not verified (do these first):**
- **CelesTrak CORS from a real browser.** The sandbox can't reach CelesTrak. It's assumed to allow cross-origin requests. If it doesn't, the app silently uses the snapshot; the fix is a Cloudflare Worker proxy (plan §5/§12).
- **Field accuracy:** compare ISS passes with Heavens-Above on the live site (the v0.1 "done when" item).
- Starlink group performance on a mid-range phone (~10k objects in the worker).

**Known limitations:**
- What's That? has **not been tried on a real phone**. Things to check first: iOS heading (`webkitCompassHeading` is assumed to follow the back camera when upright), Android's absolute alpha being magnetic (declination is added on both), landscape AR overlay, the 64° FOV guess, and the camera overlay's alignment.
- Pass list magnitudes: none (OMM has no standard magnitude); the ISS and stations are highlighted instead.
- Typed coordinates far from any listed city fall back to the device's time zone.
- Stars ignore proper motion and annual aberration (~20″). Fine for a radar; revisit for v0.5 matching only if needed.
- Phone layout not yet tried on a **real** iPhone/Android (only Playwright emulation): check the sheet swipe, safe areas in "Add to Home Screen" mode, and the `<datalist>` city picker on iOS Safari.
- The details sheet's pass table (one satellite) is still computed on the main thread; fine.
- The `?t=` simulated clock advances in real time; there is no speed-up.

**Next:**
1. **Field-test What's That?** on an Android phone and an iPhone at night (the v0.5 "done when"). Log results in `docs/ACCURACY.md`.
2. v0.8 service worker so it opens offline at a dark site; precache `stars.json`, `constellations.json` and the last TLEs.
3. v0.3 aircraft layer: test CORS on adsb.lol / airplanes.live / OpenSky first. **This can't be done from the cloud sandbox** (all three are 403'd by its proxy), so it needs the owner's browser or a local session. Aircraft then become What's That? candidates.
4. What's That? extras from the plan: multi-point calibration, FOV calibration (drag a marker onto the Moon), `AbsoluteOrientationSensor`, magnetometer-disturbance detection on Android.
5. v0.6 Starlink trains, v0.7 sound mode.

## 4. LoopLand: state
**Built:** v0.1 sandbox (no server).
- Engine (`src/game/claim.ts`, `Game.apply`). For each run:
  1. Clean the track (`clean.ts`).
  2. Draw a gap-free hex **trail** (`gridPathCells`). Auto-close if start and end are ≤ 75 m apart.
  3. **Walls** = trail + the player's *own land touching the trail* (connected components).
  4. Flood fill from the border of a bounding-box region. Unreached non-wall cells are **enclosed**.
  5. Keep only enclosed pockets that touch the trail and have ≥ 3 cells. This is the **donut rule**: a hole inside your land isn't refilled unless you run around it.
  6. Claim the pockets, plus trail cells bordering a pocket, plus *fading* cells of others on the trail. Steal from previous owners.
  7. **Refresh:** own cells on the trail, plus own land enclosed by the trail alone (a second flood with trail-only walls), so re-running a loop keeps its interior fresh.
  8. `waves` = BFS order for the replay animation.
- Rules: `DEFAULT_RULES` in `src/game/types.ts`. H3 res 11, fade 14 d, neutral 30 d, auto-close 75 m, min pocket 3 cells, point jump > 30 km/h dropped, average > 22 km/h rejected, gap > 200 m splits the track, no timestamps → rejected.
- Decay is evaluated at each run's end time (in the engine) and at `Date.now()` (for display).
- The sandbox replays all runs **sorted by `startedAt`**. The multiplayer plan says *upload order* plus a 48 h backdating limit. Change this when a server exists.
- Parsing (`parse.ts`): GPX and TCX via `DOMParser`, matching on `localName` (namespace-agnostic). FIT is not supported (the user gets a message to export GPX).
- Storage (`store.ts`): IndexedDB stores raw players and activities. The map is always rebuilt by replay, which is deterministic.
- **Run versions** (`versions.ts`, owner asked "if people upload from Strava, how do we make sure the latest version is marked?"): Strava GPX has no activity id, so two uploads are the *same run* when they're the same player and their time ranges overlap by ≥ 50 % of the shorter one (min 1 min). `Activity.uploadedAt` is set on upload; `resolveVersions()` keeps the newest upload of each run as current (old data without `uploadedAt` loses to any timestamped upload), and only current versions are replayed. UI: a toast on re-upload, a "Latest of N uploads" badge, an "older uploads" list with **Use this version** (bumps its `uploadedAt`) and **Delete**; "Remove all versions" deletes the group. An identical file is still refused by the fingerprint check. With the Strava API later, key on the activity id instead (plan v0.3).
- **Phone layout** (< 900 px, same pattern as SkyWatch): the map is fixed full-screen; `.side` becomes a full-screen page over it for every tab except Map. Tabs **Map · Add run · Board · Runs · How to** (`setTab` + `[data-view]`). A pink ＋ (`<label for="file">`) opens the file picker from the map; uploads, the demo and ▶ Replay switch to the Map tab before animating (`showMap()`). A `#who` chip shows the active player, area and rank (tap → Board). A `#welcome` card shows while there are no activities. Leaflet's zoom buttons are hidden on phones (pinch). Toasts sit at the top. "Getting a GPX file on a phone" explains Strava/Garmin exports. Manifest + icons in `public/`.
- UI:
  - `src/ui/map.ts`: Leaflet canvas renderer, CARTO Voyager tiles, `cellsToMultiPolygon` per player, dashed style for fading land, replay animation
  - `src/main.ts`: upload, hot-seat players, leaderboard, run log with replay and remove, cell popups
- Demo: `src/game/demo.ts`, a synthetic seeded season in Central Park with players Blaze and Nova. It shows a steal, a revenge excursion, a figure-8, an out-and-back that claims nothing, and fading land.

**Verified:**
- 29 tests:
  - claim, out-and-back, open U, auto-close, figure-8, noise loops
  - jitter stability within ±15 %
  - steal, excursion, donut rule
  - fade, neutral and run-through grab, refresh
  - anti-cheat
  - determinism, flood waves
  - GPX/TCX parsing
- Performance: a 3 km × 3 km loop (~4.3k cells) processes in ~140 ms.
- Playwright desktop and mobile runs, persistence across reload, production sub-path build.
- Run versions: 6 unit tests (crop = same run, back-to-back/other player/small overlap = different, newest wins, re-upload of the original wins, untimestamped data, lookup); Playwright: upload a loop, then an edited export → toast + one run "Latest of 2 uploads" + no double area; Use this version survives reload; Remove all versions empties the list.
- Phone flows (iPhone 13): ＋ → file chooser → GPX loop claimed with the animation on the map; Add → demo → map; chip → Board; Runs → ▶ Replay → map; How to; desktop unchanged (no tabs/＋). No overflow, no console errors.

**Not verified:**
- **Real GPX files from the owner.** The v0.1 "done when" is "your own last 10 runs produce a sensible map".
- Very large territories (100k+ cells) in the browser.
- CARTO tile usage limits if the site gets traffic.

**Next (from `docs/LOOPLAND_PLAN.md`):**
1. Playtest with real runs, then tune the balancing table (plan §11).
2. v0.2: backend on the spare laptop behind a Cloudflare Tunnel, magic-link auth, shared map. **Privacy zones are mandatory before anyone else joins.**
3. v0.3 auto-import. **Check Strava's late-2024 API terms first**: they restrict showing one user's data to others.
4. Then crews and seasons, share cards, live arena.

**Ideas noted but not built:**
- sandbox export/import JSON (for sharing with friends)
- a FIT parser
- deck.gl `H3HexagonLayer` if Leaflet gets slow

## 5. Deployment status
- `deploy/pages.yml` is a complete workflow: typecheck, test, snapshot TLEs (continue-on-error), build, then deploy Pages from `main`; also scheduled daily at 04:23 UTC.
- **It is not active.** The cloud session's GitHub token was refused when creating `.github/workflows/*` ("no `workflow` scope"). The owner must:
  1. create `.github/workflows/pages.yml` on GitHub with that content
  2. set Settings → Pages → Source: GitHub Actions
  3. merge to `main`
- The site will be at `https://k144u.github.io/IamBored/` (landing), with `/skywatch/` and `/loopland/` under it.
- The owner hasn't asked for a PR yet. Ask before opening one.

## 6. Testing in the cloud sandbox
- **Network:** `registry.npmjs.org` and `raw.githubusercontent.com` work. `celestrak.org`, `basemaps.cartocdn.com`, `tile.openstreetmap.org`, `cdn.jsdelivr.net` and the flight APIs (`api.adsb.lol`, `api.airplanes.live`, `opensky-network.org`) are blocked.
- **Playwright:** preinstalled. Run scripts with `NODE_PATH=$(npm root -g) node script.cjs`.
- **CelesTrak in screenshots:** intercept it with `page.route('https://celestrak.org/**', …)` and fulfill with fixture OMM JSON. Abort tile requests.
- **SkyWatch fixture:** `apps/skywatch/src/test/fixtures.ts` holds `ISS_2019`, the satellite.js README TLE as OMM, with epoch 2019-06-05.
  - Visible-ISS scene: `?t=2019-06-05T12:43:30Z&lat=39.9&lon=116.4` (Beijing; the ISS is sunlit, the sky is in nautical twilight)
  - Daytime overhead pass from London: about 2019-06-05T17:14Z
- **Busy radar:** clone the fixture with varied `RA_OF_ASC_NODE`, `MEAN_ANOMALY`, `INCLINATION` and `MEAN_MOTION` (name them `TEST-SAT n`). Use this in screenshot scripts only; never ship it.
- **LoopLand:** click `#btn-demo` and wait about 6 s for the animation.
- **Phone screenshots:** use `devices['iPhone 13']`, `['iPhone SE']`, `['iPhone 13 landscape']`. Click `.tab[data-tab="list"]` etc. to switch sections; `#highlight button.link` selects the ISS and opens the sheet; `#sheet-grip` expands it.
- **What's That? in Playwright:** click `.tab[data-tab="identify"]`, then `#wt-go`. Without events it enters drag mode after 1.5 s. To simulate a phone, dispatch `new DeviceOrientationEvent('deviceorientationabsolute', { alpha, beta, gamma: 0, absolute: true })` on `window` (Chromium supports constructing it). Upright portrait aiming at true azimuth A and elevation E: `beta = 90 + E`, `alpha = 360 − (A − declination)` (London 2026 declination ≈ +1.2°).
- **Passes test data:** route `GROUP=visual` to 30 cloned `TEST-SAT n` orbits so the list is busy; `.pass-row` appears after ~1–2 s.
- **LoopLand phone:** `page.waitForEvent('filechooser')` + click `.fab`, then `chooser.setFiles(gpx)`.
- **Dev servers:** start them with the Bash tool's background mode (`npm run dev:skywatch` / `dev:loopland`); a `nohup … &` started inside a normal call can die with that call.
- **Star scenes:** `?t=2026-01-15T23:00:00Z&lat=51.5&lon=-0.1` (London winter night: Orion, Sirius, Jupiter in Gemini) and `?t=2026-01-15T12:00:00Z&…` (noon: stars hidden).
- **Playwright pitfall:** `locator(...).textContent()` on an element that doesn't exist waits 30 s. In polling loops use `page.evaluate(() => document.querySelector(...)?.textContent)`.
- **Shell pitfall:** `pkill -f vite` (or any pattern that appears in your own command line) kills the tool's own shell (exit 144). Use `pgrep -af` to look first, then `kill <pid>`.
- **Expected build warning:** Vite warns that `node:module` / `node:worker_threads` are "externalized" from satellite.js's WASM build. It's harmless: the WASM bulk API isn't used and is tree-shaken.
- **happy-dom:** doesn't support `getElementsByTagNameNS('*', …)`. That's why `parse.ts` scans by `localName`.

## 7. Key library facts (verified in this session)
- **satellite.js 7.1:**
  - ESM only
  - `json2satrec(omm)`, `propagate(satrec, date, { communityDecayCheckEnabled })` returns `{ position, velocity } | null`
  - `shadowFraction(sunEciAU, satEciKm)` gives 0 (lit) to 1 (umbra)
  - `sunPos(jday(date)).rsun` is an `{x,y,z}` object (it was an array in v6)
  - `gstime(date)`
- **astronomy-engine 2.1:**
  - `Equator(body, date, observer, true, true)` → `Horizon(date, observer, ra, dec, 'normal')`; `Illumination(body, date).mag/.phase_fraction`
  - `Rotation_EQJ_HOR(date, observer).rot` is stored transposed: `out_i = Σ_j rot[j][i] · in_j`. The horizontal frame is x = north, y = **west**, z = up, so `az = atan2(−y, x)`.
  - `Horizon(..., 'normal')` still adds ~0.57° of refraction to objects far below the horizon. Compare positions only above ~1°.
  - `DefineStar(Body.Star1, raHours, decDeg, distLy)` makes a fixed star usable with `Equator` (handy as a test reference).
- **magvar 2.2** (MIT, WMM2025, CommonJS; typed in `src/types/magvar.d.ts`): `magvar(lat, lon, altKm, decimalYearOrDate)`, east positive; prints a warning outside 2025–2030, so pass a clamped decimal year.
- **DeviceOrientation:** Earth frame x = east, y = north, z = up; alpha counts **anticlockwise** (heading = 360 − alpha for a flat phone). Chromium now also exposes `DeviceOrientationEvent.requestPermission`.
- **h3-js 4.5:** `polygonToCells([[lat,lng]…], res)`, `cellsToMultiPolygon(cells, true)` (GeoJSON order), `gridPathCells`, `gridDisk`, `getHexagonAreaAvg(res, 'km2')`.

## 8. Open questions for the owner
1. SkyWatch radar orientation: keep E on the right (map-style), or switch to "looking up" (E on the left) as an option?
2. LoopLand name: keep "LoopLand"? (Alternatives are in plan §15.)
3. Should the sandbox get a JSON export/import so friends can share a map before a server exists?
4. Open a PR to `main` now, or keep building on the branch?
