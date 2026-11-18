# Star Dominion — development

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests + 30-year soak
npm run build      # type-check + production build into dist/
npm run soak       # soak test only, with yearly reports
```

- `/lab.html` on the dev server shows every planet type rendered live, which is useful when tuning the planet shader.
- Debug hook: `window.__sd` is the zustand UI store. `__sd.getState().game` is the live `GameState`. For example, `__sd.getState().setSpeed(3)`.

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
| 5 | Imperial capital builder | Pending | |
| 6 | Resource operations and logistics | Pending | |
| 7 | 3D ships and combat presentation | Pending | |
| 8 | Sovereign interfaces | Pending | |
| 9 | Public deployment | Pending | |
| 10 | Integrity: migrations, long simulations, docs | Ongoing | `tests/migration.test.ts` loads the pre-3D v1 fixture |

**Benchmarks (10,000-system Milky Way, 5 kingdoms and 12 independent realms):**

- Galaxy generation: about 1.2–1.4 s.
- Simulation: 6.6 ms per day when profiled alone, about 10 ms per day under parallel test load.
- Save after 2 years: 3.7 MB.
- Renderer: about 4.4 ms of JavaScript per frame (0.5 ms dynamic buffers, 3.2 ms draw submission, 0.7 ms overlay). Headless SwiftShader reaches only 4–14 fps because it rasterises on the CPU; real GPUs are not fill-limited at this load.
