# Tutorial, guidance and Codex

The audit behind this work is in `docs/GUIDANCE_AUDIT.md`. All guidance is UI-side (`src/guidance`); the simulation never reads it.

## Lessons

| # | Lesson | Steps | What the player does (objectives are checked against real state) | Recommended when |
|---|---|---|---|---|
| 1 | Your First Reign | 8 | Learn the goal and the three victories; run and pause time; then five real orders: choose research, build on the homeworld, send the construction ship to claim a neighbouring system ("Show me" selects it), send the scout exploring, let two months pass; finally, where to look from now on | Start of a guided reign |
| 2 | Understanding the Galaxy | 5 | Select a system; enter a system and select a planet; explore a new system with the scout | After 1 |
| 3 | The Imperial Capital | 4 | Open the capital; queue a capital building or upgrade | After 2 |
| 4 | Economy and Resources | 5 | Open Economy and Industry; trade on the market (optional) | After 3, or after three months |
| 5 | Expansion and Colonization | 5 | Queue a district or building; claim a second system; assign a governor (optional) | After 4, or five systems charted |
| 6 | Fleets and Warfare | 5 | Queue a ship; give a fleet an order or stance | After 5, or when war comes |
| 7 | Research and Civilization | 4 | Set research; queue or open the tech tree; open the Kingdom window | After 1 |
| 8 | Diplomacy and Great Houses | 5 | Open Diplomacy; send a proposal (optional); open the Council; name an heir (optional) | First contact, or after 7 |
| 9 | Characters and Leadership | 4 | Open the Hall of Heroes; recruit or assign someone | After 5, or after six months |
| 10 | Megastructures and Long-Term Ambition | 4 | Open Construction | A new era or a megastructure technology |

How lessons behave:
- Each step highlights the control it names. If that control's window is closed, the highlight falls back to the ministries button.
- Steps without an objective use "Continue"; a step with an objective can be skipped.
- The panel can be paused (it collapses to a bar), left (the lesson is marked unfinished) and resumed, restarted or replayed from **Codex → Lessons**.
- **Codex → Settings** resets all progress for the current reign.
- Progress lives in `GameState.guidance`, so it is saved with the game, including autosaves and cloud saves.
- Saves made with the old ten-step advisor (`GameState.tutorial`) migrate to Lesson 1.

## Contextual guidance

- **Information drawer.** The ? button in every window header shows:
  - the window's purpose, important controls and advanced notes;
  - links to Codex entries and the matching lesson.

  The content is in `src/guidance/screens.ts` and covers all 22 windows.
- **First-visit card.** The first time a window opens in a reign, a one-line explanation appears with "How it works" and "Got it" buttons. It is not shown while the active lesson already covers that window, and never again once dismissed.
- **Next steps panel** (`src/guidance/hints.ts`).
  - It opens with the goal for the current stage of the reign:
    - early: grow, explore, claim;
    - mid: specialise, find allies, hold your own;
    - late: go for one of the three victories.
  - Below the goal are the two or three most useful things to do now. "N more" reveals up to seven.
  - **Problems** come first: shortages, a rival arming against you, threatened worlds, idle research, unrest and waiting matters.
  - **Growth steps** follow:
    - settle a named habitable world with a colony ship;
    - build a construction ship to claim nearby systems;
    - build a scout to chart the frontier;
    - strengthen a fleet that is weak beside a neighbour;
    - make a pact with a realm that would sign;
    - the first missing requirement of the next era;
    - the closest ambition.
  - Every item is computed from the ledger and state at the moment it is shown, with real numbers. Each has a button that goes to the place where it is done. "Dismiss" hides an item for 180 game days.
  - During a lesson only danger-level items appear. The panel can be folded away.
- **"Show me"** in a lesson step opens the right window or selects the right thing on the map: the homeworld, a free neighbouring system, the survey ship.
- **Tooltips.** `Term` wraps a word with its Codex summary; clicking it opens the entry. They are used on resources, ministry flyouts, section titles, technologies, ship classes, roles, decrees, treaties, seats and capital buildings.
- **Preferences.** Lessons, hints and tooltips can each be turned off, or all at once ("I know the game"). They are stored per browser in `sd.guidance.v1`, and the title screen's guided checkbox follows them.

## Imperial Codex

Open it with F2, the book icon in the ministries column, a ? drawer link or a tooltip click. It has 15 categories, the ones the milestone asked for.

**Mechanic entries** (`mech.*`) are hand-written against the code. Each has these sections where they apply:
- what it is, what it does, how to use it;
- details and strategy;
- related entries and a button to the window where the mechanic is used.

The rules they quote, with their source files:
- invasion strength: `fleets.ts tryInvade`
- trade losses: `economy.ts`
- storage caps: `storageCap`
- shortages: `shortageOf`
- the stability multiplier: `stabilityOutputMult`
- war requirements: `canDeclareWar`
- treaty effects: `economy.ts` and `diplomacy.ts`
- megastructure instalments: `construction.ts`
- the Kardashev formula: `power.ts`

**Catalogue entries** are generated from `src/sim/data` and `sim/operations.ts` / `espionage.ts`. That covers every building, ship class, technology (with what it unlocks), era (requirements and effects), megastructure, capital building, role, trait, item, decree, government, policy, planet type and star type. Because the numbers are read from the same tables the simulation uses, they cannot drift.

Speculative content (the last two eras, the Continuum Engine, Kardashev Types IV and V) is labelled. No unimplemented feature is presented as working. The Codex states explicitly that battles resolve automatically and that invasions use transport troops against a garrison.

`tests/guidance.test.ts` checks:
- every link and screen reference resolves;
- every data item has an entry;
- quoted numbers equal the data (for example the residential district costs 80 minerals and 30 credits).
