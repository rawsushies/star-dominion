import { TECH_BY_ID } from './data/techs';
import { canBuildStationOn, defaultOp, OP_MAX_LEVEL, OP_MODES, opUpgradeCost } from './operations';
import { canQueueCapital, queueCapital, cancelCapital } from './capital';
import { canIssueDecree, issueDecree, revokeDecree, canResolvePetition, resolvePetition, houseById, canActOnHouse, actOnHouse } from './governance';
import { ERAS } from './data/eras';
// Command layer: the only way the UI or the AI changes game state. Every
// command is validated against the rules (ownership, costs, tech, limits).
// This is the seam where a server-authoritative multiplayer layer could sit:
// clients would send these command objects instead of mutating state.

import { BUILDINGS } from './data/buildings';
import { SHIPS } from './data/ships';
import { GOVERNMENTS, POLICY_BY_ID } from './data/governments';
import { MEGA_BY_ID } from './data/megastructures';
import { STARBASE } from './data/ships';
import { buildingCost, buildingDays, canBuild, canBuildShip, shipCost, shipDays, starbaseUpgradeCost } from './construction';
import { createFleet, isCivilianFleet, routeFleet, removeFleet } from './fleets';
import { canResearch } from './research';
import { addMemory, applyDeal, breakTreaty, declareWar, evaluateProposal, evaluateContract, makePeace, type Evaluation, canDeclareWar, hasContact } from './diplomacy';
import { computeLedger } from './economy';
import { empireMods, hasTech, mod } from './modifiers';
import { planetHab } from './economy';
import { hasTreaty, isHostile, isExplored, warBetween } from './territory';
import { canAfford, log, nextId, pay, refund } from './util';
import { next } from './rng';
import { charById, charactersOf, createCharacter, rosterLimit, recruitCost, canAssign, assign, unassign, describeAssignment, canLearn, equip, unequip, releaseCaptive, recruitChance, ransomPrice } from './characters';
import { ITEM_BY_ID, type EquipSlot } from './data/characters';
import type { CharAssignment, Cost, BuildingId, DealItem, Fleet, FleetOrder, GameState, GovernmentId, PeaceTerm, ResId, ShipClass, StationKind, TreatyType , OpMode } from './types';

export type Command =
  | { type: 'queueBuilding'; planetId: number; building: BuildingId }
  | { type: 'demolish'; planetId: number; building: BuildingId }
  | { type: 'cancelQueue'; planetId: number; index: number; ships?: boolean }
  | { type: 'queueShip'; planetId: number; cls: ShipClass; fleetId?: number | null }
  | { type: 'buildStation'; planetId: number; kind: StationKind }
  | { type: 'upgradeOperation'; planetId: number }
  | { type: 'setOperationMode'; planetId: number; mode: OpMode }
  | { type: 'dismantleOperation'; planetId: number }
  | { type: 'upgradeStarbase'; systemId: number }
  | { type: 'moveFleet'; fleetId: number; target: number }
  | { type: 'fleetOrder'; fleetId: number; order: FleetOrder }
  | { type: 'setStance'; fleetId: number; stance: Fleet['stance'] }
  | { type: 'mergeFleets'; fleetId: number; otherId: number }
  | { type: 'splitFleet'; fleetId: number; shipIds: number[] }
  | { type: 'renameFleet'; fleetId: number; name: string }
  | { type: 'disbandFleet'; fleetId: number }
  | { type: 'assignAdmiral'; fleetId: number; admiralId: number | null }
  | { type: 'recruitAdmiral' }
  | { type: 'recruitCharacter'; charId: number }
  | { type: 'dismissCharacter'; charId: number }
  | { type: 'assignCharacter'; charId: number; assignment: CharAssignment | null }
  | { type: 'learnSkill'; charId: number; skill: string }
  | { type: 'commissionItem'; item: string }
  | { type: 'equipItem'; charId: number; item: string }
  | { type: 'unequipItem'; charId: number; slot: EquipSlot }
  | { type: 'captive'; charId: number; action: 'pardon' | 'recruit' | 'ransom' }
  | { type: 'payRansom'; charId: number }
  | { type: 'capitalBuild'; building: string; plot?: number }
  | { type: 'capitalCancel'; index: number }
  | { type: 'issueDecree'; decree: string }
  | { type: 'revokeDecree'; decree: string }
  | { type: 'resolvePetition'; petitionId: number; option: number }
  | { type: 'houseAction'; houseId: number; action: 'grant' | 'suppress' | 'honour' }
  | { type: 'setResearch'; tech: string }
  | { type: 'queueResearch'; tech: string }
  | { type: 'dequeueResearch'; tech: string }
  | { type: 'setPolicy'; policy: string; option: string }
  | { type: 'changeGovernment'; government: GovernmentId }
  | { type: 'market'; res: ResId; amount: number }
  | { type: 'propose'; to: number; give: DealItem[]; receive: DealItem[] }
  | { type: 'proposeContract'; to: number; give: Cost; receive: Cost; years: number }
  | { type: 'respondProposal'; id: number; accept: boolean }
  | { type: 'declareWar'; target: number }
  | { type: 'proposePeace'; warId: number; term: PeaceTerm }
  | { type: 'breakTreaty'; target: number; treaty: TreatyType }
  | { type: 'startMegastructure'; systemId: number; mega: string };

export interface CommandResult { ok: boolean; message?: string; evaluation?: Evaluation }

const fail = (message: string): CommandResult => ({ ok: false, message });
const OK: CommandResult = { ok: true };

export const MARKET_BASE: Record<ResId, number> = {
  credits: 1, minerals: 1, energy: 1, food: 1, alloys: 4, electronics: 5, components: 10, rare: 8, influence: 0,
};

export function marketFee(state: GameState, empireId: number): number {
  return Math.max(0.05, 0.2 * (1 + mod(empireMods(state, state.empires[empireId]), 'marketFee')));
}

export function marketQuote(state: GameState, empireId: number, res: ResId, amount: number): number {
  const p = state.market.price[res];
  const fee = marketFee(state, empireId);
  return amount > 0 ? Math.ceil(p * amount * (1 + fee)) : Math.floor(p * -amount * (1 - fee));
}

export const STATION_COST = { minerals: 100, credits: 40 };
export const ADMIRAL_COST = { credits: 150, influence: 20 };
export const GOV_CHANGE_COST = 150;

export function execute(state: GameState, empireId: number, cmd: Command): CommandResult {
  const e = state.empires[empireId];
  if (!e || !e.alive) return fail('Empire is not active');
  const fleetOf = (id: number) => {
    const f = state.fleets[id];
    return f && f.ownerId === empireId ? f : null;
  };
  switch (cmd.type) {
    case 'queueBuilding': {
      const p = state.planets[cmd.planetId];
      if (!p) return fail('No such planet');
      const v = canBuild(state, e, p, cmd.building);
      if (!v.ok) return fail(v.reason!);
      p.colony!.queue.push({ kind: 'building', id: cmd.building, progress: 0, total: buildingDays(state, e, cmd.building), paid: false });
      return OK;
    }
    case 'demolish': {
      const p = state.planets[cmd.planetId];
      const c = p?.colony;
      if (!c || c.ownerId !== empireId) return fail('Not your colony');
      if (cmd.building === 'capital') return fail('The palace cannot be demolished');
      if (!(c.buildings[cmd.building] ?? 0)) return fail('Nothing to demolish');
      if (c.queue.length >= 6) return fail('Construction queue full');
      c.queue.push({ kind: 'building', id: cmd.building, progress: 0, total: 20, paid: true, demolish: true });
      return OK;
    }
    case 'cancelQueue': {
      const c = state.planets[cmd.planetId]?.colony;
      if (!c || c.ownerId !== empireId) return fail('Not your colony');
      const q = cmd.ships ? c.shipQueue : c.queue;
      const item = q[cmd.index];
      if (!item) return fail('No such item');
      if (item.paid && !item.demolish) {
        const cost = item.kind === 'ship' ? shipCost(state, e, item.id as ShipClass) : buildingCost(state, e, item.id as BuildingId);
        refund(e, cost, 0.75);
      }
      q.splice(cmd.index, 1);
      return OK;
    }
    case 'queueShip': {
      const p = state.planets[cmd.planetId];
      if (!p) return fail('No such planet');
      const v = canBuildShip(state, e, p, cmd.cls);
      if (!v.ok) return fail(v.reason!);
      p.colony!.shipQueue.push({ kind: 'ship', id: cmd.cls, progress: 0, total: shipDays(state, e, cmd.cls), paid: false, targetFleetId: cmd.fleetId ?? null });
      return OK;
    }
    case 'buildStation': {
      const p = state.planets[cmd.planetId];
      if (!p) return fail('No such planet');
      const sys = state.galaxy.systems[p.systemId];
      if (sys.owner !== empireId) return fail('System not owned');
      const why = canBuildStationOn(p, cmd.kind);
      if (why) return fail(why);
      if (!pay(e, STATION_COST)) return fail('Insufficient resources');
      p.station = cmd.kind;
      p.op = defaultOp(state.tick);
      return OK;
    }
    case 'upgradeOperation': {
      const p = state.planets[cmd.planetId];
      if (!p?.station || !p.op || state.galaxy.systems[p.systemId].owner !== empireId) return fail('Not one of your operations');
      if (p.op.level >= OP_MAX_LEVEL) return fail('Already at its highest level');
      const cost = opUpgradeCost(p.op.level + 1);
      if (!pay(e, cost as Cost)) return fail('Insufficient resources');
      p.op.level++;
      return OK;
    }
    case 'setOperationMode': {
      const p = state.planets[cmd.planetId];
      if (!p?.station || !p.op || state.galaxy.systems[p.systemId].owner !== empireId) return fail('Not one of your operations');
      if (!OP_MODES[cmd.mode]) return fail('Unknown mode');
      p.op.mode = cmd.mode;
      return OK;
    }
    case 'dismantleOperation': {
      const p = state.planets[cmd.planetId];
      if (!p?.station || state.galaxy.systems[p.systemId].owner !== empireId) return fail('Not one of your operations');
      e.stock.minerals += Math.floor(STATION_COST.minerals * 0.25 * (p.op?.level ?? 1));
      p.station = null;
      delete p.op;
      return OK;
    }
    case 'upgradeStarbase': {
      const sys = state.galaxy.systems[cmd.systemId];
      if (!sys || sys.owner !== empireId) return fail('System not owned');
      if (sys.starbaseUpgrade) return fail('Upgrade already in progress');
      if (sys.starbase >= 3) return fail('Starbase at maximum level');
      if (sys.starbase === 2 && !hasTech(e, 'eng_starbases')) return fail('Requires Citadel Engineering');
      const cost = starbaseUpgradeCost(sys.starbase);
      if (!cost || !pay(e, cost)) return fail('Insufficient resources');
      sys.starbaseUpgrade = { progress: 0, total: STARBASE[sys.starbase + 1]!.days };
      return OK;
    }
    case 'moveFleet': {
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      if (!routeFleet(state, f, cmd.target)) return fail('No route');
      f.order = { type: 'move', target: cmd.target };
      return OK;
    }
    case 'fleetOrder': {
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      const o = cmd.order;
      if (o.type === 'colonize') {
        if (!f.ships.some((s) => s.cls === 'colony')) return fail('Requires a colony ship');
        const p = state.planets[o.planetId];
        if (!p || p.colony || p.colonizing) return fail('World unavailable');
        const so = state.galaxy.systems[p.systemId].owner;
        if (so != null && so !== empireId) return fail('System owned by another power');
        if (planetHab(state, p, e, empireMods(state, e)) <= 0) return fail('Uninhabitable for our species');
        if (!routeFleet(state, f, p.systemId)) return fail('No route');
      } else if (o.type === 'outpost') {
        if (!f.ships.some((s) => s.cls === 'constructor')) return fail('Requires a construction ship');
        const sys = state.galaxy.systems[o.systemId];
        if (!sys || sys.owner != null) return fail('System already claimed');
        if (!isExplored(e, o.systemId)) return fail('System unexplored');
        if (!routeFleet(state, f, o.systemId)) return fail('No route');
      } else if (o.type === 'invade') {
        if (f.troops <= 0) return fail('No troops embarked — add Troop Transports');
        const p = state.planets[o.planetId];
        if (!p?.colony || !isHostile(state, empireId, p.colony.ownerId)) return fail('Target must be a hostile colony (declare war first)');
        if (!routeFleet(state, f, p.systemId)) return fail('No route');
      } else if (o.type === 'patrol') {
        if (o.a === o.b) return fail('Patrol needs two systems');
        if (!routeFleet(state, f, o.b)) return fail('No route');
        o.leg = 0;
      } else if (o.type === 'blockade') {
        if (!routeFleet(state, f, o.systemId)) return fail('No route');
      } else if (o.type === 'move') {
        if (!routeFleet(state, f, o.target)) return fail('No route');
      } else if (o.type === 'idle') {
        f.path = f.progress > 0 && f.path.length ? [f.path[0]] : [];
      }
      f.order = o;
      return OK;
    }
    case 'setStance': {
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      f.stance = cmd.stance;
      return OK;
    }
    case 'mergeFleets': {
      const a = fleetOf(cmd.fleetId);
      const b = fleetOf(cmd.otherId);
      if (!a || !b || a === b) return fail('Invalid fleets');
      if (a.systemId !== b.systemId || a.progress > 0 || b.progress > 0) return fail('Fleets must be in the same system');
      a.ships.push(...b.ships);
      a.troops += b.troops;
      a.supply = Math.min(a.supply, b.supply);
      if (a.admiralId == null && b.admiralId != null) { const ld = charById(state, b.admiralId); if (ld) assign(state, ld, { kind: 'fleet', fleetId: a.id }); }
      removeFleet(state, b);
      if (isCivilianFleet(a)) a.stance = 'passive';
      return OK;
    }
    case 'splitFleet': {
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      if (f.progress > 0) return fail('Cannot split while in transit');
      const moving = f.ships.filter((s) => cmd.shipIds.includes(s.id));
      if (!moving.length || moving.length === f.ships.length) return fail('Select some, but not all, ships');
      f.ships = f.ships.filter((s) => !cmd.shipIds.includes(s.id));
      const nf = createFleet(state, empireId, f.systemId, []);
      nf.ships = moving;
      nf.troops = moving.reduce((a, s) => a + (SHIPS[s.cls].troops ?? 0), 0);
      f.troops = f.ships.reduce((a, s) => a + (SHIPS[s.cls].troops ?? 0), 0);
      nf.supply = f.supply;
      nf.stance = isCivilianFleet(nf) ? 'passive' : f.stance;
      if (isCivilianFleet(nf)) nf.name = `${SHIPS[nf.ships[0].cls].label} ${nf.id}`;
      return { ok: true, message: String(nf.id) };
    }
    case 'renameFleet': {
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      f.name = cmd.name.slice(0, 40) || f.name;
      return OK;
    }
    case 'disbandFleet': {
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      // Scrapping in friendly space returns a quarter of the alloys.
      const sys = state.galaxy.systems[f.systemId];
      if (sys.owner === empireId) for (const s of f.ships) e.stock.alloys += (SHIPS[s.cls].cost.alloys ?? 0) * 0.25;
      removeFleet(state, f);
      return OK;
    }
    case 'assignAdmiral': {
      // legacy command: assign any fleet-capable character
      const f = fleetOf(cmd.fleetId);
      if (!f) return fail('Not your fleet');
      if (cmd.admiralId == null) { const cur = charById(state, f.admiralId); if (cur) unassign(state, cur); f.admiralId = null; return OK; }
      return execute(state, empireId, { type: 'assignCharacter', charId: cmd.admiralId, assignment: { kind: 'fleet', fleetId: f.id } });
    }
    case 'recruitAdmiral': {
      // legacy command: hire a fresh admiral directly
      if (charactersOf(state, empireId).length >= rosterLimit(state, e)) return fail(`Roster is full (${rosterLimit(state, e)})`);
      if (!pay(e, ADMIRAL_COST)) return fail('Requires 150 credits and 20 influence');
      createCharacter(state, empireId, 'admiral');
      return OK;
    }
    case 'recruitCharacter': {
      const c = charById(state, cmd.charId);
      if (!c || c.ownerId !== empireId || c.status !== 'candidate') return fail('That candidate is not available');
      if (charactersOf(state, empireId).length >= rosterLimit(state, e)) return fail(`Roster is full (${rosterLimit(state, e)}). Expand the Hall of Heroes or dismiss someone.`);
      const cost = recruitCost(c);
      if (!pay(e, cost)) return fail(`Requires ${cost.credits} credits and ${cost.influence} influence`);
      c.status = 'active';
      c.bio.push({ tick: state.tick, text: `Entered the service of the ${e.name}.` });
      return OK;
    }
    case 'dismissCharacter': {
      const c = charById(state, cmd.charId);
      if (!c || c.ownerId !== empireId || c.status !== 'active') return fail('Not in your service');
      unassign(state, c);
      for (const slot of Object.keys(c.equipment) as EquipSlot[]) unequip(c, e, slot);
      c.status = 'retired';
      c.bio.push({ tick: state.tick, text: `Dismissed from the service of the ${e.name}.` });
      return OK;
    }
    case 'assignCharacter': {
      const c = charById(state, cmd.charId);
      if (!c || c.ownerId !== empireId) return fail('Not in your service');
      const why = canAssign(state, c, cmd.assignment);
      if (why) return fail(why);
      assign(state, c, cmd.assignment);
      if (cmd.assignment) c.bio.push({ tick: state.tick, text: `${describeAssignment(state, cmd.assignment)}.` });
      return OK;
    }
    case 'learnSkill': {
      const c = charById(state, cmd.charId);
      if (!c || c.ownerId !== empireId || c.status !== 'active') return fail('Not in your service');
      const why = canLearn(c, cmd.skill);
      if (why) return fail(why);
      c.skills[cmd.skill] = (c.skills[cmd.skill] ?? 0) + 1;
      c.skillPoints--;
      return OK;
    }
    case 'commissionItem': {
      const it = ITEM_BY_ID[cmd.item];
      if (!it || it.findable) return fail('That cannot be commissioned');
      const forge = e.capital?.buildings.military_academy?.level ?? 0;
      if (forge < 1) return fail('Requires a Military Academy in the capital');
      if (!pay(e, it.cost as Cost)) return fail('Not enough resources');
      (e.armory ??= []).push(it.id);
      return OK;
    }
    case 'equipItem': {
      const c = charById(state, cmd.charId);
      if (!c || c.ownerId !== empireId || c.status !== 'active') return fail('Not in your service');
      const why = equip(c, e, cmd.item);
      return why ? fail(why) : OK;
    }
    case 'unequipItem': {
      const c = charById(state, cmd.charId);
      if (!c || c.ownerId !== empireId) return fail('Not in your service');
      unequip(c, e, cmd.slot);
      return OK;
    }
    case 'captive': {
      const c = charById(state, cmd.charId);
      if (!c || c.status !== 'captive' || c.captorId !== empireId) return fail('You hold no such prisoner');
      const home = state.empires[c.ownerId];
      if (cmd.action === 'pardon') {
        releaseCaptive(state, c, `Pardoned and released by the ${e.name}.`);
        addMemory(state, home.id, empireId, 'pardon', 20, 1, 'Pardoned our commanders');
        log(state, { kind: 'capture', severity: 'info', title: `${c.name} pardoned`, text: `The ${e.name} has released ${c.name} to the ${home.name}.`, empires: [empireId, home.id] });
        return OK;
      }
      if (cmd.action === 'recruit') {
        if (charactersOf(state, empireId).length >= rosterLimit(state, e)) return fail('Your roster is full');
        if (!pay(e, { influence: 25 })) return fail('Requires 25 influence');
        if (next(state.rng) < recruitChance(state, c)) {
          const from = home.name;
          c.ownerId = empireId; c.status = 'active'; c.captorId = null; c.loyalty = 35; c.assignment = null;
          c.bio.push({ tick: state.tick, text: `Swore allegiance to the ${e.name} after captivity, forsaking the ${from}.` });
          addMemory(state, home.id, empireId, 'turncoat', -15, 0.5, 'Turned our commanders');
          log(state, { kind: 'capture', severity: 'good', title: `${c.name} joins you`, text: `Your former prisoner now serves the ${e.name}.`, empires: [empireId, home.id] });
          return { ok: true, message: 'recruited' };
        }
        c.loyalty = Math.min(100, c.loyalty + 5);
        return { ok: true, message: `${c.name} refused your offer.` };
      }
      // ransom: the captive's realm pays to have them back
      const price = ransomPrice(c);
      if (!home.alive) return fail('Their realm has fallen');
      if (warBetween(state, empireId, home.id)) return fail('They will not pay ransom while at war with you');
      if (home.stock.credits < price) return fail(`The ${home.name} cannot pay ${price} credits`);
      home.stock.credits -= price;
      e.stock.credits += price;
      releaseCaptive(state, c, `Ransomed back from the ${e.name} for ${price} credits.`);
      return { ok: true, message: `Ransomed for ${price} credits` };
    }
    case 'capitalBuild': {
      const why = canQueueCapital(state, e, cmd.building, cmd.plot);
      if (why) return fail(why);
      queueCapital(state, e, cmd.building, cmd.plot);
      return OK;
    }
    case 'capitalCancel': {
      if (!cancelCapital(e, cmd.index)) return fail('No such work in the queue');
      return OK;
    }
    case 'issueDecree': {
      const why = canIssueDecree(state, e, cmd.decree);
      if (why) return fail(why);
      issueDecree(state, e, cmd.decree);
      return OK;
    }
    case 'revokeDecree': {
      if (!e.decrees?.some((d) => d.id === cmd.decree)) return fail('That decree is not in force');
      revokeDecree(state, e, cmd.decree);
      return OK;
    }
    case 'resolvePetition': {
      const why = canResolvePetition(e, cmd.petitionId, cmd.option);
      if (why) return fail(why);
      resolvePetition(state, e, cmd.petitionId, cmd.option);
      return OK;
    }
    case 'houseAction': {
      const h = houseById(e, cmd.houseId);
      const why = canActOnHouse(state, e, h, cmd.action);
      if (why) return fail(why);
      actOnHouse(state, e, h!, cmd.action);
      return OK;
    }
    case 'payRansom': {
      const c = charById(state, cmd.charId);
      if (!c || c.status !== 'captive' || c.ownerId !== empireId) return fail('Not one of your captured people');
      const holder = state.empires[c.captorId ?? -1];
      if (!holder) return fail('Their captors are gone');
      if (warBetween(state, empireId, holder.id)) return fail('No ransom can be arranged while at war');
      const price = ransomPrice(c);
      if (!pay(e, { credits: price })) return fail(`Requires ${price} credits`);
      holder.stock.credits += price;
      releaseCaptive(state, c, `Ransomed home by the ${e.name} for ${price} credits.`);
      return OK;
    }
    case 'setResearch': {
      if ((TECH_BY_ID[cmd.tech]?.era ?? 0) > (e.era ?? 0)) return fail(`Requires the ${ERAS[TECH_BY_ID[cmd.tech].era!].name} era`);
      if (!canResearch(e, cmd.tech)) return fail('Prerequisites not met');
      if (e.research.current && e.research.current !== cmd.tech) e.research.queue.unshift(e.research.current);
      e.research.queue = e.research.queue.filter((t) => t !== cmd.tech);
      e.research.current = cmd.tech;
      return OK;
    }
    case 'queueResearch': {
      if (e.research.done.includes(cmd.tech) || e.research.current === cmd.tech || e.research.queue.includes(cmd.tech)) return fail('Already researched or queued');
      { const need = TECH_BY_ID[cmd.tech]?.era ?? 0; if (need > (e.era ?? 0)) return fail(`Requires the ${ERAS[need].name} era`); }
      // Auto-queue missing prerequisites in order.
      const order: string[] = [];
      const visit = (id: string) => {
        if (e.research.done.includes(id) || e.research.current === id || e.research.queue.includes(id) || order.includes(id)) return;
        for (const r of (TECHS_REQ[id] ?? [])) visit(r);
        order.push(id);
      };
      visit(cmd.tech);
      e.research.queue.push(...order);
      return OK;
    }
    case 'dequeueResearch': {
      e.research.queue = e.research.queue.filter((t) => t !== cmd.tech);
      if (e.research.current === cmd.tech) e.research.current = null;
      return OK;
    }
    case 'setPolicy': {
      const def = POLICY_BY_ID[cmd.policy];
      if (!def || !def.options.some((o) => o.id === cmd.option)) return fail('Unknown policy');
      if (e.policies[cmd.policy] === cmd.option) return OK;
      if (e.stock.influence < 5) return fail('Changing policy costs 5 influence');
      e.stock.influence -= 5;
      e.policies[cmd.policy] = cmd.option;
      return OK;
    }
    case 'changeGovernment': {
      if (!GOVERNMENTS[cmd.government]) return fail('Unknown government');
      if (e.government === cmd.government) return fail('Already in place');
      const wait = e.governmentChangedTick + 360 * 10 - state.tick;
      if (wait > 0) return fail(`Reform possible in ${Math.ceil(wait / 360)} years`);
      if (!pay(e, { influence: GOV_CHANGE_COST })) return fail(`Requires ${GOV_CHANGE_COST} influence`);
      e.government = cmd.government;
      e.governmentChangedTick = state.tick;
      e.timedMods.push({ key: 'stability', value: -15, until: state.tick + 720, label: 'Constitutional upheaval' });
      log(state, { kind: 'government', severity: 'warn', title: `${e.name} reforms its government`, text: `The realm is now a ${GOVERNMENTS[cmd.government].label}.`, empires: [] });
      return OK;
    }
    case 'market': {
      if (cmd.res === 'influence' || cmd.res === 'credits') return fail('Not tradable');
      const amt = Math.round(cmd.amount);
      if (!amt) return fail('Amount required');
      const value = marketQuote(state, empireId, cmd.res, amt);
      if (amt > 0) {
        if (!pay(e, { credits: value })) return fail(`Requires ${value} credits`);
        e.stock[cmd.res] += amt;
      } else {
        if (e.stock[cmd.res] < -amt) return fail('Not enough in storage');
        e.stock[cmd.res] += amt;
        e.stock.credits += value;
      }
      const p = state.market.price;
      p[cmd.res] = Math.max(MARKET_BASE[cmd.res] * 0.25, Math.min(MARKET_BASE[cmd.res] * 4, p[cmd.res] * (1 + amt / 3000)));
      state.market.volume[cmd.res] += Math.abs(amt);
      return { ok: true, message: `${amt > 0 ? 'Bought' : 'Sold'} ${Math.abs(amt)} for ${value} credits` };
    }
    case 'propose': {
      const to = state.empires[cmd.to];
      if (!to?.alive || to.kind === 'guardian' || to.kind === 'raiders') return fail('They will not negotiate');
      if (!hasContact(state, empireId, cmd.to)) return fail('No contact established');
      for (const it of [...cmd.give, ...cmd.receive]) {
        if (it.kind === 'system') {
          const owner = cmd.give.includes(it) ? empireId : cmd.to;
          if (state.galaxy.systems[it.systemId]?.owner !== owner) return fail('System ownership changed');
          const capSys = state.empires[owner].capitalSystemId;
          if (capSys === it.systemId) return fail('Capital systems cannot be traded');
        }
        if (it.kind === 'credits' && cmd.give.includes(it) && e.stock.credits < it.amount) return fail('Insufficient credits');
        if (it.kind === 'resource' && cmd.give.includes(it) && e.stock[it.res] < it.amount) return fail(`Insufficient ${it.res}`);
        if (it.kind === 'treaty' && hasTreaty(state, empireId, cmd.to, it.treaty)) return fail('Treaty already exists');
      }
      const prop = { id: nextId(state), from: empireId, to: cmd.to, give: cmd.give, receive: cmd.receive, tick: state.tick, kind: 'deal' as const };
      if (to.isPlayer) { state.proposals.push(prop); return { ok: true, message: 'Proposal sent' }; }
      const ev = evaluateProposal(state, prop);
      if (ev.accept) applyDeal(state, prop);
      return { ok: ev.accept, message: ev.accept ? 'Accepted' : 'Declined', evaluation: ev };
    }
    case 'proposeContract': {
      const to = state.empires[cmd.to];
      if (!to?.alive || to.isPlayer || to.kind === 'guardian' || to.kind === 'raiders') return fail('They will not negotiate');
      if (!hasContact(state, empireId, cmd.to)) return fail('No contact established');
      const clean = (c: Cost) => Object.fromEntries(Object.entries(c).filter(([k, v]) => (v ?? 0) > 0 && k !== 'influence')) as Cost;
      const give = clean(cmd.give), receive = clean(cmd.receive);
      if (!Object.keys(give).length && !Object.keys(receive).length) return fail('Contract is empty');
      const years = Math.max(1, Math.min(20, Math.round(cmd.years)));
      const ev = evaluateContract(state, empireId, cmd.to, give, receive, computeLedger(state, to).net as Record<string, number>);
      if (ev.accept) {
        state.tradeDeals.push({ id: nextId(state), a: empireId, b: cmd.to, aGives: give, bGives: receive, until: state.tick + years * 360 });
        log(state, { kind: 'treaty', severity: 'good', title: 'Resource contract signed', text: `${e.name} and ${to.name} agree a ${years}-year exchange.`, empires: [empireId, cmd.to] });
      }
      return { ok: ev.accept, message: ev.accept ? 'Contract signed' : 'Contract declined', evaluation: ev };
    }
    case 'respondProposal': {
      const i = state.proposals.findIndex((p) => p.id === cmd.id && p.to === empireId);
      if (i < 0) return fail('Proposal expired');
      const p = state.proposals[i];
      state.proposals.splice(i, 1);
      if (!cmd.accept) {
        return OK;
      }
      if (p.kind === 'peace') {
        const war = state.wars.find((w) => w.id === p.warId);
        if (!war) return fail('War already over');
        const proposerSide = war.attackers.includes(p.from) ? 'attackers' : 'defenders';
        const winnerSide = p.peaceTerm === 'status_quo' ? proposerSide : proposerSide;
        makePeace(state, war, p.peaceTerm ?? 'status_quo', winnerSide);
      } else applyDeal(state, p);
      return OK;
    }
    case 'declareWar': {
      const v = canDeclareWar(state, empireId, cmd.target);
      if (!v.ok) return fail(v.reason!);
      declareWar(state, empireId, cmd.target);
      return OK;
    }
    case 'proposePeace': {
      const war = state.wars.find((w) => w.id === cmd.warId);
      if (!war) return fail('No such war');
      const mySide = war.attackers.includes(empireId) ? 'attackers' : war.defenders.includes(empireId) ? 'defenders' : null;
      if (!mySide) return fail('Not a belligerent');
      const leader = mySide === 'attackers' ? war.attackers[0] : war.defenders[0];
      if (leader !== empireId) return fail('Only the war leader may negotiate');
      const other = mySide === 'attackers' ? war.defenders[0] : war.attackers[0];
      const prop = { id: nextId(state), from: empireId, to: other, give: [], receive: [], tick: state.tick, kind: 'peace' as const, peaceTerm: cmd.term, warId: war.id };
      if (state.empires[other].isPlayer) { state.proposals.push(prop); return { ok: true, message: 'Proposal sent' }; }
      const ev = evaluateProposal(state, prop);
      if (ev.accept) makePeace(state, war, cmd.term, mySide);
      return { ok: ev.accept, message: ev.accept ? 'Peace accepted' : 'Peace rejected', evaluation: ev };
    }
    case 'breakTreaty': {
      if (!hasTreaty(state, empireId, cmd.target, cmd.treaty)) return fail('No such treaty');
      if (cmd.treaty === 'vassal') {
        const t = state.treaties.find((x) => x.type === 'vassal' && ((x.a === empireId && x.b === cmd.target) || (x.b === empireId && x.a === cmd.target)))!;
        if (t.b === empireId) {
          // A vassal breaking free means war with the overlord.
          breakTreaty(state, empireId, cmd.target, 'vassal');
          state.empires[empireId].stock.influence += 40; // independence war costs no influence
          declareWar(state, empireId, cmd.target);
          return { ok: true, message: 'Independence declared' };
        }
      }
      breakTreaty(state, empireId, cmd.target, cmd.treaty);
      return OK;
    }
    case 'startMegastructure': {
      const def = MEGA_BY_ID[cmd.mega];
      const sys = state.galaxy.systems[cmd.systemId];
      if (!def || !sys) return fail('Invalid project');
      if (sys.owner !== empireId) return fail('System not owned');
      if (!hasTech(e, def.tech)) return fail('Requires research');
      if (def.starReq && !def.starReq.includes(sys.star)) return fail('Unsuitable star');
      if (sys.megastructures.length >= 2) return fail('System can host at most two megastructures');
      if (sys.megastructures.some((m) => m.id === def.id)) return fail('Already present in this system');
      if (def.unique && state.galaxy.systems.some((s) => s.megastructures.some((m) => m.id === def.id && m.ownerId === empireId))) return fail('Only one per realm');
      if (def.id === 'orbital_ring' && !sys.planetIds.some((p) => state.planets[p].colony?.ownerId === empireId && (state.planets[p].colony?.buildings.shipyard ?? 0) > 0)) return fail('Requires a colony with a shipyard in this system');
      if (!canAfford(e, def.stageCost)) return fail('Cannot afford the first stage');
      sys.megastructures.push({ id: def.id, ownerId: empireId, stage: 0, progress: 0, building: true });
      log(state, { kind: 'megastructure', severity: 'info', title: `${def.label} begun`, text: `Construction started at ${sys.name}.`, empires: [], systemId: sys.id });
      return OK;
    }
  }
}

import { TECHS } from './data/techs';
const TECHS_REQ: Record<string, string[]> = Object.fromEntries(TECHS.map((t) => [t.id, t.requires]));

export function describeBuildingRequirement(id: BuildingId): string {
  const d = BUILDINGS[id];
  return d.tech ? `Requires research` : '';
}
