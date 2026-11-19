# Star Dominion — game design

You are the sovereign of a young interstellar kingdom: one world, a few ships, and rivals who are just as hungry. The game is real-time with pause. Every system below is implemented and running in the simulation (`src/sim`).

## Pillars

- **A kingdom, not a ship.** You never fly anything. You set policy, build, research, negotiate and send fleets.
- **A living galaxy.** AI kingdoms use the same rules and the same command layer as the player. They expand, trade, ally, betray and fall without scripting.
- **Readable depth.** Every number has a tooltip or ledger line that shows where it comes from.
- **Evolution.** Kingdoms climb from feudal houses to god-like civilisations (see *Eras*).

## Time

- One tick is one day.
- Monthly systems run every 30 days: diplomacy, unrest, events, eras, statistics and victory.
- Speeds are paused, 2, 6 and 15 days per second.
- Important events (war, invasion, rebellion, a new era) pause the game automatically. This can be turned off in the Chancery.

## Galaxy

- Galaxies come in four sizes: 30, 60 or 120 systems, or a **Milky Way of 10,000 systems**.
- Small galaxies scatter systems over spiral arms around a dense core. The Milky Way is a 3D barred spiral: a bulge and central bar, two major and two minor arms, a flared disc, clusters and a halo, with named sectors. It is explored in a 3D renderer.
- Hyperlanes form a planar graph that is always connected, with a few extra crossings for shortcuts.
- **Stars:** yellow, orange, red, white, blue, neutron, pulsar or black hole. Star type changes megastructure options and battle conditions (a pulsar disables shields).
- **Bodies:** 12 planet types plus moons and asteroid belts. Each type has its own district mix and yields, and habitability depends on your species' climate (verdant, arid or boreal).
- **Features:**
  - nebulae (sensor haze);
  - jump nexuses (toll hubs);
  - derelicts (salvage);
  - precursor ruins (one-off research);
  - sentinel lairs (guardian fleets that hold rich systems).
- Fog of war: you see owned and adjacent systems, your fleets' sensor ranges and your allies' territory.

## Economy

Nine stockpiled resources:

| Category | Resources |
|---|---|
| Base | credits, minerals, energy, food |
| Refined | alloys, electronics, components, rare elements |
| Political | influence |

Research is a monthly flow rather than a stockpile.

- **Jobs:** each world has jobs from districts and buildings. Population fills jobs in priority order: capital, food, energy, refining, extraction, and so on. Unfilled jobs produce nothing.
- **Production chains:** minerals → alloys (foundry) and electronics (fabricator); electronics + alloys → components. Shortages cripple everything downstream.
- **Taxes and trade:** each colony pays tax and generates trade value. Trade travels to the capital along your supply network.
  - Every lane without a starport or a recent patrol loses 2.5% to piracy.
  - Hostile armed ships on the route cut it off entirely.
- **Upkeep:** buildings, fleets and starbases all cost upkeep. Exceeding naval or administrative capacity makes everything more expensive and less stable.
- **Storage:** stockpiles have caps, and output above a cap is wasted.
- **Market:** a galactic broker buys and sells goods. Prices move with every trade and drift back each month.

## Planets

- Building slots grow with population.
- Districts are limited by planet size and type.
- 22 building types, including the capital palace, arcologies, research labs, shipyards, garrisons and planetary shields.
- Stability per world (0–100) comes from government, policy, buildings, unemployment, occupation, war exhaustion and over-extension. Stability scales output.
- Below 35, unrest builds. Long unrest becomes revolt, and a world can break away as a rebel state or return to its former owner.

## Kingdom management

- **Governments (6):** Imperial Monarchy, Democratic Republic, Military Dictatorship, Technocratic Directorate, Corporate Syndicate and Feudal Kingdom. Each has distinct bonuses. Reform costs influence and has a 10-year cooldown.
- **Ministries (6):** Treasury, Defence, Industry, Science, Foreign Affairs and Interior. They hold 11 policies with trade-offs: taxation, trade law, military budget, border security, subsidies, construction, research priority, diplomatic stance, intelligence, population and colonisation.

## Expansion

- **Outposts:** a construction ship claims an unclaimed system. Claim cost rises with distance and realm size.
- **Colonies:** a colony ship settles a habitable planet. Colony ships cost more for every colony you already have.
- **Administrative capacity** caps how many systems you can govern efficiently.

## Military

- **13 hull classes:**
  - warships: corvette, frigate, destroyer, cruiser, battlecruiser, carrier, battleship, dreadnought;
  - support: scout, logistics, troop transport, construction ship, colony ship.
- Each hull has hull, armour and shield values, plus damage, tracking, evasion, strike craft, point defence, shield pierce, speed and naval cost.
- **Fleets** take admirals (skill and a trait), stances (aggressive, defensive or passive) and orders: move, patrol, blockade, invade, outpost and colonise.
- Fleets draw supply inside your network, suffer attrition outside it, and repair at friendly starbases.
- **Combat** runs automatically, three rounds a day:
  - targets are chosen by size preference;
  - hit chance is tracking against evasion;
  - damage hits shields, then armour, then hull;
  - point defence thins strike craft;
  - outmatched fleets retreat.
- Every battle is recorded and can be replayed round by round, in 3D, with the real hulls in formation.
- **Invasion:** first win the orbit by defeating fleets, starbase and planetary defences. Then troop transports land against the garrison. Conquered worlds resist for years.

## Diplomacy

- **Opinion** combines government affinity, borders, treaties, trade and a memory of events: broken pacts, wars, gifts and insults. Memories fade over time.
- **Treaties:** non-aggression pact, trade agreement, research cooperation, mutual defence, alliance and vassalage.
- **Deals:** one-off exchanges of credits, resources and systems, plus recurring resource contracts.
- **War:** declaring war costs influence and drags in defensive allies. War score comes from battles and occupation. Peace terms are status quo, tribute, ceding systems, or vassalisation. A five-year truce follows.
- Intelligence accuracy depends on borders, treaties and the intelligence policy. Low intel shows estimates with error bars.

## Research

- 9 fields across 5 tiers (55 technologies), plus the **Ascension** field.
- Technologies give modifiers and unlock hulls, buildings, starbase upgrades and megastructures.
- Research continues while a project is set. Queue a locked technology and its prerequisites are queued automatically.

## Megastructures

| Megastructure | Effect |
|---|---|
| Orbital Ring | Faster shipbuilding |
| Bastion Citadel | Near-impregnable system |
| Dyson Swarm | Huge energy |
| Stellar Collector | Energy |
| Hypergate | Instant jumps between gates |
| Grand Archive | Research |
| Lattice Network | Admin and stability |
| **Continuum Engine** | Era-gated; see below |

All are built in stages over years.

## Kardashev index (energy)

The Kardashev index is a scientific energy rating, kept separate from political eras (`src/sim/power.ts`).

- **P** is the realm's usable power in watts, built from real infrastructure:
  - the planetary grid (energy jobs, collector stations, capital power plants);
  - stellar harvesting (collectors and Dyson swarms capture part of their star's luminosity);
  - galactic harvesting (sector-scale arrays);
  - the Continuum Engine (a speculative vacuum-energy tap).
- **K = (log10(P) − 6) / 10** (Sagan's interpolation). Type I is 10¹⁶ W, Type II is 10²⁶ W and Type III is 10³⁶ W.
- Type IV and V (10⁴⁶ and 10⁵⁶ W) go beyond Kardashev's original scale. They are labelled *speculative* wherever they appear.
- The throne room ranks the great realms by K.

## Eras (political evolution)

Eras are political ages. Some list a minimum Kardashev index among their requirements, but an era is not a Kardashev type.

| Era | Requirements | Bonuses |
|---|---|---|
| Age of Houses | start | — |
| Interstellar Imperium | 10 techs, 4 systems, 60 population | +3 admin, +6 naval, +10% research, +2 stability |
| Stellar Ascendancy | 26 techs, *Stellar Engineering*, K ≥ 1.0, 160 population | +25% energy, +15% research, +10% alloys, +10% hull |
| Galactic Hegemony | 42 techs, *Galactic Lattice Theory*, 25% of the galaxy, K ≥ 2.0 | +20% core output, +15% damage, +10 admin, +30 naval |
| Transcendent Continuum | *Dimensional Engineering*, K ≥ 3.0, Continuum Engine stage 1 | +40% research and energy, +25% shields, +25% growth |
| Omega Sovereignty | *Omega Theorem*, Continuum Engine stage 3 | **Ascension victory** |

- Era bonuses stack.
- Ascension technologies can only be researched once the matching era is reached.
- Reaching a new era pauses the game and shows a "new age" screen.
- AI kingdoms follow the same ladder, and the dispatches log announces when a rival advances.

## Characters (Hall of Heroes)

- **Nine roles:** admiral, general, governor, scientist, diplomat, chancellor, industrialist, explorer and spymaster.
- Characters have attributes, traits, levels, skill points, loyalty and a salary. The roster is limited, and the capital's Hall of Heroes raises the limit.
- **Posts:** fleet command, planetary governorship, resource operations, and the six council seats.
- Characters can be captured in battle. Captives can be pardoned, ransomed or recruited, and they are exchanged at peace.

## Governance

- **Royal council:** six seats (Chancellor of the Treasury, Grand Marshal, High Steward of Industry, Archscholar, Envoy-General and Spymaster). Each seat turns its holder's attributes into realm modifiers.
- **Decrees:** twelve timed edicts, such as extraordinary levy, royal festival, war footing, martial law and imperial census. Each has a cost, strength, duration and cooldown. At most three are in force at once, or four with a level-10 throne hall.
- **Great houses:** each realm has noble houses tied to provinces. Their loyalty feeds stability. Disloyal houses revolt, and a revolt can be suppressed or bought off with grants.
- **Petitions:** matters arise for the council and lapse to a default if they go unanswered.
- **Provinces** are the galaxy's sectors. Governors add administrative capacity.

## Imperial capital

- The capital world holds a city of plots around the **Citadel (levels 1–30)**. Each Citadel level opens plots and raises the cap on every other building.
- **Sixteen buildings:** Citadel, throne hall, royal treasury, Hall of Heroes, research institute, imperial shipyards, refinery complex, diplomatic quarter, military academy, intelligence bureau, grand market, bastion walls, arcology spires, stellar observatory, stellar forge and monument of the ages.
- Buildings are queued, cost ordinary resources, and feed realm modifiers through the same ledger as everything else.
- Demolition refunds 75%. A conquered capital is sacked.

## Resource operations

- Mining, energy, gas and research stations on uncolonised bodies run as **operations** with levels 1–5 and four modes:
  - **standard:** steady output, with a reserve that falls slowly;
  - **surge:** +60% output at double upkeep, with a reserve that drains fast;
  - **sustain:** −30% output while the reserve recovers;
  - **halted:** no output or upkeep, and logistics capacity is freed.
- Deliveries need freighter **logistics capacity** (logistics tenders add more). An operation outside the supply network delivers half. A hostile warfleet in the system blockades it completely.
- An industrialist can direct an operation and raise its output.
- Output enters the ordinary economy ledger. There is no second economy.

## Sovereign screens

- **Throne room:** the ruler's portrait, standing among the great realms, the matters awaiting a decision (each one opens its ministry) and the ministries.
- **War room:** wars and war score, fronts with threat against defence, hostile fleets sighted, our fleets and their commanders, and 3D battle replays.
- **Chronicle:** a yearly record of every realm, a history chart, and the headlines of each year.

## Victory and defeat

- **Domination:** hold 60% of all systems.
- **Supremacy:** no rival major kingdom left standing, apart from your vassals.
- **Ascension:** reach Omega Sovereignty.
- **Defeat:** you lose your last world.
- After a victory you may keep ruling.

## Threats

- **Void Corsairs** raid unpatrolled space.
- **Precursor Sentinels** guard their lairs.
- **Random events (9 types):** windfalls, plagues, discoveries, unrest and more.

## Onboarding and guidance

Players learn by playing, and guidance never takes control. Details are in `docs/GUIDANCE.md`.

- **Ten lessons.** Welcome, Galaxy, Capital, Economy, Expansion, Fleets and warfare, Research and civilisation, Diplomacy and houses, Characters, Megastructures.
  - Each step names one objective. The objective ticks itself from real game state or a recorded player command, and the control involved is highlighted.
  - Lesson 1 starts with a guided reign. Later lessons unlock progressively and are offered once, never forced.
  - Lessons can be paused, skipped, left, replayed and reset. Progress is saved with the game.
- **Imperial Codex** (F2, or the book icon). A searchable encyclopedia in 15 categories.
  - Mechanic entries are written against the simulation code.
  - Catalogue entries (buildings, ships, technologies, eras, megastructures, capital buildings, roles, traits, items, decrees, governments, policies, planets, stars) are generated from the data tables, so their numbers are always the game's own.
  - Speculative content is labelled as such.
- **Every window explains itself.** A ? drawer shows the window's purpose, its controls, advanced notes, Codex links and the matching lesson. A first-visit card appears the first time a window opens.
- **Advisor hints.** Hints are shown only when the condition is real:
  - shortages and stockpiles running out, full storage and idle research;
  - an idle construction ship or scout, idle builders on a planet or in the capital;
  - unassigned characters, unspent skill points, waiting petitions and envoys, and no heir in old age;
  - naval capacity exceeded, restless worlds, and threatened or exposed worlds at war.

  One hint shows at a time; dismissing one hides it for six months. During a lesson only urgent hints appear.
- **Tooltips** on resources, ministries, section titles, technologies, ships, roles, decrees and capital buildings are backed by the Codex.
- Experienced players can turn lessons, hints and tooltips off, together or separately. The preference is stored per browser.

## Audio

A central audio manager drives music, sound effects and ambience. Details are in `docs/AUDIO.md`.

- **Music** is original and generated live in eight contexts:
  - empire entry, galaxy exploration, empire management, capital development;
  - political tension, war, megastructure construction, late-game civilisation.

  Contexts crossfade over several seconds. Stingers mark eras, war, victory, defeat and finished megastructures.
- **Sound effects** are Kenney CC0. They cover interface actions, notifications, trade, construction, research, recruitment, fleet orders, combat, diplomacy, characters and megastructure stages.
- **Ambience** follows the view: space, orbit, the capital's industry, or ship engines.
- **Settings:** master, music, effects and ambience volumes, and mute (M key or the speaker button). Settings are stored per browser.

## Known limitations

- The visual direction for the capital, ships, heroes and villains is under review (milestone 11). See `docs/ASSET_WISHLIST.md`. The current models are placeholders that have not been approved.

- Era 2 and beyond are late-game goals. In 30-year test runs, AI kingdoms reliably reach Type I but rarely Type II. Megastructure appetite is still being tuned.
- There is no ground-combat screen: invasions resolve automatically.
- Diplomacy uses buttons and a deal builder. There is no free-text negotiation.
- Single-player only. The command layer is designed for a server-authoritative multiplayer layer, which does not exist yet.
