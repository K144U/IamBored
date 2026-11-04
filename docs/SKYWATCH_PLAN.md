# SkyWatch: Detailed Project Plan

> Status: **v0.1 built** (plus pass predictions from v0.2) and **v0.4 sky bodies built**. Code: [`apps/skywatch/`](../apps/skywatch/).
> Overview and accuracy summary: see [README](../README.md).

---

## 1. Vision

A free webpage that answers two questions for anyone, anywhere:

1. **"What's up there right now?"** Satellites, aircraft, planets and stars above you, live.
2. **"What's *that*?"** Point your phone at a light in the sky (or toward a sound) and get an answer.

It should feel like a hacker-style mission-control screen, but be simple enough for a non-technical friend to open from a link.

### Goals
- Runs entirely in the browser, hosted for free on a static host
- Works on phones (sensors, camera) and desktops (big dashboard)
- Honest about uncertainty: confidence scores, not fake certainty
- Works offline for predictions once data is cached

### Non-goals (for now)
- Tracking people or private devices
- Requiring an SDR or any hardware
- Accounts, logins or a backend database
- Native mobile apps (the PWA covers this)

---

## 2. User stories

| # | As a… | I want to… | So that… |
|---|---|---|---|
| U1 | stargazer | see what satellites are overhead right now | I know what I'm looking at |
| U2 | stargazer | get the next visible ISS / bright passes | I can go outside at the right time |
| U3 | curious person | point my phone at a light and get its name | I stop wondering "plane or satellite?" |
| U4 | person hearing a plane | find out which aircraft it is | I know what's flying over my house |
| U5 | aviation nerd | see interesting aircraft (military, emergency, rare) | I spot cool traffic |
| U6 | anyone | see a fresh Starlink train coming | I can show friends the "string of lights" |
| U7 | user with page closed | get a notification before a great pass | I don't miss it |
| U8 | desktop user | leave a full-screen dashboard running | it looks like mission control |

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Build | **Vite + TypeScript** | Fast, zero-config, static output for Pages |
| UI | Vanilla TS + small components (revisit Svelte if UI grows) | Minimal deps, easy to read |
| Satellite math | **satellite.js** (SGP4/SDP4, supports OMM JSON) | Standard JS SGP4 implementation |
| Sky bodies | **astronomy-engine** | Accurate Sun/Moon/planets, horizon coordinates, refraction |
| Magnetic declination | **geomagnetism** (World Magnetic Model) | Magnetic → true north |
| Map | **Leaflet** or **MapLibre GL** + free tiles (OpenFreeMap / OSM, respecting usage policy) | Lightweight 2D map |
| Sky radar / AR | **Canvas 2D** | Fast enough, full control of the look |
| Heavy compute | **Web Worker** | Keep UI at 60 fps while propagating thousands of satellites |
| Audio ML (later) | **TensorFlow.js + YAMNet** | On-device sound classification (jet / helicopter / thunder…) |
| Offline / install | Service Worker + Web App Manifest (PWA) | Home-screen app, cached data |
| Tests | **Vitest** | Unit + golden-file tests for the math |
| Hosting | **GitHub Pages** (or Cloudflare Pages) | Free + HTTPS (needed for sensors) |
| Optional edge | **Cloudflare Worker** (+ KV, Cron) | CORS proxy, caching, push alerts |

---

## 4. Repository layout (planned; as built, the app lives in `apps/skywatch/`)

```
/
├─ README.md
├─ docs/
│  ├─ SKYWATCH_PLAN.md   ← this file
│  ├─ IDEAS.md           ← brainstorm backlog
│  └─ ACCURACY.md        ← validation results (later)
├─ app/                  ← the SkyWatch web app (Vite project)
│  ├─ index.html
│  ├─ public/
│  │  ├─ manifest.webmanifest
│  │  ├─ icons/
│  │  └─ data/
│  │     ├─ stars.json          ← bright star catalog (mag ≤ 4.5)
│  │     └─ tle-snapshot.json   ← daily fallback (GitHub Action)
│  └─ src/
│     ├─ main.ts
│     ├─ state/            ← app state, settings, location
│     ├─ data/             ← fetchers + cache (TLE, aircraft)
│     ├─ engine/
│     │  ├─ satellites.ts  ← propagation, look angles
│     │  ├─ visibility.ts  ← sunlit / dark-sky / magnitude
│     │  ├─ passes.ts      ← pass prediction
│     │  ├─ aircraft.ts    ← ENU conversion, extrapolation
│     │  ├─ sky.ts         ← Sun, Moon, planets, stars
│     │  └─ coords.ts      ← shared geodesy / vector math
│     ├─ identify/
│     │  ├─ sensors.ts     ← orientation → pointing vector
│     │  ├─ calibration.ts
│     │  ├─ matcher.ts     ← scoring + motion matching
│     │  └─ sound.ts       ← sound mode
│     ├─ workers/
│     │  └─ propagate.worker.ts
│     ├─ ui/
│     │  ├─ radar.ts       ← polar sky plot
│     │  ├─ map.ts
│     │  ├─ ar.ts          ← camera overlay
│     │  ├─ passes-list.ts
│     │  └─ theme.css      ← "mission control" look
│     └─ sw.ts             ← service worker
├─ worker/               ← optional Cloudflare Worker (proxy, alerts)
└─ .github/workflows/
   ├─ deploy.yml         ← build + publish to Pages
   └─ tle-snapshot.yml   ← daily TLE snapshot
```

---

## 5. Data layer

### 5.1 Satellites (CelesTrak)
- **Endpoint:** `https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=json` (OMM JSON)
- **Groups used:**
  - `stations` (ISS, Tiangong)
  - `visual` (~100–150 brightest)
  - `starlink`
  - `last-30-days` (new launches/trains)
  - `active` (everything, optional, large)
- **Supplemental (operator) data** for Starlink: CelesTrak `supplemental/sup-gp.php?FILE=starlink&FORMAT=json`. This is more accurate around maneuvers and for new trains.
- **Politeness:** CelesTrak updates roughly every 2 h and asks clients not to re-download more often. Cache per group with a timestamp in IndexedDB and refetch only if older than 2 h.
- **Fallback:** if the fetch fails, use `public/data/tle-snapshot.json`, refreshed daily by a GitHub Action.
- **Staleness warning:** show the TLE age in the UI and warn if it's older than 3 days.

### 5.2 Aircraft (ADS-B aggregators)
| Source | Query style | Notes |
|---|---|---|
| adsb.lol | `/v2/point/{lat}/{lon}/{radius_nm}` | Open data, community-run |
| airplanes.live | `/v2/point/{lat}/{lon}/{radius_nm}` | Rate limit ~1 req/s |
| OpenSky | `/api/states/all?lamin&lomin&lamax&lomax` | Anonymous limits are strict |

- **To verify in v0.3:** CORS headers, rate limits and terms of use for each. If browsers are blocked, route through the Cloudflare Worker (cache responses ~5 s per area tile, so many users share one upstream call).
- Poll every 5–10 s while the aircraft layer is visible, and never when the tab is hidden (Page Visibility API).
- Fields used: hex, callsign, lat, lon, `alt_geom` (prefer over `alt_baro`), ground speed, track, vertical rate, squawk, category, type, `seen_pos` (age of the position).
- Route (origin → destination) comes from the aggregator's route lookup when available; show "unknown" otherwise.

### 5.3 Sky bodies
- Sun, Moon, planets: computed live with astronomy-engine. No network needed.
- Stars: bundled `public/data/stars.json`, built once by `scripts/build-stars.mjs` from the HYG database v4.1 (Hipparcos + Yale BSC + Gliese; CC BY-SA 4.0): RA, Dec, magnitude, B−V colour, name, Bayer designation, constellation. 925 stars with mag ≤ 4.5, 48 KB (18 KB gzipped).

### 5.4 Location & time
- Geolocation API, with manual entry or map click as a fallback (and for privacy).
- **Clock sync:** read the `Date` header from a CelesTrak or Pages response and store the offset from the device clock. This matters because an overhead satellite moves ~1°/s.

---

## 6. Engine design

### 6.1 Coordinates (shared)
- Observer geodetic (lat, lon, h) → ECEF (WGS-84)
- Target ECEF → **ENU** (East-North-Up) relative to the observer → **azimuth, elevation, range**
- Unit pointing vectors in ENU are the common currency. Every "where is X" and "where am I pointing" becomes a 3D unit vector, and the angular separation is `acos(a·b)`.

### 6.2 Satellite propagation
- `json2satrec` / `twoline2satrec` → `propagate(satrec, date)` → ECI → `eciToEcf` (with `gstime`) → ENU → az/el/range.
- **Performance:** up to ~10k Starlinks plus visual sats. Propagate everything in a **Web Worker** every ~2 s, keep positions plus velocities, and interpolate linearly for 60 fps rendering in between.
- Pre-filter: skip satellites whose last computed elevation was < −20° and that are not near rise.

### 6.3 Visibility & brightness
A satellite is **naked-eye visible** when all three hold:
1. **Above horizon:** elevation > 0° (> 10° for "good").
2. **Sunlit:** the satellite is outside Earth's shadow. Use a cylindrical shadow model first and upgrade to a conical umbra/penumbra model if needed.
3. **Observer in darkness:** Sun altitude < −6° (civil twilight end). Fade the confidence between −6° and −12°.

**Magnitude estimate:**
`mag = std_mag + 5·log10(range_km / 1000) − 2.5·log10(phase_function(β))`
- `std_mag` is the standard magnitude at 1000 km, 50 % illuminated. Use per-satellite values when known, defaults per class otherwise (ISS ≈ −1.3, Starlink ≈ 5 operational / brighter while raising orbit).
- Limit for "visible": mag ≤ ~4.5 in a dark sky, lower in cities or with moonlight (user-selectable "sky quality" setting).

### 6.4 Pass prediction
- Coarse scan from now to now + 48 h in 60 s steps (30 s for LEO), looking for elevation sign changes.
- Refine rise and set by **bisection** to ~1 s, and max elevation by **golden-section search**.
- For each pass, record the start, max and end az/el and times, max brightness, and the visible segment (sunlit and dark) within the pass.
- Rank passes by brightness × max elevation × visible duration.

### 6.5 Starlink trains & flare hunter
- **Train detection:** take the satellites from the newest launch (same international designator prefix, e.g. `2026-123`). If they're clustered in the same orbit with small along-track spacing, mark them as a "train". Predict its visible passes like any other satellite.
- **Glint flags:** compute the Sun–satellite–observer geometry. Mark "possible flash" when the satellite is near the specular reflection angle for a typical panel and antenna orientation. This is a **heuristic**, clearly labeled.
- Iridium flares: show an explainer card ("why you won't see these anymore") instead of a feature.

### 6.6 Aircraft
- Geodetic (lat, lon, alt_geom) → ECEF → ENU → az/el/range. Curvature is included automatically.
- **Extrapolate to now:** `pos_now = pos + velocity × (now − t_position)` using ground speed, track and vertical rate.
- **Interesting traffic rules:**
  - squawk 7500, 7600 or 7700
  - military hex ranges or callsign patterns
  - category A7 (rotorcraft)
  - rare types (watchlist JSON)
  - very low altitude near the user

### 6.7 Sky bodies
- astronomy-engine `Equator()` → `Horizon()` with refraction for the Sun, Moon and planets.
- Stars (built in `src/engine/stars.ts`): J2000 unit vectors, then one `Rotation_EQJ_HOR(time, observer)` matrix per frame (precession + nutation + Earth rotation), a 3×3 multiply per star, and `Refraction('normal', el)`. Matches astronomy-engine's own `Equator()`→`Horizon()` within 0.01° (tested). Proper motion and annual aberration (~20″) are ignored.
- Moon phase and illumination are also used as input for the sky brightness estimate.

---

## 7. "What's That?" design

### 7.1 Pointing vector from sensors
- **Preferred:** `AbsoluteOrientationSensor` (Generic Sensor API, Chrome Android), which gives a quaternion relative to Earth.
- **Fallback:** `deviceorientationabsolute` (Android) or `deviceorientation` + `webkitCompassHeading` (iOS, after `DeviceOrientationEvent.requestPermission()` on a user tap).
- Build the full **rotation matrix** from alpha/beta/gamma (or the quaternion). The camera points along the device's **−Z axis**. Transform that into ENU to get az/el.
  - Don't just use `alpha` as the heading: it breaks down when the phone points up near the zenith (gimbal lock).
- **Smoothing:** low-pass filter on the unit vector (not on raw angles, which wrap at 360°), ~0.2 s time constant.
- **Declination:** compass gives magnetic north. Add the WMM declination for the user's location to get true north. Detect platforms that already report true north and skip it there.
- **Screen orientation:** compensate for portrait or landscape (`screen.orientation.angle`).

### 7.2 Calibration
- **One-tap calibration:** "Point at the Moon / Jupiter / Venus / a bright star → tap Calibrate".
  - offset_az = true_az − measured_az (and the same for elevation)
  - Store in localStorage with a timestamp and location.
- **Multi-point calibration (optional):** two or more known objects fit a small rotation (yaw + tilt) instead of a single azimuth offset.
- The **calibration quality** determines the matcher's σ (expected pointing error):
  - uncalibrated σ ≈ 12°
  - 1-point σ ≈ 3°
  - multi-point σ ≈ 1.5°
- Show a warning when the magnetometer looks disturbed (the reading jumps while the phone is still) and suggest the "figure-8" recalibration motion.
- **Never** suggest calibrating on the Sun.

### 7.3 Candidate set
Recomputed each frame (cheap, from cached positions):
- visible satellites (sunlit, dark sky, mag ≤ limit)
- aircraft within ~100 km and above the horizon
- Moon, visible planets, stars with mag ≤ 2.5 (expandable)

### 7.4 Scoring
For each candidate *i* with angular separation *d_i* from the pointing vector:

```
spatial_i   = exp( −d_i² / (2 σ²) )
prior_i     = f(type, brightness)         # brighter = more likely what you noticed
motion_i    = g(observed motion, predicted motion)   # 1.0 if not tracking
score_i     = spatial_i × prior_i × motion_i
confidence  = score_i / Σ score
```

- Show the **top 3** with confidence %. Show "nothing obvious here" when the best spatial score is low.
- Show the type icon, name, distance, altitude and "what to look for" (e.g. "steady white light moving ~1°/s toward the NE; it will fade into shadow in 40 s").

### 7.5 Motion matching
- While the user holds **"Track"** and follows the light, record the pointing vectors for 2–5 s.
- Fit the angular velocity: direction (as a position angle) and rate (°/s).
- Compare with each candidate's predicted angular velocity:

| Object | Typical angular motion |
|---|---|
| Stars and planets | ~0.004°/s (sidereal), effectively still |
| Aircraft at cruise altitude | ~0.1–1°/s, depending on distance |
| LEO satellites | ~0.5–1.5°/s, smooth great-circle arc |

- `motion_i` combines the direction similarity (cosine) and the rate ratio. This separates a high plane from a satellite even when both sit inside the compass error cone.

### 7.6 AR camera overlay
- `getUserMedia({ video: { facingMode: 'environment' } })`.
- Project candidate ENU vectors onto the screen with a **gnomonic (pinhole) projection** using the camera's field of view.
  - The FOV is unknown on the web. Default to ~65° horizontal, and let calibration on a known object refine it (the user drags a marker onto the Moon).
- Draw labels, motion arrows and the predicted path for the next 30 s.
- Without camera permission, fall back to a "compass + sky radar" pointing view.

### 7.7 Sound mode
- **Key insight: sound lag.** Sound travels at ~343 m/s. A plane 3 km away is heard from where it was **~9 s ago**, and it has moved on since. So:
  - for each aircraft, compute its position at `t − range / 343`
  - compute the direction the sound comes from
  - compare with where the user points ("point to where you hear it")
- Without pointing, rank aircraft by **estimated loudness**: closeness, low altitude, and type (helicopters and props are louder per km at low altitude; jets are loud on climb-out).
- **Optional classifier:** YAMNet in TensorFlow.js runs on the mic stream on-device. Its relevant classes include *Aircraft*, *Jet engine*, *Propeller/airscrew*, *Helicopter* and *Thunder*. The class boosts matching aircraft categories: helicopter → A7, prop → light aircraft.
- **Privacy:** audio never leaves the device and is not stored. A visible "mic on" indicator.
- Stretch: Doppler shift trend (rising vs. falling pitch) for approaching vs. receding.

---

## 8. UI / UX

### 8.1 Screens
1. **Dashboard (desktop default):**
   - big sky radar
   - map with aircraft
   - "Overhead now" list
   - next passes
   - clock with UTC and local time
   - status bar (data age, location, sensors)
2. **Sky Radar:** polar plot with the zenith in the center and the horizon at the edge. Satellites are dots with trails, planes are arrows, planets and stars are symbols. Tap any object for details.
3. **Passes:** next 48 h of visible passes, filter by object or group, "add to calendar" (.ics download).
4. **What's That? (mobile default):** AR camera view, top-3 match card, Calibrate and Track buttons, sound mode toggle.
5. **Map:** aircraft and satellite ground tracks, the user's location, the visibility footprint.
6. **Settings:** location (auto or manual), sky quality, units, layers, alerts, calibration reset, privacy info.

**Built (phone layout, < 900 px wide):** a bottom tab bar with **Radar · Overhead · Planets · Settings**, one section at a time. Tapping a dot or a list row opens a **details bottom sheet** over the radar (swipe up to expand, swipe down or ✕ to close). In landscape the radar sits at full height on the left with the details as a side panel. Desktop keeps the two-column dashboard.

### 8.2 Look & feel
- Dark "mission control" theme: monospace data, glowing accents, scanline or grid backdrop, all subtle and readable.
- A **red night mode** that keeps your eyes dark-adapted for stargazing.
- Respect `prefers-reduced-motion`. Full keyboard navigation on desktop.

### 8.3 Onboarding
1. "Where are you?" (allow location, or pick on the map) *(built: first-run card with "Use my location" / "Pick a city"; an offline list of ~100 cities, so nothing typed leaves the browser)*
2. "Want to identify things with your phone?" (sensor and camera permissions, with an explanation)
3. A quick calibration prompt if the Moon or a bright planet is up

---

## 9. Offline, PWA & alerts

- **Service worker:** precache the app shell, stars.json and the last TLEs. Passes and sky bodies work fully offline. Aircraft need a network connection.
- **Installable:** the manifest has icons, `display: standalone`, and a theme color.
- **Alerts (page closed)**, in order of preference:
  1. **ntfy:** the user picks a topic. A scheduled Cloudflare Worker computes passes for the subscribed locations and posts notifications. Requires storing the location (rounded to ~1 km) in KV, which is explained to the user and opt-in.
  2. **Calendar export** (.ics) of upcoming passes: zero backend, works everywhere.
  3. **Spare laptop** running the same pass logic in Node on a cron, for personal use.
- **In-page alerts:** while the page is open, notify via the Notifications API.

---

## 10. Privacy & ethics

- The location stays in the browser unless the user opts into server alerts.
- No analytics by default. If ever added, use a privacy-friendly, cookieless option.
- Camera and mic are processed on-device only and never uploaded.
- Only public broadcast and open data is shown. No tracking of people.
- Respect the rate limits and terms of every data source, and credit them in the app's About page.

---

## 11. Testing & validation

### 11.1 Unit / golden tests (Vitest)
- coords: known ECEF↔geodetic↔ENU conversions
- satellites: fixed TLE + fixed time → az/el compared with reference values from Skyfield / Heavens-Above (tolerance 0.1°)
- passes: fixed TLE + location → rise, max and set times within ±5 s of the reference
- visibility: known shadow entry/exit times
- sky: planet positions vs. astronomy-engine reference / JPL Horizons (tolerance 1′)
- matcher: synthetic scenes with known answers, with noise injected into the pointing vector

### 11.2 Field validation (logged in `docs/ACCURACY.md`)
- 10+ ISS and bright-satellite passes: predicted vs. observed time and direction
- Compass error on several phones: uncalibrated vs. calibrated (measured against the Moon and planets)
- Aircraft: compare with a flight-tracking site for the same moment
- "What's That?" hit rate: % correct as the top answer and in the top 3, per object type

### 11.3 Performance budgets
- First load < 300 KB JS gzipped (lazy-load TF.js and the AR code)
- Propagation of 10k satellites < 150 ms per batch in the worker
- 60 fps radar on a mid-range phone

---

## 12. Deployment

- **GitHub Actions `deploy.yml`:** on push to `main`, `npm ci && npm run build` and deploy to GitHub Pages.
- **`tle-snapshot.yml`:** daily cron fetches the CelesTrak groups and commits `public/data/tle-snapshot.json` (or uploads it as a Pages artifact without committing).
- **Cloudflare Worker** (optional), deployed with `wrangler`:
  - `/proxy/aircraft?lat&lon&r`, cached ~5 s
  - a cron for ntfy alerts
- Custom domain optional.

---

## 13. Milestones

Each milestone is shippable on its own.

### v0.1: "Overhead now"
- [x] Vite + TS scaffold, deploy pipeline to Pages
- [x] Location (geolocation + manual)
- [x] Fetch and cache CelesTrak `stations` + `visual`
- [x] Propagate → "overhead now" list with az/el/range, refreshing every second
- [x] Basic sky radar canvas
- [ ] Field check: compare the ISS with Heavens-Above on the live site

**Done when:** the ISS position matches Heavens-Above within 0.5° on the live site.

### v0.2: Passes & visibility
- [ ] Shadow + twilight + magnitude model
- [ ] Pass prediction (48 h) + passes screen + .ics export
- [ ] Web Worker propagation, Starlink group

**Done when:** predicted visible ISS passes match Heavens-Above times within ±10 s.

### v0.3: Aircraft
- [ ] Test CORS and limits on the aggregators; add the Worker proxy if needed
- [ ] Aircraft layer on radar + map, extrapolation, details card
- [ ] Interesting-traffic highlights

**Done when:** aircraft positions on the radar match a flight-tracking site within ~1°.

### v0.4: Sky bodies
- [x] Sun, Moon (with phase), planets, bright stars on the radar
- [x] Red night mode

**Done when:** planet positions are within 1′ of the reference.

### v0.5: What's That?
- [ ] Sensor fusion → pointing vector (Android + iOS paths), declination
- [ ] Calibration flow
- [ ] Matcher (spatial + prior), top-3 card
- [ ] AR camera overlay
- [ ] Motion matching ("Track")

**Done when:** ≥ 90 % top-1 accuracy for Moon/planets and ≥ 70 % top-3 for satellites and planes in field tests after calibration.

### v0.6: Starlink trains & flares
- [ ] New-launch train detection, supplemental Starlink data
- [ ] Train pass alerts in the UI, glint heuristic, Iridium explainer

### v0.7: Sound mode
- [ ] Sound-lag-corrected aircraft directions
- [ ] Loudness ranking
- [ ] Optional YAMNet classifier (lazy-loaded)

### v0.8: PWA & alerts
- [x] Web app manifest + icons ("Add to Home Screen" opens full-screen)
- [ ] Service worker, offline passes, install prompt
- [ ] ntfy alerts via Worker cron (opt-in)

### Later
- [ ] 3D globe view (globe.gl / CesiumJS)
- [ ] Extra layers: earthquakes (USGS), ships (AIS), weather/cloud cover ("will clouds block this pass?")
- [ ] Rocket launch countdowns (Launch Library 2)
- [ ] Aurora forecast (NOAA SWPC)
- [ ] Shareable "I saw it!" cards
- [ ] Multi-language

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Flight APIs block CORS or change terms | Aircraft layer breaks | Worker proxy, multiple sources with fallback, cache |
| Rate limits if the site gets popular | Data gaps | Shared edge cache, back off, poll only when visible |
| Bad compasses on some phones | Wrong IDs | Calibration, motion matching, top-3 + confidence, disturbance warning |
| iOS sensor / permission quirks | Feature unavailable | Explicit permission button, graceful fallback to manual radar |
| 10k+ Starlinks too slow on old phones | Lag | Worker, interpolation, visibility pre-filter, "Starlink layer" toggle |
| Stale TLEs (CelesTrak down) | Drift | Daily snapshot fallback, staleness warning |
| Camera FOV unknown | AR labels offset | FOV calibration on a known object, sensible default |
| Light pollution makes predictions "wrong" to users | Confusion | Sky-quality setting adjusts the magnitude limit |

---

## 15. Open questions

1. Which flight APIs allow browser CORS today, and which have the friendliest terms? (Resolve in v0.3.)
2. Vanilla TS vs. a small framework (Svelte/Preact) once the UI grows past ~5 screens?
3. Is server-side alerting worth storing rounded user locations, or are .ics + in-page alerts enough?
4. ~~Should SkyWatch live at the repo root or under `app/`?~~ Decided: `apps/skywatch/`, next to `apps/loopland/`.
5. Name: SkyWatch, or something more unique to avoid clashing with existing apps?

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **TLE / OMM** | Text / JSON formats describing a satellite's orbit at a given epoch |
| **SGP4** | Standard model that turns a TLE into a position at any time |
| **az / el** | Azimuth (compass direction, 0° = north) and elevation (angle above the horizon) |
| **ENU** | East-North-Up local coordinate frame centered on the observer |
| **ADS-B** | Aircraft broadcasting their GPS position, speed and ID |
| **MLAT** | Aircraft position computed from signal timing when ADS-B is missing |
| **Squawk** | 4-digit transponder code; 7500/7600/7700 are emergencies |
| **Magnitude** | Brightness scale where lower is brighter (Venus ≈ −4, faintest naked-eye ≈ 6) |
| **Declination (magnetic)** | Angle between magnetic north and true north at your location |
