// The guided lessons. Ten chapters teach the game by doing: each step names an objective that
// completes itself when the player actually does it (checked against the real game state or a
// recorded player action), and highlights the control involved. Chapters unlock progressively and
// any chapter can be replayed from the Codex.

import type { GameState } from '../sim/types';
import type { ScreenId, UIState } from '../ui/store';
import { getLedger } from '../sim/engine';
import { claimCost } from '../sim/territory';
import { hasContact } from '../sim/diplomacy';
import { kardashev } from '../sim/eras';
import { ERAS } from '../sim/data/eras';
import { MEGASTRUCTURES } from '../sim/data/megastructures';
import { charactersOf } from '../sim/characters';
import { CITADEL_MAX } from '../sim/data/capital';
import { DESIGNATION_COST } from '../sim/data/designations';
import type { Command } from '../sim/commands';
import { TECH_BY_ID, techCost } from '../sim/data/techs';
import { availableTechs } from '../sim/research';
import { canBuild } from '../sim/construction';
import { adjacency } from '../sim/galaxy';
import { SHIPS } from '../sim/data/ships';
import {
  atWarWith, bestWarship, captured, conquestFocus, defenceAt, fleetNeeded, garrisonOf, myTroops, myWarFleets, myWarPower,
  orbitWon, orderAttack, orderInvade, orderTransports, orderWarships, pickTarget, queuedTroops, queuedWarships, troopsNeeded, type Focus,
} from './conquest';

export interface LessonCtx {
  g: GameState;
  ui: UIState;
  /** counters when the step began */
  base: Record<string, number>;
  now: Record<string, number>;
  /** a recorded flag: `act:<command>` (player command succeeded), `win:<screen>` (window opened), `view:system`, `sel:system`, `sel:planet`, `sel:fleet` */
  has: (flag: string) => boolean;
}

export interface LessonStep {
  title: string;
  text: string | ((c: LessonCtx) => string);
  /** the objective, shown with a tick box; steps without one are read-and-continue */
  goal?: string | ((c: LessonCtx) => string);
  done?: (c: LessonCtx) => boolean;
  /** controls to highlight, first match wins (falls back down the list when a window is closed) */
  target?: string[];
  /** "Show me" opens this screen */
  open?: ScreenId;
  /** "Show me" selects these on the map (and opens a screen), when the step is about one thing */
  show?: (g: GameState) => { screen?: ScreenId; systemId?: number; planetId?: number; fleetId?: number } | null;
  /** "Do it for me": the orders that carry out the step (run in order) */
  auto?: (g: GameState) => Command[];
  /** stop at the first order that succeeds (alternatives, e.g. peace terms from best to least) */
  autoFirst?: boolean;
}

export interface Chapter {
  id: string;
  n: number;
  title: string;
  brief: string;
  /** recommended once this holds (the chapter is always available to start by hand) */
  unlock: (g: GameState, done: string[]) => boolean;
  unlockText: string;
  codex: string[];
  steps: LessonStep[];
}

const neo = (label: string) => `.neo-btn[aria-label="${label}"]`;
const win = (label: string) => `section.win[aria-label="${label}"]`;
const guide = (id: string) => `[data-guide="${id}"]`;
const grew = (k: string, by = 1) => (c: LessonCtx) => (c.now[k] ?? 0) >= (c.base[k] ?? 0) + by;
const opened = (id: ScreenId) => (c: LessonCtx) => c.has(`win:${id}`) || c.ui.windows.some((w) => w.id === id) || (id === 'capital' && c.ui.view === 'capital');
const me = (g: GameState) => g.empires[g.playerId];

// ---------------------------------------------------------------- helpers for the first lessons

function cheapestTech(g: GameState): string | null {
  const ids = availableTechs(me(g)).filter((id) => TECH_BY_ID[id]);
  ids.sort((a, b) => techCost(a) - techCost(b));
  return ids[0] ?? null;
}
/** The district for whichever of minerals, energy and food is lowest, that the home planet can take. */
function districtToBuild(g: GameState) {
  const e = me(g);
  const p = e.capitalPlanetId != null ? g.planets[e.capitalPlanetId] : null;
  if (!p?.colony) return null;
  const L = getLedger(g, e);
  const opts = ([['minerals', 'mining'], ['energy', 'power'], ['food', 'agri']] as const).slice().sort((a, b) => L.net[a[0]] - L.net[b[0]]);
  for (const [, d] of opts) if (canBuild(g, e, p, d).ok) return d;
  return canBuild(g, e, p, 'residential').ok ? 'residential' as const : null;
}
const scoutFleet = (g: GameState) => Object.values(g.fleets).find((x) => x.ownerId === g.playerId && x.ships.length > 0 && x.ships.every((s) => s.cls === 'scout'));
const ctorFleet = (g: GameState) => Object.values(g.fleets).find((x) => x.ownerId === g.playerId && x.ships.some((s) => s.cls === 'constructor') && x.order.type !== 'outpost');
function freeNeighbour(g: GameState): number | null {
  const e = me(g);
  const owned = new Set(g.galaxy.systems.filter((s) => s.owner === e.id).map((s) => s.id));
  return g.galaxy.lanes.flatMap(([a, b]) => owned.has(a) ? [b] : owned.has(b) ? [a] : []).find((id) => g.galaxy.systems[id].owner == null && !g.galaxy.systems[id].outpostProject && !g.galaxy.systems[id].features.includes('guardian') && e.explored.includes(id)) ?? null;
}
function nearestUnexplored(g: GameState, from: number): number | null {
  const adj = adjacency(g.galaxy);
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const v = q.shift()!;
    if (!me(g).explored.includes(v)) return v;
    for (const n of adj[v]) if (!seen.has(n)) { seen.add(n); q.push(n); }
  }
  return null;
}
const planetName = (g: GameState, f: Focus) => g.planets[f.planetId].name;
function shipyardId(g: GameState): number | undefined {
  const mine = g.planets.filter((p) => p.colony?.ownerId === g.playerId && (p.colony.buildings.shipyard ?? 0) > 0);
  return (mine.find((p) => p.id === me(g).capitalPlanetId) ?? mine[0])?.id;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'welcome', n: 1, title: 'The Basics', brief: 'Three things only: the clock, inventing upgrades and building on your planet.',
    unlock: () => true, unlockText: 'Available from the start.', codex: ['mech.sovereign', 'mech.time'],
    steps: [
      {
        title: 'Welcome, ruler',
        text: (c) => `You rule the ${me(c.g).name}, a small kingdom in space. Right now it is one planet, a few ships and a lot of empty stars. Your job is to make it bigger and stronger. You do not need to understand everything. This lesson shows you three things: the clock, inventing and building. Everything else comes later, one piece at a time.`,
      },
      {
        title: 'Start and stop the clock',
        text: 'The game is stopped. Nothing happens until you start the clock. Press Space, or the round button at the bottom of the screen, to start time. Press it again to stop. Stop whenever you want to think: you can give orders while the clock is stopped.',
        goal: 'Start the clock, then stop it',
        done: (c) => c.has('ran') && c.ui.speed === 0,
        target: ['.dial-center'],
      },
      {
        title: 'Pick something to invent',
        text: 'Your scientists invent upgrades, one at a time. Inventions make your planet produce more and unlock new buildings and ships. Open Research and click any one. It does not matter much which; the cheap ones finish fastest.',
        goal: 'Choose something to research',
        done: (c) => !!me(c.g).research.current || me(c.g).research.queue.length > 0,
        target: [neo('Research')],
        open: 'research',
        auto: (g) => { const t = cheapestTech(g); return t ? [{ type: 'setResearch', tech: t }] : []; },
      },
      {
        title: 'Build on your planet',
        text: 'Your planet makes what you need: minerals (to build things), energy and food. It makes them in districts, which are areas of the planet set aside for one job. Build one more district now. Tip: the numbers at the top of the screen show what you have; build more of whatever is lowest.',
        goal: 'Order a new district on your home planet',
        done: grew('buildings'),
        target: [guide('planet-build'), neo('Planets')],
        show: (g) => ({ screen: 'planets', planetId: me(g).capitalPlanetId ?? undefined }),
        auto: (g) => { const d = districtToBuild(g); return d ? [{ type: 'queueBuilding', planetId: me(g).capitalPlanetId!, building: d }] : []; },
      },
      {
        title: 'Let time run',
        text: 'Start the clock and let one month go by. Watch the numbers at the top change as your planet works and your scientists study.',
        goal: 'Let one month pass',
        done: (c) => (c.now.tick ?? 0) >= (c.base.tick ?? 0) + 30,
        target: ['.dial-center'],
      },
      {
        title: 'What to do next',
        text: 'That is the basics. From now on, look at the Next step box on the right: it always shows one thing worth doing, with a button that takes you there. The buttons on the left are the game\'s screens. You start with only a few. New ones appear when you need them, and each comes with a short explanation. When you are ready, the next lesson shows how to grow.',
        target: ['.hints'],
      },
    ],
  },
  {
    id: 'grow', n: 2, title: 'Getting Bigger', brief: 'What the stars on the map are, how to explore them, and how to make free ones yours.',
    unlock: (_g, d) => d.includes('welcome'), unlockText: 'After "The Basics".', codex: ['mech.galaxy', 'mech.fog', 'mech.outpost'],
    steps: [
      {
        title: 'Stars are places',
        text: 'Each dot of light on the map is a star system: a sun with planets around it. The coloured area around your home is your territory. Stars nobody has coloured are free. Owning more systems means more resources and more room. Two of your ships help you grow: a scout, to look around, and a construction ship, to claim.',
      },
      {
        title: 'Explore with your scout',
        text: 'Most stars are dark because nobody from your realm has been there. Your scout fixes that. Press Show me to select it, then right-click any star to send it there. Each star it visits gets charted: you see its planets, and you meet whoever lives nearby.',
        goal: 'Explore a new star system',
        done: grew('explored'),
        target: ['.right-col'],
        show: (g) => { const f = scoutFleet(g); return f ? { fleetId: f.id, systemId: f.systemId } : null; },
        auto: (g) => { const f = scoutFleet(g); const t = f ? nearestUnexplored(g, f.systemId) : null; return f && t != null ? [{ type: 'moveFleet', fleetId: f.id, target: t }] : []; },
      },
      {
        title: 'Claim a free system',
        text: (c) => `To make a free system yours, your construction ship builds an outpost there: a small space station that marks the system as yours. Press Show me to pick a free system next to yours, then press Send construction ship on the right. It costs influence (a slow-growing resource used for claims and deals) and 40 alloys (refined metal).${ctorFleet(c.g) ? '' : ' You have no construction ship right now: Do it for me orders one at your shipyard.'}`,
        goal: 'Send a construction ship to claim a system',
        done: (c) => Object.values(c.g.fleets).some((f) => f.ownerId === c.g.playerId && f.order.type === 'outpost') || c.g.galaxy.systems.some((s) => s.outpostProject?.empireId === c.g.playerId) || grew('systems')(c),
        target: ['text:.right-col button|Send construction ship', '.right-col'],
        show: (g) => { const free = freeNeighbour(g); return free != null ? { systemId: free } : null; },
        auto: (g) => {
          const f = ctorFleet(g); const free = freeNeighbour(g);
          if (f && free != null) return [{ type: 'fleetOrder', fleetId: f.id, order: { type: 'outpost', systemId: free } }];
          const yard = g.planets.find((p) => p.colony?.ownerId === g.playerId && (p.colony.buildings.shipyard ?? 0) > 0);
          return yard ? [{ type: 'queueShip', planetId: yard.id, cls: 'constructor' }] : [];
        },
      },
      {
        title: 'Wait for the outpost',
        text: 'Flying there and building takes a couple of months. Start the clock and watch. You can also skip this step and keep playing; the outpost finishes on its own.',
        goal: 'Own a second star system',
        done: (c) => (c.now.systems ?? 0) >= 2 && (c.now.systems ?? 0) > (c.base.systems ?? 0) || (c.now.systems ?? 0) >= 3,
        target: ['.dial-center'],
      },
      {
        title: 'Keep growing',
        text: 'Do this whenever you can: explore, then claim the free systems next to you. Later you will settle new planets with colony ships; the Next step box will tell you when. When you meet another realm, a card explains who they are. The next lesson shows how to take a planet from someone else.',
      },
    ],
  },
  {
    id: 'conquest', n: 3, title: 'Your First War', brief: 'Take a planet from a weak neighbour, step by step: warships, soldiers, war, battle, landing and peace.',
    unlock: (g, d) => d.includes('grow') && (pickTarget(g) != null || g.tick >= 360 * 2), unlockText: 'After "Getting Bigger", once you have met a neighbour.', codex: ['mech.war', 'mech.combat', 'mech.invasion'],
    steps: [
      {
        title: 'How taking a planet works',
        text: 'Conquering is a recipe with five parts. 1) Warships, to beat the enemy\'s ships and space station. 2) Troop transports, ships that carry soldiers. 3) A declaration of war: you cannot attack a realm you are at peace with. 4) Your ships fly there and win the fight above the planet. 5) The soldiers land and take it. This lesson does it with you, one part at a time, against an easy target it picks for you.',
      },
      {
        title: 'Pick a target',
        text: (c) => {
          const f = conquestFocus(c.g);
          if (!f) return 'You have not met anyone you could attack yet. Keep exploring with your scout. This step finishes by itself as soon as you meet a neighbour.';
          const owner = c.g.empires[f.empireId];
          return `Your target: ${planetName(c.g, f)}, a world of the ${owner.name}. ${owner.kind === 'minor' ? 'They are a small independent realm, so this is a good first fight.' : 'They are a great realm, so be careful: they have more ships than a small realm would.'} Press Show me to see where it is.`;
        },
        goal: 'Find a world you could take',
        done: (c) => conquestFocus(c.g) != null,
        show: (g) => { const f = conquestFocus(g); return f ? { systemId: g.planets[f.planetId].systemId } : null; },
      },
      {
        title: 'Build warships',
        text: (c) => {
          const f = conquestFocus(c.g);
          const need = f ? fleetNeeded(c.g, f) : 0;
          return `Warships do the fighting. ${f ? `${planetName(c.g, f)} is guarded with a strength of about ${Math.round(defenceAt(c.g, f.planetId))}, and the ${c.g.empires[f.empireId].name} could send more. Aim for a fleet strength of ${need} or more.` : ''} Open your shipyard (Show me) and build ${SHIPS[bestWarship(c.g)].label}s, or press Do it for me. Ships take weeks to build, so let the clock run. New warships join the fleet at your home planet by themselves.`;
        },
        goal: (c) => { const f = conquestFocus(c.g); return `Fleet strength ${Math.round(myWarPower(c.g))} of ${f ? fleetNeeded(c.g, f) : '?'}${queuedWarships(c.g) ? ` (${queuedWarships(c.g)} more being built)` : ''}`; },
        done: (c) => { const f = conquestFocus(c.g); return !!f && myWarPower(c.g) >= fleetNeeded(c.g, f); },
        target: ['text:section.win[aria-label="Planets"] .build-opt|Destroyer', 'text:section.win[aria-label="Planets"] .build-opt|Frigate', 'text:section.win[aria-label="Planets"] .build-opt|Corvette', neo('Planets')],
        show: (g) => ({ screen: 'planets', planetId: shipyardId(g) }),
        auto: (g) => orderWarships(g),
      },
      {
        title: 'Build troop transports',
        text: (c) => {
          const f = conquestFocus(c.g);
          const need = f ? troopsNeeded(c.g, f.planetId) : 8;
          return `Warships cannot take a planet; soldiers can. Each Troop Transport carries 8 soldiers. ${f ? `${planetName(c.g, f)} has about ${Math.round(garrisonOf(c.g, f.planetId))} defenders, so bring at least ${need} soldiers (${Math.ceil(need / 8)} transports).` : ''} Build them at your shipyard, or press Do it for me. They also join your home fleet.`;
        },
        goal: (c) => { const f = conquestFocus(c.g); return `Soldiers aboard: ${Math.round(myTroops(c.g))} of ${f ? troopsNeeded(c.g, f.planetId) : '?'}${queuedTroops(c.g) ? ` (${queuedTroops(c.g)} more being built)` : ''}`; },
        done: (c) => { const f = conquestFocus(c.g); return !!f && myTroops(c.g) >= troopsNeeded(c.g, f.planetId); },
        target: ['text:section.win[aria-label="Planets"] .build-opt|Troop Transport', neo('Planets')],
        show: (g) => ({ screen: 'planets', planetId: shipyardId(g) }),
        auto: (g) => orderTransports(g, conquestFocus(g)),
      },
      {
        title: 'Declare war',
        text: (c) => {
          const f = conquestFocus(c.g);
          const name = f ? c.g.empires[f.empireId].name : 'them';
          const inf = me(c.g).stock.influence;
          return `Open Diplomacy, click the ${name} in the list, and press Declare war (or Do it for me). It costs 40 influence${inf < 40 ? `; you have ${Math.floor(inf)}, so let time run until you have enough` : ''}. Be ready: from now on they will fight back, and other realms will trust you a little less.`;
        },
        goal: 'Be at war with your target',
        done: (c) => atWarWith(c.g, conquestFocus(c.g)),
        target: ['text:section.win[aria-label="Diplomacy"] button|Declare war', neo('Diplomacy')],
        open: 'diplomacy',
        auto: (g) => { const f = conquestFocus(g); return f ? [{ type: 'declareWar', target: f.empireId }] : []; },
      },
      {
        title: 'Send the fleet',
        text: (c) => {
          const f = conquestFocus(c.g);
          const sys = f ? c.g.galaxy.systems[c.g.planets[f.planetId].systemId].name : 'the target';
          return `Press Show me to select your fleet, then right-click the star ${sys} on the map (or press Do it for me). Take the transports along: soldiers can only land from the same system.`;
        },
        goal: 'Get your fleet to the target system',
        done: (c) => { const f = conquestFocus(c.g); if (!f) return false; if (captured(c.g, f)) return true; const sid = c.g.planets[f.planetId].systemId; return Object.values(c.g.fleets).some((x) => x.ownerId === c.g.playerId && (x.systemId === sid && !x.path.length || x.order.type === 'move' && (x.order as { target: number }).target === sid)); },
        target: ['.right-col'],
        show: (g) => { const fl = myWarFleets(g).sort((a, b) => b.ships.length - a.ships.length)[0]; return fl ? { fleetId: fl.id, systemId: fl.systemId } : null; },
        auto: (g) => orderAttack(g, conquestFocus(g)),
      },
      {
        title: 'Win the fight in orbit',
        text: 'When your ships arrive they fight by themselves: you do not aim or fire. Before soldiers can land you must destroy every enemy warship there, their space station and the planet\'s defence guns. Let the clock run and watch. If you are losing badly, select your fleet and right-click a star at home to pull back, then build more ships.',
        goal: 'Clear the sky above the target',
        done: (c) => orbitWon(c.g, conquestFocus(c.g)),
        target: ['.dial-center'],
        show: (g) => { const f = conquestFocus(g); return f ? { systemId: g.planets[f.planetId].systemId } : null; },
      },
      {
        title: 'Land the soldiers',
        text: (c) => {
          const f = conquestFocus(c.g);
          return `The sky is yours. Press Show me to select ${f ? planetName(c.g, f) : 'the planet'}, then press Invade on the right (or Do it for me). Your soldiers land and fight the defenders: more soldiers than defenders wins. If the landing fails, the transports are lost; build more and try again.`;
        },
        goal: 'Capture the planet',
        done: (c) => captured(c.g, conquestFocus(c.g)),
        target: ['text:.right-col button|Invade', '.right-col'],
        show: (g) => { const f = conquestFocus(g); return f ? { systemId: g.planets[f.planetId].systemId, planetId: f.planetId } : null; },
        auto: (g) => orderInvade(g, conquestFocus(g)),
      },
      {
        title: 'Make peace',
        text: (c) => {
          const f = conquestFocus(c.g);
          return `${f ? planetName(c.g, f) : 'The planet'} is yours. Wars cost money every month and the enemy will try to take it back, so end the war. Open Military and offer peace (or Do it for me): asking for land or money works when you are winning; "status quo" just stops the fighting. If they refuse, keep winning and ask again. Either way, the planet stays yours.`;
        },
        goal: 'End the war',
        done: (c) => !atWarWith(c.g, conquestFocus(c.g)),
        target: ['text:section.win[aria-label="Military"] button|Offer', neo('Military')],
        open: 'military',
        autoFirst: true,
        auto: (g) => {
          const f = conquestFocus(g);
          const w = f ? g.wars.find((x) => (x.attackers[0] === g.playerId && x.defenders.includes(f.empireId)) || (x.defenders[0] === g.playerId && x.attackers.includes(f.empireId))) : null;
          return w ? (['cede', 'tribute', 'status_quo'] as const).map((term) => ({ type: 'proposePeace', warId: w.id, term })) : [];
        },
      },
      {
        title: 'That is the whole recipe',
        text: 'Warships, transports, war, the fight in orbit, the landing, peace. Bigger realms have more ships and more soldiers, so start small and grow. Two new screens are on your bar: Military (your wars and peace offers) and the War room (where enemy fleets are). If someone declares war on you, a card will tell you what to do.',
      },
    ],
  },
  {
    id: 'economy', n: 4, title: 'Where Resources Come From', brief: 'What each resource is for, what happens when one runs out, and how to fix it.',
    unlock: (g, d) => d.includes('grow') && (getLedger(g, me(g)).shortages.length > 0 || g.tick >= 360), unlockText: 'When something runs out, or after a year.', codex: ['mech.resources', 'mech.storage', 'mech.shortage', 'mech.chains', 'mech.trade', 'mech.market'],
    steps: [
      {
        title: 'The nine stockpiles',
        text: 'Credits pay for almost everything and come from taxes and trade. Minerals, energy and food come from districts. Alloys, electronics and components are refined from minerals in factories. Rare elements come from special deposits. Influence pays for claims, decrees and diplomacy. Research is not stored: it flows into your current project.',
        target: ['.res-strip'],
      },
      {
        title: 'Open the ledger',
        text: 'The Economy window lists every monthly flow from the simulation: production, population consumption, taxes, trade, building and fleet upkeep, and treaties. Click a resource to see exactly where it comes from and where it goes.',
        goal: 'Open the Economy window',
        done: opened('economy'),
        target: [neo('Economy')],
        open: 'economy',
      },
      {
        title: 'Storage and shortages',
        text: (c) => {
          const L = getLedger(c.g, me(c.g));
          return `Each stockpile has a storage cap (yours: ${Math.round(L.cap.minerals)} for goods, ${Math.round(L.cap.credits)} credits, ${Math.round(L.cap.influence)} influence); income beyond it is lost, and storage depots raise it. A shortage is a stockpile at zero that is still falling: food shortages cause famine and shrinking populations, energy and consumer-goods shortages hurt stability, and factories without their input fall to a quarter of their output.`;
        },
        target: [guide('economy-storage'), win('Economy')],
      },
      {
        title: 'Production chains',
        text: 'Industry shows the chains live: mining feeds alloy foundries, foundries feed shipyards, electronics and components feed laboratories, megastructures and advanced ships. A world with jobs but no workers produces nothing; a world with workers but no jobs only pays a little tax.',
        goal: 'Open the Industry window',
        done: opened('industry'),
        target: [neo('Industry')],
        open: 'industry',
      },
      {
        title: 'Trade and the market',
        text: 'Every world generates trade value that must travel to the capital through your territory. Hostile ships cut a route; each lane without a starport or a recent patrol skims 2.5% (up to half). Trade agreements with other realms add 8% of collected trade each. On the Galactic market in the Economy window you can buy or sell goods for credits, with a broker fee; prices move as you trade.',
        goal: 'Buy or sell on the market (or skip)',
        done: (c) => c.has('act:market'),
        target: [guide('economy-market'), win('Economy')],
        open: 'economy',
      },
    ],
  },
  {
    id: 'expansion', n: 5, title: 'Settling New Planets', brief: 'Colony ships, more districts, and giving each planet a job.',
    unlock: (g, d) => d.includes('grow') && g.tick >= 270, unlockText: 'Nine months into your reign.', codex: ['mech.planetBuild', 'mech.outpost', 'mech.colonize', 'mech.designation', 'role.governor'],
    steps: [
      {
        title: 'Build on a world',
        text: 'Open Planets and select your capital. Districts (residential, agricultural, mining, generator) are limited by the planet\'s size and type; buildings need free building slots, which grow with population. Districts provide jobs and housing: workers fill jobs and produce, the unemployed only pay a little tax, and population grows only while there is housing and food.',
        goal: 'Queue a district or building on a colony',
        done: grew('buildings'),
        target: [guide('planet-build'), neo('Planets')],
        open: 'planets',
      },
      {
        title: 'Claim a neighbouring system',
        text: (c) => {
          const e = me(c.g);
          const near = c.g.galaxy.lanes.filter(([a, b]) => (c.g.galaxy.systems[a].owner === e.id) !== (c.g.galaxy.systems[b].owner === e.id)).map(([a, b]) => (c.g.galaxy.systems[a].owner === e.id ? b : a)).find((s) => c.g.galaxy.systems[s].owner == null);
          const cost = near != null ? claimCost(c.g, e, near) : null;
          return `Your construction ship can raise an outpost in an explored, unclaimed system: select the system and press "Send construction ship". It costs influence (about ${cost ?? 'a few dozen'} for a nearby system; more for distant ones) plus 40 alloys, takes 60 days, and the ship becomes the starbase. Claimed systems extend your territory, supply and trade network.`;
        },
        goal: 'Claim a second system (the outpost can still be building when you move on)',
        done: (c) => (c.now.systems ?? 0) > (c.base.systems ?? 0) || c.g.galaxy.systems.some((s) => s.outpostProject?.empireId === c.g.playerId),
        target: ['.right-col'],
      },
      {
        title: 'Found colonies',
        text: 'A colony ship (built at a shipyard) settles a habitable planet: select the planet and press "Send colony ship". Habitability depends on your people\'s climate and the planet type. Settling takes about five months; young colonies need crown support (food and credits) until they reach six pops. Each colony adds jobs, taxes, trade and new building slots.',
      },
      {
        title: 'Province roles',
        text: `In Planets → Province role you can give a colony a designation: Breadbasket, Mining, Power, Forge, Academy, Trade hub or Fortress world. Each boosts one output by 25–30% at a cost to everything else (Fortress strengthens defences instead). A change costs ${DESIGNATION_COST} influence and can be made once a year.`,
        target: [guide('planet-province'), win('Planets')],
      },
      {
        title: 'Governors',
        text: 'A governor administers a whole province (sector), raising output and stability on every colony there. Recruit one in the Hall of Heroes and post them to a province. Governors who want land are happier for it.',
        goal: 'Optional: assign a character to a post',
        done: (c) => grew('assigned')(c) || c.has('act:assignCharacter'),
        target: [neo('Hall of Heroes')],
        open: 'heroes',
      },
    ],
  },
  {
    id: 'capital', n: 3, title: 'Your Capital City', brief: 'The city on your home planet, and how its buildings help your whole realm.',
    unlock: (g, d) => d.includes('grow') && g.tick >= 180, unlockText: 'Half a year into your reign.', codex: ['mech.capital', 'cat.capital'],
    steps: [
      {
        title: 'Open the capital',
        text: 'Your capital world carries a city of great works around the Citadel. Open the Capital from the ministries column: the city fills the screen.',
        goal: 'Open the Capital window',
        done: opened('capital'),
        target: [neo('Capital')],
        open: 'capital',
      },
      {
        title: 'The Citadel and its plots',
        text: `The Citadel is the heart of the city. Each level opens more of the 24 city plots and allows grander buildings around it, up to level ${CITADEL_MAX}. Every other building needs a minimum Citadel level, and some need other buildings first. Raising the Citadel itself requires the rest of the city and the Throne hall to keep pace.`,
        target: [guide('capital-plots')],
      },
      {
        title: 'Raise a building',
        text: 'Choose a plot, then pick a building to raise, or select an existing building and extend it a level. The cost is shown before you commit and is paid when work begins. Each level takes a number of days; your builders work through the queue in order, and more builders come with Citadel levels.',
        goal: 'Queue a building or an upgrade in the capital',
        done: grew('capitalWork'),
        target: [guide('capital-build')],
        open: 'capital',
      },
      {
        title: 'The capital and the realm',
        text: 'Capital buildings grant realm-wide effects: taxes, research, influence, naval capacity, garrisons, roster places, intelligence and more ("What the city gives the realm" lists them). They are separate from the districts and buildings on each planet. If an enemy captures your capital world the city is sacked, so defend it.',
        target: [win('Capital')],
      },
    ],
  },
  {
    id: 'diplomacy', n: 8, title: 'Friends, Rivals and Your Court', brief: 'What other realms think of you, treaties, and the people at your own court.',
    unlock: (g, d) => d.includes('grow') && g.empires.some((x) => x.id !== g.playerId && x.kind === 'major' && x.alive && hasContact(g, g.playerId, x.id)), unlockText: 'When you meet another great realm.', codex: ['mech.diplomacy', 'mech.treaties', 'mech.war', 'mech.council', 'mech.decrees', 'mech.houses', 'mech.succession'],
    steps: [
      {
        title: 'Other realms',
        text: 'Open Diplomacy. Every realm you have met has an opinion of you, built from memories that fade with time: shared borders, government, treaties, gifts, insults and wars. Their reasons are listed in full. Envoys awaiting your answer appear at the top.',
        goal: 'Open Diplomacy',
        done: opened('diplomacy'),
        target: [neo('Diplomacy')],
        open: 'diplomacy',
      },
      {
        title: 'Treaties, deals and war',
        text: 'You can propose non-aggression pacts, trade and research agreements, defensive pacts, alliances and vassalage; exchange credits, resources or systems; and sign monthly resource contracts. The other side weighs each offer and tells you why it refuses. War can be declared on a realm you have no truce or pact with; peace offers range from status quo to tribute, vassalage or ceding systems, depending on war score.',
        goal: 'Optional: send a proposal',
        done: (c) => c.has('act:propose') || c.has('act:proposeContract'),
        target: [guide('diplomacy-treaties'), win('Diplomacy')],
      },
      {
        title: 'The royal council',
        text: 'Open the Council. Six seats (Chancellor of the Treasury, Grand Marshal, High Steward, Archscholar, Envoy-General, Spymaster) each turn a councillor\'s attributes into realm-wide bonuses. Policies, set per ministry in the Kingdom window, trade one benefit against another.',
        goal: 'Open the Council',
        done: opened('council'),
        target: [neo('Council')],
        open: 'council',
      },
      {
        title: 'Decrees and petitions',
        text: 'Decrees are temporary edicts paid in influence and resources: an extraordinary levy, a royal festival, conscription. Up to three can be in force, each with a cooldown. Petitions are matters brought before the council by houses and officials; each option has a real cost and effect, and ignoring one picks the default when it expires.',
        target: [guide('council-tabs'), win('Royal council')],
      },
      {
        title: 'Great Houses and succession',
        text: 'Noble houses hold land in your provinces. Each has power, loyalty and an ambition (a council seat, war, low taxes, land, wealth or order); an ignored ambition breeds grievance, and a disloyal, powerful house can revolt. You can grant, honour or suppress them. Your sovereign ages: name an heir in the Throne room (10 influence) or a death will bring a succession crisis.',
        goal: 'Optional: name an heir in the Throne room',
        done: (c) => (c.now.heir ?? 0) > 0,
        target: [guide('throne-succession'), neo('Throne room')],
        open: 'throne',
      },
    ],
  },
  {
    id: 'research', n: 7, title: 'Research and Eras', brief: 'Planning research, and the eras your civilisation moves through on the way to winning.',
    unlock: (g, d) => d.includes('grow') && g.tick >= 360, unlockText: 'After a year.', codex: ['mech.research', 'mech.eras', 'mech.kardashev'],
    steps: [
      {
        title: 'Choose a project',
        text: 'Open Research and pick a technology. Research points come from laboratories, the capital and your Archscholar, and flow into the current project every day. A realm without a project wastes them, so always keep one set.',
        goal: 'Set a research project',
        done: (c) => !!me(c.g).research.current,
        target: [guide('research-list'), neo('Research')],
        open: 'research',
      },
      {
        title: 'Queue what follows',
        text: 'Queue further projects so research continues when one completes. Technologies are grouped into nine fields (propulsion, weapons, defence, industry, energy, biology, artificial intelligence, colonisation and advanced engineering, plus Ascension) and tiers; each tier costs more, and many need prerequisites. The Tech tree shows the lines between them.',
        goal: 'Queue another technology, or open the Tech tree',
        done: (c) => (me(c.g).research.queue.length > 0) || opened('techtree')(c),
        target: [neo('Tech tree'), neo('Research')],
        open: 'techtree',
      },
      {
        title: 'Political eras',
        text: (c) => `Your civilisation advances through political eras: ${ERAS.slice(0, 4).map((x) => x.name).join(', ')} and beyond. Each era asks for real achievements (technologies, systems held, population, sometimes megastructures or a minimum energy rating), grants permanent bonuses and opens era-locked technologies. You are in the ${ERAS[me(c.g).era ?? 0].name}. The Kingdom window lists what the next era requires.`,
        goal: 'Open the Kingdom window',
        done: opened('kingdom'),
        target: [guide('kingdom-eras'), '.era-badge', neo('Kingdom')],
        open: 'kingdom',
      },
      {
        title: 'The Kardashev scale',
        text: (c) => `The Kardashev index is a separate, scientific measure: the power your civilisation actually uses, in watts, on Sagan\'s scale K = (log₁₀ W − 6) / 10. Type I harnesses a planet (10¹⁶ W), Type II a star, Type III a galaxy; Types IV and V are speculative. You stand at K ${kardashev(c.g, me(c.g)).toFixed(3)}. Generators, collectors and megastructures raise it; eras are political milestones that only sometimes ask for a minimum K.`,
        target: ['.era-badge'],
      },
    ],
  },
  {
    id: 'galaxy', n: 2, title: 'Map Controls and Words', brief: 'Moving the camera, entering a system, and what system, planet and province mean.',
    unlock: (_g, d) => d.includes('grow'), unlockText: 'After "Getting Bigger".', codex: ['mech.galaxy', 'mech.fog', 'mech.provinces'],
    steps: [
      {
        title: 'Move around the map',
        text: 'Drag with the left button to pan, scroll to zoom, and drag with the middle button (or hold Shift) to turn the view. Stars are star systems, joined by hyperlanes: fleets can only travel along lanes, one system to the next. Coloured regions are realms\' territory; yours is your crest colour.',
      },
      {
        title: 'Select a system',
        text: 'Click any star to select it. The Selected item panel on the right shows its star, owner, starbase and planets, and what you can do there. The Overview below it lists systems, fleets, realms and sectors sorted by distance.',
        goal: 'Select a star system',
        done: (c) => c.has('sel:system'),
        target: ['.right-col'],
      },
      {
        title: 'System, planet, province, capital',
        text: 'A system is a star and everything orbiting it; you claim whole systems with outposts. A planet is one world inside a system; inhabited planets are colonies with their own population, buildings and stability. Systems are grouped into named sectors, which serve as your provinces: a governor administers every colony in one. Your capital is the world that seats the crown: it hosts the Citadel and its city, and trade flows to it.',
      },
      {
        title: 'Enter a system',
        text: 'Double-click a system you have explored, or select it and press "Enter system", to see its planets in orbit. Click a planet to inspect it: type, size, deposits and habitability.',
        goal: 'Enter a system and select a planet',
        done: (c) => c.has('view:system') && c.has('sel:planet'),
        target: ['.right-col'],
      },
      {
        title: 'Fog of war and exploration',
        text: 'You only know the planets of systems you have explored, and you only see fleets within sensor range of your territory and ships. Your Survey Corps is a scout: select it (Overview → Fleets, or click it on the map), then right-click a neighbouring star to send it there. Each new system it reaches is charted.',
        goal: 'Explore a new system',
        done: grew('explored'),
        target: ['.overview'],
      },
    ],
  },
  {
    id: 'fleets', n: 6, title: 'Ships in Detail', brief: 'The kinds of warships, fleet orders, and how battles and landings are decided.',
    unlock: (g, d) => d.includes('conquest') || g.wars.some((w) => w.attackers.includes(g.playerId) || w.defenders.includes(g.playerId)), unlockText: 'After "Your First War", or when war comes.', codex: ['mech.ships', 'mech.combat', 'mech.invasion', 'mech.naval', 'cat.fleets'],
    steps: [
      {
        title: 'Ship classes',
        text: 'Warships come in hull sizes: corvettes and frigates are fast and evasive, destroyers and cruisers are the line, battleships, carriers and dreadnoughts hit hardest but need technology. Civilian hulls do the realm\'s work: scouts explore, construction ships raise outposts, colony ships settle, transports carry troops, logistics tenders extend supply. Each class prefers targets of certain sizes.',
      },
      {
        title: 'Build a warship',
        text: 'Ships are built at shipyards: open Planets, select a world with a shipyard and queue a hull, or use Industry. Cost is paid when work begins. Every warship uses naval capacity (right gauge on the dial); going over capacity raises fleet upkeep.',
        goal: 'Queue a ship',
        done: grew('ships'),
        target: [neo('Industry'), neo('Planets')],
        open: 'planets',
      },
      {
        title: 'Command fleets',
        text: 'Select a fleet and right-click a star to move it, or use the Selected item panel: Move, Patrol (protects trade lanes), Blockade, Stop. In Fleet management you can merge and split fleets, assign an admiral and set a stance: aggressive fleets fight on unless hopelessly outmatched, defensive fleets withdraw once clearly outgunned, and passive fleets try to slip away from any battle.',
        goal: 'Open Fleet management and change a fleet\'s stance or orders',
        done: (c) => c.has('act:setStance') || c.has('act:fleetOrder') || c.has('act:moveFleet') || c.has('act:mergeFleets') || c.has('act:splitFleet'),
        target: [guide('fleet-command'), neo('Fleets')],
        open: 'fleets',
      },
      {
        title: 'Space combat',
        text: 'Battles happen on their own when hostile fleets meet in a system: three rounds a day until one side is destroyed or retreats. Each ship picks targets by size; hit chance is its tracking against the target\'s evasion; shields absorb first, then armour reduces each hit; carriers\' strike craft are thinned by point defence. Composition, technology, admirals, supply and terrain decide the outcome, so a balanced fleet can beat a bigger one. Battle reports in Military replay every engagement.',
        target: [neo('Military')],
      },
      {
        title: 'Ground invasion',
        text: 'Capturing a world is separate from winning in space. First secure the orbit: no hostile warships, and the planet\'s defence batteries and the system\'s starbase knocked out by bombardment. Then transports land their troops: their strength (raised by a general, 30% weaker without supply, cut by 40% against a planetary shield, with some luck) is compared with the garrison. The transports are spent either way. A captured world starts with high resistance and low stability.',
      },
    ],
  },
  {
    id: 'characters', n: 9, title: 'Your People', brief: 'Hiring admirals, governors and spies, and giving them jobs.',
    unlock: (g, d) => d.includes('grow') && g.tick >= 360 * 2, unlockText: 'After two years.', codex: ['mech.characters', 'cat.characters', 'mech.espionage'],
    steps: [
      {
        title: 'The Hall of Heroes',
        text: (c) => `The notable people of your realm lead its fleets, govern its provinces, sit on its council, serve as envoys and run its spies. You have ${charactersOf(c.g, c.g.playerId).length} in service. Each has six attributes, traits, a loyalty and an ambition; meeting the ambition keeps them loyal.`,
        goal: 'Open the Hall of Heroes',
        done: opened('heroes'),
        target: [neo('Hall of Heroes')],
        open: 'heroes',
      },
      {
        title: 'Recruit and assign',
        text: 'Candidates wait to be recruited; each costs a salary and the roster has a limit (the capital\'s Hall of Heroes raises it). Post characters where their role counts: admirals to fleets (combat), generals to fleets with transports (invasions), governors to provinces, scientists and chancellors to the council, diplomats as envoys, industrialists to a world, explorers to survey fleets, spymasters to the council.',
        goal: 'Recruit a candidate or give someone a post',
        done: (c) => grew('characters')(c) || grew('assigned')(c) || c.has('act:recruitCharacter') || c.has('act:assignCharacter'),
        target: [guide('heroes-roster'), win('Hall of Heroes')],
      },
      {
        title: 'Skills and equipment',
        text: 'Characters gain experience in their post and earn skill points at each level, spent on their role\'s skill tree. Equipment (weapons, armour, relics and instruments), commissioned once you have a Military academy or found in ruins and derelicts, adds attributes and effects.',
      },
      {
        title: 'Espionage',
        text: 'A spymaster can run covert operations from the Intelligence window: gather intel (a two-year network that sharpens reports), steal technology, sabotage a factory or batteries, or incite unrest. Success pits your agent\'s cunning against the target\'s counter-intelligence. Discovered operations anger the victim, and a caught agent may be taken prisoner.',
        target: [guide('intel-covert'), neo('Intelligence')],
        open: 'intel',
      },
    ],
  },
  {
    id: 'megastructures', n: 10, title: 'Great Works', brief: 'Huge building projects that take generations and change the game.',
    unlock: (g, d) => d.includes('research') && (me(g).era ?? 0) >= 1 || MEGASTRUCTURES.some((m) => me(g).research.done.includes(m.tech)) || d.length >= 8, unlockText: 'Once you reach a new era or research a megastructure.', codex: ['mech.mega', 'cat.megastructures', 'mech.eras'],
    steps: [
      {
        title: 'Generational projects',
        text: `Megastructures are the largest works of a civilisation: ${MEGASTRUCTURES.slice(0, 4).map((m) => m.label).join(', ')} and more. Each needs its technology, some need a particular kind of star, and some can be built only once.`,
        goal: 'Open Construction',
        done: opened('construction'),
        target: [neo('Construction')],
        open: 'construction',
      },
      {
        title: 'Stages, instalments and benefits',
        text: 'A megastructure is built in stages. Each stage\'s cost is paid in daily instalments while it is under construction, over hundreds of days; on a day the treasury cannot pay, the work waits. Every completed stage adds its benefits at once (more output, research or energy), so a half-built structure already pays.',
        target: [guide('construction-mega'), win('Construction')],
      },
      {
        title: 'Starting one',
        text: 'Once researched, a megastructure shows a list of your eligible systems in Construction: pick one and press "Begin construction" (a system holds at most two). The structure appears in the system and grows with every stage; Systems shows its progress. Its energy feeds your Kardashev rating, and some eras require specific stages.',
        target: [guide('construction-mega'), neo('Construction')],
        open: 'construction',
      },
      {
        title: 'The long reign',
        text: 'From a house with one world to a civilisation that spans its galaxy: expand, keep your worlds stable, out-think your rivals, raise great works and keep the dynasty alive. The Chronicle records every year of your reign against your rivals. The Codex is always open to you, and hints will point out real problems as they arise.',
      },
    ],
  },
];

CHAPTERS.forEach((c, i) => { c.n = i + 1; });
export const CHAPTER_BY_ID: Record<string, Chapter> = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));
