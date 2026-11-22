# Star Dominion — development

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests + 30-year soak
npm run build      # type-check + production build into dist/
npm run soak       # soak test only, with yearly reports
npm run soak:seeds -- 12 101 303   # multi-seed invariant check: years, then seeds
npm run fuzz -- 20 small,medium 1,2,3 25   # bug audit: random player commands (years, sizes, seeds,
                   #   commands per month) with invariants checked monthly; prints every problem kind
npm run fuzz:browser -- http://localhost:5181 20 2   # browser monkey audit against a running dev
                   #   server (clicks per screen, phases); desktop and phone; reports page/console errors
npm run test:e2e   # Playwright browser tests (starts its own dev server; needs Chromium:
                   #   npx playwright install chromium)
npm run candidates:fetch    # download CC0 candidate asset packs into dev-assets/ (gitignored)
npm run candidates:capture  # re-render docs/asset-previews/m11 (dev server on :5173 must be running)
npm run lab:capture -- http://localhost:5173 --perf   # capital laboratory screenshots + measurements
npm run candidates:fetch -- k-sci-fi-sounds k-interface-sounds && python3 -I scripts/build_audio.py
                   # rebuild public/assets/audio/sfx and src/audio/manifest.json from Kenney's CC0 packs
```

- `/lab.html` on the dev server shows every planet type rendered live, which is useful when tuning the planet shader.
- `/capitallab.html` on the dev server is the capital laboratory: the same sample capital as A (production), B (new lighting pipeline) and C (terraced diorama), with quality tiers and an FPS meter; `?gallery=1` shows the committed screenshots side by side. See `docs/CAPITAL_LAB.md`.
- `/compare.html` on the dev server is the asset comparison gallery: candidate sets for the capital, ships, heroes and villains, rendered side by side with the production set, plus external sets shown with their creators' previews. Run `npm run candidates:fetch` first.
- `/assets.html` on the dev server is the 3D asset viewer: every ship class, character body, antagonist, capital building tier and a full capital arrangement, each labelled with creator and licence.
- `window.__sdAudio.debug()` reports the music context, live sections, ambience scene, context state and any failed sound files.
- Debug hook: `window.__sd` is the zustand UI store. `__sd.getState().game` is the live `GameState`. For example, `__sd.getState().setSpeed(3)`.

## Deployment

The game is a static site and is deployed to **GitHub Pages** at https://rawsushies.github.io/star-dominion/.

- `.github/workflows/deploy.yml` runs on every push to `main`. It type-checks, runs the tests, builds, adds a `404.html` fallback and `.nojekyll`, and publishes `dist/` to the `gh-pages` branch.
- Pages serves `gh-pages` from the root. If Pages is ever switched off, turn it back on in **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` / root**.
- The build uses relative paths (`base: './'`), so it works under the `/star-dominion/` subpath. The game has no client-side routes, and the 404 fallback still serves the app.
- A service worker (`public/sw.js`, registered only in production builds) makes the game playable offline after the first visit and keeps models, textures and sounds on the device. Its cache is named after the release version (`sw.js?v=<package.json version>`), so a new release replaces it; bump the version in `package.json` for every release.
- Saves stay in the browser (IndexedDB), so play needs no server. For Google cloud saves, set the four `VITE_FIREBASE_*` values as repository **variables** (not secrets; they are public web identifiers), then follow the steps below. Never commit `.env.local`.

## Enabling Google cloud saves (optional)

The game works fully offline. To let players keep their reign in their Google account:

1. Create a project at console.firebase.google.com. The free Spark plan is enough.
2. **Authentication → Sign-in method:** enable **Google**. Under **Authentication → Settings → Authorized domains**, add the domain you deploy to.
3. **Firestore Database:** create a database in production mode, then publish the rules in [`firestore.rules`](firestore.rules) (paste them in the console's Rules tab, or run `firebase deploy --only firestore:rules`). They let each signed-in player read and write only their own saves under `users/{uid}/saves/{slot}`, and accept only the slot ids the game itself produces. These rules are not exercised by the automated tests (which use an in-memory stand-in for Firestore); check them in the Firebase console's Rules Playground or the emulator after changing them.

4. **Project settings → Your apps → Web app:** copy the config into `.env.local`, using `.env.example` as the template:

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_APP_ID=...
   ```

5. Rebuild. A **Sign in with Google** button appears on the title screen and in the Chancery (game menu).

These Firebase web keys identify the project and are not secrets. Access is controlled by the rules above.

## Adding content

- **Technology:** add an entry to `src/sim/data/techs.ts`. Use `mods` for modifier keys, `flags` for unlocks, and `era` to gate it behind a civilisational era.
- **Era:** edit `src/sim/data/eras.ts`. Requirements are declarative and are evaluated by `src/sim/eras.ts`.
- **Building, ship or megastructure:** add it to the matching file in `src/sim/data/`. Construction and the AI pick it up from the data.
- **Command:** extend the `Command` union and the `execute()` switch in `src/sim/commands.ts`. Validate there, never in the UI.
- **Resource operations:** kinds, modes and logistics rules live in `src/sim/operations.ts`. Output goes through `opReport()` into the normal ledger.
- **3D assets:** register a model in `src/ui/render/assets/catalog.ts` (file, pack, licence) and map it to a ship class, role or building tier there. Put GLBs in `public/assets/models/`, with textures embedded and at most 1024 px. Record the source in `docs/ASSET_CATALOG.md`. Only CC0 or other licences that allow redistribution are accepted.
- **Capital content:** buildings, costs, timers, prerequisites and effects live in `src/sim/data/capital.ts`; rules in `src/sim/capital.ts`; the 3D city in `src/ui/render/capital3d.ts`.
- **Governance content:** decrees, house ambitions and council petitions live in `src/sim/data/governance.ts`; rules in `src/sim/governance.ts`.
- **Character content:** roles, traits, skills, ambitions and items live in `src/sim/data/characters.ts`; council seats in `src/sim/data/council.ts`. Effects are named keys (`dmg`, `output`, `stability`…) read by `src/sim/characters.ts`.
- **Screen:** create it in `src/ui/screens/`, register it in `screens/index.ts`, `ScreenId` (`store.ts`), `NAV` (`Chrome.tsx`), the neocom groups (`Hud.tsx`) and the icons (`icons.tsx`). Wrap it in `<Sheet>` so it renders inside a window.

## Conventions

- `src/sim` must never import from `src/ui` or touch the DOM.
- Keep `GameState` plain JSON. When adding a field, give it a default in `save.ts` so older saves keep loading.
- All randomness inside the simulation must use `state.rng` helpers. Never use `Math.random()` there.
- UI copy is sentence case and states plainly what an action does.
- **Guidance stays truthful.**
  - A new mechanic needs a Codex entry (`src/guidance/codex.ts`) that describes what the code does.
  - A new window needs an entry in `src/guidance/screens.ts`.
  - Numbers belong in generated entries, never hand-written.
  - Lesson highlights use `data-guide` anchors (`<Section guide="…">`).
- New sounds go through `scripts/build_audio.py` (source, licence and manifest) and need a rule in `src/audio/manager.ts` if they can repeat quickly.

## Known limitations and next steps

- **Balance:** AI kingdoms rarely reach Type II within 30 years. Megastructure investment needs tuning.
- **Bundle size:** three.js (~730 KB minified) and React load as their own long-cached files; the game code is ~850 KB; the capital city loads on first visit (and is prefetched in idle time).
- **Multiplayer:** the simulation and command layer are ready for a server-authoritative host. Lobby, networking and conflict resolution are not built.
- **Mobile:** below 640 px the HUD switches to a phone layout (compact readouts, full-screen windows). It is tested on a phone-sized viewport in Chromium; real devices and Safari are not covered by the automated tests.

## Releasing

1. Bump `version` in `package.json` (shown in game, names the offline cache) and add a section to `CHANGELOG.md`.
2. Run the full checks: `npx tsc --noEmit -p .`, `npm test`, `npm run build`, `npm run test:e2e`, plus `npm run fuzz` for a longer bug audit.
3. Merge to `main`: the deploy workflow publishes the build. Tag the merge commit `v<version>` and create a GitHub release with the changelog section.

## Expansion progress (sovereign expansion)

This log is updated at each milestone, so work can resume after any interruption.

| # | Milestone | Status | Verification |
|---|---|---|---|
| 1 | Energy-based Kardashev index (`sim/power.ts`) | Done | `tests/power.test.ts`; 30-year soak: realms at K 0.80–0.88, one reaches Type I (K 1.07) |
| 2 | 3D barred-spiral galaxy, 10,000 systems, 3D renderer and navigation | Done | `tests/galaxy3d.test.ts` (connectivity, structure, sectors, A* optimality, lazy-body determinism, 10k simulation under 20 ms/day); Playwright: picking, double-click to enter, zoom and pan |
| 3 | Characters and Hall of Heroes | Done | `tests/characters.test.ts` (8): founding court, v1 legacy-admiral migration, validated recruit/assign/learn/dismiss, roster limit, council and leader modifiers, salaries, capture with pardon/ransom/recruit and peace-time exchange, AI keeps posts filled over 3 years; Playwright: recruit and assign in the Hall of Heroes |
| 4 | Governance: council, decrees, houses, provinces | Done | `tests/governance.test.ts` (8): houses founded, decree validation/cost/strength/cap/lapse/cooldown, levy angers low-tax houses, house loyalty → stability, revolt, suppress and grant, petitions arise/answer/lapse to a free default, governors add admin capacity, AI governs for 4 years with save/load determinism, v1 save gains governance fields; Playwright: issue a decree, houses and provinces tabs |
| 5 | Imperial capital builder | Done | `tests/capital.test.ts` (7): Citadel on its plot, plot/prerequisite/Citadel-cap/cost/queue validation, Citadel requirements open plots, a full city reaches Citadel 30 and its effects reach the realm, 75% refund, sacking on conquest, AI builds over 4 years with save determinism, v1 saves gain a capital; Playwright: 3D city renders, Build queues work, clicking a plot in 3D selects the right building. Visual references in `docs/references/` |
| 5b | Sourced 3D assets (CC0): ships, capital architecture, characters | Done | `tests/assets.test.ts` (4): files exist as valid self-contained GLBs from CC0 packs, animated models have idle clips and opaque materials, every ship class, role and building is mapped, and heavier classes are larger. Playwright: viewer sections, the capital built from sourced parts, fleet formations in the system view, an animated hero in the Hall of Heroes. See `docs/ASSET_CATALOG.md` and `docs/ASSET_WISHLIST.md` |
| 6 | Resource operations and logistics | Done | `tests/operations.test.ts` (6): site validation, gas harvesters, ledger integration, levels and modes, reserve drain and recovery, overstretch, cut-off and blockade, logistics tenders, industrialist bonus, old-save defaults, AI runs operations within capacity, save determinism. Playwright: found, surge and upgrade from the Operations screen |
| 7 | 3D ships and combat presentation | Done | Battle replays in 3D (`src/ui/render/battle3d.ts`) driven by the recorded `BattleReport`: real hulls in facing formations, beams, torpedoes and strike craft by role, shield flashes, hull damage tint, explosions with debris, starbases and planetary batteries from sourced parts. System-view fleet formations from milestone 5b. Playwright on a real 30-round simulated battle: 445 shots shown, 9 of 10 recorded kills by round 29 (the tenth falls in the final round), scrubbing works, no console errors. The simulation is untouched |
| 8 | Sovereign interfaces | Done | Throne room (ruler figure, standing, matters awaiting a decision, links to the ministries), War room (wars and war score, fronts with threat against defence, hostile fleets sighted, our fleets and commanders, battle replays), Chronicle (yearly record in `src/sim/chronicle.ts`, a history chart of each realm, headlines per year). These join the existing council, capital, Hall of Heroes, diplomacy and kingdom screens. `tests/chronicle.test.ts` (2): yearly records, no repeated headlines, save determinism, old saves. Playwright on a game simulated for 4 years: all three screens render, a matter opens its screen, no console errors |
| 9 | Public deployment | Done | `.github/workflows/deploy.yml` builds on every push to `main` and publishes `dist/` to the `gh-pages` branch. Live at https://rawsushies.github.io/star-dominion/ (HTTP 200). Vite uses a relative `base` (`./`), so the build works under any sub-path |
| 10 | Integrity: migrations, long simulations, docs | Done | `tests/migration.test.ts` loads the pre-3D v1 fixture, and every milestone test checks old-save defaults and save/load fingerprints. `scripts/soak-seeds.ts` runs several seeds and checks invariants: finite stocks, Kardashev in range, Citadel ≤ 30, valid ownership and assignments, logistics within capacity, and save round-trip equality. The soak found AI realms overstretching freighters (41/28). Fixed in `sim/ai.ts`: no new stations without spare capacity, and halted sites restart only when they fit. It also found that rebel states born mid-game lacked governance fields, so a save round-trip changed them (seed 202, year 20). Fixed in `blankEmpire`, with a regression test in `tests/integrity.test.ts`. Seeds 101, 202 and 303 over 30 years now pass every invariant |
| 11 | Visual identity: asset research and comparison | **At the approval gate** | Researched OpenGameArt, itch.io, Sketchfab (API), Fab (API), Poly Haven, ambientCG and CGTrader; TurboSquid, Kenney.nl and Poly Pizza are blocked by the proxy. 13 CC0 packs fetched reproducibly (`scripts/candidate-sources.json`) and rendered in the dev-only `/compare.html` gallery with per-model triangle, texture and animation counts; external sets are shown with creator previews. Findings, renders and three directions are in `docs/ASSET_WISHLIST.md`. **No production asset was replaced.** Engineering: the loader records and announces failures, and the HUD names missing models (`tests/e2e/assets.spec.ts`); every 3D view frees its GPU resources through `releaseView` (`tests/render-resources.test.ts`). Quality: Playwright tests are in the repo (`tests/e2e`, `npm run test:e2e`), and CI (`.github/workflows/ci.yml`) runs tsc, vitest, the build, a 3-seed integrity run and the browser tests, with a nightly 30-year 5-seed run. ARCHITECTURE.md and GAME_DESIGN.md are brought up to date |
| 12 | Diorama rendering: capital laboratory | **At the approval gate** | `capitallab.html` renders the same sample capital as A (production, unchanged), B (production scene through the new pipeline) and C (terraced island diorama with KayKit CC0 environment and Space Base dressing). `src/ui/render/pipeline.ts`: HDR sky + PMREM environment, fitted sun shadows, GTAO with a mobile profile and water excluded, emissive-only bloom, ACES via OutputPass; desktop/medium/mobile tiers. Diorama: instanced chunked vegetation, merged static geometry, detail culling; mobile tier 0.43M triangles and 393 draw calls per frame. Tests: `tests/diorama-layout.test.ts`, `tests/pipeline.test.ts`, `tests/e2e/capital-lab.spec.ts` (plot picking, variant switching, zero GPU resources after dispose, visual regression). Device frame rates not measured (SwiftShader only). **Production capital not replaced.** Details in `docs/CAPITAL_LAB.md` |
| 13 | Onboarding, guidance, Codex and audio | Done (browser tests written; to be confirmed by CI) | `docs/GUIDANCE.md`, `docs/AUDIO.md`, `docs/GUIDANCE_AUDIT.md`. `tests/guidance.test.ts` (16) and `tests/audio.test.ts` (12) pass; the full unit suite passes. Manually driven in Chromium: lesson 1 completed by real actions, Codex search and entries, info drawers, audio unlocked after a click, music switching contexts, no failed files and no console errors. `tests/e2e/guidance.spec.ts` and `audio.spec.ts` were not run locally (the run was stopped on request) |
