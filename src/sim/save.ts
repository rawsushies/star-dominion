// Serialisation. GameState is plain JSON, so saving is JSON.stringify; loading
// validates the version and structure, then restores derived caches lazily.

import { SAVE_VERSION, updateStats } from './engine';
import type { GameState } from './types';

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (!s || typeof s !== 'object') throw new Error('Not a Star Dominion save');
  if (s.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${s.version} (expected ${SAVE_VERSION})`);
  for (const k of ['galaxy', 'planets', 'empires', 'fleets', 'rng'] as const) {
    if (!(k in s)) throw new Error(`Corrupt save: missing ${k}`);
  }
  updateStats(s);
  return s;
}

/** Cheap deterministic fingerprint of the whole state (used by tests and save metadata). */
export function fingerprint(state: GameState): string {
  const str = serialize(state);
  let h1 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h1 ^= str.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + ':' + str.length;
}
