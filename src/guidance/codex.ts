// The Imperial Codex: the in-game encyclopedia. Mechanic entries are written against the
// simulation code (each names the rule it describes); catalogue entries (buildings, ships,
// technologies, eras, megastructures, capital buildings, roles, seats, decrees, designations,
// governments, policies, planets, stars, operations, covert operations) are generated from the
// game's own data tables, so their numbers are always the numbers the game uses.

import { OFFER_COST, OFFER_LABEL, PRIORITY_LABEL } from '../sim/data/politics';
import type { ScreenId } from '../ui/store';
import type { Cost } from '../sim/types';
import { RESOURCES } from '../sim/types';
import { BUILDINGS } from '../sim/data/buildings';
import { SHIPS, SHIP_ORDER, STARBASE } from '../sim/data/ships';
import { TECHS, TECH_BY_ID, TECH_CATEGORIES, techCost } from '../sim/data/techs';
import { ERAS } from '../sim/data/eras';
import { MEGASTRUCTURES } from '../sim/data/megastructures';
import { CAPITAL_BUILDINGS, CAPITAL_BY_ID, CITADEL_MAX, COST_GROWTH } from '../sim/data/capital';
import { ROLES, ROLE_ORDER, TRAITS, ITEMS, SKILLS, ATTR_LABEL, AMBITIONS } from '../sim/data/characters';
import { COUNCIL_SEATS } from '../sim/data/council';
import { DECREES, MAX_DECREES, HOUSE_AMBITIONS } from '../sim/data/governance';
import { DESIGNATIONS, DESIGNATION_IDS, DESIGNATION_COST, DESIGNATION_COOLDOWN } from '../sim/data/designations';
import { GOVERNMENTS, POLICIES, MINISTRIES } from '../sim/data/governments';
import { PLANET_TYPES, STAR_TYPES } from '../sim/data/planets';
import { OP_KINDS, OP_MODES, OP_MAX_LEVEL } from '../sim/operations';
import { COVERT, COVERT_KINDS } from '../sim/espionage';
import { TREATY_LABEL } from '../sim/diplomacy';
import { HEIR_COST } from '../sim/succession';
import { modText } from '../ui/modLabels';
import { DEVOURER, DIRECTIVES, EMERGENCY_DAYS, FOUNDING, KNOWLEDGE_COST, OMEGA, PRECURSORS, PRESSURE, QUORUM, SEAT_LABEL, SENTINEL_SITES, SESSION_DAYS, SPONSOR_COST, SPONSOR_OPINION, VETO_COOLDOWN, VETO_COST, WATCHFUL_YEARS, WEIGHT_CAP } from '../sim/data/expansion';

export type CodexCat =
  | 'galaxy' | 'worlds' | 'capital' | 'economy' | 'production' | 'colonization' | 'fleets' | 'diplomacy'
  | 'research' | 'eras' | 'characters' | 'council' | 'houses' | 'espionage' | 'megastructures' | 'expansion';

export const CODEX_CATS: { id: CodexCat; label: string }[] = [
  { id: 'galaxy', label: 'Galaxy and exploration' },
  { id: 'worlds', label: 'Systems, planets and provinces' },
  { id: 'capital', label: 'Capital and buildings' },
  { id: 'economy', label: 'Resources and economy' },
  { id: 'production', label: 'Production and trade' },
  { id: 'colonization', label: 'Colonisation and governors' },
  { id: 'fleets', label: 'Fleets, ships and combat' },
  { id: 'diplomacy', label: 'Diplomacy and rival realms' },
  { id: 'research', label: 'Research and technology' },
  { id: 'eras', label: 'Eras and the Kardashev scale' },
  { id: 'characters', label: 'Heroes and characters' },
  { id: 'council', label: 'Council and ministries' },
  { id: 'houses', label: 'Great Houses and succession' },
  { id: 'espionage', label: 'Espionage' },
  { id: 'megastructures', label: 'Megastructures' },
  { id: 'expansion', label: 'Conclave, ancients and crises' },
];

export interface CodexEntry {
  id: string;
  cat: CodexCat;
  title: string;
  /** one line */
  summary: string;
  what?: string;
  does?: string;
  how?: string;
  /** costs, prerequisites and figures, as label/value rows */
  facts?: [string, string][];
  strategy?: string;
  related: string[];
  /** the window where it is used */
  screen?: ScreenId;
  /** speculative fiction, or not implemented */
  status?: 'speculative' | 'unavailable';
  /** entries generated from a data table are grouped under a heading */
  group?: string;
}

const RES_NAME: Record<string, string> = { credits: 'credits', minerals: 'minerals', energy: 'energy', food: 'food', alloys: 'alloys', electronics: 'electronics', components: 'components', rare: 'rare elements', influence: 'influence', research: 'research', trade: 'trade value' };
export function costText(c: Cost | Record<string, number | undefined>): string {
  const parts = Object.entries(c).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${Math.round((v as number) * 100) / 100} ${RES_NAME[k] ?? k}`);
  return parts.length ? parts.join(', ') : 'none';
}
const modsText = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => Math.abs(v) > 1e-9).map(([k, v]) => modText(k, v)).join(', ') || 'none';
const days = (d: number) => `${d} days${d >= 60 ? ` (about ${Math.round(d / 30)} months)` : ''}`;

// ---------------------------------------------------------------- mechanics (hand-written, checked against the code)

const MECHANICS: CodexEntry[] = [
  // galaxy
  { id: 'mech.sovereign', cat: 'galaxy', title: 'The sovereign and the goal', screen: 'throne', summary: 'You rule a realm in real time: establish, develop, expand and preserve it.',
    what: 'You play the crown of one realm among several. Rival kingdoms, minor powers, raiders, guardians and rebels share the galaxy and play by the same rules as you.',
    does: 'Every decision is made through your ministries (the windows on the left) and on the map. The simulation runs day by day while time flows.',
    how: 'Keep research going, build on your worlds, claim systems, keep stability up, deal with your neighbours and defend what you hold. Pause whenever you need to think.',
    strategy: 'Growth comes from more worlds and better-run worlds. Overextension shows as low stability, empty stockpiles and undefended borders. The game ends if you lose every world; reaching the final era wins it.',
    related: ['mech.time', 'mech.galaxy', 'mech.eras'] },
  { id: 'mech.time', cat: 'galaxy', title: 'Time and speed', summary: 'The throne dial runs the simulation at 2, 6 or 15 days a second, or pauses it.',
    what: 'The game advances one day at a time. Production and consumption are monthly figures applied a thirtieth each day.',
    how: 'Click the centre of the dial or press Space to pause and resume. The speed buttons, or keys 1–3, choose 2, 6 or 15 days a second. The game pauses automatically on war, invasion and rebellion (you can turn this off in the Chancery).',
    related: ['mech.sovereign'] },
  { id: 'mech.galaxy', cat: 'galaxy', title: 'Galaxy, systems and hyperlanes', summary: 'Star systems joined by hyperlanes; fleets travel lane to lane.',
    what: 'The galaxy is a set of star systems connected by hyperlanes and grouped into named sectors. A system holds a star, planets, moons and asteroid belts, and may have features such as ancient ruins, a jump nexus, a rare cluster, a nebula, a derelict, a pulsar or a guardian.',
    how: 'Left-drag to pan, scroll to zoom, middle-drag (or Shift-drag) to turn the view. Click a star to select it; double-click an explored star to enter it. With a fleet selected, right-click a star to move there.',
    strategy: 'Chokepoints (systems with few lanes) are where borders are held. A jump nexus pays tolls; ruins can be surveyed for finds.',
    related: ['mech.fog', 'mech.provinces', 'mech.outpost'] },
  { id: 'mech.fog', cat: 'galaxy', title: 'Exploration and fog of war', summary: 'Unexplored systems hide their planets; you only see fleets within sensor range.',
    what: 'Each realm keeps its own list of explored systems. Planets in a system are known only once it is explored, and other realms\' fleets are visible only inside your sensor range (your territory, your ships and allies).',
    how: 'Send a scout (the Survey Corps) to neighbouring systems: select it and right-click a star. Each arrival charts the system. An explorer leading the fleet extends sensors and speed.',
    related: ['mech.galaxy', 'role.explorer'], screen: 'fleets' },
  // worlds
  { id: 'mech.provinces', cat: 'worlds', title: 'Systems, planets, provinces and the capital', summary: 'What each of these words means in Star Dominion.',
    what: 'A system is a star and everything orbiting it; territory is claimed system by system. A planet is one world; an inhabited planet is a colony with its own population, buildings, stability and queue. A province is a sector: a named group of systems that one governor can administer. The capital is the world that seats your crown.',
    does: 'Trade value from every world must travel to the capital. The capital hosts the Citadel and its city. Governors raise output and stability across a whole province.',
    related: ['mech.capital', 'role.governor', 'mech.designation', 'mech.trade'], screen: 'council' },
  { id: 'mech.life', cat: 'worlds', title: 'The living galaxy', summary: 'Worlds trade, people move, realms rise and fall, and history remembers.',
    what: 'Each world produces and consumes goods. Merchants turn surpluses into standing routes: supply routes inside a realm, and trade between realms at peace. Every cargo ship on the map is a convoy of a real route, every transport carries real migrants, and every courier carries a real overture.',
    does: 'A world whose imports do not arrive goes short: up to −14 stability and −15% output, and slower growth when grain is missing. Battles, sieges and conquest devastate worlds (lower output and housing until rebuilt). People leave crowded, jobless, hungry or war-torn worlds for prosperous ones, sometimes across borders. Realms enter golden ages, decline, fall into crisis and may lose their outer worlds to secession; rebel states that endure become recognised, and prosperous minor states can become great powers. Mines run out over generations.',
    how: 'Keep the lanes to importing worlds safe from corsairs and enemy fleets. Trade with peaceful neighbours: exporters earn the market price and importers fill their stores. Realms remember who fed them in famine, who blockaded their trade and who ravaged their worlds. The Chronicle keeps the galactic history; the map shows each system\'s condition.',
    related: ['mech.trade', 'mech.stability', 'mech.shortage'], screen: 'trade' },
  { id: 'mech.stability', cat: 'worlds', title: 'Stability and unrest', summary: 'Each colony\'s contentment; below 40 output suffers, very low stability leads to revolt.',
    what: 'Stability (0–100) is computed per colony from government, policies, buildings, governors, decrees, shortages, occupation and more; the Planets window lists every factor.',
    does: 'Output and taxes are cut by up to 40% below stability 40 (60% of normal below 20), and rise by up to 15% above 70. A colony that stays below 12 for months rises in revolt and may break away to form a rebel realm.',
    how: 'Fix shortages first (famine is −20 stability, a consumer goods shortage −10). Lower taxes, festivals, entertainment, governors and garrisons help.',
    related: ['mech.shortage', 'mech.decrees', 'role.governor'], screen: 'planets' },
  { id: 'mech.designation', cat: 'worlds', title: 'Province roles (designations)', summary: 'Specialise a colony for a focused bonus at a cost to other output.',
    how: `Planets → Province role. A change costs ${DESIGNATION_COST} influence and can be made once every ${DESIGNATION_COOLDOWN} days.`,
    facts: DESIGNATION_IDS.map((d) => [DESIGNATIONS[d].label, DESIGNATIONS[d].description]),
    strategy: 'Pair a designation with a governor of the province and buildings that fit it: a Forge world with foundries, an Academy world with laboratories.',
    related: ['mech.provinces', 'role.governor'], screen: 'planets' },
  { id: 'mech.planetBuild', cat: 'worlds', title: 'Districts, buildings, jobs and housing', summary: 'Colonies grow by building districts and buildings; pops work the jobs they provide.',
    what: 'Districts (residential, agricultural, mining, generator) are limited by the planet\'s size and type. Other buildings each take a building slot; slots grow with population (one more every 5 pops).',
    does: 'Buildings provide jobs and housing. Pops fill jobs in a fixed priority (food and energy first, so a shrinking colony does not starve itself). Each filled job produces its output and consumes its inputs. Unemployed pops pay less tax. Population grows while there is housing and food, and shrinks without them.',
    how: 'Planets → select a colony → Districts and buildings. The cost is paid when work begins; a project without funds waits. A world can queue six projects.',
    related: ['cat.worlds', 'mech.stability', 'mech.chains'], screen: 'planets' },
  { id: 'mech.outpost', cat: 'worlds', title: 'Outposts and starbases', summary: 'Claim a system with a construction ship; upgrade its starbase for defence.',
    how: 'Select an explored, unclaimed system and press "Send construction ship" (or give the ship a Build outpost order). The claim costs influence, more for distant systems, plus 40 alloys, and takes 60 days. The construction ship is consumed into the starbase.',
    facts: STARBASE.slice(1).map((s) => [s!.label, `hull ${s!.hull}, armour ${s!.armor}, shields ${s!.shields}, damage ${s!.damage}${s!.days ? `; upgrade ${costText(s!.upgrade)} over ${days(s!.days)}` : ''}`]),
    strategy: 'Starports and citadels guard trade lanes (no loss on that lane) and must be knocked out before an invasion of the system can land.',
    related: ['mech.trade', 'mech.invasion', 'mech.colonize'], screen: 'system' },
  { id: 'mech.operations', cat: 'worlds', title: 'Resource operations', summary: 'Orbital stations on uncolonised bodies, run at a level and in a mode.',
    what: `An operation extracts from a body you do not colonise. It has a level (1–${OP_MAX_LEVEL}), a mode and a reserve that heavy extraction drains.`,
    facts: [...Object.values(OP_KINDS).map((k) => [k.label, `${k.produces}. ${k.description}`] as [string, string]), ...Object.values(OP_MODES).map((m) => [`${m.label} mode`, m.description] as [string, string])],
    does: 'Output reaches your stockpiles only through logistics: the supply network, freighter capacity (spaceports, imperial shipyards, logistics ships) and freedom from blockade.',
    related: ['mech.chains', 'mech.trade'], screen: 'operations' },
  // capital
  { id: 'mech.capital', cat: 'capital', title: 'The imperial capital and the Citadel', summary: 'A city of great works around the Citadel, granting realm-wide effects.',
    what: `The capital world carries a city of 24 plots. The Citadel (levels 1–${CITADEL_MAX}) opens plots as it rises and caps the level of every other building.`,
    does: 'Each capital building adds realm-wide effects per level (taxes, research, influence, naval capacity, garrisons, roster places, intelligence and more). These are separate from the districts and buildings of each planet.',
    how: `Open Capital, choose a plot and a building, or select a building to extend it. Costs grow about ${Math.round((COST_GROWTH - 1) * 100)}% per level and are paid when work begins; builders work through a queue, and more builders come with Citadel levels. Raising the Citadel requires enough levels in other buildings and in the Throne hall.`,
    strategy: 'Early Treasury and Research institute levels pay back quickly. If an enemy captures the capital world the city is sacked and the crown moves to another world.',
    related: ['cat.capital', 'mech.planetBuild'], screen: 'capital' },
  // economy
  { id: 'mech.resources', cat: 'economy', title: 'Resources', summary: 'Nine stockpiles plus research.',
    facts: [['Credits', 'Taxes, trade, and the price of almost everything; salaries and upkeep.'], ['Minerals', 'Mining districts and operations; construction and refining.'], ['Energy', 'Generator districts and collectors; building upkeep. Shortage hurts stability.'], ['Food', 'Agricultural districts and hydroponics; each pop eats one a month. Shortage is famine.'], ['Alloys', 'Refined from minerals in foundries; ships, outposts, upgrades.'], ['Electronics', 'Refined in fabs; consumer goods (0.05 per pop a month) and advanced projects.'], ['Components', 'Manufactured; advanced ships, starbases and megastructures.'], ['Rare elements', 'Special deposits and gas harvesters; high-end buildings and projects.'], ['Influence', 'The capital, government and council; claims, decrees, designations, diplomacy.'], ['Research', 'Not stored: flows into the current project every day.']],
    how: 'The resource strip shows stock, monthly change and storage. Hover a resource for every source and use; the Economy window has the full ledger.',
    related: ['mech.storage', 'mech.shortage', 'mech.chains'], screen: 'economy' },
  { id: 'mech.storage', cat: 'economy', title: 'Storage', summary: 'Each stockpile has a cap; income above it is lost.',
    facts: [['Goods (each)', '2000 base, plus every storage building (the Sovereign Palace adds 4000), raised by storage modifiers.'], ['Credits', 'Six times the goods cap.'], ['Influence', '1500.']],
    strategy: 'A full bar on the resource strip means wasted income: spend it, sell it on the market, or build a storage depot.',
    related: ['mech.resources', 'mech.market'], screen: 'economy' },
  { id: 'mech.shortage', cat: 'economy', title: 'Shortages', summary: 'A stockpile at zero and still falling cripples what depends on it.',
    what: 'A shortage is a resource whose stock is below 0.5 while its monthly net is negative.',
    does: 'Food: famine, −20 stability and shrinking population. Energy: stability falls. Electronics: consumer goods shortage, −10 stability. Credits: the treasury cannot pay. Any refined input: factories using it run at 25% of their output.',
    how: 'Smart hints warn three months before a stockpile runs out. Raise production, cut consumption (fewer ships, fewer buildings with upkeep) or buy on the market.',
    related: ['mech.resources', 'mech.stability', 'mech.chains'], screen: 'economy' },
  { id: 'mech.market', cat: 'economy', title: 'The galactic market', summary: 'Buy and sell goods for credits.',
    how: 'Economy → Galactic market. Choose a good and an amount.',
    does: 'The broker fee starts at 20% (never below 5%; policies change it). Each trade moves the price: buying raises it, selling lowers it, between a quarter and four times the base price. Credits and influence cannot be traded.',
    strategy: 'Good for covering a short gap. Large repeated trades move the price against you.',
    related: ['mech.storage', 'mech.shortage'], screen: 'economy' },
  // production
  { id: 'mech.chains', cat: 'production', title: 'Production chains', summary: 'Extraction feeds refining feeds manufacturing.',
    what: 'Minerals are smelted into alloys in foundries; fabs turn inputs into electronics; component works make components; rare extractors need a rare deposit. Each refining job consumes its input every month.',
    does: 'If an input is in shortage, the factories that need it run at 25%. Jobs without workers produce nothing.',
    how: 'Industry shows the chain with live monthly figures and output by world.',
    related: ['cat.production', 'mech.shortage', 'mech.planetBuild'], screen: 'industry' },
  { id: 'mech.trade', cat: 'production', title: 'Trade routes', summary: 'Trade value travels to the capital; unprotected lanes and enemies take their share.',
    what: 'Every colony generates trade value from its population and commerce. It is collected only when it reaches the capital through your supply network.',
    does: 'A route through a system with hostile warships is disrupted (nothing arrives). Each system on the route without a starport and without a patrol in the last 45 days loses 2.5% (at most 50% in total). A world cut off from the capital collects nothing. Each trade agreement adds 8% of collected trade plus 2 credits a month.',
    how: 'Trade lists every route and its loss. Upgrade starbases to starports on busy lanes, or give a fleet a Patrol order between two systems.',
    related: ['mech.outpost', 'mech.treaties'], screen: 'trade' },
  // colonisation
  { id: 'mech.colonize', cat: 'colonization', title: 'Colonisation', summary: 'A colony ship settles a habitable planet.',
    how: 'Build a colony ship at a shipyard, select a planet and press "Send colony ship". If the system is unclaimed, its claim (influence) is paid too and a basic outpost is raised.',
    does: 'The planet must be habitable for your people (climate and planet type). Settling takes about 150 days (faster with colonisation technology). A young colony costs the crown 2 food and 3 credits a month until it has six pops (for up to two years).',
    strategy: 'Planets that suit your climate give the most housing and output. Gaia worlds suit everyone.',
    related: ['cat.worlds', 'mech.outpost', 'role.governor'], screen: 'planets' },
  // fleets
  { id: 'mech.ships', cat: 'fleets', title: 'Ships and fleets', summary: 'Thirteen hull classes, built at shipyards and grouped into fleets.',
    what: 'Warships come in four sizes (S, M, L, XL); civilian hulls (scouts, construction ships, colony ships, transports, logistics tenders) do the realm\'s work. Each class has hull, armour, shields, damage, tracking, evasion and speed, and prefers targets of certain sizes.',
    how: 'Queue ships at a shipyard (Planets or Industry). New ships join a fleet at the yard. In Fleet management, merge, split, rename and disband fleets, assign leaders and set stances.',
    related: ['cat.fleets', 'mech.naval', 'mech.combat'], screen: 'fleets' },
  { id: 'mech.naval', cat: 'fleets', title: 'Naval capacity, supply and stances', summary: 'How many ships you can maintain, how far they can fight, and how willingly.',
    does: 'Every ship uses command points against your naval capacity (the right gauge on the dial); exceeding it raises fleet upkeep. Fleets resupply inside your supply network and lose supply outside it; low supply weakens them. Stances: aggressive fleets fight on unless hopelessly outmatched; defensive fleets withdraw once clearly outgunned; passive fleets try to escape battle, and keep moving through hostile systems.',
    related: ['mech.combat', 'mech.ships'], screen: 'fleets' },
  { id: 'mech.combat', cat: 'fleets', title: 'Space combat', summary: 'Automatic battles: three rounds a day whenever hostile forces share a system.',
    what: 'You do not steer battles; you decide which ships fight, where, under whom and with what stance.',
    does: 'Each round every ship picks a target, preferring certain hull sizes. Hit chance compares its tracking with the target\'s evasion. Shields absorb damage first, then armour reduces each hit; some weapons pierce shields. Carriers launch strike craft, which enemy point defence thins out. Starbases and planetary defence batteries fight too. Fleets that are outmatched may retreat. Technology, admirals, supply and the system itself all count.',
    how: 'Military → Battle reports replays every engagement, round by round.',
    strategy: 'Composition matters more than raw numbers: corvettes are hard for heavy guns to hit; heavy hulls crush small ones; carriers outrange everything without point defence.',
    related: ['mech.invasion', 'mech.naval', 'role.admiral'], screen: 'military' },
  { id: 'mech.invasion', cat: 'fleets', title: 'Ground invasion', summary: 'Separate from space combat: secure the orbit, then land troops against the garrison.',
    what: 'Planets are captured with troops carried by transports, not by warships.',
    does: 'An invasion waits until the orbit is secured: no hostile warships, and the planet\'s defence batteries and the system starbase knocked out. Then the attack is the troops landed × (1 + the general\'s bonus) × a random 0.85–1.15 × 0.6 against a planetary shield × 0.7 without supply, against the garrison × 0.85–1.15. The transports are spent either way. A won invasion transfers the world (high resistance, stability at most 30, queues lost); a capital captured is sacked.',
    how: 'Select the enemy planet with a fleet carrying transports in the system and press "Invade with …".',
    related: ['mech.combat', 'role.general', 'mech.war'], screen: 'military' },
  // diplomacy
  { id: 'mech.diplomacy', cat: 'diplomacy', title: 'Opinion and contact', summary: 'Every realm remembers how you treat it.',
    what: 'You can deal only with realms you have contact with (met through borders, exploration or treaties). Each realm\'s opinion of you is a sum of memories, each fading at its own pace: borders, government, treaties, gifts, insults, wars and broken pacts.',
    how: 'Diplomacy → select a realm → "Why they feel this way" lists every memory.',
    related: ['mech.treaties', 'mech.war', 'role.diplomat'], screen: 'diplomacy' },
  { id: 'mech.treaties', cat: 'diplomacy', title: 'Treaties, deals and contracts', summary: 'Pacts, one-time exchanges and monthly resource contracts.',
    facts: Object.entries(TREATY_LABEL).map(([k, v]) => [v, k === 'trade' ? '+8% of collected trade and +2 credits a month per partner.' : k === 'vassal' ? 'Imposed through peace terms, or sworn when a weaker realm accepts a demand of fealty (it weighs your power, whether it is threatened or losing another war, its opinion of you and its pride). The vassal joins its overlord\'s wars and cannot declare war on it; a resentful vassal breaks free when its overlord looks weak, a content one stays.' : k === 'nap' ? 'Neither side may attack the other while it holds. It lapses after 15 years unless renewed, and either side may renounce it (others will remember).' : k === 'research' ? '+10% research per partner, and better intelligence on each other.' : k === 'defense' ? 'Each side is called into wars declared on the other.' : 'Allies are called into each other\'s wars, and share the best intelligence.']),
    how: 'Diplomacy → Treaties, Exchange (credits, resources, systems, treaties) and Resource contract (monthly, for a number of years). The other realm weighs each offer and lists its reasons when it declines.',
    related: ['mech.diplomacy', 'mech.trade'], screen: 'diplomacy' },
  { id: 'mech.war', cat: 'diplomacy', title: 'War and peace', summary: 'Declaring war, war score and peace terms.',
    does: 'War can be declared on a realm you are not already at war with, are not bound to by vassalage and have no truce with; it costs 40 influence. Defence pacts and alliances bring others in. War score moves with battles, captured worlds (15, or 30 for a capital), failed invasions and occupation (one point a month for each enemy colony system your warships hold with no defending fleet, up to three a month). War exhaustion builds over time.',
    how: 'Offer peace from Diplomacy or Military: status quo, tribute, ceding systems or vassalage. Better terms need a better war score. Peace brings a five-year truce.',
    related: ['mech.combat', 'mech.invasion', 'mech.treaties'], screen: 'diplomacy' },
  { id: 'mech.stewards', cat: 'worlds', title: 'Stewards', summary: 'Hand a world\'s construction to its steward.',
    what: 'Tick "Let the steward build here" on a colony in Planets, or hand every colony to stewards at once. Each month the steward queues what the world needs most, following its province role and keeping a small reserve of minerals and credits. It uses the same judgement as the rival realms\' own builders. You can still queue buildings yourself.',
    related: ['mech.planetBuild', 'mech.designation'], screen: 'planets' },
  { id: 'mech.anomalies', cat: 'galaxy', title: 'Anomalies', summary: 'Discoveries that ask for a decision.',
    what: 'The first time your ships chart a system they may find something strange: a sleeper ark adrift (settle its people, strip it, or leave it and risk it waking), a signal from the dark near a pulsar, nebula or black hole (study it for research, or attract raiders), a ghost fleet in derelict space (recommission the ships or scrap them). Each comes before the council and may lead to a further stage months later.',
    related: ['mech.fog'], screen: 'council' },
  { id: 'mech.victory', cat: 'diplomacy', title: 'Victory and defeat', summary: 'Three roads to victory, open to every great realm.',
    what: 'Domination: hold half of all claimed systems and two fifths of all people, and keep it for two years. Supremacy: leave no rival great realm independent (fallen or your vassal) and keep it so for a year. A vassal\'s land does not count toward Domination, so conquest and subjugation are different roads. Ascension: reach Omega Sovereignty, the last era. Each rival leans toward one road by temperament; Diplomacy shows its ambition.',
    does: 'Rivals can win too, and a rival\'s victory ends your reign. The galaxy is warned when a realm begins a domination hold or comes three quarters of the way to any victory. Realms fear whoever leads: their opinion of the leader falls, they sign defence pacts with one another more readily and plan wars against it.',
    how: 'The throne room shows your progress on each road and that of the leading rival you know of.',
    related: ['mech.war', 'mech.eras', 'mech.ambitions'], screen: 'throne' },
  { id: 'mech.ambitions', cat: 'diplomacy', title: 'Ambitions', summary: 'Optional milestones for each stage of a reign.',
    what: 'Ambitions are grouped in three phases: a foothold among the stars, a realm among realms, a civilisation of the galaxy. You move to the next phase with the first era or a handful of fulfilled ambitions.',
    does: 'Each ambition pays a modest one-time reward when met: influence, resources or a temporary bonus. None is required, and any may be met early.',
    how: 'Throne room → Ambitions lists the current phase with progress bars.',
    related: ['mech.victory'], screen: 'throne' },
  { id: 'mech.rivals', cat: 'diplomacy', title: 'Rival realms and difficulty', summary: 'How AI rivals plan, and what difficulty changes.',
    what: 'Rivals issue the same commands as you and judge strength through the same uncertain intelligence. Each pursues a goal: expand, develop, arm against a rival, wage war, recover from losses, or chase the last eras.',
    does: 'A rival arming against you stages its fleet on your border and secures its other flanks; if your intelligence on it is decent, you are told. Difficulty changes how well rivals play: how fast they react, how much of an edge they want before declaring war, how many battle groups they field, how long they leave you alone (15, 8 or 4 years), and whether aggressive realms betray pacts (Hard only). It never gives them resources.',
    how: 'Choose the difficulty when starting a reign. Watch the war room and dispatches for warnings.',
    related: ['mech.war', 'mech.victory'], screen: 'diplomacy' },
  // research
  { id: 'mech.research', cat: 'research', title: 'Research and technology', summary: 'Technologies in nine fields and eight tiers, plus Ascension.',
    what: `There are ${TECHS.length} technologies. Each belongs to a field and a tier; higher tiers cost more (tier 1: ${techCost(TECHS.find((t) => t.tier === 1)!.id)} research). Most need prerequisites; Ascension technologies need a civilisational era.`,
    does: 'Research points come from laboratories, the capital, the Archscholar, research outposts and more, and flow into the current project each day. Finished technologies apply their modifiers at once or unlock buildings, ships and projects. Once everything is known, repeatable future studies continue.',
    how: 'Research → choose a project or queue several; the Tech tree shows prerequisites.',
    related: ['cat.research', 'mech.eras'], screen: 'research' },
  // eras
  { id: 'mech.eras', cat: 'eras', title: 'Political eras', summary: 'Milestones of your civilisation\'s institutions, each with permanent bonuses.',
    what: `There are ${ERAS.length} eras, from the ${ERAS[0].name} onward. The last two are speculative fiction.`,
    does: 'Each era has requirements (technologies, systems held, population, a breakthrough, megastructure stages, a minimum Kardashev rating). Reaching it grants permanent bonuses and opens era-locked technologies. Reaching the final era wins the game.',
    how: 'Kingdom → Political eras lists the requirements and your progress.',
    related: ['cat.eras', 'mech.kardashev'], screen: 'kingdom' },
  { id: 'mech.kardashev', cat: 'eras', title: 'The Kardashev scale', summary: 'A scientific rating of the power your civilisation uses, separate from eras.',
    what: 'K = (log₁₀ P − 6) / 10, where P is your usable power in watts (Sagan\'s interpolation). Type I is 10¹⁶ W (a planet), Type II 10²⁶ W (a star), Type III 10³⁶ W (a galaxy). Types IV and V are speculative extensions and labelled as such.',
    does: 'P is built from real infrastructure: every energy job, collector and capital power plant on the planetary grid (raised by energy technology), stellar harvesting by collectors and swarms, galactic harvesting by sector arrays, and the Continuum Engine, multiplied by grid efficiency.',
    strategy: 'Eras are political milestones; some list a minimum K among their requirements, which is the only link between the two.',
    related: ['mech.eras', 'mech.mega'], screen: 'kingdom' },
  // characters
  { id: 'mech.characters', cat: 'characters', title: 'Characters', summary: 'The notable people of your realm and what they do.',
    what: 'Each character has a role, six attributes (martial, command, cunning, diplomacy, stewardship, science), traits, a level and skills, loyalty and an ambition.',
    does: 'Effects reach the simulation only through their post: fleet leaders (admirals, generals, explorers), council seats, provincial governors, planet industrialists and envoys. Characters gain experience in post and a skill point each level. Loyalty depends on pay, treatment and whether their ambition is met; very disloyal characters may desert or defect. Captured characters can be pardoned, recruited or ransomed.',
    how: `Hall of Heroes: recruit candidates (the roster holds 8, plus 2 per level of the capital's Hall of Heroes), assign posts, spend skill points, equip items.`,
    facts: Object.entries(AMBITIONS).map(([, a]) => [`Ambition: ${a.label}`, a.want]),
    related: ['cat.characters', 'mech.council', 'mech.espionage'], screen: 'heroes' },
  // council
  { id: 'mech.council', cat: 'council', title: 'The royal council and ministries', summary: 'Six seats that turn councillors\' attributes into realm-wide bonuses; policies per ministry.',
    facts: COUNCIL_SEATS.map((s) => [s.label, `${s.description} Roles: ${s.roles.map((r) => ROLES[r].label).join(', ')}.`]),
    how: 'Council → Council tab to assign seats. Policies are set in the Kingdom window, one per question, grouped by ministry; each option changes modifiers and may cost upkeep.',
    related: ['cat.council', 'mech.decrees', 'mech.characters'], screen: 'council' },
  { id: 'mech.decrees', cat: 'council', title: 'Decrees and petitions', summary: 'Temporary edicts, and matters brought before the council.',
    what: `Decrees are edicts with a cost, a duration and a cooldown; at most ${MAX_DECREES} can be in force (a level 10 Throne hall allows a fourth). Their strength grows with the attribute of the councillor in the related seat.`,
    does: 'Petitions arrive from the houses and the provinces. Each option has a real cost and effect (on houses, characters, modifiers); an unanswered petition takes its default answer after 90 days.',
    how: 'Council → Decrees tab; Matters before the council.',
    related: ['cat.council', 'mech.houses'], screen: 'council' },
  // houses
  { id: 'mech.houses', cat: 'houses', title: 'Great Houses', summary: 'Noble houses with power, loyalty, ambitions and grievances.',
    what: 'Each house holds land in some of your provinces and has power (0–100), loyalty (0–100) and an ambition. Members of a house may serve you as characters.',
    does: 'An ambition met keeps a house content; ignored, it builds grievance and loyalty falls. A powerful, disloyal house can rise in revolt, hurting stability in its provinces. You can grant favours, honour or suppress a house from the Council.',
    facts: Object.values(HOUSE_AMBITIONS).map((a) => [a.label, a.want]),
    related: ['mech.succession', 'mech.decrees'], screen: 'council' },
  { id: 'mech.succession', cat: 'houses', title: 'Succession and heirs', summary: 'Your sovereign ages and dies; name an heir to avoid a crisis.',
    does: `The crown passes to the named heir (naming one costs ${HEIR_COST} influence) or, without one, to a claimant put forward by the strongest Great House. A named heir backed by loyal houses means a smooth coronation; an empty succession means house loyalty falls, stability suffers for two years, and a disaffected house may rise for its own pretender.`,
    how: 'Throne room → Succession.',
    related: ['mech.houses'], screen: 'throne' },
  // espionage
  { id: 'mech.espionage', cat: 'espionage', title: 'Espionage and covert operations', summary: 'A spymaster runs one operation at a time against a rival.',
    facts: COVERT_KINDS.map((k) => [COVERT[k].label, `${COVERT[k].description} ${days(COVERT[k].days)}; ${costText(COVERT[k].cost)}; base success ${Math.round(COVERT[k].base * 100)}%.`]),
    does: 'Success depends on your agent\'s cunning against the rival\'s counter-intelligence (their spymaster and intelligence bonuses). Operations can be discovered and the victim remembers; a failed, discovered agent may be taken prisoner.',
    how: 'Intelligence → Covert operations: choose a rival, an operation, an agent (a spymaster in your service) and, for sabotage and unrest, a world.',
    related: ['role.spymaster', 'mech.diplomacy'], screen: 'intel' },
  // megastructures
  { id: 'mech.mega', cat: 'megastructures', title: 'Megastructures', summary: 'Generational projects built in stages, each stage paying off at once.',
    what: `There are ${MEGASTRUCTURES.length} megastructures. Each needs its technology; some need a particular star or can be built only once. A system holds at most two.`,
    does: 'Each stage takes hundreds of days and its cost is paid in daily instalments; on a day the treasury cannot pay, work waits. Every completed stage adds its modifiers and flat output at once. Energy from megastructures feeds the Kardashev rating, and some eras require specific stages.',
    how: 'Construction → Megastructures: pick an eligible system you own and press "Begin construction".',
    related: ['cat.megastructures', 'mech.kardashev', 'mech.eras'], screen: 'construction' },
  // the Grand Expansion
  { id: 'mech.conclave', cat: 'expansion', title: 'The High Conclave', summary: 'A galactic assembly with influence, not unlimited authority: weighted votes, motions and directives.',
    what: `Founded in the ${FOUNDING.earliest / 360}rd year once a great realm reaches the Interstellar Imperium (the ${FOUNDING.latest / 360}th regardless). Seats: ${Object.values(SEAT_LABEL).join(', ')}. The three leading realms at its founding are Founding Sovereigns for good; Great Powers need the Stellar Ascendancy and 6% of claimed space or 8% of the galaxy's people, without a disgraced reputation; Sponsored Sovereigns sit while an ancient power sponsors them; Regional Delegates rotate every five years; everyone else observes.`,
    does: `Weights combine political standing, territory, military strength and reputation, each with diminishing returns, scaled by seat and capped at ${Math.round(WEIGHT_CAP * 100)}% of the chamber; they freeze when a session opens. Ordinary sessions last ${SESSION_DAYS} days and need more yea than nay; a Founding Sovereign may veto one every ${VETO_COOLDOWN / 360} years for ${VETO_COST} influence. Emergency sessions last ${EMERGENCY_DAYS} days, need two thirds and cannot be vetoed. A quorum of ${Math.round(QUORUM * 100)}% must take a side. A directive binds every seated member but its target and those who defy it; defiance costs 15 reputation, the supporters' goodwill and 4 stability for three years, and a second within ten years suspends a seat.`,
    facts: Object.values(DIRECTIVES).map((d) => [d.label, `${d.summary} Tabling costs ${d.cost} influence${d.years ? `; in force ${d.years} years` : ''}.`] as [string, string]),
    how: 'High Conclave window: vote, lobby AI delegates, table a motion when no session runs, defy or comply with directives.',
    related: ['mech.ancients', 'mech.omega', 'mech.diplomacy'], screen: 'conclave' },
  { id: 'mech.ancients', cat: 'expansion', title: 'The Stagnant Ascendancies', summary: 'Two ancient powers, dormant until the galaxy provokes them: the Archons of Veil and Automata Prime.',
    what: Object.values(PRECURSORS).map((p) => `${p.name}: ${p.lore}`).join(' '),
    does: `Pressure builds from what realms do, and each point is blamed on whoever caused it. Warnings come at ${PRESSURE.stir} and ${PRESSURE.final}; at ${PRESSURE.awaken} a power wakes, raises its hosts and makes war on those it blames most. Warships left in their protected systems bring a warning and then war. When both are awake they fight the War in Heaven: younger realms may pledge to a side, join an independent coalition whose members defend one another, stay out, or salvage the ancients' outworks. An awakened power left in peace for ${WATCHFUL_YEARS} years grows watchful; one that loses every world falls, and its throne world's new master inherits its relics.`,
    facts: Object.values(PRECURSORS).flatMap((p) => [[`${p.name}: what wakes them`, p.wakes.join('; ')], [`${p.name}: sponsorship`, `${p.sponsorDuty} Favours: ${p.sponsorBoons.map((b) => b.label).join(', ')}.`]] as [string, string][]),
    how: `Ancients and threats window: pay tribute, seek restricted knowledge (${KNOWLEDGE_COST} influence), seek sponsorship (${SPONSOR_COST} influence, their opinion ${SPONSOR_OPINION}), and act in the War in Heaven.`,
    related: ['mech.conclave', 'mech.threats'], screen: 'cosmos' },
  { id: 'mech.threats', cat: 'expansion', title: 'The Void Devourer and the Sentinels', summary: 'A roaming stellar leviathan, and the ancient guardians of what the precursors left.',
    what: `The Void Devourer enters the galaxy between its ${DEVOURER.earliestYear}th and ${DEVOURER.latestYear}th year and leaves after ${DEVOURER.lifespanYears}. It moves every ${DEVOURER.moveDays} days to the richest neighbouring system, announcing its next destination a full move ahead.`,
    does: `Where it sits, energy falls to ${Math.round(DEVOURER.drain * 100)}% and trade through the system is cut; where it fed, a scar dims energy to ${Math.round(DEVOURER.scar * 100)}% for ${DEVOURER.scarYears} years and a stage of any Dyson Swarm or Stellar Collector is eaten. It grows as it feeds and starves on empty space. Whoever kills it gains +10% energy for good and reputation; leaving your systems to it with no fleet near costs reputation. Sentinels guard four kinds of site; destroying a host gives its reward and reputation, and angers Automata Prime.`,
    facts: Object.values(SENTINEL_SITES).map((s) => [s.label, s.reward] as [string, string]),
    how: 'Ancients and threats window, and the galaxy map (the Devourer, its path and the days to its next move are drawn there).',
    related: ['mech.ancients', 'mech.combat'], screen: 'cosmos' },
  { id: 'mech.omega', cat: 'expansion', title: 'The Omega Incursion', summary: 'A multi-year crisis drawn by the Omega Theorem or an advanced Continuum Engine.',
    what: `Anomalies (${OMEGA.anomalyMonths} months), warnings with the rift's location (${OMEGA.warningMonths} months), the rift opening (${OMEGA.riftMonths} months), then the incursion: corruption spreads along the fronts, Omega fleets grow stronger, corrupted worlds produce half and lose their people, and a corrupted world with no defending fleet is lost after ${OMEGA.neglectMonths} months. Galactic trade and markets suffer. If corruption takes ${Math.round(OMEGA.consumeShare * 100)}% of claimed space, the galaxy is consumed and the reign ends.`,
    does: `Warships holding the rift wear down its integrity (faster under a Conclave containment). At integrity ${OMEGA.sealIntegrity} a holder may seal it (${OMEGA.sealDays} days); at ${OMEGA.breachIntegrity}, destroy its source at the cost of two warships in five; at ${OMEGA.exploitIntegrity}, with the Transcendent Continuum or a Continuum Engine, bind it for great power and the galaxy's enmity, with a yearly chance it tears free. Sealing or destroying it names a Warden of the Galaxy (the realm with most credit), who joins the Conclave's founders; contributors enjoy a reconstruction boom and members who stood aside lose standing. Corrupted systems take years to recover.`,
    how: 'Ancients and threats window for the rift; High Conclave window for emergency containment and contributions.',
    related: ['mech.conclave', 'mech.eras', 'mech.mega'], screen: 'cosmos' },
  { id: 'mech.politics', cat: 'expansion', title: 'Emergent politics', summary: 'Every realm and ancient power pursues its own interests: alliances, compacts, conspiracies, concords and betrayals arise from circumstance, not script.',
    what: `Each great realm carries motives recomputed every month: a priority (${Object.values(PRIORITY_LABEL).join(', ').toLowerCase()}), what it fears and why, what it wants, whom it is loyal to, its rival and how it would end the Omega Incursion. Each ancient power keeps a regard for every younger realm (respect for strength and deeds, admiration for conduct it approves of, fear of power and trouble caused) that moves month by month and feeds its opinion.`,
    does: `Overtures are weighed by both sides from their own interests, with itemised reasons. ${Object.entries(OFFER_LABEL).map(([k, v]) => `${v}${OFFER_COST[k as keyof typeof OFFER_COST] ? ` (${OFFER_COST[k as keyof typeof OFFER_COST]} influence)` : ''}`).join(', ')}. Alliances, protection and vassalage are real treaties: allies join wars. Compact members are called into one another's wars against their common foe and do not plan war on one another; a member who makes a separate peace, ignores the call or turns on a partner breaks it, and drifting interests strain it until it fractures. A collusion is secret: the ancient power's blame shifts to the target and each partner is drawn into the other's war; intelligence can uncover it, and the target may expose or confront the conspirator. A concord sets wars aside until a cosmic crisis ends. An accord between the ancients ends or prevents the War in Heaven while a common threat holds them together, and breaks when it fades.`,
    facts: [['Overtures', `Answer within ${Math.round(120 / 30)} months; a refusal is remembered and the same overture is not repeated for a year.`], ['Honour', 'A compact member called to war has three months to answer.'], ['Mediation', 'Brokering an accord between the ancients earns their admiration and the galaxy\'s esteem; sowing discord between them risks both turning on you.']],
    how: 'Diplomacy window: political overtures, each realm\'s motives, compacts and concords, pacts and political history. Ancients and threats window: the ancients\' regard, petitions to them, collusion, mediation and discord.',
    related: ['mech.ancients', 'mech.conclave', 'mech.diplomacy'], screen: 'diplomacy' },
];

// ---------------------------------------------------------------- generated catalogues

function generated(): CodexEntry[] {
  const out: CodexEntry[] = [];
  // buildings
  for (const b of Object.values(BUILDINGS)) {
    const facts: [string, string][] = [];
    if (b.buildable !== false) { facts.push(['Cost', costText(b.cost)]); facts.push(['Build time', days(b.days)]); }
    facts.push(['Upkeep per month', costText(b.upkeep)]);
    if (b.jobs) facts.push(['Jobs', String(b.jobs)]);
    if (b.housing) facts.push(['Housing', String(b.housing)]);
    if (Object.keys(b.output).length) facts.push(['Output per filled job per month', costText(b.output as Cost)]);
    if (Object.keys(b.input).length) facts.push(['Input per filled job per month', costText(b.input)]);
    for (const [k, l] of [['stability', 'Stability'], ['garrison', 'Garrison'], ['admin', 'Admin capacity'], ['storage', 'Storage'], ['navalCap', 'Naval capacity']] as const) if (b[k]) facts.push([l, `+${b[k]}`]);
    if (b.max) facts.push(['Limit per world', String(b.max)]);
    if (b.tech) facts.push(['Requires research', TECH_BY_ID[b.tech]?.name ?? b.tech]);
    if (b.needs) facts.push(['Requires building', BUILDINGS[b.needs].label]);
    if (b.deposit) facts.push(['Requires', 'a rare element deposit']);
    out.push({ id: `bld.${b.id}`, cat: b.category === 'military' ? 'worlds' : b.category === 'industry' ? 'production' : 'worlds', group: 'Planet buildings', title: b.label, summary: b.description, facts, related: ['mech.planetBuild', 'cat.worlds'], screen: 'planets' });
  }
  // ships
  for (const id of SHIP_ORDER) {
    const s = SHIPS[id];
    const facts: [string, string][] = [['Role', s.role], ['Hull size', s.size === 'civ' ? 'civilian' : s.size], ['Cost', costText(s.cost)], ['Build time', days(s.days)], ['Upkeep per month', costText(s.upkeep)],
      ['Hull / armour / shields', `${s.hull} / ${s.armor} / ${s.shields}`], ['Damage per round', String(s.damage + (s.strike ?? 0))], ['Tracking / evasion', `${Math.round(s.tracking * 100)}% / ${Math.round(s.evasion * 100)}%`],
      ['Speed', String(s.speed)], ['Naval capacity used', String(s.command)], ['Prefers targets', s.prefers.join(', ')]];
    if (s.troops) facts.push(['Troops', String(s.troops)]);
    if (s.pierce) facts.push(['Shield piercing', `${Math.round(s.pierce * 100)}%`]);
    if (s.strike) facts.push(['Strike craft damage', String(s.strike)]);
    if (s.tech) facts.push(['Requires research', TECH_BY_ID[s.tech]?.name ?? s.tech]);
    out.push({ id: `ship.${id}`, cat: 'fleets', group: 'Ship classes', title: s.label, summary: s.description, facts, related: ['mech.ships', 'mech.combat'], screen: 'fleets' });
  }
  // technologies
  for (const t of TECHS) {
    const cat = TECH_CATEGORIES.find((c) => c.id === t.category)?.label ?? t.category;
    const facts: [string, string][] = [['Field', cat], ['Tier', String(t.tier)], ['Cost', `${techCost(t.id)} research`], ['Prerequisites', t.requires.map((r) => TECH_BY_ID[r]?.name ?? r).join(', ') || 'none']];
    if (t.era != null) facts.push(['Requires era', ERAS[t.era]?.name ?? String(t.era)]);
    if (t.mods && Object.keys(t.mods).length) facts.push(['Effects', modsText(t.mods)]);
    const unlocks = [...Object.values(BUILDINGS).filter((b) => b.tech === t.id).map((b) => b.label), ...SHIP_ORDER.filter((s) => SHIPS[s].tech === t.id).map((s) => SHIPS[s].label), ...MEGASTRUCTURES.filter((m) => m.tech === t.id).map((m) => m.label)];
    if (unlocks.length) facts.push(['Unlocks', unlocks.join(', ')]);
    out.push({ id: `tech.${t.id}`, cat: 'research', group: `Technologies: ${cat}`, title: t.name, summary: t.description, facts, related: ['mech.research', ...t.requires.map((r) => `tech.${r}`)], screen: 'research', status: t.category === 'ascension' && (t.era ?? 0) >= ERAS.length - 2 ? 'speculative' : undefined });
  }
  // eras
  for (const e of ERAS) {
    const r = e.req;
    const req = [r.techs && `${r.techs} technologies`, r.systems && `${r.systems} systems`, r.galaxyShare && `${Math.round(r.galaxyShare * 100)}% of claimed space`, r.pops && `${r.pops} pops`, r.tech && `research ${TECH_BY_ID[r.tech]?.name ?? r.tech}`, r.megaStages && `${r.megaStages} megastructure stages`, r.mega && `${r.mega.stages} stage(s) of the ${MEGASTRUCTURES.find((m) => m.id === r.mega!.id)?.label}`, r.minK && `Kardashev K ≥ ${r.minK}`].filter(Boolean).join(', ');
    out.push({ id: `era.${e.id}`, cat: 'eras', group: 'Eras', title: `${e.id + 1}. ${e.name}`, summary: e.epithet, what: e.lore, facts: [['Requirements', req || 'none (starting era)'], ['Permanent effects', modsText(e.mods)], ['Perks', e.perks.join('; ')]], related: ['mech.eras', 'mech.kardashev'], screen: 'kingdom', status: e.id >= ERAS.length - 2 ? 'speculative' : undefined });
  }
  // megastructures
  for (const m of MEGASTRUCTURES) {
    const facts: [string, string][] = [['Requires research', TECH_BY_ID[m.tech]?.name ?? m.tech], ['Stages', String(m.stages)], ['Each stage', `${costText(m.stageCost)} over ${days(m.stageDays)}, paid daily`], ['Per completed stage', [modsText(m.modsPerStage), m.outputPerStage ? `+${costText(m.outputPerStage as Cost)} a month` : ''].filter(Boolean).join('; ')]];
    if (m.starReq) facts.push(['Star', m.starReq.map((s) => STAR_TYPES[s].label).join(' or ')]);
    if (m.unique) facts.push(['Limit', 'one per realm']);
    out.push({ id: `mega.${m.id}`, cat: 'megastructures', group: 'Megastructures', title: m.label, summary: m.description, facts, related: ['mech.mega', `tech.${m.tech}`], screen: 'construction', status: m.id === 'continuum_engine' ? 'speculative' : undefined });
  }
  // capital buildings
  for (const b of CAPITAL_BUILDINGS) {
    const facts: [string, string][] = [['Levels', `1–${b.maxLevel}`], ['Level 1 cost', costText(b.cost)], ['Cost growth', `about ${Math.round((COST_GROWTH - 1) * 100)}% per level`], ['Level 1 time', days(b.days)], ['Per level', modsText(b.perLevel)]];
    if (b.citadel) facts.push(['Requires Citadel level', String(b.citadel)]);
    if (b.requires) facts.push(['Requires', Object.entries(b.requires).map(([id, lv]) => `${CAPITAL_BY_ID[id].label} ${lv}`).join(', ')]);
    if (b.notes) facts.push(['Also', b.notes]);
    out.push({ id: `cap.${b.id}`, cat: 'capital', group: 'Capital buildings', title: b.label, summary: b.description, facts, related: ['mech.capital'], screen: 'capital' });
  }
  // roles
  for (const r of ROLE_ORDER) {
    const d = ROLES[r];
    out.push({ id: `role.${r}`, cat: r === 'governor' ? 'colonization' : r === 'spymaster' ? 'espionage' : 'characters', group: 'Character roles', title: d.label, summary: d.description, facts: [['Serves', d.serves], ['Key attributes', d.primary.map((a) => ATTR_LABEL[a]).join(', ')], ['Skills', SKILLS.filter((s) => s.role === r).map((s) => s.label).join(', ') || '—']], related: ['mech.characters'], screen: 'heroes' });
  }
  for (const t of TRAITS) out.push({ id: `trait.${t.id}`, cat: 'characters', group: 'Traits', title: t.label, summary: t.description, facts: [['Kind', t.good ? 'Virtue' : 'Flaw'], ...(t.attrs ? [['Attributes', Object.entries(t.attrs).map(([k, v]) => `${v! > 0 ? '+' : ''}${v} ${ATTR_LABEL[k as keyof typeof ATTR_LABEL]}`).join(', ')] as [string, string]] : []), ...(t.loyalty ? [['Loyalty', `${t.loyalty > 0 ? '+' : ''}${t.loyalty}`] as [string, string]] : [])], related: ['mech.characters'], screen: 'heroes' });
  for (const i of ITEMS) out.push({ id: `item.${i.id}`, cat: 'characters', group: 'Equipment', title: i.label, summary: i.description, facts: [['Slot', i.slot], ['Commission cost', costText(i.cost)], ...(i.attrs ? [['Attributes', Object.entries(i.attrs).map(([k, v]) => `+${v} ${ATTR_LABEL[k as keyof typeof ATTR_LABEL]}`).join(', ')] as [string, string]] : []), ...(i.findable ? [['Found', 'in ruins and derelicts'] as [string, string]] : [])], related: ['mech.characters'], screen: 'heroes' });
  // decrees
  for (const d of DECREES) out.push({ id: `decree.${d.id}`, cat: 'council', group: 'Decrees', title: d.label, summary: d.description, facts: [['Cost', costText(d.cost)], ['Lasts', days(d.days)], ['Cooldown', days(d.cooldown)], ['Effects at full strength', modsText(d.mods)], ['Strengthened by', `the ${COUNCIL_SEATS.find((s) => s.id === d.seat)?.label ?? d.seat}'s ${ATTR_LABEL[d.attr]}`], ...(d.war != null ? [['Only', d.war ? 'at war' : 'at peace'] as [string, string]] : [])], related: ['mech.decrees'], screen: 'council' });
  // governments and policies
  for (const gv of Object.values(GOVERNMENTS)) out.push({ id: `gov.${gv.id}`, cat: 'council', group: 'Governments', title: gv.label, summary: gv.description, facts: [['Ruler', gv.ruler], ['Effects', gv.summary.join(', ')]], related: ['mech.council'], screen: 'kingdom' });
  for (const p of POLICIES) out.push({ id: `policy.${p.id}`, cat: 'council', group: 'Policies', title: p.label, summary: `${MINISTRIES.find((m) => m.id === p.ministry)?.label ?? p.ministry} policy.`, facts: p.options.map((o) => [o.label, o.description]), related: ['mech.council'], screen: 'kingdom' });
  // planets and stars
  for (const t of Object.values(PLANET_TYPES)) out.push({ id: `planet.${t.id}`, cat: 'worlds', group: 'Planet types', title: t.label, summary: t.description, facts: [['Natural climate', t.climate ?? 'none'], ['Habitability (wet / dry / cold)', `${Math.round(t.hab.wet * 100)}% / ${Math.round(t.hab.dry * 100)}% / ${Math.round(t.hab.cold * 100)}%`], ['Districts per size (res / agri / mining / power)', `${t.districts.residential} / ${t.districts.agri} / ${t.districts.mining} / ${t.districts.power}`], ['Yield (food / minerals / energy)', `${t.yield.food} / ${t.yield.minerals} / ${t.yield.energy}`]], related: ['mech.colonize', 'mech.planetBuild'], screen: 'planets' });
  for (const [id, s] of Object.entries(STAR_TYPES)) out.push({ id: `star.${id}`, cat: 'galaxy', group: 'Star types', title: s.label, summary: `Energy yield ×${s.energy}; luminosity ${s.luminosity} suns.`, facts: [['Energy multiplier', `×${s.energy}`], ['Luminosity', `${s.luminosity} L☉`]], related: ['mech.galaxy', 'mech.kardashev'] });
  return out;
}

// ---------------------------------------------------------------- category overviews

function overviews(): CodexEntry[] {
  const cat = (id: CodexCat) => CODEX_CATS.find((c) => c.id === id)!.label;
  return [
    { id: 'cat.worlds', cat: 'worlds', title: cat('worlds'), summary: 'How worlds are organised, built and kept stable.', related: ['mech.provinces', 'mech.planetBuild', 'mech.stability', 'mech.designation', 'mech.outpost'] },
    { id: 'cat.capital', cat: 'capital', title: cat('capital'), summary: `${CAPITAL_BUILDINGS.length} buildings of the imperial city.`, related: ['mech.capital', ...CAPITAL_BUILDINGS.map((b) => `cap.${b.id}`)] },
    { id: 'cat.economy', cat: 'economy', title: cat('economy'), summary: 'Stockpiles, storage, shortages and the market.', related: ['mech.resources', 'mech.storage', 'mech.shortage', 'mech.market'] },
    { id: 'cat.production', cat: 'production', title: cat('production'), summary: 'Refining chains and the trade that reaches the capital.', related: ['mech.chains', 'mech.trade', 'mech.operations'] },
    { id: 'cat.fleets', cat: 'fleets', title: cat('fleets'), summary: `${SHIP_ORDER.length} ship classes, fleets, combat and invasion.`, related: ['mech.ships', 'mech.naval', 'mech.combat', 'mech.invasion', ...SHIP_ORDER.map((s) => `ship.${s}`)] },
    { id: 'cat.research', cat: 'research', title: cat('research'), summary: `${TECHS.length} technologies in ${TECH_CATEGORIES.length} fields.`, related: ['mech.research'] },
    { id: 'cat.eras', cat: 'eras', title: cat('eras'), summary: `${ERAS.length} political eras and the scientific energy scale.`, related: ['mech.eras', 'mech.kardashev', ...ERAS.map((e) => `era.${e.id}`)] },
    { id: 'cat.characters', cat: 'characters', title: cat('characters'), summary: `${ROLE_ORDER.length} roles, ${TRAITS.length} traits, ${ITEMS.length} items of equipment.`, related: ['mech.characters', ...ROLE_ORDER.map((r) => `role.${r}`)] },
    { id: 'cat.council', cat: 'council', title: cat('council'), summary: 'Seats, ministries, policies, decrees and governments.', related: ['mech.council', 'mech.decrees'] },
    { id: 'cat.megastructures', cat: 'megastructures', title: cat('megastructures'), summary: `${MEGASTRUCTURES.length} generational projects.`, related: ['mech.mega', ...MEGASTRUCTURES.map((m) => `mega.${m.id}`)] },
  ];
}

// ---------------------------------------------------------------- index and search

let all: CodexEntry[] | null = null;
let byId: Record<string, CodexEntry> = {};

export function codexEntries(): CodexEntry[] {
  if (!all) {
    all = [...MECHANICS, ...overviews(), ...generated()];
    byId = Object.fromEntries(all.map((e) => [e.id, e]));
  }
  return all;
}

export function codexEntry(id: string): CodexEntry | null {
  codexEntries();
  return byId[id] ?? null;
}

const text = (e: CodexEntry) => [e.title, e.summary, e.what, e.does, e.how, e.strategy, ...(e.facts ?? []).flat(), e.group].filter(Boolean).join(' ').toLowerCase();

/** Entries matching every word of the query, best first (title matches before body matches). */
export function searchCodex(query: string, cat?: CodexCat | null): CodexEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = codexEntries().filter((e) => !cat || e.cat === cat);
  if (!words.length) return pool;
  const scored: [CodexEntry, number][] = [];
  for (const e of pool) {
    const t = text(e), title = e.title.toLowerCase();
    if (!words.every((w) => t.includes(w))) continue;
    let score = 0;
    for (const w of words) score += title.startsWith(w) ? 6 : title.includes(w) ? 4 : 1;
    if (e.id.startsWith('mech.')) score += 2;
    scored.push([e, score]);
  }
  return scored.sort((a, b) => b[1] - a[1] || a[0].title.localeCompare(b[0].title)).map(([e]) => e);
}

/** One-line explanation of a resource (or research) for tooltips, from the Resources entry. */
export function resourceHelp(key: string): string | null {
  const label: Record<string, string> = { credits: 'Credits', minerals: 'Minerals', energy: 'Energy', food: 'Food', alloys: 'Alloys', electronics: 'Electronics', components: 'Components', rare: 'Rare elements', influence: 'Influence', research: 'Research' };
  return codexEntry('mech.resources')?.facts?.find(([k]) => k === label[key])?.[1] ?? null;
}

/** Codex entry for a resource key, used by tooltips. */
export const RESOURCE_ENTRY = 'mech.resources';
export const RESOURCE_KEYS = RESOURCES;
