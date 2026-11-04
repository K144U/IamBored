# ⬢ LoopLand: Real-Life Paper.io for Runners

**Run a loop. The land inside is yours.** Loop around someone else's land to steal it. Land you stop visiting fades away.

This is the **v0.1 sandbox**: everything runs in your browser and your runs never leave it. Full design: [docs/LOOPLAND_PLAN.md](../../docs/LOOPLAND_PLAN.md).

## Try it
1. Open the page and press **Load demo season** to watch a week of turf wars in Central Park.
2. Or export your own runs as **GPX** (Strava: activity → ⋯ → *Export GPX*) and drop them on the page.
3. Add friends as hot-seat players, switch the active player, and drop their GPX files to battle on one device.

## Rules (as built)
| Rule | Detail |
|---|---|
| Claim | Any area your run encloses: self-crossing loops, runs ending ≤ 75 m from the start, or excursions that leave your land and return (the Paper.io move) |
| Steal | Enclosed land owned by others becomes yours |
| Donut rule | A hole inside your land is only retaken if your run goes around it |
| Fade | Not visited for 14 days → fading, and anyone can take it by running through. 30 days → neutral |
| Fair play | Rejects runs > 22 km/h average, drops GPS teleports (> 30 km/h jumps), splits at GPS gaps > 200 m, rejects files without timestamps |
| Grid | [H3](https://h3geo.org/) resolution 11 hexagons (~25 m edge, ~2,150 m²) |

## Running it
```bash
npm install          # once, from the repo root
npm run dev:loopland # http://localhost:5174
npm test -w loopland # claim engine + GPX/TCX parser tests
```

## Code map
| File | What |
|---|---|
| `src/game/claim.ts` | Game engine: trail → hex walls → flood fill → pockets → steal/refresh/decay |
| `src/game/clean.ts` | GPS cleaning and anti-cheat |
| `src/game/parse.ts` | GPX / TCX import |
| `src/game/demo.ts` | Synthetic demo season |
| `src/ui/map.ts` | Leaflet map, territory rendering, replay animation |
| `src/main.ts` | Sidebar, uploads, players, run log |
