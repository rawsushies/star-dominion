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
