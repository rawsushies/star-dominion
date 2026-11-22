// Smart hints: the royal advisor points out real, current situations (a shortage, idle research,
// an idle construction ship, unassigned characters, an undefended world at war, ...). Every hint
// is derived from the simulation state at the moment it is shown; nothing is invented. Hints are
// ranked, shown one at a time, and can be dismissed for half a year.

import type { GameState, ResId } from '../sim/types';
import { RESOURCES } from '../sim/types';
import type { ScreenId } from '../ui/store';
import { getLedger } from '../sim/engine';
import { adjacency } from '../sim/galaxy';
import { claimCost, hostileArmedPresence, isHostile } from '../sim/territory';
import { canBuild } from '../sim/construction';
import { canQueueCapital, openPlots, plotOccupant } from '../sim/capital';
import { CAPITAL_BUILDINGS } from '../sim/data/capital';
import { charactersOf } from '../sim/characters';
import { rulerAge } from '../sim/succession';
import { availableTechs } from '../sim/research';
import { guidanceOf } from './state';
import { planetHab } from '../sim/economy';
import { empireMods } from '../sim/modifiers';
import { intelLevel, hasContact, opinion } from '../sim/diplomacy';
import { bordering, hasTreaty } from '../sim/territory';
import { eraRequirements } from '../sim/eras';
import { ERAS, MAX_ERA } from '../sim/data/eras';
import { ambitionList, phaseOf, type Phase } from '../sim/ambitions';
import { SHIPS } from '../sim/data/ships';
import { currentStage } from '../sim/prologue';

export type HintSeverity = 'info' | 'warn' | 'danger';

export interface Hint {
  /** stable id (snoozing is per id) */
  id: string;
  severity: HintSeverity;
  title: string;
  text: string;
  /** what pressing the action does */
  action?: { label: string; screen?: ScreenId; systemId?: number; planetId?: number; fleetId?: number };
  /** higher is shown first */
  rank: number;
}

const LABEL: Record<ResId, string> = { credits: 'Credits', minerals: 'Minerals', energy: 'Energy', food: 'Food', alloys: 'Alloys', electronics: 'Electronics', components: 'Components', rare: 'Rare elements', influence: 'Influence' };
const SNOOZE_DAYS = 180;

/** Every hint whose condition holds right now (snoozed ones excluded), best first. */
export function currentHints(g: GameState): Hint[] {
  const e = g.empires[g.playerId];
  if (!e?.alive) return [];
  const out: Hint[] = [];
  const L = getLedger(g, e);
  const colonies = g.planets.filter((p) => p.colony?.ownerId === g.playerId);
  const atWar = g.wars.some((w) => w.attackers.includes(g.playerId) || w.defenders.includes(g.playerId));

  // research
  if (!e.research.current && !e.research.queue.length && availableTechs(e).length) {
    out.push({ id: 'research-idle', severity: 'warn', rank: 80, title: 'The scholars are idle', text: `${Math.round(L.net.research)} research points a month are being wasted. Choose a technology to study.`, action: { label: 'Open Research', screen: 'research' } });
  }

  // shortages and stockpiles running down
  for (const r of RESOURCES) {
    if (r === 'influence') continue;
    const net = L.net[r];
    const stock = e.stock[r];
    if (L.shortages.includes(r)) {
      const effect = r === 'food' ? 'Colonies are starving and populations will shrink.' : r === 'energy' ? 'Stability is falling across the realm.' : r === 'electronics' ? 'Consumer goods have run out; stability suffers.' : r === 'credits' ? 'The treasury is empty; upkeep and salaries go unpaid.' : `Factories that need ${LABEL[r].toLowerCase()} run at a quarter of their output.`;
      out.push({ id: `short-${r}`, severity: 'danger', rank: 100, title: `${LABEL[r]} have run out`, text: `${LABEL[r]}: ${net.toFixed(1)} a month with nothing in store. ${effect} Raise production, cut consumption or buy on the market.`, action: { label: 'Open Economy', screen: 'economy' } });
    } else if (net < -0.5 && stock / -net < 3) {
      out.push({ id: `low-${r}`, severity: 'warn', rank: 70, title: `${LABEL[r]} will run out in ${Math.max(1, Math.floor(stock / -net))} months`, text: `${LABEL[r]}: ${Math.round(stock)} in store, ${net.toFixed(1)} a month.`, action: { label: 'Open Economy', screen: 'economy' } });
    } else if (r !== 'credits' && net > 1 && stock >= L.cap[r] * 0.98) {
      out.push({ id: `full-${r}`, severity: 'info', rank: 30, title: `${LABEL[r]} storage is full`, text: `${Math.round(net)} ${LABEL[r].toLowerCase()} a month are lost above the ${Math.round(L.cap[r])} cap. Spend them, sell them on the market or build storage depots.`, action: { label: 'Open Economy', screen: 'economy' } });
    }
  }

  // war: hostile warships in a system where you hold a world
  if (atWar) {
    const threatened = colonies.find((p) => hostileArmedPresence(g, g.playerId, p.systemId));
    if (threatened) out.push({ id: `threat-${threatened.id}`, severity: 'danger', rank: 95, title: `${threatened.name} is under threat`, text: `Hostile warships are in orbit of ${threatened.name}. Its defences will be worn down and it can be invaded. Send a fleet.`, action: { label: 'Show the system', systemId: threatened.systemId } });
  }

  // naval capacity
  if (L.navalCap && L.navalUsed > L.navalCap) {
    out.push({ id: 'naval-over', severity: 'warn', rank: 60, title: 'Over naval capacity', text: `${L.navalUsed} of ${L.navalCap} capacity used: fleet upkeep is raised. Build shipyards and starbases, or disband old hulls.`, action: { label: 'Open Fleets', screen: 'fleets' } });
  }

  // restless worlds
  const restless = colonies.filter((p) => p.colony!.stability < 35).sort((a, b) => a.colony!.stability - b.colony!.stability)[0];
  if (restless) out.push({ id: `unrest-${restless.id}`, severity: restless.colony!.stability < 20 ? 'danger' : 'warn', rank: 75, title: `${restless.name} is restless`, text: `Stability ${Math.round(restless.colony!.stability)}. Output falls below 40, and a world that stays very unstable will revolt. See its stability factors.`, action: { label: 'Open the colony', screen: 'planets', planetId: restless.id } });

  // idle construction ship with somewhere to go
  const adj = adjacency(g.galaxy);
  for (const f of Object.values(g.fleets)) {
    if (f.ownerId !== g.playerId || f.order.type !== 'idle' || f.path.length || !f.ships.some((s) => s.cls === 'constructor')) continue;
    const owned = new Set(g.galaxy.systems.filter((s) => s.owner === g.playerId).map((s) => s.id));
    const target = [...owned].flatMap((s) => adj[s]).find((s) => g.galaxy.systems[s].owner == null && !g.galaxy.systems[s].outpostProject && e.explored.includes(s));
    if (target == null) break;
    const cost = claimCost(g, e, target);
    if (e.stock.influence >= cost && e.stock.alloys >= 40) {
      out.push({ id: `ctor-${f.id}`, severity: 'info', rank: 55, title: 'A construction ship is idle', text: `${f.name} could raise an outpost in ${g.galaxy.systems[target].name} for ${cost} influence and 40 alloys. Select the system and send it.`, action: { label: `Show ${g.galaxy.systems[target].name}`, systemId: target } });
    }
    break;
  }

  // idle scout with uncharted neighbours
  for (const f of Object.values(g.fleets)) {
    if (f.ownerId !== g.playerId || f.order.type !== 'idle' || f.path.length || !f.ships.length || !f.ships.every((s) => s.cls === 'scout')) continue;
    if (e.explored.some((s) => adj[s].some((n) => !e.explored.includes(n)))) {
      out.push({ id: `scout-${f.id}`, severity: 'info', rank: 45, title: 'A survey ship is idle', text: `${f.name} is waiting for orders while systems at your frontier are uncharted. Select it and right-click a star to explore.`, action: { label: `Select ${f.name}`, fleetId: f.id, systemId: f.systemId } });
    }
    break;
  }

  // idle planetary construction (only when it can actually build and afford something basic)
  if (e.stock.minerals >= 100) {
    const idle = colonies.find((p) => !p.colony!.auto && !p.colony!.queue.length && (['residential', 'agri', 'mining', 'power'] as const).some((b) => canBuild(g, e, p, b).ok));
    if (idle) out.push({ id: `idle-build-${idle.id}`, severity: 'info', rank: 40, title: `Nothing is being built on ${idle.name}`, text: `${idle.name} has free district space and ${Math.round(e.stock.minerals)} minerals are in store. New districts add jobs and housing. Or tick “Let the steward build here” and the world builds by itself.`, action: { label: 'Open the colony', screen: 'planets', planetId: idle.id } });
  }

  // capital builders idle
  if (e.capital && !e.capital.queue.length) {
    const plot = openPlots(e).find((p) => !plotOccupant(e.capital!, p));
    const can = CAPITAL_BUILDINGS.find((b) => canQueueCapital(g, e, b.id, (e.capital!.buildings[b.id]?.level ?? 0) > 0 ? undefined : plot) == null);
    if (can) out.push({ id: 'capital-idle', severity: 'info', rank: 35, title: 'The capital\'s builders are idle', text: `You can afford work in the capital now, for example ${can.label}.`, action: { label: 'Open the Capital', screen: 'capital' } });
  }

  // people
  const service = charactersOf(g, g.playerId);
  const idlePeople = service.filter((c) => !c.assignment);
  if (idlePeople.length) out.push({ id: 'chars-idle', severity: 'info', rank: 38, title: `${idlePeople.length === 1 ? idlePeople[0].name + ' has' : idlePeople.length + ' characters have'} no post`, text: 'Unassigned characters draw a salary but give no benefit. Give them a fleet, province, world, envoy post or council seat.', action: { label: 'Open Hall of Heroes', screen: 'heroes' } });
  const points = service.filter((c) => c.skillPoints > 0);
  if (points.length) out.push({ id: 'skill-points', severity: 'info', rank: 25, title: 'Skill points to spend', text: `${points.map((c) => c.name).slice(0, 3).join(', ')}${points.length > 3 ? ' and others' : ''} can learn new skills.`, action: { label: 'Open Hall of Heroes', screen: 'heroes' } });

  // court
  const petitions = e.petitions?.length ?? 0;
  if (petitions) out.push({ id: 'petitions', severity: 'info', rank: 50, title: `${petitions} ${petitions === 1 ? 'matter awaits' : 'matters await'} the council`, text: 'An unanswered petition takes its default answer after 90 days.', action: { label: 'Open Council', screen: 'council' } });
  const inbox = g.proposals.filter((p) => p.to === g.playerId).length;
  if (inbox) out.push({ id: 'proposals', severity: 'info', rank: 52, title: `${inbox} ${inbox === 1 ? 'envoy awaits' : 'envoys await'} your answer`, text: 'Another realm has made you an offer.', action: { label: 'Open Diplomacy', screen: 'diplomacy' } });
  if (e.heirId == null && rulerAge(g, e) >= 55) out.push({ id: 'heir', severity: 'warn', rank: 58, title: 'No heir is named', text: `${e.ruler} is ${rulerAge(g, e)}. Without a named heir, the sovereign's death brings a succession crisis.`, action: { label: 'Open Throne room', screen: 'throne' } });

  // enemy fleets next to an undefended colony during war
  if (atWar) {
    const exposed = colonies.find((p) => !hostileArmedPresence(g, g.playerId, p.systemId) && adj[p.systemId].some((n) => Object.values(g.fleets).some((f) => f.systemId === n && f.ships.length && isHostile(g, g.playerId, f.ownerId) && f.ships.some((s) => !['scout', 'constructor', 'colony', 'transport', 'logistics'].includes(s.cls)))) && !Object.values(g.fleets).some((f) => f.ownerId === g.playerId && f.systemId === p.systemId && f.ships.some((s) => !['scout', 'constructor', 'colony', 'transport', 'logistics'].includes(s.cls))));
    if (exposed) out.push({ id: `exposed-${exposed.id}`, severity: 'warn', rank: 85, title: `${exposed.name} is unprotected`, text: `Hostile warships are one jump from ${exposed.name}, and none of your warships guard it.`, action: { label: 'Open War room', screen: 'warroom' } });
  }

  out.push(...growthSteps(g));
  const sn = guidanceOf(g).snoozed;
  return out.filter((h) => (sn[h.id] ?? -1) <= g.tick).sort((a, b) => b.rank - a.rank);
}

export function snoozeHint(g: GameState, id: string, days = SNOOZE_DAYS) {
  guidanceOf(g).snoozed[id] = g.tick + days;
}

/** The current stage of the reign, in a sentence: what the player is trying to do now. */
export const PHASE_GOAL: Record<Phase, string> = {
  early: 'Make your realm bigger: build on your planet, explore nearby stars and claim the free ones.',
  mid: 'Get stronger than your neighbours: settle more planets, build a fleet, and make friends or take land.',
  late: 'Go for the win: own half of all claimed space, make every rival bow to you, or reach the last era. The Throne room shows how close everyone is.',
};
export function reignGoal(g: GameState): { phase: Phase; text: string } {
  const phase = phaseOf(g.empires[g.playerId]);
  const q = currentStage(g);
  if (q) return { phase, text: `Quest: ${q.title}. ${q.goal}` };
  return { phase, text: PHASE_GOAL[phase] };
}

/**
 * Proactive advice: the next useful step to grow the realm, derived from its real situation.
 * Ranked below problems, so a shortage or a threat always comes first.
 */
export function growthSteps(g: GameState): Hint[] {
  const e = g.empires[g.playerId];
  const out: Hint[] = [];
  const colonies = g.planets.filter((p) => p.colony?.ownerId === g.playerId);
  const yard = colonies.find((p) => (p.colony!.buildings.shipyard ?? 0) > 0) ?? null;
  const myFleets = Object.values(g.fleets).filter((f) => f.ownerId === g.playerId);
  const has = (cls: string) => myFleets.some((f) => f.ships.some((s) => s.cls === cls)) || colonies.some((p) => p.colony!.shipQueue.some((q) => q.id === cls));
  const owned = new Set(g.galaxy.systems.filter((s) => s.owner === g.playerId).map((s) => s.id));
  const adj = adjacency(g.galaxy);
  const m = empireMods(g, e);

  // a rival visibly arming against us comes first among these
  for (const r of g.empires) {
    if (r.alive && r.aiPlan?.goal === 'arm' && r.aiPlan.target === g.playerId && intelLevel(g, g.playerId, r.id) >= 30) {
      out.push({ id: `arming-${r.id}`, severity: 'danger', rank: 90, title: `${r.name} is preparing war on you`, text: 'Build warships and keep them at home, sign a defence pact with a neighbour, or offer them a non-aggression pact in Diplomacy.', action: { label: 'Open Diplomacy', screen: 'diplomacy' } });
    }
  }

  // settle a habitable world we can reach
  const target = g.planets
    .filter((p) => !p.colony && !p.colonizing && (owned.has(p.systemId) || (g.galaxy.systems[p.systemId].owner == null && adj[p.systemId].some((v) => owned.has(v)))) && e.explored.includes(p.systemId))
    .map((p) => ({ p, h: planetHab(g, p, e, m) }))
    .filter((x) => x.h >= 0.5)
    .sort((a, b) => b.h * b.p.size - a.h * a.p.size)[0];
  if (target && yard && !has('colony')) {
    out.push({ id: 'grow-colony', severity: 'info', rank: 48, title: `Settle ${target.p.name}`, text: `${target.p.name} is ${Math.round(target.h * 100)}% habitable for your people. Build a Colony Ship at ${yard.name}'s shipyard; when it is ready, select ${target.p.name} on the map and press Send colony ship.`, action: { label: `Open ${yard.name}`, screen: 'planets', planetId: yard.id } });
  }

  // claim more systems: a construction ship
  const freeNear = [...owned].flatMap((s) => adj[s]).some((s) => g.galaxy.systems[s].owner == null && !g.galaxy.systems[s].features.includes('guardian'));
  if (freeNear && yard && !has('constructor') && e.stats.systems < (e.stats.adminCap || 0) + 2) {
    out.push({ id: 'grow-ctor', severity: 'info', rank: 46, title: 'Claim more systems', text: `Unclaimed systems border your space. Build a Construction Ship at ${yard.name}'s shipyard; each outpost costs influence and 40 alloys and extends your borders, resources and supply.`, action: { label: `Open ${yard.name}`, screen: 'planets', planetId: yard.id } });
  }

  // explore: a scout
  const frontierUnknown = e.explored.some((s) => adj[s].some((n) => !e.explored.includes(n)));
  if (frontierUnknown && yard && !has('scout')) {
    out.push({ id: 'grow-scout', severity: 'info', rank: 36, title: 'Chart the unknown', text: 'Systems at your frontier are uncharted and you have no survey ship. Build a Scout: it reveals planets to settle and rivals to watch.', action: { label: `Open ${yard.name}`, screen: 'planets', planetId: yard.id } });
  }

  // defence: a neighbour much stronger than our fleets
  const strongest = g.empires.filter((r) => r.alive && r.kind === 'major' && r.id !== g.playerId && bordering(g, g.playerId, r.id)).sort((a, b) => b.stats.militaryPower - a.stats.militaryPower)[0];
  if (strongest && yard && (e.stats.militaryPower || 0) < strongest.stats.militaryPower * 0.5 && intelLevel(g, g.playerId, strongest.id) > 0) {
    const cls = (['destroyer', 'frigate', 'corvette'] as const).find((c) => !SHIPS[c].tech || e.research.done.includes(SHIPS[c].tech!)) ?? 'corvette';
    out.push({ id: 'grow-navy', severity: 'warn', rank: 44, title: 'Your fleet is weak beside your neighbours', text: `${strongest.name} fields more than twice your strength. Build warships (a ${SHIPS[cls].label} is a good start) before they notice.`, action: { label: `Open ${yard.name}`, screen: 'planets', planetId: yard.id } });
  }

  // friends: a neighbour who would sign
  const friend = g.empires.find((r) => r.alive && r.kind === 'major' && r.id !== g.playerId && hasContact(g, g.playerId, r.id) && !g.treaties.some((t) => (t.a === r.id && t.b === g.playerId) || (t.b === r.id && t.a === g.playerId)) && opinion(g, r.id, g.playerId) >= 0 && !hasTreaty(g, g.playerId, r.id, 'nap'));
  if (friend) out.push({ id: `grow-pact-${friend.id}`, severity: 'info', rank: 28, title: `Make a friend of ${friend.name}`, text: `${friend.name} thinks well enough of you to consider a treaty. A non-aggression pact protects a border; trade and research agreements pay every month.`, action: { label: 'Open Diplomacy', screen: 'diplomacy' } });

  // the next era: the first requirement still missing
  if ((e.era ?? 0) < MAX_ERA) {
    const next = ERAS[(e.era ?? 0) + 1];
    const miss = eraRequirements(g, e, next).find((q) => !q.done);
    if (miss) out.push({ id: `grow-era-${e.era}`, severity: 'info', rank: 22, title: `Toward the ${next.name}`, text: `Still needed: ${miss.label} (${miss.have} of ${miss.need}). Each era brings permanent bonuses.`, action: { label: 'Open Kingdom', screen: 'kingdom' } });
  }

  // the closest unfinished ambition of this stage
  const phase = phaseOf(e);
  const amb = ambitionList(g, e).filter((a) => !a.done && a.def.phase === phase).sort((a, b) => b.frac - a.frac)[0];
  if (amb) out.push({ id: `grow-amb-${amb.def.id}`, severity: 'info', rank: 20, title: `Ambition: ${amb.def.title}`, text: `${amb.def.how} Reward: ${amb.def.rewardText}.`, action: { label: 'Open Throne room', screen: 'throne' } });
  return out;
}
