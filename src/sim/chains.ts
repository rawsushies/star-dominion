// Event chains: matters that grow out of the realm's situation and come back months later
// depending on how the council answered. Stage definitions live in data/chains.ts; this module
// starts chains when their conditions arise, raises scheduled stages and applies their effects.

import { PETITION_BY_ID, type PetitionOption } from './data/governance';
import { addMemory } from './diplomacy';
import { createFleet } from './fleets';
import { spawnRaiders } from './engine';
import { chance, pick } from './rng';
import { log, nextId } from './util';
import type { Empire, GameState, Petition } from './types';

/** years before the same chain can start again in one realm */
const COOLDOWN_YEARS = 12;

export function raiseStage(state: GameState, e: Empire, def: string, planetId: number | null) {
  const d = PETITION_BY_ID[def];
  if (!d) return;
  e.petitions ??= [];
  // one copy of a matter at a time
  if (e.petitions.some((x) => x.def === def)) return;
  // the world may have been lost since the chain began: the matter dies with it
  if (planetId != null && state.planets[planetId]?.colony?.ownerId !== e.id) return;
  const p: Petition = { id: nextId(state), def, houseId: e.houses?.[0]?.id ?? null, memberId: null, sectorId: null, tick: state.tick, expires: state.tick + 120, planetId };
  e.petitions.push(p);
  if (e.isPlayer) {
    const name = planetId != null ? state.planets[planetId].name : '';
    log(state, { kind: 'council', severity: 'warn', title: `Before the council: ${d.title.replace('{planet}', name)}`, text: d.text.replace(/\{planet\}/g, name) + ' Decide in the Council chamber within four months.', empires: [e.id], planetId: planetId ?? undefined });
  }
}

/** Apply the parts of an answer that only event chains use, and schedule the next stage. */
export function applyChainEffects(state: GameState, e: Empire, p: Petition, o: PetitionOption) {
  const planet = p.planetId != null ? state.planets[p.planetId] : null;
  const c = planet?.colony && planet.colony.ownerId === e.id ? planet.colony : null;
  if (o.planet && c) {
    if (o.planet.pops) c.pops = Math.max(1, c.pops + o.planet.pops);
    if (o.planet.stability) c.stability = Math.max(0, Math.min(100, c.stability + o.planet.stability));
    if (o.planet.resistance) c.resistance = Math.max(0, Math.min(100, c.resistance + o.planet.resistance));
  }
  if (o.research && e.research.current) e.research.progress += o.research;
  for (let i = 0; i < (o.raiders ?? 0); i++) spawnRaiders(state, e);
  if (o.reputation) {
    for (const x of state.empires) if (x.alive && x.id !== e.id && (x.kind === 'major' || x.kind === 'minor')) addMemory(state, x.id, e.id, `chain_${p.def}`, o.reputation, 0.15, o.reputation > 0 ? 'Generous deeds' : 'Ruthless dealings');
  }
  if (o.fleet?.length && e.capitalSystemId != null) createFleet(state, e.id, e.capitalSystemId, o.fleet, 'Privateer Squadron');
  if (o.next) {
    const def = !o.next.chance || chance(state.rng, o.next.chance) ? o.next.def : o.next.else;
    if (def) (e.pendingChains ??= []).push({ def, at: state.tick + o.next.days, planetId: p.planetId ?? null });
  }
}

function canStart(state: GameState, e: Empire, root: string): boolean {
  const cd = e.chainCooldowns?.[root];
  if (cd != null && cd > state.tick) return false;
  if (e.petitions?.some((p) => p.def === root)) return false;
  return true;
}

function start(state: GameState, e: Empire, root: string, planetId: number | null) {
  (e.chainCooldowns ??= {})[root] = state.tick + 360 * COOLDOWN_YEARS;
  raiseStage(state, e, root, planetId);
}

/** Monthly: raise stages that are due, and start new chains when the situation calls for one. */
export function chainsMonthly(state: GameState) {
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    if (e.pendingChains?.length) {
      const due = e.pendingChains.filter((x) => x.at <= state.tick);
      e.pendingChains = e.pendingChains.filter((x) => x.at > state.tick);
      for (const d of due) raiseStage(state, e, d.def, d.planetId);
    }
    // a young reign has enough to learn: chains begin after the first two years
    if (state.tick < 360 * 2 || (e.petitions?.length ?? 0) >= 3 || !chance(state.rng, 0.06)) continue;
    const worlds = state.planets.filter((p) => p.colony?.ownerId === e.id);
    if (!worlds.length) continue;
    const options: [string, number | null][] = [];
    // an ancient site in our space
    const ruins = worlds.filter((p) => state.galaxy.systems[p.systemId].features.includes('ancient_ruins') && !state.galaxy.systems[p.systemId].features.includes('guardian'));
    if (ruins.length && canStart(state, e, 'precursor_signal')) options.push(['precursor_signal', pick(state.rng, ruins).id]);
    // crowded worlds breed disease
    const crowded = worlds.filter((p) => p.colony!.pops >= 8);
    if (crowded.length && canStart(state, e, 'fever_outbreak')) options.push(['fever_outbreak', pick(state.rng, crowded).id]);
    // conquered or restless worlds
    const restless = worlds.filter((p) => p.id !== e.capitalPlanetId && (p.colony!.originalOwnerId != null || p.colony!.stability < 35));
    if (restless.length && canStart(state, e, 'separatists')) options.push(['separatists', pick(state.rng, restless).id]);
    // a solvent crown at peace attracts the guilds
    if (e.stock.credits > 500 && !state.wars.some((w) => w.attackers.includes(e.id) || w.defenders.includes(e.id)) && canStart(state, e, 'guild_charter')) options.push(['guild_charter', null]);
    // corsairs on our border
    const raiders = state.empires.find((x) => x.kind === 'raiders');
    const owned = new Set(state.galaxy.systems.filter((s) => s.owner === e.id).map((s) => s.id));
    if (raiders && Object.values(state.fleets).some((f) => f.ownerId === raiders.id && owned.has(f.systemId)) && canStart(state, e, 'corsair_envoy')) options.push(['corsair_envoy', null]);
    if (!options.length) continue;
    const [root, planetId] = pick(state.rng, options);
    start(state, e, root, planetId);
  }
}
