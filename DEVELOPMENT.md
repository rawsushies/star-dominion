# Star Dominion — development

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests + 30-year soak
npm run build      # type-check + production build into dist/
npm run soak       # soak test only, with yearly reports
npm run soak:seeds -- 12 101 303   # multi-seed invariant check: years, then seeds
```

- `/lab.html` on the dev server shows every planet type rendered live, which is useful when tuning the planet shader.
- `/assets.html` on the dev server is the 3D asset viewer: every ship class, character body, antagonist, capital building tier and a full capital arrangement, each labelled with creator and licence.
- Debug hook: `window.__sd` is the zustand UI store. `__sd.getState().game` is the live `GameState`. For example, `__sd.getState().setSpeed(3)`.

## Deployment

The game is a static site and is deployed to **GitHub Pages** at https://rawsushies.github.io/star-dominion/.

- `.github/workflows/deploy.yml` runs on every push to `main`. It type-checks, runs the tests, builds, adds a `404.html` fallback and `.nojekyll`, and publishes `dist/` to the `gh-pages` branch.
- Pages serves `gh-pages` from the root. If Pages is ever switched off, turn it back on in **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` / root**.
- The build uses relative paths (`base: './'`), so it works under the `/star-dominion/` subpath. The game has no client-side routes, and the 404 fallback still serves the app.
- Saves stay in the browser (IndexedDB), so play needs no server. For Google cloud saves, set the four `VITE_FIREBASE_*` values as repository **variables** (not secrets; they are public web identifiers), then follow the steps below. Never commit `.env.local`.

## Enabling Google cloud saves (optional)

The game works fully offline. To let players keep their reign in their Google account:

1. Create a project at console.firebase.google.com. The free Spark plan is enough.
2. **Authentication → Sign-in method:** enable **Google**. Under **Authentication → Settings → Authorized domains**, add the domain you deploy to.
3. **Firestore Database:** create a database in production mode, then set these rules:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

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

## Known limitations and next steps

- **Balance:** AI kingdoms rarely reach Type II within 30 years. Megastructure investment needs tuning.
- **Bundle size:** the main chunk is about 970 KB minified because of Three.js. Lazy-loading the system view would cut this.
- **Multiplayer:** the simulation and command layer are ready for a server-authoritative host. Lobby, networking and conflict resolution are not built.
- **Mobile:** the HUD targets desktop. Below 1100 px the dispatches panel hides and windows fill the screen, but play on phones is not a goal.

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

**Benchmarks (10,000-system Milky Way, 5 kingdoms and 12 independent realms):**

- Galaxy generation: about 1.2–1.4 s.
- Simulation: 6.6 ms per day when profiled alone, about 10 ms per day under parallel test load.
- Save after 2 years: 3.7 MB.
- Renderer: about 4.4 ms of JavaScript per frame (0.5 ms dynamic buffers, 3.2 ms draw submission, 0.7 ms overlay). Headless SwiftShader reaches only 4–14 fps because it rasterises on the CPU; real GPUs are not fill-limited at this load.
