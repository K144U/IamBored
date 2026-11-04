# IamBored Lab

Side projects and ideas built when bored. Everything runs in the browser.

| Project | What | Status |
|---|---|---|
| 🛰️ [**SkyWatch**](apps/skywatch/) | Live sky radar: ISS, satellites, Moon and planets above you, next visible passes | v0.1 built |
| ⬢ [**LoopLand**](apps/loopland/) | Real-life Paper.io for runners: close a loop and the land inside is yours | v0.1 sandbox built |

Plans and the idea backlog are in [`docs/`](docs/):
- [SKYWATCH_PLAN.md](docs/SKYWATCH_PLAN.md)
- [LOOPLAND_PLAN.md](docs/LOOPLAND_PLAN.md)
- [IDEAS.md](docs/IDEAS.md) (FlagRun, the CTF IRL idea, is parked here)

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

## Deploy (GitHub Pages)
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
