# Star Dominion — architecture

```
src/
  sim/              deterministic simulation (no DOM, no React)
    data/           static definitions: planets, buildings, ships, techs, governments,
                    megastructures, eras, names, characters, council, governance, capital
    types.ts        GameState and every entity type (plain JSON)
    engine.ts       newGame, step (one day), monthly systems, stats, victory
    commands.ts     Command union + execute(): the ONLY way to change state on purpose
    economy.ts      ledger: jobs, production, taxes, trade, upkeep, storage, shortages
    fleets.ts       movement, supply, orders, invasion, conquest
    combat.ts       battle resolution and recorded BattleReports
    galaxy.ts       small spiral galaxies and the 10,000-system 3D Milky Way; spatial.ts indexes it
    power.ts        usable power in watts and the Kardashev index K = (log10 P − 6) / 10
    eras.ts         political eras (separate from Kardashev; some require a minimum K)
    characters.ts   heroes: roster, posts, levels, capture and ransom
    governance.ts   council seats, decrees, great houses, petitions, provinces
    capital.ts      the imperial capital city: plots, Citadel 1–30, building queue
    operations.ts   resource operations, modes, reserves and freighter logistics
    chronicle.ts    the yearly record behind the Chronicle screen
    modifiers.ts    additive modifier aggregation (government, policy, tech, eras, council,
                    decrees, capital, characters, timed effects), cached by signature
    ai.ts           AI kingdoms and corsairs (issue Commands like the player)
    save.ts         serialise / deserialise with migrations for older saves
  persistence/
    idb.ts          IndexedDB save slots (local)
    cloud.ts        Firebase Auth (Google) + Firestore saves (optional, lazy-loaded)
  ui/
    store.ts        zustand UI store, real-time loop, windows, toasts, save/load glue
    App.tsx         HUD composition
    components/     Hud, ContextPanel, MapView, MainMenu, Evolution, Tutorial, Account,
                    PlanetHero, OpControls, icons, common widgets, and in Chrome.tsx
                    the toasts and the asset-failure notice
    screens/        21 management screens rendered inside floating windows, including
                    Throne room, War room, Chronicle, Royal council, Imperial capital,
                    Hall of Heroes and Resource operations
    render/
      galaxy3d.ts   the 3D galaxy (10,000 systems, instanced stars, lanes, territory)
      system3d.ts   star-system scene with fleet formations built from real hulls
      planet3d.ts   procedural planet shader; planetScene.ts for large portraits
      capital3d.ts  the capital city built from sourced building parts by tier
      hero3d.ts     animated character stage (Hall of Heroes, throne-room ruler)
      battle3d.ts   3D replay of a recorded BattleReport
      pipeline.ts   shared post-processing pipeline and quality tiers (HDR sky/PMREM, fitted
                    shadows, GTAO, emissive bloom, ACES output)
      capitalDiorama.ts, dioramaLayout.ts   candidate terraced-island capital (laboratory only)
      nebula.ts     background bake
      assets/
        catalog.ts  registry of sourced models by role (ship class, character role,
                    capital building); the only file to edit when swapping an asset
        loader.ts   lazy GLB loading with a shared cache, failure records and events
        resources.ts  disposeObject / resourcesOf / modelStats (GPU cleanup, cost)
        release.ts  releaseView(): frees a view's resources but keeps the model cache
  dev/              development pages, never part of the production build:
    planetLab.ts    /lab.html: every planet type rendered live
    assetViewer.ts  /assets.html: every production model, labelled with its licence
    compare.ts      /compare.html: candidate asset sets compared side by side
    capitalLab*.ts  /capitallab.html: capital variants A/B/C, tiers, gallery; sampleCapital.ts
    candidates.ts   the candidate sets, their sources, verified facts and verdicts
scripts/
  soak-seeds.ts         multi-seed, multi-year invariant check (npm run soak:seeds)
  fetch-candidates.mjs  downloads CC0 candidate packs into dev-assets/ (gitignored)
  capture-candidates.mjs  renders gallery previews into docs/asset-previews/m11
  capture-capital-lab.mjs renders capital-lab screenshots and measurements (docs/asset-previews/m12)
tests/              vitest: simulation suite, milestone suites, 30-year soak
  e2e/              Playwright browser interaction tests (npm run test:e2e)
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
- **Galaxy map.** A Three.js scene (`galaxy3d.ts`) with an orbit, pan and zoom camera. It draws two kinds of stars, kept distinct: a scenic starfield of about 140,000 GPU points sampled from the generator's density model, and one pickable point per simulated system (up to 10,000), coloured by star type and dimmed by fog of war. Hyperlanes, territory clouds and the disc glow are GPU geometry, rebuilt only when ownership or visibility changes. Labels, selection, markers, fleets and map-mode overlays are drawn on a 2D overlay canvas, with distance-based level of detail.
- **3D.** Every 3D view owns one `WebGLRenderer` and frees it in `dispose()` through `releaseView`, which disposes every geometry, material and texture the view created while keeping the shared model cache. Planets use `ShaderMaterial`s with simplex-noise terrain, ocean, ice, lava, gas bands, clouds, city lights and an atmosphere shell.
- **Sourced models.** Views ask `catalog.ts` for a model by role and `loader.ts` loads it once. A simple placeholder shows while a model is in flight. If loading fails, the loader records the failure, logs it and notifies subscribers, and the HUD shows a notice naming the missing models. A missing asset is never silently replaced.
- **3D views:**
  - **System view:** a live perspective scene (`SystemView3D`). Labels, ownership rings and click targets come from projecting 3D positions onto a 2D overlay canvas.
  - **Thumbnails:** baked by one shared offscreen WebGL renderer and cached.
  - **Large portraits** (`PlanetHero`): live renderers.
- **Fallbacks.** If WebGL is unavailable, sprite baking falls back to flat discs and the system view degrades gracefully instead of throwing.

## Guidance (`src/guidance`)

UI-side; the simulation never reads it.

- `state.ts`: `GameState.guidance` (lesson progress, flags, hint snoozes), plus per-browser preferences in `localStorage` (`sd.guidance.v1`).
- `chapters.ts`: the ten lessons, written as data. A step is text, an objective predicate over a `LessonCtx` (game, UI, counters captured at the start of the step, recorded flags), highlight selectors (`[data-guide=…]` anchors in the screens) and a "Show me" screen.
- `lessons.ts`: the lesson engine.
  - Start, next, back, pause, skip, finish, reset and recommendation.
  - Recorded flags: `act:<command>` from the store's `onCommand` hook, plus `win:`, `sel:`, `view:system` and `ran` from store subscriptions.
- `hints.ts`: `currentHints(g)`, ranked and derived from the ledger and state.
- `screens.ts`: the information-drawer content for every window.
- `codex.ts`: hand-written mechanic entries plus catalogues generated from `src/sim/data`, with search.

UI components:
- `components/Guidance.tsx` holds the lesson panel, offer, hint card, info drawer, first-visit card and `Term` tooltips.
- `screens/Codex.tsx` is the Codex window.

The store exposes `onCommand` and `onPlayerEvents` listener hooks; listener errors can never break a command or the loop.

## Audio (`src/audio`)

- `manager.ts`: one `AudioContext`, created or resumed on the first user gesture (`installAudioUnlock`).
  - Routing: master gain ← limiter ← music (through a ducking gain), sfx and ambient buses.
  - Decoded buffers are cached. The `Throttle` enforces a per-sound gap and voice limit and a 24-voice cap.
  - Ogg is used, with an AAC fallback (`canPlayType`).
  - A missing file is warned about once and then skipped.
  - A muted or silent mix suspends the context.
- `music.ts`: the generative `MusicEngine`.
  - Instruments: detuned pads, a formant choir, FM bells, bass, brass, plucks and drums, through a convolution reverb.
  - Per-context key, mode, progression and instrumentation; a look-ahead scheduler; crossfading sections (at most one live); stingers.
- `ambience.ts`: one crossfaded bed at a time, mixing synthesised layers with Kenney loops.
- `director.ts`: pure choices (`musicFor`, `sceneFor`, `commandSound`, `eventSound`), plus the wiring to store subscriptions, the command and event hooks, and delegated click and hover listeners.
- `manifest.json`: generated by `scripts/build_audio.py`; the source and licence of every sound.

## Persistence

- **Local:** IndexedDB slots, an autosave, and JSON export/import files.
- **Cloud (optional):** when `VITE_FIREBASE_*` variables are set at build time, players can sign in with Google. Saves and autosaves are mirrored to `users/{uid}/saves/{slot}`. The payload is gzip-compressed (`CompressionStream`) and split into 700 KB `Bytes` chunks to stay under Firestore's 1 MiB document limit. The Firebase SDK is dynamically imported, so offline builds never load it.
- **Compatibility:** `deserialize` fills defaults for fields added later (for example `Empire.era`), so older saves keep loading.

## Testing

- `tests/sim.test.ts` covers galaxy generation, determinism, save/load, economy, construction, starvation, outposts, colonisation, ship building, combat composition, invasion, diplomacy, research, AI expansion, eras and save migration.
- `tests/soak.test.ts` runs 30 in-game years with every kingdom AI-controlled and prints a yearly report: size, population, military, technology, Kardashev rating and resource balance.
- Milestone suites: `power`, `galaxy3d`, `characters`, `governance`, `capital`, `operations`, `chronicle`, `assets`, `migration`, `integrity` and `render-resources`.
- `scripts/soak-seeds.ts` runs several seeds for many years and checks invariants each year: finite stocks, Kardashev range, the Citadel cap, house and character loyalty, logistics within capacity, and an unchanged state after a save round-trip.
- `tests/e2e` holds Playwright tests that drive the real app in headless Chromium (SwiftShader WebGL): a new reign and every sovereign screen, throne-room matters, repeated opening of the 3D views, the asset-failure notice, and the comparison gallery.
- `tests/guidance.test.ts`: lesson references and objectives, pause, skip, replay and reset, unlocking, save persistence, migration of the old advisor, hint conditions and snoozing, and Codex integrity and accuracy against the data.
- `tests/audio.test.ts` (fake Web Audio): settings, throttling, assets and licences, unlock, unsupported browsers, missing files, mute, crossfade without duplicate sections, and the director's choices.
- `tests/e2e/guidance.spec.ts` and `audio.spec.ts`: onboarding with save and reload, every lesson, the Codex, info drawers, hints, guidance off, audio after a gesture, volume and mute persistence, and missing audio files.
- CI (`.github/workflows/ci.yml`) runs the type check, unit tests, build, a 10-year three-seed integrity run and the browser tests on every push and pull request, plus a nightly 30-year five-seed run.
