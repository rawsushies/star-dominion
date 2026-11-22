// Diplomacy: directional opinions with decaying memories, treaties, a general
// deal system (credits, resources, systems, treaties), AI acceptance logic
// with itemised reasons, war declarations with alliances, and peace terms.

import { bordering, hasTreaty, ownedSystems, warBetween, visibleSystems, setSystemOwner } from './territory';
import { empireMods, mod } from './modifiers';
import { log, nextId } from './util';
import { releaseCaptive } from './characters';
import { BUILDINGS } from './data/buildings';
import type { DealItem, Empire, GameState, PeaceTerm, Proposal, TreatyType, War, BuildingId } from './types';
import { networkBonus } from './espionage';
import { hegemon } from './victory';

export const TREATY_LABEL: Record<TreatyType, string> = {
  nap: 'Non-Aggression Pact', trade: 'Trade Agreement', research: 'Research Cooperation',
  defense: 'Mutual Defence Pact', alliance: 'Alliance', vassal: 'Vassalage',
};
const TREATY_OPINION: Record<TreatyType, number> = { nap: 5, trade: 10, research: 10, defense: 15, alliance: 25, vassal: 10 };
const CLASH: [string, string][] = [['monarchy', 'republic'], ['junta', 'republic'], ['technocracy', 'feudal'], ['corporate', 'feudal'], ['junta', 'technocracy']];

const key = (a: number, b: number) => `${a}>${b}`;
/** years a non-aggression pact lasts before it must be renewed */
export const NAP_YEARS = 15;

export function addMemory(state: GameState, a: number, b: number, k: string, value: number, decayPerMonth: number, label: string) {
  const list = (state.opinions[key(a, b)] ??= []);
  const ex = list.find((m) => m.key === k);
  if (ex) { ex.value = Math.max(-100, Math.min(100, ex.value + value)); ex.decayPerMonth = decayPerMonth; }
  else list.push({ key: k, value, decayPerMonth, label });
}

export function opinionBreakdown(state: GameState, a: number, b: number): [string, number][] {
  const ea = state.empires[a];
  const eb = state.empires[b];
  const out: [string, number][] = [];
  if (!ea || !eb) return out;
  if (eb.kind === 'guardian' || eb.kind === 'raiders') return [['Hostile entity', -100]];
  out.push(['Disposition', Math.round(ea.personality.diplomacy * 20 - 8)]);
  if (ea.government === eb.government) out.push(['Kindred government', 15]);
  else if (CLASH.some(([x, y]) => (x === ea.government && y === eb.government) || (y === ea.government && x === eb.government))) out.push(['Ideological rivalry', -10]);
  const border = bordering(state, a, b);
  if (border) out.push(['Border friction', -Math.min(20, Math.round(border * 4 * (0.5 + ea.personality.expansion)))]);
  for (const t of state.treaties) {
    if ((t.a === a && t.b === b) || (t.a === b && t.b === a)) out.push([TREATY_LABEL[t.type], TREATY_OPINION[t.type]]);
  }
  if (warBetween(state, a, b)) out.push(['At war', -50]);
  const stance = mod(empireMods(state, eb), 'diploOpinion');
  if (stance) out.push(['Their diplomatic posture', stance]);
  const pa = ea.stats.militaryPower || 1;
  const pb = eb.stats.militaryPower || 1;
  if (border && pb > pa * 1.8) out.push(['Fears their military', -10]);
  // a realm racing towards victory frightens everyone else
  if (ea.kind === 'major') {
    const lead = hegemon(state);
    if (lead && lead.id === b) out.push(['Fears their ambition', -Math.round(10 + lead.fear * 25)]);
  }
  for (const m of state.opinions[key(a, b)] ?? []) out.push([m.label, Math.round(m.value)]);
  return out;
}

export function opinion(state: GameState, a: number, b: number): number {
  return Math.max(-100, Math.min(100, opinionBreakdown(state, a, b).reduce((s, [, v]) => s + v, 0)));
}

export function hasContact(state: GameState, viewer: number, target: number): boolean {
  if (viewer === target) return true;
  const v = state.empires[viewer];
  const t = state.empires[target];
  if (!t?.alive || !v) return false;
  if (state.treaties.some((x) => (x.a === viewer && x.b === target) || (x.b === viewer && x.a === target))) return true;
  if (warBetween(state, viewer, target)) return true;
  const explored = new Set(v.explored);
  for (const s of state.galaxy.systems) if (s.owner === target && explored.has(s.id)) return true;
  const vis = visibleSystems(state, viewer);
  for (const id in state.fleets) if (state.fleets[id].ownerId === target && vis.has(state.fleets[id].systemId)) return true;
  return false;
}

/** 0..100 knowledge of a rival: drives how precisely the UI shows their data. */
export function intelLevel(state: GameState, viewer: number, target: number): number {
  if (viewer === target) return 100;
  // a planted spy network is contact enough
  if (!hasContact(state, viewer, target) && !networkBonus(state, viewer, target)) return 0;
  let v = 20;
  if (bordering(state, viewer, target)) v += 20;
  for (const t of state.treaties) {
    if (!((t.a === viewer && t.b === target) || (t.b === viewer && t.a === target))) continue;
    v += t.type === 'alliance' || t.type === 'vassal' ? 40 : t.type === 'research' ? 20 : 10;
  }
  if (warBetween(state, viewer, target)) v += 10;
  v += mod(empireMods(state, state.empires[viewer]), 'intel');
  v += networkBonus(state, viewer, target);
  return Math.max(5, Math.min(100, v));
}

/** Approximate a value given limited intel (deterministic fuzz per pair). */
export function fuzz(value: number, intel: number, seed: number): { value: number; range: number } {
  if (intel >= 80) return { value, range: 0 };
  const err = ((1 - intel / 100) * 0.6);
  const h = Math.sin(seed * 12.9898) * 43758.5453;
  const bias = (h - Math.floor(h) - 0.5) * err;
  return { value: Math.round(value * (1 + bias)), range: Math.round(value * err) };
}

// ---------- deals ----------

export function systemValue(state: GameState, systemId: number): number {
  const sys = state.galaxy.systems[systemId];
  let v = 30 + sys.asteroidBelts * 10 + sys.starbase * 25;
  for (const pid of sys.planetIds) {
    const p = state.planets[pid];
    v += p.deposits.minerals * 3 + p.deposits.energy * 3 + p.deposits.rare * 12;
    if (p.colony) {
      v += p.colony.pops * 25;
      for (const b in p.colony.buildings) v += (BUILDINGS[b as BuildingId].cost.minerals ?? 50) * 0.5 * (p.colony.buildings[b as BuildingId] ?? 0);
    }
  }
  if (sys.features.includes('jump_nexus')) v += 60;
  if (sys.features.includes('rare_cluster')) v += 40;
  return v;
}

const PRICE_FALLBACK: Record<string, number> = { credits: 1, minerals: 1, energy: 1, food: 1, alloys: 4, electronics: 5, components: 10, rare: 8, influence: 6 };

function itemValue(state: GameState, it: DealItem, receiver: number, giver: number): number {
  switch (it.kind) {
    case 'credits': return it.amount;
    case 'resource': return it.amount * (state.market.price[it.res] ?? PRICE_FALLBACK[it.res]);
    case 'system': {
      const v = systemValue(state, it.systemId);
      const hasColony = state.galaxy.systems[it.systemId].planetIds.some((p) => state.planets[p].colony?.ownerId === giver);
      return receiver === giver ? 0 : v * (hasColony ? 3 : 1.3);
    }
    case 'treaty': return 0; // treaties are evaluated separately
  }
}

export interface Evaluation { accept: boolean; score: number; reasons: [string, number][] }

export function evaluateProposal(state: GameState, p: Proposal): Evaluation {
  const ai = state.empires[p.to];
  const from = state.empires[p.from];
  const reasons: [string, number][] = [];
  const op = opinion(state, p.to, p.from);
  reasons.push(['Opinion of you', Math.round(op * 0.6)]);
  const acc = mod(empireMods(state, from), 'acceptance');
  if (acc) reasons.push(['Diplomatic outreach', acc]);

  if (p.kind === 'peace') return evaluatePeace(state, p, reasons);

  // Material balance from the AI's point of view: what it receives minus what it gives.
  let gain = 0;
  for (const it of p.give) gain += itemValue(state, it, p.to, p.from);
  let loss = 0;
  for (const it of p.receive) {
    if (it.kind === 'system') loss += itemValue(state, it, p.from, p.to) * 1.5 + 40;
    else loss += itemValue(state, it, p.from, p.to) * 1.1;
  }
  const econ = Math.max(200, (ai.stats.economyScore || 200));
  const balance = ((gain - loss) / econ) * 60;
  if (gain || loss) reasons.push(['Value of the exchange', Math.round(balance)]);

  const treaties = [...p.give, ...p.receive].filter((x): x is Extract<DealItem, { kind: 'treaty' }> => x.kind === 'treaty');
  for (const t of treaties) {
    const [label, v] = treatyAppetite(state, p.to, p.from, t.treaty, p.give.includes(t));
    reasons.push([label, v]);
  }
  if (!treaties.length && !p.give.length && p.receive.length) reasons.push(['Demand without compensation', -20]);
  // Fear: weak AIs bow to strong, threatening neighbours.
  const pa = ai.stats.militaryPower || 1;
  const pf = from.stats.militaryPower || 1;
  const demands = p.receive.length > 0 && p.give.length === 0;
  if (demands && pf > pa * 2 && bordering(state, p.to, p.from)) reasons.push(['Intimidated by your fleets', Math.min(40, Math.round((pf / pa) * 8))]);
  const score = reasons.reduce((s, [, v]) => s + v, 0);
  return { accept: score >= 0, score, reasons };
}

function treatyAppetite(state: GameState, ai: number, other: number, t: TreatyType, offeredByOther: boolean): [string, number] {
  const e = state.empires[ai];
  const o = state.empires[other];
  const pers = e.personality;
  const op = opinion(state, ai, other);
  const powerRatio = (o.stats.militaryPower || 1) / (e.stats.militaryPower || 1);
  if (hasTreaty(state, ai, other, t)) return ['Treaty already in force', -1000];
  if (warBetween(state, ai, other)) return ['We are at war', -1000];
  // a realm preparing war on the proposer will not tie its own hands
  if (e.aiPlan && (e.aiPlan.goal === 'arm' || e.aiPlan.goal === 'war') && e.aiPlan.target === other && (t === 'nap' || t === 'defense' || t === 'alliance')) return ['We have other plans for you', -1000];
  switch (t) {
    case 'nap': return ['Non-aggression appetite', Math.round(-5 + pers.diplomacy * 15 - pers.aggression * 20 + (powerRatio > 1.2 ? 15 : 0))];
    case 'trade': return ['Commercial interest', Math.round(-10 + pers.mercantile * 30 + (op > 0 ? 5 : -10))];
    case 'research': return ['Scientific interest', Math.round(-20 + pers.science * 30 + (op > 20 ? 5 : -10))];
    case 'defense': {
      const lead = hegemon(state);
      const common = (lead != null && lead.id !== ai && lead.id !== other && lead.fear > 0.3) || state.empires.some((x) => x.alive && x.kind === 'major' && x.id !== ai && x.id !== other && opinion(state, ai, x.id) < -20 && opinion(state, other, x.id) < -10);
      return ['Shared security concerns', Math.round(-30 + pers.diplomacy * 20 + (common ? 25 : 0) + (op > 40 ? 10 : 0))];
    }
    case 'alliance': return ['Alliance requires deep trust', Math.round(-60 + pers.diplomacy * 25 + (op > 60 ? 30 : 0))];
    case 'vassal': {
      // `offeredByOther`: the proposer offers vassalage (they become overlord if listed in their receive list)
      void offeredByOther;
      return ['Submission to your rule', Math.round(-80 + (powerRatio > 3 ? 40 : 0) + (powerRatio > 5 ? 30 : 0) + (op > 30 ? 15 : 0))];
    }
  }
}

function evaluatePeace(state: GameState, p: Proposal, reasons: [string, number][]): Evaluation {
  const war = state.wars.find((w) => w.id === p.warId);
  if (!war) return { accept: false, score: -999, reasons: [['No such war', -999]] };
  const ai = state.empires[p.to];
  const aiAttacker = war.attackers.includes(p.to);
  const myScore = aiAttacker ? war.score : -war.score; // positive = AI winning
  reasons.length = 0;
  reasons.push(['War score (theirs)', Math.round(-myScore)]);
  reasons.push(['War exhaustion', Math.round(ai.warExhaustion * 0.6)]);
  const years = (state.tick - war.startTick) / 360;
  if (years > 3) reasons.push(['Long war', Math.round(Math.min(25, (years - 3) * 5))]);
  const term = p.peaceTerm ?? 'status_quo';
  const termCost: Record<PeaceTerm, number> = { status_quo: 10, tribute: 35, cede: 45, vassalize: 80 };
  reasons.push([`Terms: ${PEACE_LABEL[term]}`, -termCost[term]]);
  reasons.push(['Aggression', -Math.round(ai.personality.aggression * 15)]);
  const score = reasons.reduce((s, [, v]) => s + v, 0);
  return { accept: score >= 0, score, reasons };
}

/** AI evaluation of a recurring monthly resource contract. */
export function evaluateContract(state: GameState, from: number, to: number, fromGives: Partial<Record<string, number>>, toGives: Partial<Record<string, number>>, aiNet: Record<string, number>): Evaluation {
  const ai = state.empires[to];
  const reasons: [string, number][] = [];
  reasons.push(['Opinion of you', Math.round(opinion(state, to, from) * 0.4)]);
  const price = (k: string) => state.market.price[k as keyof typeof state.market.price] ?? PRICE_FALLBACK[k] ?? 1;
  let gain = 0, loss = 0;
  for (const k in fromGives) gain += (fromGives[k] ?? 0) * price(k);
  for (const k in toGives) loss += (toGives[k] ?? 0) * price(k);
  if (gain + loss > 0) reasons.push(['Value of the exchange', Math.round(((gain - loss * 1.1) / (gain + loss)) * 50)]);
  reasons.push(['Mercantile outlook', Math.round(ai.personality.mercantile * 12 - 4)]);
  for (const k in toGives) {
    if ((aiNet[k] ?? 0) < (toGives[k] ?? 0)) { reasons.push([`Cannot spare ${k}`, -100]); break; }
  }
  if (warBetween(state, from, to)) reasons.push(['We are at war', -1000]);
  const score = reasons.reduce((a, [, v]) => a + v, 0);
  return { accept: score >= 0, score, reasons };
}

export const PEACE_LABEL: Record<PeaceTerm, string> = {
  status_quo: 'Status quo', tribute: 'Pay tribute', cede: 'Cede border systems', vassalize: 'Become vassal',
};

export function signTreaty(state: GameState, a: number, b: number, type: TreatyType) {
  if (hasTreaty(state, a, b, type)) return;
  state.treaties.push({ type, a, b, since: state.tick });
  const ea = state.empires[a];
  const eb = state.empires[b];
  log(state, {
    kind: 'treaty', severity: 'good', title: `${TREATY_LABEL[type]} signed`,
    text: type === 'vassal' ? `${eb.name} has sworn fealty to ${ea.name}.` : `${ea.name} and ${eb.name} have signed a ${TREATY_LABEL[type]}.`,
    empires: [],
  });
}

export function breakTreaty(state: GameState, a: number, b: number, type: TreatyType, silent = false) {
  const i = state.treaties.findIndex((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
  if (i < 0) return;
  state.treaties.splice(i, 1);
  if (silent) return;
  const grave = type === 'nap' || type === 'alliance' || type === 'defense';
  addMemory(state, b, a, 'broke_treaty', grave ? -40 : -15, 0.5, 'Broke a treaty with us');
  if (grave) {
    for (const x of state.empires) {
      if (x.id !== a && x.id !== b && x.alive && x.kind === 'major') addMemory(state, x.id, a, 'untrustworthy', -12, 0.3, 'Untrustworthy');
    }
  }
  log(state, { kind: 'treaty', severity: 'warn', title: `${TREATY_LABEL[type]} dissolved`, text: `${state.empires[a].name} ended the ${TREATY_LABEL[type]} with ${state.empires[b].name}.`, empires: [] });
}

export function applyDeal(state: GameState, p: Proposal) {
  const from = state.empires[p.from];
  const to = state.empires[p.to];
  const transfer = (giver: Empire, receiver: Empire, it: DealItem) => {
    if (it.kind === 'credits') { const amt = Math.min(giver.stock.credits, it.amount); giver.stock.credits -= amt; receiver.stock.credits += amt; }
    else if (it.kind === 'resource') { const amt = Math.min(giver.stock[it.res], it.amount); giver.stock[it.res] -= amt; receiver.stock[it.res] += amt; }
    else if (it.kind === 'system') transferSystem(state, it.systemId, giver.id, receiver.id);
  };
  for (const it of p.give) transfer(from, to, it);
  for (const it of p.receive) transfer(to, from, it);
  const treaties = [...p.give, ...p.receive].filter((x): x is Extract<DealItem, { kind: 'treaty' }> => x.kind === 'treaty');
  for (const t of treaties) {
    if (t.treaty === 'vassal') {
      // whoever "receives" the vassal treaty item becomes the overlord
      const overlord = p.receive.includes(t) ? p.from : p.to;
      const vassal = overlord === p.from ? p.to : p.from;
      signTreaty(state, overlord, vassal, 'vassal');
    } else signTreaty(state, p.from, p.to, t.treaty);
  }
  const gifts = p.give.filter((x) => x.kind !== 'treaty').length && !p.receive.length;
  if (gifts) addMemory(state, p.to, p.from, 'gift', 15, 1, 'Generous gifts');
  if (p.give.length || p.receive.length) addMemory(state, p.to, p.from, 'deal', 5, 0.5, 'Honest dealings');
}

export function transferSystem(state: GameState, systemId: number, from: number, to: number) {
  const sys = state.galaxy.systems[systemId];
  if (sys.owner !== from) return;
  setSystemOwner(state, systemId, to);
  if (sys.starbase === 0) sys.starbase = 1;
  for (const pid of sys.planetIds) {
    const c = state.planets[pid].colony;
    if (c && c.ownerId === from) {
      if (state.empires[from].capitalPlanetId === pid) continue; // capitals cannot be traded
      c.ownerId = to;
      c.originalOwnerId = from;
      c.resistance = 30;
      c.queue = [];
      c.shipQueue = [];
    }
  }
  for (const m of sys.megastructures) m.ownerId = to;
}

// ---------- war & peace ----------

export function canDeclareWar(state: GameState, a: number, b: number): { ok: boolean; reason?: string } {
  if (a === b) return { ok: false, reason: 'Cannot declare war on yourself' };
  const eb = state.empires[b];
  if (!eb?.alive) return { ok: false, reason: 'Empire no longer exists' };
  if (warBetween(state, a, b)) return { ok: false, reason: 'Already at war' };
  if (hasTreaty(state, a, b, 'vassal')) return { ok: false, reason: 'Bound by vassalage' };
  const truce = state.truces.find((t) => ((t.a === a && t.b === b) || (t.a === b && t.b === a)) && t.until > state.tick);
  if (truce) return { ok: false, reason: `Truce in effect for ${Math.ceil((truce.until - state.tick) / 30)} more months` };
  if (state.empires[a].stock.influence < 40) return { ok: false, reason: 'Requires 40 influence' };
  return { ok: true };
}

export function declareWar(state: GameState, a: number, b: number): War | null {
  if (!canDeclareWar(state, a, b).ok) return null;
  const ea = state.empires[a];
  const eb = state.empires[b];
  ea.stock.influence -= 40;
  for (const t of ['nap', 'trade', 'research', 'defense', 'alliance'] as TreatyType[]) if (hasTreaty(state, a, b, t)) breakTreaty(state, a, b, t);
  state.tradeDeals = state.tradeDeals.filter((d) => !((d.a === a && d.b === b) || (d.a === b && d.b === a)));
  addMemory(state, b, a, 'declared_war', -60, 1, 'Declared war on us');
  for (const x of state.empires) if (x.alive && x.kind === 'major' && x.id !== a && x.id !== b && bordering(state, x.id, a)) addMemory(state, x.id, a, 'warmonger', -8, 0.5, 'Warmonger');
  const war: War = { id: nextId(state), attackers: [a], defenders: [b], startTick: state.tick, score: 0, name: `${ea.adjective}–${eb.adjective} War` };
  // Defensive pacts / alliances / vassals of the defender join
  const joinDef = state.treaties.filter((t) => ((t.type === 'defense' || t.type === 'alliance') && (t.a === b || t.b === b)) || (t.type === 'vassal' && (t.a === b || t.b === b)));
  for (const t of joinDef) {
    const ally = t.a === b ? t.b : t.a;
    if (ally === a || war.defenders.includes(ally) || !state.empires[ally].alive) continue;
    if (hasTreaty(state, ally, a, 'alliance') || hasTreaty(state, ally, a, 'vassal')) continue;
    war.defenders.push(ally);
    for (const tt of ['nap', 'trade', 'research', 'defense'] as TreatyType[]) if (hasTreaty(state, ally, a, tt)) breakTreaty(state, ally, a, tt, true);
    addMemory(state, b, ally, 'honored_pact', 20, 0.5, 'Honoured our pact');
  }
  // Attacker's alliance partners and vassals join if they bear the target no love
  for (const t of state.treaties) {
    if (!((t.type === 'alliance' || t.type === 'vassal') && (t.a === a || t.b === a))) continue;
    const ally = t.a === a ? t.b : t.a;
    if (war.defenders.includes(ally) || war.attackers.includes(ally) || !state.empires[ally].alive) continue;
    if (t.type === 'vassal' || opinion(state, ally, b) < 10) {
      war.attackers.push(ally);
      for (const tt of ['nap', 'trade', 'research', 'defense'] as TreatyType[]) if (hasTreaty(state, ally, b, tt)) breakTreaty(state, ally, b, tt, true);
    }
  }
  state.wars.push(war);
  const names = (ids: number[]) => ids.map((i) => state.empires[i].name).join(', ');
  log(state, {
    kind: 'war', severity: 'danger', title: `${ea.name} declares war on ${eb.name}`,
    text: `Attackers: ${names(war.attackers)}. Defenders: ${names(war.defenders)}.`, empires: [],
  });
  return war;
}

export function makePeace(state: GameState, war: War, term: PeaceTerm, winnerSide: 'attackers' | 'defenders') {
  const winners = winnerSide === 'attackers' ? war.attackers : war.defenders;
  const losers = winnerSide === 'attackers' ? war.defenders : war.attackers;
  const wl = winners[0];
  const ll = losers[0];
  if (term !== 'status_quo' && state.empires[wl]) state.empires[wl].warsWon = (state.empires[wl].warsWon ?? 0) + 1;
  if (term === 'tribute') {
    const loser = state.empires[ll];
    state.tributes.push({ from: ll, to: wl, perMonth: Math.round(8 + (loser.stats.population || 10) * 0.25), until: state.tick + 360 * 8 });
  } else if (term === 'vassalize') {
    for (const t of ['alliance', 'defense'] as TreatyType[]) for (const x of state.empires) if (hasTreaty(state, ll, x.id, t)) breakTreaty(state, ll, x.id, t, true);
    signTreaty(state, wl, ll, 'vassal');
  } else if (term === 'cede') {
    // Loser cedes border systems the victor's forces occupy or that adjoin the victor (max 3, no capital).
    const victorSystems = new Set(ownedSystems(state, wl));
    const candidates = ownedSystems(state, ll).filter((sid) => {
      const sys = state.galaxy.systems[sid];
      if (sys.planetIds.some((p) => state.empires[ll].capitalPlanetId === p)) return false;
      const occupied = Object.values(state.fleets).some((f) => f.ownerId === wl && f.systemId === sid);
      const adjacent = state.galaxy.lanes.some(([x, y]) => (x === sid && victorSystems.has(y)) || (y === sid && victorSystems.has(x)));
      return occupied || adjacent;
    });
    candidates.sort((x, y) => systemValue(state, y) - systemValue(state, x));
    for (const sid of candidates.slice(0, 3)) transferSystem(state, sid, ll, wl);
  }
  // prisoners of war go home under the treaty
  const sides = new Set([...war.attackers, ...war.defenders]);
  let exchanged = 0;
  for (const c of state.characters) {
    if (c.status !== 'captive' || c.captorId == null || !sides.has(c.captorId) || !sides.has(c.ownerId)) continue;
    const captorAttacker = war.attackers.includes(c.captorId);
    if (captorAttacker === war.attackers.includes(c.ownerId)) continue;
    releaseCaptive(state, c, `Returned home in the prisoner exchange that ended the ${war.name}.`);
    exchanged++;
  }
  state.wars = state.wars.filter((w) => w !== war);
  for (const a of war.attackers) for (const d of war.defenders) state.truces.push({ a, b: d, until: state.tick + 360 * 5 });
  for (const id of [...war.attackers, ...war.defenders]) state.empires[id].warExhaustion *= 0.5;
  log(state, {
    kind: 'peace', severity: 'good', title: `Peace: ${war.name}`,
    text: `Terms — ${PEACE_LABEL[term]}${term !== 'status_quo' ? ` (${state.empires[ll].name} to ${state.empires[wl].name})` : ''}. A five-year truce begins.${exchanged ? ` ${exchanged} prisoner${exchanged > 1 ? 's were' : ' was'} exchanged.` : ''}`,
    empires: [],
  });
}

export function monthlyDiplomacy(state: GameState) {
  for (const k in state.opinions) {
    const list = state.opinions[k];
    for (const m of list) {
      if (m.value > 0) m.value = Math.max(0, m.value - m.decayPerMonth);
      else m.value = Math.min(0, m.value + m.decayPerMonth);
    }
    state.opinions[k] = list.filter((m) => Math.abs(m.value) >= 0.5);
  }
  state.truces = state.truces.filter((t) => t.until > state.tick);
  // non-aggression pacts lapse after fifteen years unless renewed
  for (const t of state.treaties.filter((x) => x.type === 'nap' && state.tick - x.since >= NAP_YEARS * 360)) {
    state.treaties = state.treaties.filter((x) => x !== t);
    log(state, { kind: 'treaty', severity: 'info', title: 'Non-Aggression Pact lapsed', text: `The pact between ${state.empires[t.a].name} and ${state.empires[t.b].name} has run its course of ${NAP_YEARS} years. It can be renewed.`, empires: [t.a, t.b] });
  }
  state.tributes = state.tributes.filter((t) => t.until > state.tick && state.empires[t.from].alive && state.empires[t.to].alive);
  state.tradeDeals = state.tradeDeals.filter((d) => d.until > state.tick);
  state.proposals = state.proposals.filter((p) => state.tick - p.tick < 90);
  // war exhaustion
  for (const e of state.empires) {
    if (!e.alive || (e.kind !== 'major' && e.kind !== 'minor')) continue;
    const atWar = state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id));
    const m = empireMods(state, e);
    if (atWar) e.warExhaustion = Math.min(100, e.warExhaustion + 0.8 * (1 + mod(m, 'warExhaustion')));
    else e.warExhaustion = Math.max(0, e.warExhaustion - 3);
  }
  // Occupation: each enemy colony system held by a side's warships with no defending fleet there
  // moves the war score by one point a month (up to three per side per month).
  for (const w of state.wars) {
    let net = 0;
    for (const side of ['attackers', 'defenders'] as const) {
      const us = new Set(side === 'attackers' ? w.attackers : w.defenders);
      const them = new Set(side === 'attackers' ? w.defenders : w.attackers);
      let held = 0;
      for (const s of state.galaxy.systems) {
        if (s.owner == null || !them.has(s.owner) || !s.planetIds.some((pid) => state.planets[pid].colony && them.has(state.planets[pid].colony!.ownerId))) continue;
        let ours = false, theirs = false;
        for (const id in state.fleets) {
          const f = state.fleets[id];
          if (f.systemId !== s.id || !f.ships.some((x) => x.cls !== 'transport' && x.cls !== 'scout' && x.cls !== 'constructor' && x.cls !== 'colony')) continue;
          if (us.has(f.ownerId)) ours = true; else if (them.has(f.ownerId)) theirs = true;
        }
        if (ours && !theirs) held++;
      }
      net += (side === 'attackers' ? 1 : -1) * Math.min(3, held);
    }
    w.score = Math.max(-100, Math.min(100, w.score + net));
  }
  // Exhausted belligerents are forced to the table.
  for (const w of [...state.wars]) {
    const ea = state.empires[w.attackers[0]];
    const ed = state.empires[w.defenders[0]];
    if (!ea?.alive || !ed?.alive) { state.wars = state.wars.filter((x) => x !== w); continue; }
    if (ea.warExhaustion >= 100 || ed.warExhaustion >= 100) {
      const side = ea.warExhaustion >= 100 && ed.warExhaustion < 100 ? 'defenders' : ed.warExhaustion >= 100 && ea.warExhaustion < 100 ? 'attackers' : null;
      makePeace(state, w, side ? 'status_quo' : 'status_quo', side ?? 'attackers');
    }
  }
  // Wars with no remaining principal on one side end
  state.wars = state.wars.filter((w) => w.attackers.some((a) => state.empires[a].alive) && w.defenders.some((d) => state.empires[d].alive));
}
