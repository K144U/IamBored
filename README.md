# 🛰️ SkyWatch

**Mission control for the sky above you, in your browser.** SkyWatch tracks satellites, predicts bright passes, shows live aircraft, and lets you point your phone at the sky and ask *"what's that?"*.

It's a static webpage: open a link on your phone or PC and it works. There's nothing to install, no server and no special hardware, and it uses only free, public data.

---

## Features

### 1. 🛰️ Satellite Pass Radar
- Real-time sky plot (polar "radar" view) of satellites over your location
- "What's overhead right now" list: ISS, Starlink trains, Hubble, weather sats, debris
- Pass predictions with rise, peak and set times, max elevation and estimated brightness
- Highlights for visible ISS and Tiangong passes

### 2. ✨ Starlink Train & Flare Hunter
- Spots fresh Starlink "trains" (newly launched batches) and tells you when and where to look
- Only shows passes where the satellite is sunlit **and** your sky is dark
- Flags satellites likely to glint or flash
- Note: classic **Iridium flares are mostly extinct**, because the old Iridium satellites were deorbited by 2019 and the new ones don't flare. See [Accuracy](#-accuracy).

### 3. ✈️ Aircraft Radar
- Live map of planes near you from public ADS-B aggregators
- Details per flight: callsign, type, altitude, speed, origin and destination where available
- Highlights interesting traffic: military, emergency squawks (7500/7600/7700), helicopters, rare types

### 4. 🔭 "What's That?" (Point & Identify)
Hold your phone up, point it at something in the sky, and SkyWatch tells you what it is.

| You see or hear… | SkyWatch answers |
|---|---|
| A moving light | "That's **Starlink-3021**, 550 km up, fading in 40 s" or "**ISS**, heading NE" |
| A blinking light | "**BA283**, Boeing 777, LHR → LAX, 11,000 m" |
| A bright dot that doesn't move | "That's **Jupiter**" or "**Sirius**" |
| A sudden flash | "Likely a **satellite glint** from …" |
| A plane you **hear** but can't see | "Closest aircraft: **N123AB**, helicopter, 400 m away, 300 m altitude" |

**How it works:**
1. **Where you're pointing:** the browser reads GPS (Geolocation API) and compass/tilt (DeviceOrientation API), which gives azimuth and elevation.
2. **What's there:** the page computes the az/el of every candidate object from your position:
   - satellites from TLE/OMM data (SGP4 propagation)
   - aircraft from live ADS-B positions, extrapolated to *now*
   - planets, Moon and bright stars from ephemeris and a star catalog
3. **Match:** it ranks objects near where you're pointing, weighted by brightness, visibility and motion, and shows the top matches over a live camera view.
4. **Sound mode:** "I hear something" lists the nearest low-altitude aircraft by distance and altitude. An optional in-browser audio classifier tags the sound as *jet / prop / helicopter / thunder / other*.

---

## Architecture

SkyWatch is **web-first**: all the math runs in the browser.

```
┌──────────── Static site (GitHub Pages / Cloudflare Pages) ────────────┐
│  HTML/JS · installable PWA · HTTPS (needed for phone sensors)          │
│                                                                        │
│   satellite.js      → satellite positions, passes, flares             │
│   astronomy-engine  → Sun, Moon, planets, stars                       │
│   Leaflet + Canvas  → map, sky radar, AR "What's That?" view          │
│   Geolocation · DeviceOrientation · Camera · Mic                       │
└───────────────┬────────────────────────────────────────────────────────┘
                │ fetch
     ┌──────────┴───────────┬──────────────────────────┐
     ▼                      ▼                          ▼
 CelesTrak (TLE/OMM)   ADS-B APIs              Optional helpers:
 cached in browser     (direct, or via a       · Cloudflare Worker (CORS proxy/cache)
 + daily snapshot      Cloudflare Worker       · GitHub Action (daily TLE snapshot, alerts)
 via GitHub Action     if CORS blocks it)      · Spare laptop (alerts, extra layers)
```

| Concern | Approach |
|---|---|
| Hosting & HTTPS | GitHub Pages or Cloudflare Pages (free, HTTPS included) |
| CORS on flight APIs | Call directly where allowed; otherwise a tiny Cloudflare Worker proxy |
| Data freshness | Cache TLEs in the browser for a few hours, plus a daily snapshot committed by a GitHub Action |
| Alerts when the page is closed | Scheduled Worker or GitHub Action posting to [ntfy](https://ntfy.sh/), or the laptop later |
| iPhone sensors | An "Enable sensors" button (Safari requires a tap to grant compass access) |

---

## 🎯 Accuracy

The weak link is **the phone's compass**, not the data. Here is the error from each part of the chain:

| Component | Typical error | Notes |
|---|---|---|
| **Planets, Moon, stars** (astronomy-engine) | < 1 arcminute | Effectively perfect. Atmospheric refraction is corrected near the horizon |
| **Satellites** (SGP4 + fresh TLE) | ~1 km at TLE epoch, growing ~1–3 km/day | For a satellite ~500 km away, 1 km is about **0.1°**. Fresh data (< 2 days) is plenty. Satellites that just maneuvered (e.g. new Starlinks raising orbit) can be off by a lot more, so we use CelesTrak's *supplemental* (operator-provided) data where available |
| **Aircraft** (ADS-B) | Position ~10 m, but data is **1–10 s old** | A jet moves ~250 m/s, so we extrapolate using speed and heading. MLAT-only positions are rougher. Some aircraft (e.g. military, privacy-blocked) won't appear at all |
| **Your location** (GPS) | 5–20 m | Irrelevant for satellites and stars, minor for low aircraft |
| **Phone clock** | Usually < 1 s | An overhead satellite moves ~1°/s, so we sync against a server time header |
| **Phone tilt** (accelerometer) | ~1–2° | Good |
| **Phone compass** (magnetometer) | **5–15°, sometimes 30°+** | Thrown off by metal, magnets, cases, cars and buildings. Also needs a *magnetic declination* correction (magnetic north ≠ true north) |

**Tricks to beat the compass:**
1. **Calibrate on a known object.** Point at the Moon or a bright planet once and tap "That's the Moon". SkyWatch calculates the compass offset and corrects every reading after that. This usually gets you to **~1–3°**. *(Never point at or look at the Sun.)*
2. **Visibility filtering.** Only suggest things you could actually see: sunlit satellites in a dark sky, objects above the horizon, bright enough for current sky conditions. This removes most wrong answers.
3. **Motion matching.** While you follow a moving light with the phone, compare its direction and speed of motion against each candidate. A plane, a satellite and a star move very differently, so this nails ambiguous cases.
4. **Confidence cone.** Show the top 3 matches with a confidence score instead of pretending to be certain. The camera overlay lets you confirm visually.
5. **Declination correction.** Convert magnetic heading to true heading using the World Magnetic Model for your location.

**Realistic results:**
- Planets, Moon, bright stars: **near certain** (few candidates, very bright)
- ISS and bright satellites: **very high** after calibration
- Aircraft overhead: **high**; low or distant aircraft near the horizon are harder
- Faint satellites in a busy Starlink sky: **top-3 guess**, improved by motion matching
- Sound mode: tells you the **nearest plausible aircraft**, not a certain ID

---

## Data sources (all free)

| Data | Source |
|---|---|
| Satellite orbits (TLE/OMM, incl. supplemental) | [CelesTrak](https://celestrak.org/) |
| Live aircraft | [adsb.lol](https://adsb.lol/), [airplanes.live](https://airplanes.live/), [OpenSky](https://opensky-network.org/) |
| Sun / Moon / planets / stars | [astronomy-engine](https://github.com/cosinekitty/astronomy) + bright star catalog |
| Magnetic declination | World Magnetic Model (NOAA) |
| Push alerts | [ntfy.sh](https://ntfy.sh/) |

---

## Roadmap

- [ ] **v0.1:** Static page that fetches TLEs and shows a "what's overhead now" list and a sky radar
- [ ] **v0.2:** Pass predictions and visibility (sunlit and dark sky)
- [ ] **v0.3:** Aircraft radar layer (and a Worker proxy if CORS requires it)
- [ ] **v0.4:** Planets, Moon and bright stars layer
- [ ] **v0.5:** "What's That?" point & identify (sensors, calibration, matcher)
- [ ] **v0.6:** Starlink train and flare hunter
- [ ] **v0.7:** Sound mode (nearest aircraft plus audio classifier)
- [ ] **v0.8:** PWA install and push alerts
- [ ] **Later:** Extra layers: earthquakes, ships (AIS), weather

---

## Ethics

SkyWatch uses public broadcast and open data only. It tracks objects (satellites, aircraft, planets), not people. Your location stays in your browser.

## License

MIT, see [LICENSE](LICENSE).
