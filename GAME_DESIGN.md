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

- Galaxies come in three sizes: 30, 60 or 120 systems.
- Systems are scattered over spiral arms around a dense core.
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
- Every battle is recorded and can be replayed round by round in the battle viewer.
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

## Eras (civilisational evolution)

Each kingdom has a **Kardashev rating** shown under its name. The rating is its current era's type plus its progress toward the next era.

| Era | Type | Requirements | Bonuses |
|---|---|---|---|
| Age of Houses | 0.7 | start | — |
| Interstellar Imperium | I | 10 techs, 4 systems, 60 population | +3 admin, +6 naval, +10% research, +2 stability |
| Stellar Ascendancy | II | 26 techs, *Stellar Engineering*, 2 megastructure stages, 160 population | +25% energy, +15% research, +10% alloys, +10% hull |
| Galactic Hegemony | III | 42 techs, *Galactic Lattice Theory*, 25% of the galaxy, 6 megastructure stages | +20% core output, +15% damage, +10 admin, +30 naval |
| Transcendent Continuum | IV | *Dimensional Engineering*, Continuum Engine stage 1 | +40% research and energy, +25% shields, +25% growth |
| Omega Sovereignty | V | *Omega Theorem*, Continuum Engine stage 3 | **Ascension victory** |

- Era bonuses stack.
- Ascension technologies can only be researched once the matching era is reached.
- Reaching a new era pauses the game and shows a "new age" screen.
- AI kingdoms follow the same ladder, and the dispatches log announces when a rival advances.

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

## Onboarding

- The **guided first reign** (on by default) is a royal advisor with ten objectives. It covers time controls, research, exploration, building, outposts, ships, diplomacy and eras.
- Each objective completes itself when you actually do it, and the relevant control is highlighted.
- Tooltips explain every resource line, gauge and stat.

## Known limitations

- Era 2 and beyond are late-game goals. In 30-year test runs, AI kingdoms reliably reach Type I but rarely Type II. Megastructure appetite is still being tuned.
- There is no ground-combat screen: invasions resolve automatically.
- There is no espionage beyond intel accuracy.
- Diplomacy uses buttons and a deal builder. There is no free-text negotiation.
- Single-player only. The command layer is designed for a server-authoritative multiplayer layer, which does not exist yet.
