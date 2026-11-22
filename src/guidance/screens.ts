// What each management window is for and how to use its controls. Shown by the window's ?
// button (information panel) and, the first time a window opens, as a short first-visit card.
// Written against the screens as they are (src/ui/screens); every control named here exists.

import type { ScreenId } from '../ui/store';

export interface ScreenInfo {
  title: string;
  /** one sentence: what this window is for */
  purpose: string;
  /** the important controls and readouts */
  controls: [string, string][];
  /** advanced mechanics worth knowing, kept out of the main interface */
  advanced?: string[];
  /** Codex entries to read next */
  codex: string[];
  /** lesson that teaches this window */
  lesson?: string;
}

export const SCREEN_INFO: Partial<Record<ScreenId, ScreenInfo>> = {
  throne: {
    title: 'Throne room', purpose: 'Your seat of power: what awaits your word, your ministries at a glance, and the succession.',
    controls: [['Awaiting your word', 'Matters that need a decision: idle research, petitions, envoys and more. Click one to open the window that handles it.'], ['Ministries', 'A summary of each ministry with a link to it.'], ['Succession', 'Your sovereign\'s age and reign, and the heir. Name an heir (10 influence) to avoid a succession crisis.']],
    advanced: ['Without a named heir, the strongest Great House puts forward a claimant when the sovereign dies: house loyalty falls, stability suffers for two years, and a disaffected house may rise for its own pretender.'],
    codex: ['mech.succession', 'mech.sovereign'], lesson: 'diplomacy',
  },
  kingdom: {
    title: 'Kingdom overview', purpose: 'The state of the realm: government, political eras, policies, rankings and every active effect.',
    controls: [['Political eras', 'Your era, the requirements for the next one and your Kardashev rating.'], ['Government', 'Reform the government (costs influence; possible only every few years).'], ['Ministries and policies', 'One policy per question, grouped by ministry. Hover an option to see its effect and monthly cost.'], ['Ranking of known powers', 'How you compare with the realms you have met.'], ['Active effects', 'Every modifier currently applied to your realm, summed.']],
    codex: ['mech.eras', 'mech.kardashev', 'cat.council'], lesson: 'research',
  },
  council: {
    title: 'Royal council', purpose: 'Your ministers, decrees, the Great Houses and your provinces.',
    controls: [['Council tab', 'Six seats. A councillor\'s attributes become realm-wide bonuses. Assign characters from the Hall of Heroes.'], ['Decrees tab', 'Issue temporary edicts paid in influence and resources; up to three in force, each with a cooldown.'], ['Houses tab', 'Each house\'s power, loyalty, ambition and grievance. Grant, honour or suppress a house.'], ['Provinces tab', 'Your sectors, their governors and colonies.'], ['Matters before the council', 'Petitions. Each option shows its cost and effect; an unanswered petition takes its default answer after 90 days.']],
    advanced: ['A house whose ambition is ignored gathers grievance; low loyalty with high power can turn into open revolt, which damages stability in its provinces.'],
    codex: ['mech.council', 'mech.decrees', 'mech.houses', 'mech.provinces'], lesson: 'diplomacy',
  },
  capital: {
    title: 'Imperial capital', purpose: 'The city around your Citadel: plots, buildings, levels and the builders\' queue.',
    controls: [['City view', 'Click a plot to select it. Open plots can take a new building; sealed plots open with Citadel levels.'], ['Raise or extend', 'Buildings you can raise on the selected plot, or the next level of the selected building, with cost and time.'], ['Builders\' queue', 'Works in progress, in order. Cancel to stop a job.'], ['What the city gives the realm', 'The combined effect of every capital building.']],
    advanced: ['Costs grow about 16% per level. Raising the Citadel requires the rest of the city and the Throne hall to keep pace.'],
    codex: ['mech.capital', 'cat.capital'], lesson: 'capital',
  },
  planets: {
    title: 'Planet management', purpose: 'Each colony: districts and buildings, jobs and housing, output, stability, deposits and shipyards.',
    controls: [['Colony list', 'Select a colony to manage it.'], ['Districts and buildings', 'Queue construction. Districts are limited by the planet; buildings use slots that grow every 5 pops. Costs are paid when work starts.'], ['Monthly output', 'What this world produces and consumes.'], ['Stability factors', 'Why the world is content or restless.'], ['Province role', 'Designate the colony (Breadbasket, Forge world, ...) for a focused bonus.']],
    advanced: ['Pops fill jobs in priority order (food and energy first). Unemployed pops pay less tax; without housing or food, population shrinks.', 'Stability below 40 reduces output; long periods of very low stability lead to revolt.'],
    codex: ['mech.planetBuild', 'mech.stability', 'mech.designation', 'cat.worlds'], lesson: 'expansion',
  },
  system: {
    title: 'Star systems', purpose: 'Your claimed systems: starbases, orbital stations and megastructures.',
    controls: [['System list', 'Select a system.'], ['Starbase', 'Upgrade outposts to starports and citadels for defence and secure trade lanes.'], ['Celestial bodies', 'Planets and moons; build an orbital station on an uncolonised body.'], ['Megastructures', 'Progress of great works in the system.']],
    codex: ['mech.outpost', 'mech.operations', 'mech.mega'], lesson: 'galaxy',
  },
  fleets: {
    title: 'Fleet management', purpose: 'Every fleet: commanders, ships, composition and orders.',
    controls: [['Fleet list', 'Select a fleet.'], ['Commanders', 'Assign an admiral, general or explorer to lead it.'], ['Ships', 'Select ships to split them into a new fleet.'], ['Command', 'Stance (aggressive, defensive, passive), merge, rename and disband.']],
    advanced: ['Fleets resupply inside your supply network and lose supply outside it; low supply weakens them.'],
    codex: ['mech.ships', 'mech.naval', 'mech.combat', 'cat.fleets'], lesson: 'fleets',
  },
  military: {
    title: 'Military operations', purpose: 'Wars, hostile forces in sensor range, your fleets and battle reports.',
    controls: [['Wars', 'Each war and its score; offer peace from Diplomacy.'], ['Hostile forces sighted', 'Enemy fleets you can see.'], ['Battle reports', 'Replay any battle round by round.']],
    codex: ['mech.combat', 'mech.war', 'mech.invasion'], lesson: 'fleets',
  },
  warroom: {
    title: 'War room', purpose: 'A strategic picture of every front: wars, border systems, hostile and friendly fleets, recent battles.',
    controls: [['Fronts', 'Border systems with rivals you are at war with.'], ['Hostile forces', 'Enemy fleets in sensor range.'], ['Our fleets', 'Your fleets and their strength.']],
    codex: ['mech.war', 'mech.combat'], lesson: 'fleets',
  },
  heroes: {
    title: 'Hall of Heroes', purpose: 'The notable people of the realm: recruit, assign, train and equip them.',
    controls: [['Roster', 'Characters in service and candidates waiting to be recruited.'], ['Post', 'Assign the selected character to a fleet, province, world, envoy post or council seat.'], ['Skills', 'Spend skill points earned with levels.'], ['Equipment and Armoury', 'Equip items; commission new ones once a Military academy stands in the capital.']],
    advanced: ['Loyalty follows pay, treatment and whether a character\'s ambition is met; disloyal characters may leave.', 'Captured enemy characters can be pardoned, recruited or ransomed.'],
    codex: ['mech.characters', 'cat.characters'], lesson: 'characters',
  },
  economy: {
    title: 'Economy', purpose: 'Every monthly flow of every resource, the galactic market, storage and fiscal levers.',
    controls: [['Kingdom ledger', 'Income, expense and net per resource. Click a resource for its sources and uses.'], ['Galactic market', 'Buy and sell goods for credits. A broker fee applies and prices move as you trade.'], ['Storage', 'Stock against capacity; income beyond capacity is lost.'], ['Fiscal levers', 'Policies that change taxes and spending.']],
    codex: ['mech.resources', 'mech.storage', 'mech.shortage', 'mech.market', 'cat.economy'], lesson: 'economy',
  },
  industry: {
    title: 'Industry', purpose: 'Production chains, output by world and your shipyards.',
    controls: [['Production chains', 'Raw extraction feeding refining and manufacturing, with live monthly figures.'], ['Output by world', 'Which colonies produce what.'], ['Shipyards', 'Every shipyard and what it is building.']],
    codex: ['mech.chains', 'cat.production'], lesson: 'economy',
  },
  operations: {
    title: 'Resource operations', purpose: 'Orbital stations on uncolonised bodies: level, mode, reserve and logistics.',
    controls: [['Operations list', 'Each station and its output.'], ['Level', 'Upgrade an operation (levels 1–5) for more output.'], ['Mode', 'Standard, surge (more output, drains the reserve), sustain (lets the reserve recover) or halted.']],
    advanced: ['Output reaches your stockpiles only through logistics: the supply network, freighter capacity (spaceports, imperial shipyards, logistics ships) and freedom from blockade.'],
    codex: ['mech.operations', 'mech.chains'], lesson: 'economy',
  },
  construction: {
    title: 'Construction', purpose: 'Every project underway: planetary construction, shipyards, expansion projects and megastructures.',
    controls: [['Planetary construction', 'Buildings and districts in progress across all worlds.'], ['Shipyards', 'Hulls under construction.'], ['Expansion projects', 'Outposts, colonies and starbase upgrades in progress.'], ['Megastructures', 'Great works you can begin and those under way.']],
    codex: ['mech.mega', 'cat.megastructures', 'mech.planetBuild'], lesson: 'megastructures',
  },
  trade: {
    title: 'Trade routes', purpose: 'How each world\'s trade reaches the capital, and how to protect it.',
    controls: [['Routes to the capital', 'Each route\'s status: secure, raided, disrupted or cut, and what it loses.'], ['Trade agreements', 'Treaties that add to collected trade.'], ['Resource contracts and tribute', 'Recurring exchanges with other realms.'], ['Protecting commerce', 'Starports and patrols stop losses on a lane.']],
    codex: ['mech.trade', 'mech.treaties'], lesson: 'economy',
  },
  research: {
    title: 'Research', purpose: 'Choose and queue technologies.',
    controls: [['Available projects', 'Technologies whose prerequisites you meet. Research starts now; Queue adds it after the current one.'], ['Current project', 'Progress and time remaining.'], ['Queue', 'What follows when the current project completes.']],
    codex: ['mech.research', 'cat.research'], lesson: 'research',
  },
  techtree: {
    title: 'Technology tree', purpose: 'Every technology and its prerequisites, by field and tier.',
    controls: [['Tree', 'Lines show prerequisites. Click an available technology to research it, or a locked one to queue it.']],
    codex: ['mech.research', 'mech.eras'], lesson: 'research',
  },
  diplomacy: {
    title: 'Diplomacy', purpose: 'Other realms: opinions, treaties, deals, contracts, war and peace.',
    controls: [['Envoys awaiting an answer', 'Proposals made to you; accept or refuse.'], ['Why they feel this way', 'Every memory behind a realm\'s opinion of you.'], ['Treaties', 'Propose or break pacts.'], ['War and peace', 'Declare war (40 influence, no truce) or offer peace terms.'], ['Exchange and Resource contract', 'One-time transfers and monthly contracts; the reply explains itself.']],
    codex: ['mech.diplomacy', 'mech.treaties', 'mech.war'], lesson: 'diplomacy',
  },
  intel: {
    title: 'Intelligence', purpose: 'What you know about other realms, galactic dangers and covert operations.',
    controls: [['Realm reports', 'Estimates of rival strength; accuracy depends on borders, treaties, networks and your intelligence service.'], ['Galactic dangers', 'Guardians and raiders.'], ['Covert operations', 'Send a spymaster on an operation against a rival.']],
    codex: ['mech.espionage', 'role.spymaster'], lesson: 'characters',
  },
  journal: {
    title: 'Event journal', purpose: 'Every event of your reign; select one to go to the place it concerns.',
    controls: [['Filters', 'Narrow the log by kind.'], ['Entries', 'Click to jump to the system, world or window involved.']],
    codex: ['mech.sovereign'],
  },
  chronicle: {
    title: 'Chronicle of the reign', purpose: 'Year-by-year standings of every great realm and the year\'s headlines.',
    controls: [['Chart', 'Compare realms on population, systems, colonies, military, Citadel, era or Kardashev rating.'], ['The years', 'Headlines of each year.']],
    codex: ['mech.eras', 'mech.kardashev'],
  },
  vault: {
    title: 'Relic Vault', purpose: 'Spend relics, earned by playing, on random draws for warships, heroes and supplies.',
    controls: [['Draw 1 / Draw 10', 'Spend relics. Cards reveal what you got; ships join your fleet at the capital, heroes join your court.'], ['Odds', 'The chance of each rarity, published. Every tenth draw is at least epic; a legendary comes within 40 draws.'], ['Recent draws', 'Your last 40 results.']],
    advanced: ['Relics come from quests, ambitions, new eras, won wars and decisive battles. No real money is involved.'],
    codex: [],
  },
  codex: {
    title: 'Imperial Codex', purpose: 'The reference of the realm: lessons, an encyclopedia of every mechanic, and guidance settings.',
    controls: [['Lessons', 'Start, resume or replay any of the ten guided lessons.'], ['Encyclopedia', 'Search or browse entries. Links jump to related entries and to the window where you use the mechanic.'], ['Settings', 'Turn lessons, first-visit cards, hints and explanatory tooltips on or off, or reset lesson progress.']],
    codex: [],
  },
};
