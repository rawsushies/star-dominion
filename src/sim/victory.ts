// Victory: three distinct roads to winning, open to every great realm (the player and the AI
// alike), each with measurable progress so the player can see how close anyone is.
//
// - Domination (territory): hold half of all claimed space and two fifths of the population of
//   every sovereign realm, and keep it for two years while the rest of the galaxy reacts.
// - Supremacy (war and diplomacy): no rival great realm left independent; each has fallen or
//   kneels as a vassal.
// - Ascension (civilisation): reach the last era, Omega Sovereignty.
//
// A rival's victory ends the player's reign.

import { MAX_ERA } from './data/eras';
import { eraProgress } from './eras';
import { log } from './util';
import type { Empire, GameState } from './types';

export type VictoryKind = 'domination' | 'supremacy' | 'ascension';
export const VICTORY_LABEL: Record<VictoryKind, string> = { domination: 'Domination', supremacy: 'Supremacy', ascension: 'Ascension' };

export const DOMINATION = { systems: 0.5, population: 0.4, holdMonths: 24 };
/** progress at which the galaxy is warned that a realm nears victory */
export const VICTORY_WARNING = 0.75;

export interface VictoryProgress {
  kind: VictoryKind;
  /** 0..1 */
  progress: number;
  detail: string;
}

function sovereign(e: Empire) { return e.alive && (e.kind === 'major' || e.kind === 'minor' || e.kind === 'rebels'); }

export function claimedSystems(state: GameState): number {
  let n = 0;
  for (const s of state.galaxy.systems) if (s.owner != null && sovereign(state.empires[s.owner])) n++;
  return n;
}

export function dominationShares(state: GameState, e: Empire) {
  const claimed = Math.max(1, claimedSystems(state));
  let pop = 0;
  for (const o of state.empires) if (sovereign(o)) pop += o.stats.population ?? 0;
  return { systems: (e.stats.systems ?? 0) / claimed, population: (e.stats.population ?? 0) / Math.max(1, pop), claimed };
}

export function independentRivals(state: GameState, e: Empire): Empire[] {
  return state.empires.filter((o) => o.alive && o.kind === 'major' && o.id !== e.id && !state.treaties.some((t) => t.type === 'vassal' && t.a === e.id && t.b === o.id));
}

export function victoryProgress(state: GameState, e: Empire): VictoryProgress[] {
  const d = dominationShares(state, e);
  const held = e.dominationSince != null ? Math.min(1, (state.tick - e.dominationSince) / (DOMINATION.holdMonths * 30)) : 0;
  const domFrac = Math.min(1, d.systems / DOMINATION.systems) * 0.5 + Math.min(1, d.population / DOMINATION.population) * 0.4 + held * 0.1;
  const majors = state.empires.filter((o) => o.kind === 'major' && o.id !== e.id);
  const subdued = majors.length - independentRivals(state, e).length;
  const era = e.era ?? 0;
  return [
    { kind: 'domination', progress: domFrac, detail: `${Math.round(d.systems * 100)}% of claimed systems (need ${DOMINATION.systems * 100}%), ${Math.round(d.population * 100)}% of all population (need ${DOMINATION.population * 100}%)${e.dominationSince != null ? `, held ${Math.floor((state.tick - e.dominationSince) / 30)} of ${DOMINATION.holdMonths} months` : ''}` },
    { kind: 'supremacy', progress: majors.length ? subdued / majors.length : 1, detail: `${subdued} of ${majors.length} rival great realms fallen or vassals` },
    { kind: 'ascension', progress: era >= MAX_ERA ? 1 : (era + eraProgress(state, e)) / MAX_ERA, detail: `Era ${era} of ${MAX_ERA}` },
  ];
}

/** Which victory a realm has achieved, if any (domination only after the hold period). */
export function victoryStatus(state: GameState, e: Empire): { achieved: VictoryKind | null; progress: VictoryProgress[] } {
  const progress = victoryProgress(state, e);
  let achieved: VictoryKind | null = null;
  if ((e.era ?? 0) >= MAX_ERA) achieved = 'ascension';
  else if (independentRivals(state, e).length === 0 && state.empires.some((o) => o.kind === 'major' && o.id !== e.id)) achieved = 'supremacy';
  else if (e.dominationSince != null && state.tick - e.dominationSince >= DOMINATION.holdMonths * 30) achieved = 'domination';
  return { achieved, progress };
}

function meetsDomination(state: GameState, e: Empire) {
  const d = dominationShares(state, e);
  return d.systems >= DOMINATION.systems && d.population >= DOMINATION.population;
}

const leaderCache = new WeakMap<GameState, { month: number; lead: { id: number; fear: number } | null }>();

/**
 * The realm the rest of the galaxy fears, if any: the one furthest along any road to victory,
 * once it is clearly ahead. `fear` runs 0..1. Cached per month (derived from state only).
 */
export function hegemon(state: GameState): { id: number; fear: number } | null {
  const month = Math.floor(state.tick / 30);
  const hit = leaderCache.get(state);
  if (hit && hit.month === month) return hit.lead;
  let best: { id: number; p: number } | null = null;
  let second = 0;
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    const d = dominationShares(state, e);
    // territory and people dominate fear; the ascension race only late
    const p = Math.max(Math.min(1, d.systems / DOMINATION.systems) * 0.6 + Math.min(1, d.population / DOMINATION.population) * 0.4, (e.era ?? 0) >= 3 ? 0.5 + ((e.era ?? 0) - 3) * 0.25 : 0);
    if (!best || p > best.p) { if (best) second = Math.max(second, best.p); best = { id: e.id, p }; }
    else second = Math.max(second, p);
  }
  let lead: { id: number; fear: number } | null = null;
  if (best && best.p >= 0.45 && best.p > second * 1.25) lead = { id: best.id, fear: Math.min(1, (best.p - 0.4) / 0.4) };
  leaderCache.set(state, { month, lead });
  return lead;
}

/** Monthly: track domination holds, warn when a realm nears victory, and end the game on a victory. */
export function victoryMonthly(state: GameState) {
  const player = state.empires[state.playerId];
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major') continue;
    if (meetsDomination(state, e)) {
      if (e.dominationSince == null) {
        e.dominationSince = state.tick;
        log(state, { kind: 'victory_threat', severity: e.isPlayer ? 'good' : 'danger', title: e.isPlayer ? 'Dominion within reach' : `${e.name} claims dominion`, text: e.isPlayer ? `Hold half of all claimed space and two fifths of the galaxy's people for ${DOMINATION.holdMonths} months to win.` : `${e.name} holds half of all claimed space. Unless someone breaks their hold within ${DOMINATION.holdMonths} months, they win.`, empires: [] });
      }
    } else if (e.dominationSince != null) {
      e.dominationSince = null;
      log(state, { kind: 'victory_threat', severity: e.isPlayer ? 'warn' : 'good', title: e.isPlayer ? 'Dominion slips away' : `${e.name}'s dominion is broken`, text: e.isPlayer ? 'Your hold on the galaxy has fallen below the threshold.' : `${e.name} no longer holds enough of the galaxy to win.`, empires: [] });
    }
    // a one-off warning when a rival gets close to any victory
    if (!e.isPlayer) {
      e.victoryWarned ??= [];
      for (const p of victoryProgress(state, e)) {
        if (p.progress >= VICTORY_WARNING && !e.victoryWarned.includes(p.kind)) {
          e.victoryWarned.push(p.kind);
          log(state, { kind: 'victory_threat', severity: 'danger', title: `${e.name} nears ${VICTORY_LABEL[p.kind].toLowerCase()}`, text: `${p.detail}. Other realms grow wary of them; they may seek allies against them, and so can you.`, empires: [] });
        }
      }
    }
  }
  if (!player.alive) {
    if (!state.gameOver) {
      state.gameOver = { won: false, reason: 'Your realm has fallen. The last of your worlds is lost.' };
      log(state, { kind: 'gameover', severity: 'danger', title: 'The reign has ended', text: state.gameOver.reason, empires: [] });
    }
    return;
  }
  if (state.gameOver) return;
  const mine = victoryStatus(state, player).achieved;
  if (mine) {
    const reason = mine === 'ascension' ? 'Your civilisation has reached Omega Sovereignty and transcended the age of kingdoms.'
      : mine === 'supremacy' ? 'Every rival great realm has fallen or kneels before your throne.'
        : `Your banners have flown over half of all claimed space for ${DOMINATION.holdMonths / 12} years.`;
    state.gameOver = { won: true, reason, kind: mine };
    log(state, { kind: 'victory', severity: 'good', title: `${VICTORY_LABEL[mine]} victory`, text: `${reason} You may continue to rule.`, empires: [] });
    return;
  }
  for (const e of state.empires) {
    if (!e.alive || e.kind !== 'major' || e.isPlayer) continue;
    const theirs = victoryStatus(state, e).achieved;
    if (!theirs) continue;
    const reason = theirs === 'ascension' ? `${e.name} has reached Omega Sovereignty. The age of kingdoms ends with their crown.`
      : theirs === 'supremacy' ? `${e.name} stands alone: every other great realm has fallen or bent the knee.`
        : `${e.name} has held half of the galaxy for ${DOMINATION.holdMonths / 12} years. Their dominion is complete.`;
    state.gameOver = { won: false, reason, kind: theirs, winner: e.id };
    log(state, { kind: 'gameover', severity: 'danger', title: `${e.name}: ${VICTORY_LABEL[theirs]} victory`, text: reason, empires: [] });
    return;
  }
}
