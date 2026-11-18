# Star Dominion — architecture

```
src/
  sim/            deterministic simulation (no DOM, no React)
    data/         static definitions: planets, buildings, ships, techs, governments,
                  megastructures, eras, names
    types.ts      GameState and every entity type (plain JSON)
    engine.ts     newGame, step (one day), monthly systems, stats, victory
    commands.ts   Command union + execute(): the ONLY way to change state on purpose
    economy.ts    ledger: jobs, production, taxes, trade, upkeep, storage, shortages
    fleets.ts     movement, supply, orders, invasion, conquest
    combat.ts     battle resolution and reports
    construction.ts, research.ts, diplomacy.ts, territory.ts, galaxy.ts
    eras.ts       era requirements, Kardashev rating, monthly advancement
    modifiers.ts  additive modifier aggregation (gov, policy, tech, megas, eras, timed)
    ai.ts         AI kingdoms and corsairs (issue Commands like the player)
    save.ts       serialise / deserialise (+ forward-compatible defaults)
  persistence/
    idb.ts        IndexedDB save slots (local)
    cloud.ts      Firebase Auth (Google) + Firestore saves (optional, lazy-loaded)
  ui/
    store.ts      zustand UI store, real-time loop, windows, toasts, save/load glue
    App.tsx       HUD composition
    components/   Hud (neocom, location/agenda, resources, throne dial, dispatches,
                  overview, window manager), ContextPanel, MapView, MainMenu,
                  Evolution, Tutorial, Account, PlanetHero, common widgets
    screens/      14 management screens rendered inside floating windows
    render/       galaxyRenderer (Canvas 2D map), nebula (shader bake),
                  planet3d (Three.js planet shader + sprite baking),
                  system3d (Three.js system scene + 2D label overlay)
  dev/planetLab.ts   /lab.html: every planet type rendered live
tests/            vitest: simulation suite + 30-year soak
```

## Simulation

- **Determinism.** All randomness comes from one mulberry32 stream stored in `GameState.rng`. The same seed plus the same commands gives the same state. `fingerprint()` hashes the state for tests.
- **Plain data.** `GameState` is JSON with no class instances, so saving is `JSON.stringify` and loading is validated parsing. Caches (adjacency, supply networks, ledgers, modifiers) live in `WeakMap`s or are keyed on cheap signatures, never inside the state.
- **One write path.** Every intentional change goes through `execute(state, empireId, command)`, which validates it and returns `{ ok, message }`. The AI uses the same call. This is the seam for multiplayer: a server can run `step()` authoritatively and accept `Command`s from clients.
- **Daily vs monthly.** `step()` advances one day: movement, combat, construction, research, ledger application (monthly figures divided by 30) and AI turns on a staggered schedule. `monthly()` runs diplomacy, colony stability and revolt, events, statistics, eras and victory checks.
- **Modifiers.** Every bonus is a named additive key such as `output.energy`, `admin`, `navalCap` or `shipHull`, aggregated in one place. Systems read `mod(mods, key)` and never know where a bonus came from.
- **Eras.** `eras.ts` evaluates requirement lists against `stats` (refreshed monthly before the check), advances `Empire.era` and logs an `era` event. Era bonuses enter through `modifiers.ts`. `TechDef.era` gates research in both `canResearch` and the command layer.

## UI

- **Store and loop.** React re-renders on a throttled `rev` counter. A `requestAnimationFrame` loop calls `step()` at the selected speed (2, 6 or 15 days per second), autosaves every 360 days and turns new events into toasts and auto-pauses.
- **Windows.** `store.windows` holds open management windows: position, size, z-order and minimised state. `screen` is kept as "the focused window" for compatibility. A store subscription opens a window when `screen` is set and closes it when a window navigates back to the map.
- **Galaxy map.** Canvas 2D with a pan/zoom camera.
  - Territory is drawn from exact clipped Voronoi cells. Each edge records the neighbour that produced it, so borders appear only where ownership changes.
  - The background is a spiral-galaxy nebula baked once per seed by a fragment shader into an offscreen canvas.
- **3D.** Three.js `ShaderMaterial`s with simplex-noise terrain, ocean, ice, lava, gas bands, clouds, city lights and an atmosphere shell.
  - **System view:** a live perspective scene (`SystemView3D`). Labels, ownership rings and click targets come from projecting 3D positions onto a 2D overlay canvas.
  - **Thumbnails:** baked by one shared offscreen WebGL renderer and cached.
  - **Large portraits** (`PlanetHero`): live renderers.
- **Fallbacks.** If WebGL is unavailable, sprite baking falls back to flat discs and the system view degrades gracefully instead of throwing.

## Persistence

- **Local:** IndexedDB slots, an autosave, and JSON export/import files.
- **Cloud (optional):** when `VITE_FIREBASE_*` variables are set at build time, players can sign in with Google. Saves and autosaves are mirrored to `users/{uid}/saves/{slot}`. The payload is gzip-compressed (`CompressionStream`) and split into 700 KB `Bytes` chunks to stay under Firestore's 1 MiB document limit. The Firebase SDK is dynamically imported, so offline builds never load it.
- **Compatibility:** `deserialize` fills defaults for fields added later (for example `Empire.era`), so older saves keep loading.

## Testing

- `tests/sim.test.ts` covers galaxy generation, determinism, save/load, economy, construction, starvation, outposts, colonisation, ship building, combat composition, invasion, diplomacy, research, AI expansion, eras and save migration.
- `tests/soak.test.ts` runs 30 in-game years with every kingdom AI-controlled and prints a yearly report: size, population, military, technology, Kardashev rating and resource balance.
- UI is checked with Playwright screenshots in headless Chromium (SwiftShader WebGL).
