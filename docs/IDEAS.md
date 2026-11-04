# 💡 Idea Backlog

These are project ideas from brainstorming sessions, saved so they don't get lost. ⭐ marks the favorites.
Hardware available: a PC and a spare laptop that can act as a server (no SDR, Pi or ESP32 for now).

## 🚀 In progress
- ⭐ **SkyWatch**: satellite pass radar, Starlink train/flare hunter, aircraft radar and "What's That?" point-and-identify. See [PLAN.md](PLAN.md).

## 🛰️ Sky & space
- ⭐ Satellite pass radar *(in SkyWatch)*
- ⭐ Starlink / Iridium flare hunter *(in SkyWatch; Iridium flares are mostly extinct)*
- ⭐ Aircraft radar *(in SkyWatch, via public ADS-B APIs)*
- ⭐ "What's that sound/plane/star?" *(in SkyWatch)*
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
- Honeypot plus live attack map: a fake SSH server with bot logins drawn on a globe (isolate it!)
- Cyberpunk network monitor TUI: devices on your LAN, traffic, new-device alerts
- Pi-hole-style tracker blocker with stats: what your phone and TV phone home to
- BLE "who's around" radar plus an AirTag-following-you detector *(needs BLE hardware)*
- Spectrum waterfall / ADS-B receiver *(needs an RTL-SDR, ~$30)*
- Wardriving map *(needs portable hardware + GPS)*

## 🔎 OSINT tools
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

## 🙋 For normal people
- Own exposure check: HIBP breaches, data broker listings with opt-out links
- Username footprint checker (your own handles)
- Personal archive and search engine (ArchiveBox) on the laptop
- Price and restock sniper
- Personal "mission control" wall dashboard: weather, passes, quakes, server health, news
- Geo-guessing trainer: a game that teaches OSINT location clues
