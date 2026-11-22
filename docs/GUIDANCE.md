# Tutorial, guidance and Codex

The audit behind this work is in `docs/GUIDANCE_AUDIT.md`. All guidance is UI-side (`src/guidance`); the simulation never reads it.

## Built for a complete beginner

A guided reign assumes the player knows nothing about strategy games. It teaches one thing at a time and only when it matters:

- **Few screens at first** (`src/guidance/path.ts`). A guided reign starts with only five screens on the left bar: Galaxy, Research, Planets, Fleets and Codex. Each other screen joins the bar when the game makes it matter. Meeting a realm adds Diplomacy, a war adds Military and the War room, and running out of something adds Economy; others come with time. Each new screen arrives with a one-line card saying what it is for. A "Show all screens" button on the bar turns this off. The setting is saved with the reign (`GameState.guidance.simple`), and an unguided reign shows every screen.
- **One tip at a time.** In a guided reign the panel is called "Next step" and shows the single most useful action. "Show other ideas" shows more. Tips about screens the player does not have yet are held back.
- **"What just happened?" cards** (`src/guidance/moments.ts`). The first time each of these happens, a short card explains it in plain words and says what to do:
  - meeting a realm;
  - a war declared on you;
  - enemy warships in your space;
  - your first battle;
  - a peace offer;
  - running out of a resource;
  - your first outpost finishing;
  - a rival getting ready to attack you;
  - a new screen joining the bar.

  Cards about danger pause the game. While a lesson runs, only danger cards and first contact interrupt it. Each card is shown once per reign.
- **"Do it for me".** Steps that ask for an order have a button that gives exactly that order through the normal command path (`LessonStep.auto`). Examples are picking the cheapest research, building the district for the lowest resource, sending the scout, declaring war, and offering peace terms from best to least. The player sees the result, and the step still completes from the real game state. If an order cannot be given (not enough influence, no shipyard), the panel says why.
- **Exact pointing.** A step can light up one specific button by its text (`text:<selector>|<text>`), for example the Send construction ship, Declare war and Invade buttons. If that button is not on screen, it falls back to the screen's button on the bar.
- **Plain words.** Lesson texts explain each game word the first time it is used: district, outpost, influence, alloys, troops.

## Lessons

| # | Lesson | Steps | What the player does (objectives are checked against real state) | Recommended when |
|---|---|---|---|---|
| 1 | The Basics | 6 | Start and stop the clock; pick something to research; order a district; let a month pass; learn where the Next step box is | Start of a guided reign |
| 2 | Getting Bigger | 5 | Learn what a star system is; explore with the scout; send the construction ship to claim a free system; own a second system | After 1 |
| 3 | Your First War | 10 | Learn the five parts of a conquest; get a target picked for you (the weakest known realm's world, small realms first); build warships to the strength shown; build troop transports for the soldiers needed; declare war; send the fleet; clear the orbit; land the soldiers; make peace | After 2, once a neighbour is known (or after two years) |
| 4 | Where Resources Come From | 5 | Open Economy and Industry; trade on the market (optional) | After 2, when something runs out or after a year |
| 5 | Settling New Planets | 5 | Queue a district or building; claim a second system; assign a governor (optional) | After 2, nine months in |
| 6 | Your Capital City | 4 | Open the capital; queue a capital building or upgrade | After 2, half a year in |
| 7 | Friends, Rivals and Your Court | 5 | Open Diplomacy; send a proposal (optional); open the Council; name an heir (optional) | After 2, on meeting a great realm |
| 8 | Research and Eras | 4 | Set research; queue research or open the tech tree; open the Kingdom window | After 2, after a year |
| 9 | Map Controls and Words | 5 | Select a system; enter a system and select a planet; explore a new system | After 2 |
| 10 | Ships in Detail | 5 | Queue a ship; give a fleet an order or stance | After 3, or when war comes |
| 11 | Your People | 4 | Open the Hall of Heroes; recruit or assign someone | After 2, after two years |
| 12 | Great Works | 4 | Open Construction | A new era or a megastructure technology |

The war lesson is tested end to end (`tests/beginner.test.ts`). The test gives a fresh realm money and supplies, then uses only the lesson's own "Do it for me" orders and the passage of time. In about three and a half game years it takes a small realm's planet and makes peace.

How lessons behave:
- Each step highlights the control it names. If that control's window is closed, the highlight falls back to the ministries button.
- Steps without an objective use "Continue"; a step with an objective can be skipped.
- The panel can be paused (it collapses to a bar), left (the lesson is marked unfinished) and resumed, restarted or replayed from **Codex → Lessons**.
- **Codex → Settings** resets all progress for the current reign.
- Progress lives in `GameState.guidance`, so it is saved with the game, including autosaves and cloud saves.
- Saves made with the old ten-step advisor (`GameState.tutorial`) migrate to Lesson 1.
- Lesson numbers follow the order in `CHAPTERS`; the beginner path comes first.

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
