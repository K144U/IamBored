# IamBored Lab

Side projects and ideas built when bored. Everything runs in the browser.

| Project | What | Status |
|---|---|---|
| 🛰️ [**SkyWatch**](apps/skywatch/) | Live sky radar: ISS, satellites, Moon, planets, stars and constellations above you; visible passes with calendar export; point your phone at a light to identify it | v0.1, v0.2, v0.4, v0.5 built (phone-first) |
| ⬢ [**LoopLand**](apps/loopland/) | Real-life Paper.io for runners: close a loop and the land inside is yours | v0.1 sandbox built (phone-first) |

Plans and the idea backlog are in [`docs/`](docs/):
- [SKYWATCH_PLAN.md](docs/SKYWATCH_PLAN.md)
- [LOOPLAND_PLAN.md](docs/LOOPLAND_PLAN.md)
- [IDEAS.md](docs/IDEAS.md) (FlagRun, the CTF IRL idea, is parked here)
- [HANDOVER.md](docs/HANDOVER.md): current state and next steps, for whoever (or whichever Claude session) picks this up next

## Run locally
```bash
npm install
```
```bash
npm run dev:skywatch
```
```bash
npm run dev:loopland
```
```bash
npm test
```
```bash
npm run build
```
`npm run build` produces one static site in `dist/` (landing page + `skywatch/` + `loopland/`).

## Live on kittu.pro
Both apps are served by the owner's site (repo `K144U/Kittu.pro`, a Next.js app on Vercel):
- **https://www.kittu.pro/skywatch** (short link `/sky`)
- **https://www.kittu.pro/loopland** (short link `/run`)

`npm run build:embed` builds them into `dist-embed/` with absolute bases (`/skywatch/`, `/loopland/`) and a "Part of kittu.pro" footer. In the kittu.pro repo, `node scripts/sync-labs.mjs /path/to/IamBored` runs that build and copies the result into its `public/`; commit and push kittu.pro's `master` to deploy. kittu.pro also serves SkyWatch's satellite backup at `/skywatch/data/tle/<group>.json` (a server route that caches CelesTrak for 2 h), which stands in for the daily snapshot below.

## Deploy (GitHub Pages, optional)
The deploy workflow is ready in [`deploy/pages.yml`](deploy/pages.yml). It type-checks, tests and builds on every push, **deploys from `main`**, and rebuilds daily to refresh SkyWatch's fallback satellite snapshot.

One-time setup:
1. Copy `deploy/pages.yml` to `.github/workflows/pages.yml`. On GitHub: **Add file → Create new file**, name it `.github/workflows/pages.yml`, and paste the contents. (It's parked in `deploy/` because the coding session that wrote it wasn't allowed to create workflow files.)
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Merge to `main`. The site then lives at `https://<user>.github.io/<repo>/`.

## Layout
```
apps/skywatch/   SkyWatch (Vite + TypeScript, satellite.js, astronomy-engine)
apps/loopland/   LoopLand (Vite + TypeScript, h3-js, Leaflet)
site/            landing page
scripts/         site build + daily satellite snapshot
deploy/          GitHub Pages workflow (copy to .github/workflows/)
docs/            plans and idea backlog
```
