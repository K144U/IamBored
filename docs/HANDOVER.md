# Handover

> Last updated: 2026-11-04, at the end of the second build session (SkyWatch bright stars, v0.4 done, then the mobile-first redesign).
> Branch: `claude/vigilant-noether-hxgibq` (continues the first session's `claude/peaceful-wright-2tlzr7`; `main` has only the initial commit; no PR opened yet).

### Session log
| # | Branch | What shipped |
|---|---|---|
| 1 | `claude/peaceful-wright-2tlzr7` | Plans, SkyWatch v0.1 (+ passes, worker, Sun/Moon/planets, night mode), LoopLand v0.1 sandbox |
| 2 | `claude/vigilant-noether-hxgibq` | SkyWatch bright stars (925 stars, mag ≤ 4.5), completing v0.4; then a mobile-first redesign (tabs, details sheet, city picker, manifest) |

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
deploy/pages.yml          GitHub Pages workflow, NOT active yet (see §5)
docs/SKYWATCH_PLAN.md     full SkyWatch design + milestones (v0.1 ticked)
docs/LOOPLAND_PLAN.md     full LoopLand design + milestones (v0.1 ticked)
docs/IDEAS.md             idea backlog
```

## 3. SkyWatch: state
**Built:** v0.1 and v0.4, plus most of v0.2.
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
  - pass prediction: 30 s scan, then bisection for rise/set and golden-section search for the max, plus the visible window
- Sky (`src/engine/sky.ts`): Sun, Moon (phase), Mercury…Saturn via astronomy-engine, plus twilight state.
- **Phone layout** (owner asked for "mobile-centric, easy on the phone"). Everything is CSS under `@media (max-width: 899px)` plus a little JS in `main.ts`; desktop is unchanged.
  - Bottom tab bar (`<nav class="tabs">`). `setTab()` sets `body[data-tab]` and adds `.active` to every `[data-view="<tab>"]`; on phones `.view:not(.active)` is hidden. The details card (`#sheet`) has no `data-view`: on phones it's a fixed bottom sheet shown when `body.has-sel` (set in `select()`), only on the Radar tab. Grip/swipe toggles `.expanded`; swipe down or ✕ deselects.
  - Tapping a row in Overhead/Planets (or the ISS "show" link) selects it and jumps to Radar.
  - First-run card `#onboard` shows while the place is the Greenwich default. Location uses `data-action="locate"` buttons (two of them) and an inline `#loc-msg` instead of `alert()`. City search: `src/data/cities.ts` (~100 cities, accent-insensitive prefix match, tested) + `<datalist>`.
  - Touch: radar hit radius 28 px for satellites/bodies and 20 px for stars when `pointerType === 'touch'`. Buttons/toggles/rows ≥ 44 px; inputs 16 px (iOS zooms on smaller).
  - Header on phones: logo + name, local time, sky state (Sun altitude hidden < 480 px), icon-only night button. `viewport-fit=cover` + `env(safe-area-inset-*)` for notches and the home bar.
  - Landscape phones (height ≤ 500 px): radar left at full height, banner + legend right, details as a right-hand side panel, compact tabs.
  - "Keep the screen on" (Screen Wake Lock API; the row only appears where supported; re-acquired on `visibilitychange`).
  - `public/manifest.webmanifest` + `icon.svg`, `icon-192/512.png`, `apple-touch-icon.png` (PNGs rendered from the SVG with Playwright). No service worker yet, so it is "add to home screen", not offline.
  - Night mode also switches `<meta name="theme-color">`.
- Stars (`src/engine/stars.ts`, data in `public/data/stars.json`):
  - 925 stars with mag ≤ 4.5 from HYG v4.1: RA/Dec (J2000), mag, B−V, proper name, Bayer designation ("α² Cen"), constellation. 48 KB, 18 KB gzipped, fetched once at startup; if it fails the app just has no stars.
  - One `Rotation_EQJ_HOR` matrix per tick, then a 3×3 multiply per star, plus refraction. ~900 stars cost < 1 ms, so this runs on the main thread, not in the worker.
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
- 20 unit tests, including standing under the satellite giving ~90° elevation, the antipode giving < −80°, OMM ≡ TLE, and pass rise/set at 0° ± 0.1°
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
- Times show in the *device's* timezone, not the observer location's.
- Stars ignore proper motion and annual aberration (~20″). Fine for a radar; revisit for v0.5 matching only if needed.
- Phone layout not yet tried on a **real** iPhone/Android (only Playwright emulation): check the sheet swipe, safe areas in "Add to Home Screen" mode, and the `<datalist>` city picker on iOS Safari.
- No constellation lines (a nice next touch: add a small stick-figure list to `stars.json`, keyed by HIP numbers).
- Pass list is computed on the main thread (fine for one satellite).
- The `?t=` simulated clock advances in real time; there is no speed-up.

**Recommended next (owner-facing list, agreed in session 2):**
- Quick UX wins: a **Passes** tab (all visible passes for the ISS + brightest sats, with "add to calendar" .ics); a "what's that bright thing?" tap hint on first visit; haptic tick on select (Android); pinch-zoom on the radar.
- Service worker (v0.8) so it opens offline at a dark site with no signal; precache `stars.json` and the last TLEs.
- v0.5 "What's That?" is the big one, and it's phone-only by nature, so the new layout is its home: add it as a 5th tab.

**Next (from `docs/SKYWATCH_PLAN.md`):**
1. v0.3 aircraft layer: test CORS on adsb.lol / airplanes.live / OpenSky first. **This can't be done from the cloud sandbox** (all three are 403'd by its proxy), so it needs the owner's browser or a local session.
2. v0.5 "What's That?" (phone sensors, calibration, matcher). This is the headline feature. Stars are now available as match candidates (`starPositions`).
3. v0.6 Starlink trains.
4. v0.7 sound mode.
5. v0.8 PWA and alerts (precache `stars.json` too).

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
- UI:
  - `src/ui/map.ts`: Leaflet canvas renderer, CARTO Voyager tiles, `cellsToMultiPolygon` per player, dashed style for fading land, replay animation
  - `src/main.ts`: upload, hot-seat players, leaderboard, run log with replay and remove, cell popups
- Demo: `src/game/demo.ts`, a synthetic seeded season in Central Park with players Blaze and Nova. It shows a steal, a revenge excursion, a figure-8, an out-and-back that claims nothing, and fading land.

**Verified:**
- 23 tests:
  - claim, out-and-back, open U, auto-close, figure-8, noise loops
  - jitter stability within ±15 %
  - steal, excursion, donut rule
  - fade, neutral and run-through grab, refresh
  - anti-cheat
  - determinism, flood waves
  - GPX/TCX parsing
- Performance: a 3 km × 3 km loop (~4.3k cells) processes in ~140 ms.
- Playwright desktop and mobile runs, persistence across reload, production sub-path build.

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
- **h3-js 4.5:** `polygonToCells([[lat,lng]…], res)`, `cellsToMultiPolygon(cells, true)` (GeoJSON order), `gridPathCells`, `gridDisk`, `getHexagonAreaAvg(res, 'km2')`.

## 8. Open questions for the owner
1. SkyWatch: constellation lines on the radar, or keep it to dots and names?
2. SkyWatch radar orientation: keep E on the right (map-style), or switch to "looking up" (E on the left) as an option?
3. LoopLand name: keep "LoopLand"? (Alternatives are in plan §15.)
4. Should the sandbox get a JSON export/import so friends can share a map before a server exists?
5. Open a PR to `main` now, or keep building on the branch?
