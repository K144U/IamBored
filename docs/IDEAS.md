# 💡 Idea Backlog

These are project ideas from brainstorming sessions, saved so they don't get lost. ⭐ marks the favorites.
Hardware available: a PC and a spare laptop that can act as a server (no SDR, Pi or ESP32 for now).

## 🚀 Planned
- ⭐ **SkyWatch**: satellite pass radar, Starlink train/flare hunter, aircraft radar and "What's That?" point-and-identify. See [SKYWATCH_PLAN.md](SKYWATCH_PLAN.md).
- ⭐ **LoopLand** (working name): real-life Paper.io for runners. Run a loop and claim the land inside, steal land from other runners. See [LOOPLAND_PLAN.md](LOOPLAND_PLAN.md).

## 🅿️ Parked
### ⭐ FlagRun: CTF IRL, runners edition
Capture-the-flag on real streets with phone GPS. Could later run as events on the LoopLand map.
- **Modes:**
  - **Classic CTF:** 2 teams, grab the enemy flag within 25 m and run it home. Tag enemies within 15 m.
  - **Fox Hunt:** one runner's location is revealed every 5 min (Jet Lag: The Game style)
  - **Battle Royale:** a shrinking safe circle
  - **Puzzle CTF:** riddles and ciphers lead to the flags (OSINT crossover)
  - **Interval Flags:** a flag counts only if you hit your target pace
  - **Ghost Race** and **Zombie Run**
- **Power-ups at real locations:** radar ping, cloak, shield, double points, decoy flag
- **Problems to solve:**
  - web GPS stops when the screen is off (Wake Lock / native later)
  - 5–20 m GPS error (big capture zones, hold times)
  - cheating (speed and cadence checks)
  - safety (flags only in parks, from OpenStreetMap)
  - battery and privacy
- **Tech:** phone web app + MapLibre, the laptop or Cloudflare Durable Objects for live game rooms
- **Names:** FlagRun · RunCTF · Stride & Seek · Turf Sprint · Capture Pace

## 🛰️ Sky & space
- ⭐ Satellite pass radar *(in SkyWatch)*
- ⭐ Starlink / Iridium flare hunter *(in SkyWatch; Iridium flares are mostly extinct)*
- ⭐ Aircraft radar *(in SkyWatch, via public ADS-B APIs)*
- ⭐ "What's that sound/plane/star?" *(in SkyWatch)*
- "Can I see this rocket launch?": launch visibility and the twilight "space jellyfish" plume from your location
- Space junk reentry tracker: "a fireball might be visible near you"
- Meteor and fireball hunter: shower radiant, Moon and clouds combined into a "go outside now" score
- Stargazing forecast: tonight's score from clouds, Moon, light pollution and haze
- Sky time machine: the sky on your birthday, or during a historic event, as a poster
- Lightning radar plus thunder countdown ("strike 6 km away, thunder in 18 s")
- 3D orbital "hacker map": every tracked object on a globe, filter by military, debris, cubesats
- Space & weather event tracker: launches, ISS passes, solar flares, aurora forecasts
- Satellite change detector: compare Sentinel imagery of an area over time
- Weather satellite image receiver *(needs an SDR)*

## 🌍 "Watch the world" dashboards
- Earthquake and disaster live map (USGS, NASA FIRMS wildfires, storms) with alerts near you
- Ship tracker (free AIS feeds): superyachts, warships, tankers
- Global webcam roulette: random public live cams with their location on a map
- Live "internet weather": outages, BGP hijacks, DDoS (Cloudflare Radar, IODA)
- News and event monitor: GDELT and RSS clustered on a map
- Flight and ship tracker with "went dark" alerts

## 🖥️ Hacker-style (runs on the spare laptop)
- ⭐ Wi-Fi and Bluetooth map of your neighborhood (passive, own surroundings) *(easier with an ESP32 later)*
- CertStream phishing radar: watch new website certificates live and flag lookalike domains
- Visual traceroute globe: each hop of your traffic drawn over the undersea internet cables
- Live BGP explorer: a company's IP ranges, its network neighbors, and route changes (RIPE RIS Live)
- Free online radio receivers worldwide (KiwiSDR/WebSDR map): ISS ham contacts, numbers stations
- Mains hum (ENF) forensics: date a recording from power-grid hum drift
- Honeypot plus live attack map: a fake SSH server with bot logins drawn on a globe (isolate it!)
- Cyberpunk network monitor TUI: devices on your LAN, traffic, new-device alerts
- Pi-hole-style tracker blocker with stats: what your phone and TV phone home to
- Network sonification: home network traffic turned into ambient music
- BLE "who's around" radar plus an AirTag-following-you detector *(needs BLE hardware)*
- Spectrum waterfall / ADS-B receiver *(needs an RTL-SDR, ~$30)*
- Wardriving map *(needs portable hardware + GPS)*

## 🔎 OSINT tools
- Shadow detective (chronolocation): estimate time or place from shadows in a photo
- Domain recon dashboard: WHOIS, DNS, subdomains via crt.sh, tech stack, Wayback
- Wayback time-machine diff: how a website changed over the years
- Fact-check toolkit: reverse image search, earliest appearance, related fact-checks
- Image geolocation helper: EXIF data plus a clue checklist
- Job-posting intelligence: infer a company's tech and expansion from job ads
- Open-source repo intel: contributors, timezones, dependency risk
- Wikipedia edit watcher: suspicious edits, government IP edits
- Public-records explorer: company registries, procurement, lobbying links
- Threat feed digest: CVEs, phishing and malware feeds, daily
- Meme and narrative tracker: how a phrase spreads over time
- Sky art finder: planes drawing shapes with their flight paths

## 🙋 For normal people
- Website X-ray: every tracker, cookie and company a site sends your data to (headless browser on the laptop)
- Photo/file leak checker: see GPS, device and author metadata, then download a clean copy (in the browser)
- Scam email X-ray: where an email really came from, hops on a map, SPF/DKIM/DMARC
- QR code safety scanner: unshorten the redirect chain and check reputation before opening
- "What does the internet see of my home?": your own IP vs. Shodan InternetDB
- Browser fingerprint mirror: how unique your browser looks to trackers
- Own exposure check: HIBP breaches, data broker listings with opt-out links
- Username footprint checker (your own handles)
- Personal archive and search engine (ArchiveBox) on the laptop
- Price and restock sniper
- Personal "mission control" wall dashboard: weather, passes, quakes, server health, news
- Geo-guessing trainer: a game that teaches OSINT location clues

## 🎮 Fun & creative
- Steganography lab: hide messages in images, or pictures inside audio spectrograms
- Mini CTF or puzzle hunt for friends, hosted on the laptop
- Hacker puzzle game in a fake terminal: each level teaches a real security concept
- Daily puzzle site, Wordle-style (guess the satellite, the country from a sound, the city from its street map)
- ASCII/terminal art camera: live webcam as Matrix-style text
- Your city as a pixel-art RPG map, from OpenStreetMap
- Generative art posters from your own data (steps, music, keystrokes)

## 🧭 Other areas to explore
- **Music & audio:** song DNA (BPM, key, chords), room acoustics scanner, hum-to-MIDI
- **AI:** local private voice assistant, offline photo memory search, AI Dungeon Master
- **Money:** personal finance X-ray from bank CSVs, fake-discount detector, crypto whale watcher
- **Science & nature:** bird song identifier station, air quality and pollen map, plant growth timelapse bot
- **Maps & cities:** isochrone map, ghost transit (is the bus actually late?), abandoned places finder
- **Home lab:** personal cloud (Immich/Nextcloud), home dashboard, self-hosted AI chat over your notes
- **Learning:** flashcards from show subtitles, auto-linking second brain, private focus tracker
