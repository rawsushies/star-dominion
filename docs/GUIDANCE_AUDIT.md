# Guidance and audio audit (Phase 0)

This audit was made on main at 6cc7ec1 (plus 6b76e0d, which only adds candidate sources). It records what the game actually does, so that the tutorial, hints and Codex describe real mechanics only.

## Game flow and UI architecture

- `src/main.tsx` mounts `App`.
  - With no game loaded, `App` shows `MainMenu`: realm setup and a "Guided first reign" checkbox.
  - With a game, `App` shows the shell: `MapView`, the HUD (`LocationHud`, `ResourceStrip`, `ThroneDial`, `Dispatches`, `Overview`), `ContextPanel`, the `WindowLayer` of management windows, `Neocom`, `Toasts`, `EraDawn` and `GameOver`.
- State lives in `src/ui/store.ts` (zustand `useUI`).
  - `GameState` sits outside React and is changed only by `step()` (the engine) and `execute()` (commands, via `ui.cmd`). React re-renders on a revision counter.
  - The loop is `startLoop()`, which runs at `SPEEDS = [0, 2, 6, 15]` days per second. New events become toasts and dispatches in `surfaceEvents()`.
  - The store is exposed as `window.__sd` for the e2e tests.
- Management screens are floating windows (`Win`), keyed by `ScreenId` and registered in `src/ui/screens/index.ts`. They open through `openScreen(id)` and `WindowFrame` (in `Hud.tsx`) renders their chrome.
- Saves:
  - `serialize` produces JSON. `deserialize` checks `SAVE_VERSION = 1` and applies forward-compatible defaults (migrations) in `src/sim/save.ts`.
  - Local saves go to IndexedDB (`persistence/idb.ts`); there is an optional Firebase cloud save, and an autosave every 360 days.
- The existing guidance system:
  - `components/Tutorial.tsx`: a 10-step linear advisor, stored in `GameState.tutorial = { step, base }`. Steps complete themselves from real state and highlight a control with the `.coach` CSS class.
  - Tooltips use `Tip` in `components/common.tsx`. The resource strip, dial gauges and many screen rows already have tooltips.
  - There is no Codex, no info panels and no smart hints.
- Audio: none. There were no audio files, no Web Audio code and no settings.

## Mechanic → screen → state

| Mechanic | Where the player does it | State and rules (file) |
|---|---|---|
| Time and speed | Throne dial (`.dial-center`, `.spd`); Space and the 1–3 keys | `ui.speed`; `step()` in `sim/engine.ts` |
| Galaxy, systems, fog of war | Map: left-click selects, double-click enters a system, right-click moves the selected fleet. Overview → Systems tab | `galaxy.systems`, `empire.explored`, `visibleSystems` (`sim/territory.ts`) |
| Planets and colonies | Planets window; ContextPanel "Manage colony" | `Planet.colony` (pops, buildings, queue, stability); `sim/economy.ts` |
| Provinces (sectors) and designations | Planets → Province role; Council (governors) | `system.sector`; `colony.designation` (`data/designations.ts`): costs 25 influence, 360-day cooldown |
| Capital city (Citadel) | Capital window: plots, queue, Citadel levels (max 30) | `empire.capital` (`sim/capital.ts`, `data/capital.ts`) |
| Planet buildings and districts | Planets → Districts and buildings | `queueBuilding`; `canBuild`; costs are paid when work starts (`sim/construction.ts`) |
| Resources | Resource strip, Economy | 9 stockpiled resources (`RESOURCES`) plus research. Storage: 2000 base plus depots (credits ×6, influence 1500). A shortage means stock below 0.5 while net income is negative |
| Production chains | Industry | Foundry: minerals → alloys. Fabs: → electronics. Works: → components. A missing input cuts output to 25% |
| Trade | Trade, Economy | Trade value is routed to the capital. Hostile ships cut a route. Each unprotected lane without a starport loses 2.5% (up to 50%). Each trade agreement gives +8% plus 2 credits |
| Market | Economy → Galactic market | `market` command: broker fee from 20%; prices move with volume. Credits and influence are not tradable |
| Exploration and outposts | Fleets / ContextPanel: Survey Corps, "Send construction ship" | Outposts cost claim-cost influence plus 40 alloys and take 60 days; the constructor is consumed (`sim/fleets.ts`) |
| Colonisation | ContextPanel "Send colony ship" | The planet must be habitable. An unclaimed system also needs claim influence. Colonising takes about 150 days |
| Ships and fleets | Planets (shipyard), Industry, Fleets, Military | `queueShip`; 13 classes (`data/ships.ts`); naval capacity; stances; merge and split |
| Space combat | Automatic when hostile fleets share a system; Military → battle reports | `sim/combat.ts`: three rounds a day; tracking vs evasion; shields then armour; strike craft vs point defence |
| Ground invasion | ContextPanel "Invade with …" (transports) | `tryInvade`: the orbit must be secured first. Troops × general bonus × random 0.85–1.15 × shield (0.6) × supply, against the garrison. Transports are consumed either way |
| Research | Research, Tech tree | 9 categories plus Ascension; tiers 1–8; prerequisites; era-locked techs (`data/techs.ts`) |
| Political eras | Kingdom → Political eras; era badge | `data/eras.ts`: requirements are techs, systems, pops, megastructure stages and a minimum K |
| Kardashev index | Kingdom; era badge | `sim/power.ts`: K = (log10 W − 6)/10. A scientific energy rating, separate from eras |
| Diplomacy | Diplomacy | Opinions with decaying memories; treaties (NAP, trade, research, defence, alliance, vassal); exchanges; contracts; war and peace terms (`sim/diplomacy.ts`) |
| Council, ministries, policies | Council, Kingdom, Throne | `COUNCIL_SEATS` (6); `POLICIES` by ministry; government reform |
| Decrees and petitions | Council | `DECREES` (at most 3 in force); petitions with options (`sim/governance.ts`) |
| Great Houses | Council | Power, loyalty, ambition, grievance and revolt; grant, suppress and honour actions |
| Succession | Throne → Succession | Heir costs 10 influence. A crisis without an heir (`sim/succession.ts`) |
| Characters | Hall of Heroes | Recruit from candidates; roster limit; skills, equipment, loyalty, ambitions; captives |
| Espionage | Intelligence → Covert operations | Spymaster operations: gather intel, steal tech, sabotage, incite unrest (`sim/espionage.ts`) |
| Resource operations | Operations, Systems | Stations on uncolonised bodies: levels 1–5, modes, reserves, logistics (`sim/operations.ts`) |
| Megastructures | Construction, Systems → Megastructures | `data/megastructures.ts`: tech-gated; staged instalments over `stageDays` |
| Chronicle and journal | Chronicle, Journal | Yearly standings; the event log |

## Implemented versus only documented

Everything in the table is implemented and reachable in the UI.

Two things must be labelled carefully:
- The last two eras and Kardashev Types IV and V are speculative. The code already labels them that way.
- There is no player-controlled tactical combat. Battles resolve automatically, and the player controls composition, stance, admirals, supply and where to fight.

There is no per-planet ground army management: invasions use transport troops against the planet's garrison.

## Starting position (verified in `newGame`)

- One capital colony.
- Fleets: Home Guard (3 corvettes, with an admiral), the Survey Corps (a scout) and a construction ship.
- A scientist and a chancellor are already on the council.
- Stock: 400 credits, 500 minerals, 300 energy, 300 food, 250 alloys, 80 electronics, 20 components, 100 rare elements and 80 influence.

## Plan that followed

1. Guidance state saved in `GameState.guidance` (migrated from the old `tutorial` field), plus per-browser preferences.
2. Ten chapters with steps that complete themselves from real state, unlocking progressively. They can be replayed from the Codex Lessons tab.
3. A "?" info panel and a first-visit card in every window; tooltips backed by the Codex; smart hints computed from the real ledger and state.
4. The Codex is generated from the data files (buildings, ships, techs, eras, megastructures, capital, characters, council, decrees, designations, governments, planets), plus hand-written mechanic entries checked against the code above.
5. Audio: a central Web Audio manager with master, music, SFX and ambient buses.
   - Kenney CC0 interface and sci-fi sound effects (fetched from the OpenGameArt mirrors; kenney.nl is blocked by the proxy).
   - Original generative music and ambience synthesised in the browser.
