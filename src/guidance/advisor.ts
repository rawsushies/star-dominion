// The advisor: Lord Admiral Fiona MacLeod, who presents the tutorial. She speaks recorded lines
// (voice-lines.json) only at important moments, each once per reign; everything else she says is
// text. Her spoken words are always shown on screen as well.

import type { GameState } from '../sim/types';
import LINES from './voice-lines.json';
import { audio } from '../audio/manager';
import { guidanceOf } from './state';

export const ADVISOR = { name: 'Fiona MacLeod', title: 'Lord Admiral' };

export type VoiceId = Exclude<keyof typeof LINES, '_comment'>;

/** The words of a recorded line. */
export function line(id: VoiceId): string {
  return (LINES as Record<string, string>)[id] ?? '';
}

export function hasLine(id: string): id is VoiceId {
  return id !== '_comment' && id in LINES;
}

/** Speak a line if it has not been spoken in this reign. Returns true when it was new. */
export function speakOnce(g: GameState, id: VoiceId): boolean {
  const s = guidanceOf(g);
  const key = `said:${id}`;
  if (s.seen.includes(key)) return false;
  s.seen.push(key);
  audio.say(id);
  return true;
}

/** Say it again (the replay button). */
export function replay(id: VoiceId) {
  audio.unlock();
  audio.say(id);
}
