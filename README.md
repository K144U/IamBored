# 🛰️ SkyWatch

**Mission control for the sky above you.** SkyWatch tracks satellites, predicts flares, shows live aircraft, and lets you point your phone at the sky and ask *"what's that?"*.

It runs on a spare laptop at home and you open it from any browser. It needs no special hardware and uses only free, public data.

---

## Features

### 1. 🛰️ Satellite Pass Radar
- Real-time sky plot (polar "radar" view) of satellites over your location
- "What's overhead right now" list: ISS, Starlink trains, Hubble, weather sats, debris
- Pass predictions with rise, peak and set times, max elevation and brightness
- Alerts before visible ISS and Tiangong passes

### 2. ✨ Starlink / Iridium Flare Hunter
- Predicts bright satellite flashes visible from your location
- Spots fresh Starlink "trains" (newly launched batches) and tells you when to look
- Only shows passes where the satellite is sunlit **and** your sky is dark

### 3. ✈️ Aircraft Radar
- Live map of planes near you from public ADS-B aggregators
- Details per flight: callsign, type, altitude, speed, origin and destination
- Highlights interesting traffic: military, emergency squawks (7500/7600/7700), helicopters, rare types

### 4. 🔭 "What's That?" (Point & Identify)
Hold your phone up, point it at something in the sky, and SkyWatch tells you what it is.

| You see or hear… | SkyWatch answers |
|---|---|
| A moving light | "That's **Starlink-3021**, 550 km up, fading in 40 s" or "**ISS**, heading NE" |
| A blinking light | "**BA283**, Boeing 777, LHR → LAX, 11,000 m" |
| A bright dot that doesn't move | "That's **Jupiter**" or "**Sirius**" |
| A sudden flash | "**Iridium/Starlink flare** from …" |
| A plane you **hear** but can't see | "Closest aircraft: **N123AB**, helicopter, 400 m away, 300 m altitude" |

**How it works:**
1. **Where you're pointing:** the phone browser reads GPS (Geolocation API) and compass/tilt (DeviceOrientation API), which gives azimuth and elevation.
2. **What's there:** the server computes the az/el of every candidate object from your position:
   - satellites from TLEs (SGP4 propagation)
   - aircraft from live ADS-B positions
   - planets, Moon and bright stars from ephemeris and star catalogs
3. **Match:** it ranks the objects closest to where you're pointing, weighted by brightness, motion and distance, and shows the top matches over a live AR-style camera view.
4. **Sound mode:** "I hear something" lists the nearest low-altitude aircraft by distance and altitude. An optional on-device audio classifier tags the sound as *jet / prop / helicopter / thunder / other*, so it picks the most likely culprit.

---

## Architecture

```
┌──────────────── Phone / PC browser ────────────────┐
│  Web UI: map · sky radar · AR "What's That?" view   │
│  GPS + compass + camera (+ mic for sound mode)      │
└───────────────▲─────────────────────────────────────┘
                │ HTTPS + WebSocket
┌───────────────┴──── Spare laptop (server) ──────────┐
│  FastAPI backend                                     │
│   ├─ satellites: TLE fetch + SGP4 (Skyfield)         │
│   ├─ flares:     sunlit/dark-sky + glint prediction  │
│   ├─ aircraft:   ADS-B poller (cached)               │
│   ├─ sky:        planets & stars (Skyfield + catalog)│
│   ├─ identify:   az/el matcher                       │
│   └─ alerts:     push notifications (ntfy)           │
│  SQLite cache · scheduled jobs                       │
└──────────────────────────────────────────────────────┘
```

**Stack:** Python, FastAPI, Skyfield, SQLite for the backend. The frontend is plain HTML/JS with Leaflet (map) and Canvas (sky radar and AR view).

> Phone sensors (compass, camera, mic) only work over **HTTPS**. The easy fix is [Tailscale](https://tailscale.com/) (`tailscale serve`) or a self-signed certificate on the laptop.

---

## Data sources (all free)

| Data | Source |
|---|---|
| Satellite orbits (TLE/OMM) | [CelesTrak](https://celestrak.org/) |
| Visual magnitudes | CelesTrak / [Heavens-Above](https://heavens-above.com/) reference |
| Live aircraft | [adsb.lol](https://adsb.lol/), [airplanes.live](https://airplanes.live/), [OpenSky](https://opensky-network.org/) |
| Planets / Moon | JPL ephemeris via Skyfield (`de421.bsp`) |
| Stars | Hipparcos catalog (bright stars) |
| Push alerts | [ntfy.sh](https://ntfy.sh/) |

---

## Roadmap

- [ ] **v0.1:** Backend skeleton, TLE fetch, "what's overhead now" API
- [ ] **v0.2:** Sky radar web view and pass predictions
- [ ] **v0.3:** Aircraft radar layer
- [ ] **v0.4:** Planets and bright stars layer
- [ ] **v0.5:** "What's That?" point & identify (phone sensors and matcher)
- [ ] **v0.6:** Flare hunter and Starlink train alerts
- [ ] **v0.7:** Sound mode (nearest-aircraft + audio classifier)
- [ ] **Later:** Extra layers: earthquakes, ships (AIS), weather

---

## Ethics

SkyWatch uses public broadcast and open data only. It tracks objects (satellites, aircraft, planets), not people.

## License

MIT, see [LICENSE](LICENSE).
