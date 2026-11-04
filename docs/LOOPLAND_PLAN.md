# LoopLand: Real-Life Paper.io for Runners

> Status: **planning / idea stage**. No code yet. "LoopLand" is a working name.

**Run a loop and the land inside it is yours.** Your city is the game board, your runs are your moves, and other runners can steal your territory by looping through it.

---

## 1. Vision

[Paper.io](https://paper.io/) played on real streets:

| Paper.io | LoopLand |
|---|---|
| You move your square around the board | You run around your city |
| Leave your territory → you draw a trail | Your GPS track is your trail |
| Return to your territory → everything enclosed becomes yours | Close a loop, or return to your land, and everything enclosed becomes yours |
| Enclose enemy land → you take it | Loop through someone's territory → you steal it |
| Cross an enemy's trail → they die | *Live mode only:* cut an enemy's open trail and they lose it |

### Goals
- Make every run feel like a conquest, so people run more and explore new streets
- Fun **solo** (paint your city), better with **friends**, best as **run-club vs run-club** turf wars
- Effort-based: you can't buy territory, you have to run it
- Privacy-safe by design. Runs start at people's homes, so this matters a lot.

### Non-goals (for now)
- Cycling and driving (maybe a separate cycling league later)
- Pay-to-win anything
- Showing anyone's live location outside a live match

### Prior art (check before building)
Territory-running games have been tried before, e.g. *Run An Empire* (loop-based territory, ~2016) and *INTVL* (hex territory). There are also zone-capture games like *Turf*. **Action:** try these first. Note what's fun and what isn't, and whether they're still alive. Possible differentiators: true Paper.io rules (connect-to-territory and stealing), run-club leagues, privacy-first design, shareable conquest replays, live arena mode.

---

## 2. Core rules (async mode, the main game)

You go for a normal run with any watch or app, and the run gets imported afterward.

1. **Claim:** any area your run **encloses** becomes yours:
   - a loop where your route crosses itself, or
   - a run that starts and ends within ~75 m of the same spot (auto-closed), or
   - a run that leaves **your territory** and comes back to it. Everything between the trail and your land is filled, exactly like Paper.io.
2. **Steal:** enclosing land owned by someone else makes it yours.
3. **Paint the trail:** the cells your run passes through *as part of an enclosure* are claimed too. Open, dangling parts of the route claim nothing.
4. **Refresh:** running through your own land keeps it "fresh".
5. **Decay:** land untouched by its owner for **14 days** becomes *fading*. Anyone can grab fading land just by running **through** it, with no loop needed. After **30 days** it goes neutral. This keeps the map alive and stops early players from owning the city forever.
6. **No backdating:** activities older than **48 h** at upload time are rejected, and imports are processed in upload order.

### Example
```
Day 1  Alice runs a 5 km loop around the park          → owns the park
Day 2  Bob runs a loop that overlaps half the park     → steals that half
Day 3  Alice runs out from her land, around Bob's half,
       and back into her land                          → takes it back + extra
Day 20 Alice stops running there                       → her land starts fading
```

---

## 3. The board: hex grid

The world is split into **H3 hexagons** ([Uber H3](https://h3geo.org/)) instead of exact polygons.

| H3 resolution | Hex edge | Hex area | Use |
|---|---|---|---|
| 10 | ~66 m | ~15,000 m² | Zoomed-out rendering |
| **11** | **~25 m** | **~2,150 m²** | **Game cells**: matches GPS accuracy (5–20 m) |
| 12 | ~9 m | ~300 m² | Too fine; GPS jitter would cause noise |

**Why hexes instead of exact polygons:**
- **Simple:** ownership is a table of `cell_id → owner`, with no fragile polygon boolean math
- **Fair:** GPS jitter smaller than a cell doesn't matter
- **No diagonal leaks:** on a square grid a "closed" loop can leak through corner-touching cells. Hexes have only edge neighbors, so a continuous line of hexes really is a wall.
- **Scales:** a big city (~500 km²) is ~230k cells, which SQLite handles easily
- **Looks like a game:** a "pixel Paper.io" look, and cells can be merged into smooth blobs when zoomed out

Example: a 5 km round loop encloses up to ~2 km², about 900 cells.

---

## 4. The claim algorithm (Paper.io flood fill on hexes)

```
input:  cleaned GPS track, player P
1. trail   = H3 cells along the track
            (gridPathCells between consecutive points → a gap-free line)
2. walls   = trail ∪ cells owned by P (near the trail)
3. region  = bounding box of walls, expanded by 1 ring of cells
4. flood-fill from the region's border through non-wall cells
5. enclosed = cells in region that are NOT walls and NOT reached by the fill
6. trail_closed = trail cells that border an enclosed cell or P's land
                  (i.e. part of a loop/excursion, not a dangling tail)
7. claim(enclosed ∪ trail_closed) for P
      → overwrite previous owners (steal), record history
8. refresh P's cells that the trail passed through
```

- This one rule covers self-loops, start=end loops and connect-to-territory, just like Paper.io.
- Start=end auto-close: if the first and last points are ≤ 75 m apart, add the connecting line to the trail.
- Out-and-back runs enclose nothing, which is correct.
- **Ignore tiny claims:** fewer than ~3 enclosed cells is likely GPS noise.
- Steps 2–3 only consider P's territory within the track's bounding box plus a margin, to keep the fill small. Re-check edge cases where a U-shaped territory encloses land outside the trail's box (expand the box to the connected territory component).

---

## 5. Game modes

### 5.1 Solo / Open World (MVP)
- One shared city map and every player for themselves
- Personal stats: km² owned, % of each neighborhood, longest-held cell
- **Achievements:** "Encircle a lake", "Own a whole park", "Loop an island", "10 % of your neighborhood", "Steal from 5 different runners"

### 5.2 Crews (run clubs)
- Join a crew and your land becomes crew-colored, with crew leaderboards
- **Crew vs crew turf war seasons** (monthly): most land at season end wins and the map resets
- An all-time "Hall of Maps" archive of every season's final map

### 5.3 Challenges
- **Daily shape:** "draw a heart / star / your initials" (Strava-art style), scored by shape similarity
- **Target zone:** "first to enclose the old lighthouse this week"
- **Neighborhood raid weekend:** double points in one district

### 5.4 Live Arena (later, the true Paper.io)
- Everyone runs **at the same time** in a bounded area (e.g. a big park), for 20–40 min with 4–20 players
- Live map over WebSocket, about 1 update per second
- Each player starts with a small base. Leaving it draws a visible **open trail**.
- **Trail cut:** if someone runs across your open trail, your trail is erased and you must return to your land before you can claim again. Unlike Paper.io you don't die, because runners shouldn't be sent home.
- **Anti-jitter:** a cut needs a clear crossing, with ≥ 10 m on both sides of the trail
- Most land at the final whistle wins
- Needs the screen on (see the GPS limits below)

---

## 6. Run import

| Source | How | Notes |
|---|---|---|
| **GPX / FIT / TCX upload** | Drag and drop | Works with any watch or app. Easy to forge, so lower trust |
| **Strava** | OAuth + webhook on new activity | ⚠️ Strava's **late-2024 API terms restrict showing a user's Strava data to other users**. Check whether derived territory on a shared map is allowed **before relying on it** |
| **Garmin Connect** | Garmin Connect Developer Program | Needs an approved application |
| **Recorded in LoopLand** | In-browser GPS recording | Phone screen must stay on (Wake Lock). Best for live mode |
| **Apple Health / Health Connect** | Native wrapper only (later) | Needs a Capacitor/native app |

### Processing pipeline
1. **Parse** → points (lat, lon, time, elevation, cadence/heart rate if present)
2. **Clean:**
   - drop points with bad accuracy
   - remove teleports (speed > 30 km/h between points)
   - simplify (Douglas–Peucker, ~5 m)
3. **Validate** (anti-cheat, below) → accept, accept partially, or reject
4. **Apply privacy zones** (below)
5. **Claim** (section 4) → write cells and history
6. **Notify** stolen-from players ("Bob took 12 of your cells in Riverside Park!")
7. **Render** replay and share card

---

## 7. Anti-cheat

| Check | Rule |
|---|---|
| Activity type | Run / walk / hike only (walks maybe at reduced weight) |
| Speed | Moving segments faster than ~25 km/h (above sprint speed) are cut out. Too much → reject |
| Sustained pace | Faster than ~2:50/km sustained over > 1 km is flagged for review (world-class pace) |
| Teleports | Gaps of > 200 m with no points → split the track; claims can't cross the gap |
| Cadence | If the file has cadence: speed with ~0 steps/min → bike or car → reject |
| Backdating | Older than 48 h → reject |
| Duplicates | Same track twice (hash of resampled points) → reject |
| Trust levels | Strava/Garmin device data > in-app recording > manual GPX upload. New accounts get claim caps per day |
| Rollback | Every claim stores the previous owner, so a cheater's claims can be undone exactly |
| Reports | Players can flag suspicious activities, with a simple admin review queue |

---

## 8. Privacy & safety (critical)

Most runs **start and end at home**. A territory map centered on your house is a doxxing machine. (Recall the 2018 Strava heatmap that revealed secret military bases.)

- **Privacy zones (on by default):** at signup, mark home and work. The first and last ~300–500 m of any run near a privacy zone are **trimmed before processing**. Cells inside privacy zones are never claimed or shown.
- **Random offset trimming:** the trimmed distance varies randomly, so the zone's center can't be found by intersecting many runs.
- **No raw tracks public:** others only see territory, never your route, timestamps or pace.
- **Publish delay:** claims appear a few hours after the run, so nobody knows where you are right now.
- **Display names:** pseudonyms by default, and crews can be private.
- **Live mode:** location is visible only to players in the same match, during the match, and deleted after.
- **Safety:** no claims bonuses for highways, rail lines or private/military land (OSM-tagged exclusion zones). Show a "stay safe, obey traffic" reminder. Live arenas are only in parks.
- **Data deletion:** one button deletes your account and returns your territory to neutral.

---

## 9. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **Vite + TypeScript PWA** | Same stack as SkyWatch; installable |
| Map | **MapLibre GL** + free vector tiles (OpenFreeMap) | Smooth, styleable, free |
| Hex rendering | **deck.gl `H3HexagonLayer`** | Renders 100k+ hexes smoothly |
| Hex math | **h3-js** | Cells, paths, polygon fill |
| Geo utils | **turf.js** | Distances, simplification |
| GPX/FIT parsing | `@tmcw/togeojson` (GPX/TCX), `fit-file-parser` (FIT) | Mature parsers |
| Backend | **Node + TypeScript (Hono or Fastify)** | Shares the claim/validation code with the frontend |
| DB | **SQLite** (start) → Postgres + PostGIS (if it grows) | Simple on the laptop |
| Realtime (live mode) | WebSockets on the laptop, or **Cloudflare Durable Objects** (one object per match) | Durable Objects suit game rooms |
| Hosting | Frontend on **GitHub Pages**. Backend on the **spare laptop** behind a **Cloudflare Tunnel** | Free HTTPS, no port forwarding; Strava webhooks need a public HTTPS URL |
| Auth | Magic-link email, or Strava/Garmin OAuth | No passwords to store |
| Jobs | Simple queue table + worker loop | Imports processed one at a time, in order |

### Data model (first draft)
```sql
users       (id, name, color, crew_id, trust_level, created_at)
privacy_zones (user_id, lat, lon, radius_m)      -- never sent to other users
crews       (id, name, color, is_private)
activities  (id, user_id, source, external_id, started_at, uploaded_at,
             distance_m, status, reject_reason, track_hash)
cells       (h3 TEXT PRIMARY KEY, owner_id, crew_id,
             claimed_at, refreshed_at, activity_id)
claim_log   (activity_id, h3, prev_owner_id, new_owner_id, at)  -- replay + rollback
seasons     (id, starts_at, ends_at, final_map_snapshot)
```

---

## 10. UX

### Screens
1. **Map:** the city in player/crew colors. Your land glows, fading land is striped, and you can tap a cell to see its owner and when it was claimed.
2. **Upload / Import:** drag a GPX, or connect Strava/Garmin.
3. **Run result:**
   - animated replay: the trail draws itself, then the enclosed area **floods in** Paper.io-style
   - "+0.31 km², stole 42 cells from Bob"
4. **Leaderboards:** global, neighborhood, crew, weekly.
5. **Profile:** stats, achievements, privacy zones, connected accounts.
6. **Crew:** members, crew map, season standings.
7. **Plan a raid (later):** draw a loop on the map to preview what you'd capture, and export it as a GPX route to your watch.

### Shareability (growth)
- **Replay video/GIF** of your run eating territory, recorded with canvas + MediaRecorder
- **Share card:** "I conquered 4 % of Riverside 🏃" with a mini map
- **Season-end timelapse** of the whole city map changing colors

### Look & feel
- Bright Paper.io-style colors, chunky hexes when zoomed in, smooth blobs when zoomed out
- Satisfying flood-fill animation and sound on claim
- Dark mode

---

## 11. Balancing (open questions to playtest)

| Question | Options |
|---|---|
| Should giant loops (half marathon around a district) claim everything? | Yes, it's effort. **Or** cap area per run. **Or** big claims decay faster |
| Walking allowed? | Yes at 50 % weight, **or** a separate league |
| Fortified cells? | Cells refreshed 3+ times in a week need 2 enclosures to steal |
| Async trail cuts? | Open trails stay visible for 24 h, and anyone crossing them gets a bonus. Fun or annoying? |
| Grid resolution | 11 by default. Try 10 for less dense, rural areas |
| Decay timing | 14 / 30 days, or tune per city density |
| Score metric | km² owned vs. cells claimed per week vs. km run |

---

## 12. Testing

- **Unit tests (Vitest):**
  - synthetic tracks: square loop, figure-8, out-and-back, U-turn into own territory, overlapping steals
  - expected cell sets for each
- **Property tests:**
  - a cell always has exactly 0 or 1 owner
  - rollback of an activity restores the previous state exactly
  - claims are deterministic for the same input
- **Real data:** a folder of real GPX files (own runs, anonymized) as golden tests
- **GPS noise tests:** add random 5–20 m jitter to synthetic loops; results must stay stable
- **Playtest:** 3–5 friends for 2 weeks, then tune the balancing table

---

## 13. Milestones

Each milestone is shippable on its own.

### v0.1: Solo sandbox (no server)
- [ ] Static page: drag in GPX files → claim algorithm runs in the browser → hexes on a map
- [ ] Stored in localStorage/IndexedDB
- [ ] Replay animation

**Done when:** your own last 10 runs produce a sensible territory map. This is where we find out if it's fun.

### v0.2: Shared map with friends
- [ ] Laptop backend + Cloudflare Tunnel, magic-link auth
- [ ] Upload → server claim → shared map, stealing, decay
- [ ] Leaderboard, steal notifications
- [ ] Privacy zones (required before anyone else joins)

### v0.3: Auto-import
- [ ] Verify the Strava API terms, then add the Strava webhook import (or Garmin, or both)
- [ ] Anti-cheat validation + trust levels + rollback tool

### v0.4: Crews & seasons
- [ ] Crews, crew colors, crew leaderboards
- [ ] Monthly seasons, final map snapshot, Hall of Maps

### v0.5: Make it shareable
- [ ] Replay video/GIF export, share cards
- [ ] Achievements, daily shape challenges

### v0.6: In-app recording + Live Arena
- [ ] Browser GPS recording (Wake Lock, battery-saver)
- [ ] Live matches with Durable Objects or laptop WebSockets, trail cuts

### Later
- [ ] Native wrapper (Capacitor) for background GPS + Apple Health / Health Connect
- [ ] "Plan a raid" route builder + GPX export to watches
- [ ] City-vs-city leagues, sponsored events for run clubs
- [ ] Cycling league (separate map)
- [ ] Merge with the parked **FlagRun** (CTF IRL) idea: capture-the-flag events on the LoopLand map

---

## 14. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Strava API terms** forbid showing data to others | No easy auto-import | GPX upload, Garmin, in-app recording; legal check before v0.3 |
| **Home location leaks** | Real-world harm | Privacy zones on by default, randomized trimming, no public tracks, publish delay |
| **Cheating** (bikes, cars, forged GPX) | Leaderboards ruined | Speed and cadence checks, trust levels, rollback, reports |
| **Early players own the city forever** | New players quit | Decay, monthly seasons, neighborhood leaderboards |
| **Empty map / no players nearby** | Not fun | Solo achievements, % of your neighborhood stats, invite friends/crews |
| **Web GPS stops when the screen is off** | Live mode limited | Wake Lock + screen-on design, native wrapper later. Async mode unaffected |
| **Laptop server goes down** | Imports delayed | Job queue retries; move to a cheap VPS / Cloudflare later |
| **Dangerous running behavior** | Injury | Claims excluded on roads/rail/private land, safety prompts, live arenas only in parks |

---

## 15. Name ideas
LoopLand · RunTurf · Claimr · Strideland · Loop & Conquer · TerriRun · PaperRun · Hexrun
