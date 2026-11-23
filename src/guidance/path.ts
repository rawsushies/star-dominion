// Learning path for a new player: start with a handful of screens and add the rest one at a time,
// when the game makes them matter (meeting a realm opens Diplomacy, a war opens the War room, ...).
// Everything is still in the game; a beginner simply is not shown twenty screens on day one.
// "Simple mode" is per reign (saved with the game) and the player can switch it off at any time.

import type { GameState } from '../sim/types';
import type { ScreenId } from '../ui/store';
import { hasContact } from '../sim/diplomacy';
import { getLedger } from '../sim/engine';
import { guidanceOf } from './state';

/** Screens a beginner sees from the first day. */
export const SIMPLE_START: ScreenId[] = ['map', 'research', 'planets', 'fleets', 'codex'];

const atWar = (g: GameState) => g.wars.some((w) => w.attackers.includes(g.playerId) || w.defenders.includes(g.playerId));
const did = (g: GameState, id: string) => guidanceOf(g).done.includes(id) || guidanceOf(g).active === id;
const years = (g: GameState) => g.tick / 360;

/** When each further screen joins the bar, and the one-line reason it now matters. */
export const SCREEN_UNLOCKS: { id: ScreenId; when: (g: GameState) => boolean; why: string }[] = [
  { id: 'vault', when: (g) => (g.empires[g.playerId].relics ?? 0) > 0 && (did(g, 'grow') || (g.prologue?.stage ?? 0) >= 1 || years(g) >= 0.25), why: 'Spend the relics you earn on random draws: warships, heroes and supplies. You have some to try now.' },
  { id: 'throne', when: (g) => did(g, 'grow') || years(g) >= 1, why: 'Shows how close you, and your rivals, are to winning, plus optional goals that give rewards.' },
  { id: 'system', when: (g) => did(g, 'grow') || years(g) >= 1, why: 'A list of every star system you own.' },
  { id: 'diplomacy', when: (g) => g.empires.some((x) => x.id !== g.playerId && x.alive && x.kind !== 'guardian' && x.kind !== 'precursor' && x.kind !== 'cosmic' && hasContact(g, g.playerId, x.id)), why: 'Talk to the realms you have met: make friends, sign treaties, or declare war.' },
  { id: 'conclave', when: (g) => g.expansion?.conclave.founded != null, why: 'The High Conclave has formed: a galactic assembly that votes on wars, embargoes and limits. Your seat and your votes are here.' },
  { id: 'cosmos', when: (g) => !!g.expansion && (g.expansion.precursors.some((p) => p.warned > 0 || p.status === 'awakened' || p.sacred.some((s) => g.empires[g.playerId].explored.includes(s))) || g.expansion.devourer.status !== 'unborn' || g.expansion.omega.stage !== 'dormant'), why: 'Ancient powers and cosmic threats now matter to you: what wakes them, where they are, and what you can do.' },
  { id: 'military', when: (g) => did(g, 'conquest') || atWar(g), why: 'Your wars: who is winning, and where you offer peace.' },
  { id: 'warroom', when: (g) => did(g, 'conquest') || atWar(g), why: 'A map of the fighting: where enemy fleets are and which of your worlds are in danger.' },
  { id: 'economy', when: (g) => did(g, 'economy') || getLedger(g, g.empires[g.playerId]).shortages.length > 0 || years(g) >= 1.5, why: 'Where every resource comes from and where it goes. Open it when something runs low.' },
  { id: 'capital', when: (g) => did(g, 'capital') || years(g) >= 0.5, why: 'The city on your home planet. Its buildings give bonuses to your whole realm.' },
  { id: 'kingdom', when: (g) => years(g) >= 1, why: 'A summary of your whole realm on one page.' },
  { id: 'techtree', when: (g) => did(g, 'research') || years(g) >= 1, why: 'Every technology and what it leads to.' },
  { id: 'construction', when: (g) => years(g) >= 1, why: 'Everything being built, on every planet, in one list.' },
  { id: 'industry', when: (g) => did(g, 'economy') || years(g) >= 2, why: 'How raw materials become alloys and other goods.' },
  { id: 'heroes', when: (g) => did(g, 'characters') || years(g) >= 2, why: 'Your people: admirals, governors and agents you can hire and give jobs to.' },
  { id: 'council', when: (g) => did(g, 'diplomacy') || years(g) >= 2 || (g.empires[g.playerId].petitions?.length ?? 0) > 0, why: 'Your court: laws, decrees and requests from your people.' },
  { id: 'trade', when: (g) => years(g) >= 2.5, why: 'Trade routes and deals with other realms.' },
  { id: 'intel', when: (g) => years(g) >= 2.5, why: 'What your spies know about other realms.' },
  { id: 'operations', when: (g) => years(g) >= 3, why: 'Mines and stations in space that dig up resources.' },
  { id: 'journal', when: (g) => years(g) >= 3, why: 'A record of your goals and what has happened.' },
  { id: 'chronicle', when: (g) => years(g) >= 3, why: 'The history of your reign.' },
];

export function isSimple(g: GameState): boolean {
  return !!guidanceOf(g).simple;
}

export function setSimple(g: GameState, on: boolean) {
  guidanceOf(g).simple = on;
}

/** The screens on the bar right now; null means every screen (simple mode off). */
export function visibleScreens(g: GameState): Set<ScreenId> | null {
  if (!isSimple(g)) return null;
  const out = new Set<ScreenId>(SIMPLE_START);
  const s = guidanceOf(g);
  for (const u of SCREEN_UNLOCKS) if (s.seen.includes(`unl:${u.id}`) || u.when(g)) out.add(u.id);
  return out;
}

/** A screen that has just joined the bar and has not been announced yet. */
export function freshUnlock(g: GameState): { id: ScreenId; why: string } | null {
  if (!isSimple(g)) return null;
  const s = guidanceOf(g);
  return SCREEN_UNLOCKS.find((u) => !s.seen.includes(`unl:${u.id}`) && u.when(g)) ?? null;
}

export function hiddenCount(g: GameState): number {
  const v = visibleScreens(g);
  return v ? SCREEN_UNLOCKS.filter((u) => !v.has(u.id)).length : 0;
}
