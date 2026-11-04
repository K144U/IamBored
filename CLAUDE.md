# CLAUDE.md

Guidance for Claude Code sessions in this repo. **Read [`docs/HANDOVER.md`](docs/HANDOVER.md) first.** It has the current state, decisions, gotchas and next steps.

## What this is
"IamBored Lab": the owner's side projects, all static browser apps in an npm-workspaces monorepo.
- `apps/skywatch/`: live sky radar (satellites, ISS passes, Moon/planets). Plan: `docs/SKYWATCH_PLAN.md`
- `apps/loopland/`: real-life Paper.io for runners (GPX → hex territory). Plan: `docs/LOOPLAND_PLAN.md`
- `docs/IDEAS.md`: idea backlog. Add new ideas there so nothing gets lost.

## Commands (run from the repo root)
```bash
npm install
npm run dev:skywatch      # :5173
npm run dev:loopland      # :5174
npm test                  # vitest, both apps
npm run typecheck         # tsc --noEmit, both apps
npm run build             # → dist/ (landing + skywatch/ + loopland/)
```
Before every commit, run `npm run typecheck && npm test`. The deploy workflow runs the same checks.

## Conventions
- TypeScript strict, no UI framework (vanilla TS + small modules). Pure logic lives in `src/engine` / `src/game` and has unit tests. The UI lives in `src/ui` + `main.ts`.
- Vite `base: './'`: every asset/data path must be relative, because the site is served from a sub-path on GitHub Pages.
- Escape any user/data string before putting it in `innerHTML` (each app has an `esc()` helper).
- Privacy by default: locations and runs stay in the browser (localStorage/IndexedDB). Don't add analytics or uploads without asking.
- Keep docs in step with the code: tick milestone boxes in the plan files and update the app README when a feature ships.
- Commit on the session's designated branch. Don't push to `main` or open PRs unless asked.

## Gotchas (details in HANDOVER.md)
- Library versions are newer than you may know: **satellite.js 7.1, Vite 8 (rolldown), TypeScript 7, Vitest 5**. Read `node_modules/*/dist/*.d.ts` before assuming an API.
- In `vite.config.ts`, import `defineConfig` from `vitest/config`, not from `vite`.
- Cloud sandbox: npm works, but **CelesTrak and map tiles are blocked**. Test with Playwright route interception and fixtures (see HANDOVER).
- Cloud sessions may be unable to push `.github/workflows/*`. The workflow is parked in `deploy/pages.yml`.
