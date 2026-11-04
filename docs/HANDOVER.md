# Handover

> Last updated: 2026-11-04, at the end of the first build session.
> Branch: `claude/peaceful-wright-2tlzr7` (all work is here; `main` has only the initial commit; no PR opened yet).

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
deploy/pages.yml          GitHub Pages workflow, NOT active yet (see §5)
docs/SKYWATCH_PLAN.md     full SkyWatch design + milestones (v0.1 ticked)
docs/LOOPLAND_PLAN.md     full LoopLand design + milestones (v0.1 ticked)
docs/IDEAS.md             idea backlog
```

## 3. SkyWatch: state
**Built:** v0.1, plus parts of v0.2 and v0.4.
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
- UI (`src/main.ts`):
  - overhead table, details panel with 48 h passes, "next visible ISS pass" banner
  - location via geolocation (rounded to 3 decimals) or manual entry
  - red night mode, same-origin `HEAD` clock sync
  - URL params `?lat=&lon=&t=`

**Verified:**
- 12 unit tests, including standing under the satellite giving ~90° elevation, the antipode giving < −80°, OMM ≡ TLE, and pass rise/set at 0° ± 0.1°
- Playwright screenshots at desktop and iPhone 13 sizes, no horizontal overflow
- production build served from a sub-path, with the snapshot fallback exercised

**Not verified (do these first):**
- **CelesTrak CORS from a real browser.** The sandbox can't reach CelesTrak. It's assumed to allow cross-origin requests. If it doesn't, the app silently uses the snapshot; the fix is a Cloudflare Worker proxy (plan §5/§12).
- **Field accuracy:** compare ISS passes with Heavens-Above on the live site (the v0.1 "done when" item).
- Starlink group performance on a mid-range phone (~10k objects in the worker).

**Known limitations:**
- Times show in the *device's* timezone, not the observer location's.
- No bright-star catalog yet (v0.4).
- Pass list is computed on the main thread (fine for one satellite).
- The `?t=` simulated clock advances in real time; there is no speed-up.

**Next (from `docs/SKYWATCH_PLAN.md`):**
1. v0.3 aircraft layer: test CORS on adsb.lol / airplanes.live / OpenSky first.
2. v0.4 bright stars (`public/data/stars.json`, mag ≤ 4.5).
3. v0.5 "What's That?" (phone sensors, calibration, matcher). This is the headline feature.
4. v0.6 Starlink trains.
5. v0.7 sound mode.
6. v0.8 PWA and alerts.

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
- **Network:** `registry.npmjs.org` works. `celestrak.org`, `basemaps.cartocdn.com` and `tile.openstreetmap.org` are blocked.
- **Playwright:** preinstalled. Run scripts with `NODE_PATH=$(npm root -g) node script.cjs`.
- **CelesTrak in screenshots:** intercept it with `page.route('https://celestrak.org/**', …)` and fulfill with fixture OMM JSON. Abort tile requests.
- **SkyWatch fixture:** `apps/skywatch/src/test/fixtures.ts` holds `ISS_2019`, the satellite.js README TLE as OMM, with epoch 2019-06-05.
  - Visible-ISS scene: `?t=2019-06-05T12:43:30Z&lat=39.9&lon=116.4` (Beijing; the ISS is sunlit, the sky is in nautical twilight)
  - Daytime overhead pass from London: about 2019-06-05T17:14Z
- **Busy radar:** clone the fixture with varied `RA_OF_ASC_NODE`, `MEAN_ANOMALY`, `INCLINATION` and `MEAN_MOTION` (name them `TEST-SAT n`). Use this in screenshot scripts only; never ship it.
- **LoopLand:** click `#btn-demo` and wait about 6 s for the animation.
- **Expected build warning:** Vite warns that `node:module` / `node:worker_threads` are "externalized" from satellite.js's WASM build. It's harmless: the WASM bulk API isn't used and is tree-shaken.
- **happy-dom:** doesn't support `getElementsByTagNameNS('*', …)`. That's why `parse.ts` scans by `localName`.

## 7. Key library facts (verified in this session)
- **satellite.js 7.1:**
  - ESM only
  - `json2satrec(omm)`, `propagate(satrec, date, { communityDecayCheckEnabled })` returns `{ position, velocity } | null`
  - `shadowFraction(sunEciAU, satEciKm)` gives 0 (lit) to 1 (umbra)
  - `sunPos(jday(date)).rsun` is an `{x,y,z}` object (it was an array in v6)
  - `gstime(date)`
- **astronomy-engine 2.1:** `Equator(body, date, observer, true, true)` → `Horizon(date, observer, ra, dec, 'normal')`; `Illumination(body, date).mag/.phase_fraction`.
- **h3-js 4.5:** `polygonToCells([[lat,lng]…], res)`, `cellsToMultiPolygon(cells, true)` (GeoJSON order), `gridPathCells`, `gridDisk`, `getHexagonAreaAvg(res, 'km2')`.

## 8. Open questions for the owner
1. SkyWatch radar orientation: keep E on the right (map-style), or switch to "looking up" (E on the left) as an option?
2. LoopLand name: keep "LoopLand"? (Alternatives are in plan §15.)
3. Should the sandbox get a JSON export/import so friends can share a map before a server exists?
4. Open a PR to `main` now, or keep building on the branch?
