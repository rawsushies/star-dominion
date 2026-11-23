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
- **War:** declaring war costs influence and drags in defensive allies. War score comes from battles, captured worlds and occupation: each enemy colony system held by your warships with no defending fleet moves the score one point a month (up to three a month). Peace terms are status quo, tribute, ceding systems, or vassalisation. A five-year truce follows.
- **Fear of a leader:** a realm racing towards victory (territory, people or the last eras) is feared by every other great realm. Their opinion of it falls, they sign defence pacts with one another more readily (coalitions), and they plan wars against it.
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
| Galactic Hegemony | 42 techs, *Galactic Lattice Theory*, 25% of claimed space, K ≥ 2.0 | +20% core output, +15% damage, +10 admin, +30 naval |
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

Three distinct roads to victory, open to every great realm, the AI included (`src/sim/victory.ts`). The throne room shows your progress on each and that of the leading rival you know of.

- **Domination (territory):** hold half of all claimed systems and two fifths of the population of every sovereign realm, then keep it for two years. Measured against claimed space, so it means the same in every galaxy size.
- **Supremacy (war and diplomacy):** no rival great realm left independent: each has fallen or is your vassal.
- **Ascension (civilisation):** reach the last era, Omega Sovereignty.
- **Warnings:** the galaxy is told when a realm starts a domination hold or reaches three quarters of the way to any victory. The game pauses for these.
- **Defeat:** you lose your last world, a rival achieves any victory, or the Omega Incursion consumes the galaxy (corruption over 45% of claimed space).
- The Grand Expansion adds crisis outcomes without new ways to win: the Warden of the Galaxy title, the ancients' relics, the Devourer's heart. None of them replaces or shortens the three roads. An Ascension Injunction can regulate the Continuum Engine or the Omega Theorem for bound Conclave members, but any member may defy it, at a price.
- After a victory you may keep ruling.

## Ambitions

Optional milestones in three phases: a foothold among the stars, a realm among realms, a civilisation of the galaxy (`src/sim/ambitions.ts`). Examples: chart 12 systems, found a second world, sign a first treaty, win a war on favourable terms, specialise provinces, run supply operations, complete great works, head a bloc. None is required. Each pays a modest one-time reward (influence, resources or a temporary bonus). They are listed in the throne room with progress bars.

## Rival AI and difficulty

Every AI realm issues the same validated commands as the player and sees rivals through the same fuzzed intelligence (`src/sim/strategy.ts`, `src/sim/ai.ts`).

- **Strategic goals:** expand, develop, arm, war, recover or ascend, reviewed every few months.
  - **Arm:** the realm picks a reachable rival worth fighting, weighing border systems' value against estimated strength, both sides' allies, opinion and temperament. It builds up its fleet, stages it on the border and secures its other flanks with non-aggression pacts. Then it declares war, or stands down.
  - **Recover:** after shortages, unrest, exhaustion or heavy losses, the realm rebuilds before taking risks.
  - **Ascend:** late realms chase era breakthroughs and megastructures.
- **War:**
  - Fleets defend by need.
  - A main battle group takes enemy worlds, preferring targets near allied fleets. Transports wait at a staging system and land together once the orbit is held.
  - Raiding groups blockade weakly held systems.
  - Damaged or starving fleets go home to repair, and outmatched fleets retreat.
  - Peace terms follow the score, the strength balance and exhaustion.
- **Telegraphing:** when a rival arms against you and your intelligence on it is decent, you are told.
- **Difficulty** changes how well rivals play, never what they are given. There are no hidden bonuses.

| | Relaxed | Standard | Hard |
|---|---|---|---|
| Turn interval | 8 days | 5 days | 3 days |
| Strategic review | 180 days | 120 days | 90 days |
| Strength needed to declare war | 2× | 1.5× | 1.25× |
| Offensive wars at once | 1 | 1 | 2 |
| Years before targeting the player | 15 | 8 | 4 |
| Battle groups | 1 | 2 | 3 |
| Betrays pacts | never | never | aggressive, low-diplomacy realms |
| Coalition response to a leader | weaker | full | full |
| Imperfect build choices | 35% | 10% | none |

## Threats

- **Void Corsairs** raid unpatrolled space.
- **Precursor Sentinels** guard their lairs.
- **Random events (9 types):** windfalls, sickness, discoveries, unrest and more.
- **Event chains** (`src/sim/chains.ts`) arise from the realm's situation and come before the council as matters to decide. An answer can bring a later stage months afterwards.
  - The precursor vault: an ancient site in your space.
  - The fever: on crowded worlds.
  - Separatists: on conquered or restless worlds.
  - The guilds' loan: for a solvent crown at peace.
  - The corsair warlord: when raiders are inside your borders.

  Each choice has lasting effects: research, weapons, reputation with every court, population, stability, raiders, debts or privateers.

## The Grand Expansion (late game)

Three connected systems for the decades after the opening (`src/sim/expansion.ts` and its modules). The **High Conclave** and **Ancients and threats** windows show them; the galaxy map draws the Devourer, its announced path, the Omega rift and corruption, and the Archons' sacred worlds.

### The High Conclave (`conclave.ts`)

- **Founding:** in the third year once a great realm reaches the Interstellar Imperium, or the eighth regardless.
- **Seats:**
  - Founding Sovereigns: the three leading realms at founding, permanent, with a rare veto.
  - Great Powers: era 2, and 6% of claimed space or 8% of the people, and a reputation above -50. Several conditions, not one threshold.
  - Sponsored Sovereigns: sit while an ancient power sponsors them.
  - Regional Delegates: rotate every five years among the rest.
  - Observers: no vote.
- **Weights:** standing, territory, military and reputation, each square-rooted (diminishing returns), scaled by seat, and capped at 34% of the chamber. Stockpiles never count. Weights freeze when a session opens.
- **Sessions:**
  - One motion at a time. Ordinary sessions run 60 days and need more yea than nay.
  - Emergency sessions run 20 days and need two thirds of the votes cast. Only Founders or Great Powers can call one, and only against a cosmic threat or an ancient power at war with a member. They cannot be vetoed.
  - A quorum of 40% must take a side. Failed motions cannot be retabled for two years.
  - Members can lobby AI delegates.
- **Directives:** each binds every seated member except its target and anyone who openly defies it.
  - Containment War: its supporters go to war together, supply one another's fleets and share sight of the target.
  - Market Embargo: suspends contracts, trade agreements and new deals with the target, which pays more on the market and earns less from trade.
  - Naval Accords: no warships beyond naval capacity, and at most 2 + era battleships and dreadnoughts. Suspended during wars with the ancients or cosmic threats.
  - Ascension Injunction: stops the Continuum Engine, Dyson Swarms or the Omega Theorem.
  - Repeal: ends a directive in force.
- **Defiance** costs 15 reputation, the supporters' goodwill and 4 stability for three years. A second defiance within ten years suspends a non-founding seat for five years.
- **Reputation** (-100 to 100) feeds opinions, Conclave weight and Great Power status. Leviathan victories, crisis contributions and honouring directives raise it. Defiance, vetoes, salvage and abandoning systems to the Devourer or the Omega lower it.

### The Stagnant Ascendancies (`ancients.ts`)

- **The two powers:** the Archons of Veil (psionic, sacred worlds, relics, isolationist) and Automata Prime (machines, gateways, self-repair, technology tribute, hatred of forbidden machine minds). Each starts dormant in a small enclave of citadel systems.
- **Pressure** builds from realms reaching the Galactic Hegemony, Dyson Swarms, forbidden AI (Sentient Research Engines, the Grand Archive), settling the Archons' sacred worlds, warships in protected systems, slain Sentinels, Continuum Engine work, unpaid tribute and the Omega Incursion. Each point is blamed on whoever caused it.
- **Awakening:** warnings come at 50 and 75. At 100 the power wakes, raises hosts stronger than the strongest navy, and declares war on the realms it blames most. Their hosts besiege, land troops, take systems and demand submission from weak neighbours. Peace comes on their terms.
- **Intrusion:** warships left in protected systems bring a warning, then war: next month for the Archons, after three months for Automata Prime.
- **Diplomacy** goes through the ancients' own rites:
  - Tribute eases pressure.
  - Restricted knowledge: a technology from Automata Prime, or research, a relic and calm from the Archons.
  - Sponsorship: favours and a Conclave seat, bound by their terms. Breaking the terms twice revokes it.
  - Automata Prime demand technology tribute from advanced realms every few years.
- **The War in Heaven:** when both are awake they fight each other. Younger realms may pledge to a side, join an independent coalition whose members defend one another, stay neutral, or salvage the ancients' undefended outworks.
- **Watchful and fallen:** an awakened power left in peace for three years grows watchful. One that loses every world falls, and whoever holds its throne world inherits its relics.

### Cosmic threats (`threats.ts`, `omega.ts`)

- **Void Devourer:** appears once, in years 20 to 30, and leaves after 16 years.
  - It moves every 40 days to the richest neighbouring system, and its next destination is always announced a move ahead.
  - Where it sits: energy falls to 15% and trade through the system is cut.
  - Where it fed: a scar leaves 70% energy for eight years, and it eats a stage of any Dyson Swarm or Stellar Collector.
  - It grows as it feeds and starves on empty space. Whoever kills it gains +10% energy and reputation.
- **Sentinels** guard gateways, relic vaults, shipyards or research archives. Each pays its own reward to whoever destroys the host, and angers Automata Prime.
- **Omega Incursion:** triggered when anyone proves the Omega Theorem or brings a Continuum Engine to its second stage.
  - Stages: anomalies (8 months), warnings with the rift's location (6 months), the rift (3 months), then the incursion.
  - During the incursion: corruption spreads a fraction of a system a month, scaled to the galaxy and growing with strength. Defended systems resist. Stronger waves of fleets push out along the fronts. Corrupted worlds produce half and lose people, and an undefended one is lost after six months. Galactic trade and the energy and rare-element markets suffer.
  - The answer: fleets holding the rift wear down its integrity, 25% faster under an emergency containment. Members can contribute resources, intelligence, containment lattices and fleets.
  - The holder of the rift chooses:
    - Seal it: 180 days of holding the rift; the remnants wither.
    - Destroy its source: costs two warships in five; every Omega fleet is destroyed.
    - Bind it: great output, but the galaxy's and the ancients' enmity, the slowest recovery, and a yearly chance it tears free.
  - Afterwards: systems recover over years. The realm with most credit becomes Warden of the Galaxy and joins the Conclave's founders. Contributors get a reconstruction boom, and seated members who stood aside lose standing.

## Onboarding and guidance

Players learn by playing, and guidance never takes control. Details are in `docs/GUIDANCE.md`.

- **Ten lessons.** Your First Reign (the goal, then five real orders: research, build, claim a system, explore, let time run), Galaxy, Capital, Economy, Expansion, Fleets and warfare, Research and civilisation, Diplomacy and houses, Characters, Megastructures.
  - Each step names one objective. The objective ticks itself from real game state or a recorded player command, and the control involved is highlighted.
  - Lesson 1 starts with a guided reign. Later lessons unlock progressively and are offered once, never forced.
  - Lessons can be paused, skipped, left, replayed and reset. Progress is saved with the game.
- **Imperial Codex** (F2, or the book icon). A searchable encyclopedia in 15 categories.
  - Mechanic entries are written against the simulation code.
  - Catalogue entries (buildings, ships, technologies, eras, megastructures, capital buildings, roles, traits, items, decrees, governments, policies, planets, stars) are generated from the data tables, so their numbers are always the game's own.
  - Speculative content is labelled as such.
- **Every window explains itself.** A ? drawer shows the window's purpose, its controls, advanced notes, Codex links and the matching lesson. A first-visit card appears the first time a window opens.
- **Next steps.** A panel states the goal for the current stage of the reign and lists the two or three most useful actions now, each with a button that goes there. It covers growth (settle a named world, claim systems, explore, build a fleet, make a pact, the next era, the closest ambition) as well as problems. Advice is shown only when the condition is real:
  - shortages and stockpiles running out, full storage and idle research;
  - an idle construction ship or scout, idle builders on a planet or in the capital;
  - unassigned characters, unspent skill points, waiting petitions and envoys, and no heir in old age;
  - naval capacity exceeded, restless worlds, and threatened or exposed worlds at war.

  Dismissing an item hides it for six months. During a lesson only urgent items appear.
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

- Era 2 and beyond are late-game goals. Campaign statistics per difficulty are in `docs/CAMPAIGN.md`.
- There is no ground-combat screen: invasions resolve automatically.
- Diplomacy uses buttons and a deal builder. There is no free-text negotiation.
- Single-player only. The command layer is designed for a server-authoritative multiplayer layer, which does not exist yet.
