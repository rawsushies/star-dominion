// Shared by scripts/audit.ts and tests/fuzz.test.ts: a random player-command generator that draws
// ids from the live state (and sometimes out-of-range ids), and a set of state invariants.
import { getLedger } from '../../src/sim/engine';
import type { Command } from '../../src/sim/commands';
import { RESOURCES, type GameState, type FleetOrder } from '../../src/sim/types';
import { BUILDINGS } from '../../src/sim/data/buildings';
import { SHIP_ORDER } from '../../src/sim/data/ships';
import { TECHS } from '../../src/sim/data/techs';
import { DECREES } from '../../src/sim/data/governance';
import { CAPITAL_BUILDINGS } from '../../src/sim/data/capital';
import { MEGASTRUCTURES } from '../../src/sim/data/megastructures';
import { POLICIES, GOVERNMENTS } from '../../src/sim/data/governments';
import { ITEMS, SKILLS } from '../../src/sim/data/characters';
import { DESIGNATION_IDS } from '../../src/sim/data/designations';
import { COUNCIL_SEATS } from '../../src/sim/data/council';

let r = 12345;
export function seedFuzz(n: number) { r = n; }
const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pickA = <T,>(a: T[]): T | undefined => (a.length ? a[Math.floor(rnd() * a.length)] : undefined);
const any = (n: number) => (rnd() < 0.1 ? Math.floor(rnd() * 3) - 2 : Math.floor(rnd() * n)); // sometimes out of range

export const problems = new Map<string, { count: number; first: string }>();
export function report(key: string, detail: string) {
  const p = problems.get(key);
  if (p) p.count++; else problems.set(key, { count: 1, first: detail });
}

export function randomCommand(g: GameState): Command {
  const me = g.empires[g.playerId];
  const myPlanets = g.planets.filter((p) => p.colony?.ownerId === me.id).map((p) => p.id);
  const planets = rnd() < 0.8 && myPlanets.length ? myPlanets : g.planets.map((p) => p.id);
  const pid = () => pickA(planets) ?? any(g.planets.length);
  const myFleets = Object.values(g.fleets).filter((f) => f.ownerId === me.id).map((f) => f.id);
  const fid = () => (rnd() < 0.9 ? pickA(myFleets) ?? 0 : any(g.nextId));
  const sid = () => any(g.galaxy.systems.length);
  const chars = g.characters.map((c) => c.id);
  const cid = () => (rnd() < 0.9 ? pickA(chars) ?? 0 : any(g.nextId));
  const eid = () => any(g.empires.length);
  const order = (): FleetOrder => pickA<FleetOrder>([{ type: 'idle' }, { type: 'move', target: sid() }, { type: 'patrol', a: sid(), b: sid(), leg: 0 }, { type: 'invade', planetId: any(g.planets.length) }, { type: 'colonize', planetId: any(g.planets.length) }, { type: 'outpost', systemId: sid() }, { type: 'blockade', systemId: sid() }])!;
  const res = pickA([...RESOURCES])!;
  const all: (() => Command)[] = [
    () => ({ type: 'queueBuilding', planetId: pid(), building: pickA(Object.keys(BUILDINGS))! as never }),
    () => ({ type: 'setDesignation', planetId: pid(), designation: pickA(DESIGNATION_IDS)! }),
    () => ({ type: 'designateHeir', charId: rnd() < 0.2 ? null : cid() }),
    () => ({ type: 'launchCovert', targetId: eid(), kind: pickA(['gather_intel', 'steal_tech', 'sabotage', 'incite_unrest'] as const)!, agentId: cid(), planetId: rnd() < 0.5 ? null : any(g.planets.length) }),
    () => ({ type: 'cancelCovert', opId: pickA((g.covert ?? []).map((o) => o.id)) ?? any(99) }),
    () => ({ type: 'demolish', planetId: pid(), building: pickA(Object.keys(BUILDINGS))! as never }),
    () => ({ type: 'cancelQueue', planetId: pid(), index: any(4), ships: rnd() < 0.5 }),
    () => ({ type: 'queueShip', planetId: pid(), cls: pickA(SHIP_ORDER)!, fleetId: rnd() < 0.5 ? null : fid() }),
    () => ({ type: 'buildStation', planetId: any(g.planets.length), kind: pickA(['mining', 'energy', 'research', 'gas'] as const)! }),
    () => ({ type: 'upgradeOperation', planetId: any(g.planets.length) }),
    () => ({ type: 'setOperationMode', planetId: any(g.planets.length), mode: pickA(['standard', 'surge', 'sustain', 'halted'] as const)! }),
    () => ({ type: 'dismantleOperation', planetId: any(g.planets.length) }),
    () => ({ type: 'upgradeStarbase', systemId: sid() }),
    () => ({ type: 'moveFleet', fleetId: fid(), target: sid() }),
    () => ({ type: 'moveFleet', fleetId: fid(), target: sid() }),
    () => ({ type: 'fleetOrder', fleetId: fid(), order: order() }),
    () => ({ type: 'fleetOrder', fleetId: fid(), order: order() }),
    () => ({ type: 'setStance', fleetId: fid(), stance: pickA(['aggressive', 'defensive', 'passive'] as const)! }),
    () => ({ type: 'mergeFleets', fleetId: fid(), otherId: fid() }),
    () => { const f = g.fleets[fid()]; return { type: 'splitFleet', fleetId: f?.id ?? 0, shipIds: f ? f.ships.filter(() => rnd() < 0.5).map((s) => s.id) : [any(99)] }; },
    () => ({ type: 'renameFleet', fleetId: fid(), name: rnd() < 0.3 ? '' : 'Audit fleet' }),
    () => ({ type: 'disbandFleet', fleetId: fid() }),
    () => ({ type: 'assignAdmiral', fleetId: fid(), admiralId: rnd() < 0.3 ? null : cid() }),
    () => ({ type: 'recruitAdmiral' }),
    () => ({ type: 'recruitCharacter', charId: cid() }),
    () => ({ type: 'dismissCharacter', charId: cid() }),
    () => ({ type: 'assignCharacter', charId: cid(), assignment: pickA([null, { kind: 'fleet', fleetId: fid() }, { kind: 'province', sectorId: any(12) }, { kind: 'planet', planetId: pid() }, { kind: 'envoy', empireId: eid() }, { kind: 'council', seat: pickA(COUNCIL_SEATS)!.id }] as never[]) as never }),
    () => ({ type: 'learnSkill', charId: cid(), skill: pickA(SKILLS)!.id }),
    () => ({ type: 'commissionItem', item: pickA(ITEMS)!.id }),
    () => ({ type: 'equipItem', charId: cid(), item: pickA(ITEMS)!.id }),
    () => ({ type: 'unequipItem', charId: cid(), slot: pickA(['weapon', 'armour', 'relic', 'instrument'] as const)! }),
    () => ({ type: 'captive', charId: cid(), action: pickA(['pardon', 'recruit', 'ransom'] as const)! }),
    () => ({ type: 'payRansom', charId: cid() }),
    () => ({ type: 'capitalBuild', building: pickA(CAPITAL_BUILDINGS)!.id, plot: rnd() < 0.5 ? undefined : any(24) }),
    () => ({ type: 'capitalCancel', index: any(3) }),
    () => ({ type: 'issueDecree', decree: pickA(DECREES)!.id }),
    () => ({ type: 'revokeDecree', decree: pickA(DECREES)!.id }),
    () => ({ type: 'resolvePetition', petitionId: pickA((me.petitions ?? []).map((p) => p.id)) ?? any(99), option: any(4) }),
    () => ({ type: 'houseAction', houseId: pickA((me.houses ?? []).map((h) => h.id)) ?? any(9), action: pickA(['grant', 'suppress', 'honour'] as const)! }),
    () => ({ type: 'setResearch', tech: pickA(TECHS)!.id }),
    () => ({ type: 'queueResearch', tech: pickA(TECHS)!.id }),
    () => ({ type: 'dequeueResearch', tech: pickA(TECHS)!.id }),
    () => { const p = pickA(POLICIES)!; return { type: 'setPolicy', policy: p.id, option: pickA(p.options.map((o: { id: string }) => o.id))! }; },
    () => ({ type: 'changeGovernment', government: pickA(Object.keys(GOVERNMENTS))! as never }),
    () => ({ type: 'market', res, amount: Math.round((rnd() - 0.5) * 400) }),
    () => ({ type: 'propose', to: eid(), give: pickA([[], [{ kind: 'credits', amount: 50 }], [{ kind: 'system', systemId: sid() }]] as never[])!, receive: pickA([[], [{ kind: 'treaty', treaty: pickA(['nap', 'trade', 'research', 'defense', 'alliance', 'vassal'])! }], [{ kind: 'resource', res, amount: 30 }]] as never[])! }),
    () => ({ type: 'proposeContract', to: eid(), give: { [res]: 5 }, receive: { [pickA([...RESOURCES])!]: 5 }, years: any(5) }),
    () => ({ type: 'respondProposal', id: pickA(g.proposals.map((p) => p.id)) ?? any(99), accept: rnd() < 0.5 }),
    () => ({ type: 'declareWar', target: eid() }),
    () => ({ type: 'proposePeace', warId: pickA(g.wars.map((w) => w.id)) ?? any(99), term: pickA(['status_quo', 'tribute', 'vassalize', 'cede'] as const)! }),
    () => ({ type: 'breakTreaty', target: eid(), treaty: pickA(['nap', 'trade', 'research', 'defense', 'alliance', 'vassal'] as const)! }),
    () => ({ type: 'startMegastructure', systemId: sid(), mega: pickA(MEGASTRUCTURES)!.id }),
    () => ({ type: 'drawRelic', count: pickA([1, 10, 0, -1])! }),
    () => ({ type: 'setAutoBuild', planetId: rnd() < 0.3 ? 'all' : pid(), on: rnd() < 0.7 }),
  ];
  return pickA(all)!();
}

export function invariants(g: GameState, label: string) {
  const bad = (k: string, d: string) => report(k, `${label}: ${d}`);
  const E = g.empires;
  for (const e of E) {
    for (const res of RESOURCES) {
      if (!Number.isFinite(e.stock[res])) bad(`stock not finite (${res})`, `${e.name} ${e.stock[res]}`);
      else if (e.stock[res] < -1e-6 && res !== 'credits' && res !== 'food' && res !== 'energy') bad(`stock negative (${res})`, `${e.name} ${e.stock[res]}`);
    }
    if (!e.alive) continue;
    for (const [k, v] of Object.entries(e.stats)) if (typeof v === 'number' && !Number.isFinite(v)) bad(`stat not finite (${k})`, `${e.name}`);
    if (e.capitalPlanetId != null && g.planets[e.capitalPlanetId]?.colony?.ownerId !== e.id) bad('capital planet not owned', `${e.name} capital ${e.capitalPlanetId}`);
    if (e.research.current && !TECHS.some((t) => t.id === e.research.current)) bad('unknown current research', e.research.current);
    if (e.research.current && e.research.done.includes(e.research.current)) bad('researching a finished tech', `${e.name} ${e.research.current}`);
    if (new Set(e.research.done).size !== e.research.done.length) bad('duplicate finished tech', e.name);
    if ((e.relics ?? 0) < 0) bad('negative relics', `${e.name} ${e.relics}`);
    if (!(e.warExhaustion >= 0 && e.warExhaustion <= 100)) bad('war exhaustion out of range', `${e.name} ${e.warExhaustion}`);
    for (const h of e.houses ?? []) if (!(h.loyalty >= 0 && h.loyalty <= 100)) bad('house loyalty out of range', `${e.name} ${h.loyalty}`);
  }
  for (const p of g.planets) {
    const c = p.colony;
    if (c) {
      if (!E[c.ownerId]?.alive) bad('colony owned by a dead realm', `planet ${p.id} owner ${c.ownerId}`);
      if (!(c.pops >= 0) || !Number.isFinite(c.pops)) bad('colony pops invalid', `planet ${p.id} ${c.pops}`);
      if (!(c.stability >= 0 && c.stability <= 100)) bad('stability out of range', `planet ${p.id} ${c.stability}`);
      if (!(c.resistance >= 0 && c.resistance <= 100)) bad('resistance out of range', `planet ${p.id} ${c.resistance}`);
      for (const [b, n] of Object.entries(c.buildings)) if (!(n! >= 0) || !BUILDINGS[b as never]) bad('bad building entry', `planet ${p.id} ${b}=${n}`);
      for (const q of [...c.queue, ...c.shipQueue]) if (!(q.progress >= 0) || !(q.total > 0)) bad('bad queue item', `planet ${p.id} ${q.id} ${q.progress}/${q.total}`);
      if (p.station) bad('station and colony on one planet', `planet ${p.id}`);
    }
    if (p.colonizing && !E[p.colonizing.empireId]?.alive) bad('colonising by a dead realm', `planet ${p.id}`);
  }
  for (const s of g.galaxy.systems) {
    if (s.owner != null && !E[s.owner]?.alive) bad('system owned by a dead realm', `system ${s.id} owner ${s.owner}`);
    if (!(s.starbaseDamage >= 0 && s.starbaseDamage <= 1)) bad('starbase damage out of range', `system ${s.id} ${s.starbaseDamage}`);
  }
  for (const f of Object.values(g.fleets)) {
    if (!f.ships.length) bad('empty fleet', `fleet ${f.id}`);
    if (!E[f.ownerId]?.alive && E[f.ownerId]?.kind === 'major') bad('fleet of a dead realm', `fleet ${f.id} owner ${f.ownerId}`);
    if (!g.galaxy.systems[f.systemId]) bad('fleet in a missing system', `fleet ${f.id} at ${f.systemId}`);
    for (const n of f.path) if (!g.galaxy.systems[n]) bad('fleet path through a missing system', `fleet ${f.id}`);
    if (!(f.supply >= 0 && f.supply <= 100.001)) bad('fleet supply out of range', `fleet ${f.id} ${f.supply}`);
    if (!(f.troops >= 0)) bad('negative troops', `fleet ${f.id} ${f.troops}`);
    for (const sh of f.ships) if (!(sh.hull > 0) || !Number.isFinite(sh.hull)) bad('ship hull invalid', `fleet ${f.id} ship ${sh.id} ${sh.hull}`);
    if (f.admiralId != null) { const a = g.characters.find((c) => c.id === f.admiralId); if (!a || a.ownerId !== f.ownerId || a.status !== 'active') bad('fleet admiral invalid', `fleet ${f.id} admiral ${f.admiralId} ${a?.status}`); }
  }
  const ids = new Set<number>();
  for (const f of Object.values(g.fleets)) for (const sh of f.ships) { if (ids.has(sh.id)) bad('ship in two fleets', `ship ${sh.id}`); ids.add(sh.id); }
  for (const c of g.characters) {
    if (!(c.loyalty >= 0 && c.loyalty <= 100)) bad('character loyalty out of range', `char ${c.id} ${c.loyalty}`);
    if (c.status === 'active' && c.assignment?.kind === 'fleet') { const f = g.fleets[c.assignment.fleetId]; if (!f || f.ownerId !== c.ownerId) bad('character leads a missing/foreign fleet', `char ${c.id}`); }
    if (c.status === 'active' && c.assignment?.kind === 'planet' && g.planets[c.assignment.planetId]?.colony?.ownerId !== c.ownerId) bad('governor of a foreign world', `char ${c.id} planet ${c.assignment.planetId}`);
  }
  for (const w of g.wars) {
    if (!w.attackers.length || !w.defenders.length) bad('war with an empty side', `war ${w.id}`);
    for (const id of [...w.attackers, ...w.defenders]) if (!E[id]?.alive) bad('war with a dead participant', `war ${w.id} ${id}`);
    if (w.attackers.some((a) => w.defenders.includes(a))) bad('realm on both sides of a war', `war ${w.id}`);
    if (!(w.score >= -100 && w.score <= 100)) bad('war score out of range', `war ${w.id} ${w.score}`);
  }
  for (const t of g.treaties) {
    if (!E[t.a]?.alive || !E[t.b]?.alive) bad('treaty with a dead realm', `${t.type} ${t.a}-${t.b}`);
    if (t.a === t.b) bad('treaty with oneself', `${t.type} ${t.a}`);
    if (g.wars.some((w) => (w.attackers.includes(t.a) && w.defenders.includes(t.b)) || (w.attackers.includes(t.b) && w.defenders.includes(t.a)))) bad('treaty partners at war', `${t.type} ${t.a}-${t.b}`);
  }
  const tk = new Set<string>();
  for (const t of g.treaties) { const k = `${t.type}:${Math.min(t.a, t.b)}-${Math.max(t.a, t.b)}`; if (tk.has(k)) bad('duplicate treaty', k); tk.add(k); }
  for (const p of g.proposals) if (!E[p.from]?.alive || !E[p.to]?.alive) bad('proposal with a dead realm', `${p.id}`);
  for (const p of E) if (p.alive && p.kind === 'major') { const L = getLedger(g, p); for (const [k, v] of Object.entries(L)) if (typeof v === 'number' && !Number.isFinite(v)) bad(`ledger not finite (${k})`, p.name); }
}

