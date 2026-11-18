// UI state and the real-time loop. The GameState lives outside React and is
// mutated only by the engine (step) and the command layer (execute). React
// re-renders on a throttled revision counter.

import { create } from 'zustand';
import { newGame as createGame, step } from '../sim/engine';
import { execute, type Command, type CommandResult } from '../sim/commands';
import { serialize, deserialize } from '../sim/save';
import { writeSave, readSave } from '../persistence/idb';
import type { GameEvent, GameSettings, GameState } from '../sim/types';

export type ScreenId =
  | 'map' | 'kingdom' | 'planets' | 'system' | 'fleets' | 'military' | 'economy' | 'industry'
  | 'research' | 'diplomacy' | 'intel' | 'construction' | 'trade' | 'journal' | 'techtree';

export type MapMode = 'political' | 'resources' | 'military' | 'trade' | 'supply';

export const SPEEDS = [0, 2, 6, 15]; // days per second

export interface Toast { id: number; ev: GameEvent }

interface UI {
  game: GameState | null;
  rev: number;
  speed: number;
  lastSpeed: number;
  screen: ScreenId;
  view: 'galaxy' | 'system';
  systemId: number | null;
  planetId: number | null;
  fleetId: number | null;
  mapMode: MapMode;
  toasts: Toast[];
  pendingOrder: null | { kind: 'move' | 'patrol' | 'outpost' | 'blockade'; fleetId: number };
  battleId: number | null;
  menuOpen: boolean;
  flash: string | null;
  pauseOnEvents: boolean;
  start: (s: Partial<GameSettings>) => void;
  load: (g: GameState) => void;
  quit: () => void;
  bump: () => void;
  setSpeed: (n: number) => void;
  togglePause: () => void;
  cmd: (c: Command) => CommandResult;
  set: (p: Partial<UI>) => void;
  selectSystem: (id: number | null, openView?: boolean) => void;
  selectPlanet: (id: number | null) => void;
  selectFleet: (id: number | null) => void;
  openScreen: (s: ScreenId) => void;
  dismissToast: (id: number) => void;
  notify: (msg: string) => void;
}

export const useUI = create<UI>((set, get) => ({
  game: null,
  rev: 0,
  speed: 0,
  lastSpeed: 1,
  screen: 'map',
  view: 'galaxy',
  systemId: null,
  planetId: null,
  fleetId: null,
  mapMode: 'political',
  toasts: [],
  pendingOrder: null,
  battleId: null,
  menuOpen: false,
  flash: null,
  pauseOnEvents: true,
  start: (s) => {
    const g = createGame(s);
    lastEventId = g.nextId;
    set({ game: g, rev: 1, speed: 0, screen: 'map', view: 'galaxy', systemId: g.empires[g.playerId].capitalSystemId, planetId: null, fleetId: null, toasts: [] });
  },
  load: (g) => {
    lastEventId = g.nextId;
    set({ game: g, rev: get().rev + 1, speed: 0, screen: 'map', view: 'galaxy', systemId: g.empires[g.playerId].capitalSystemId, planetId: null, fleetId: null, toasts: [], menuOpen: false });
  },
  quit: () => set({ game: null, speed: 0, menuOpen: false }),
  bump: () => set({ rev: get().rev + 1 }),
  setSpeed: (n) => set({ speed: n, lastSpeed: n > 0 ? n : get().lastSpeed }),
  togglePause: () => { const s = get(); set({ speed: s.speed > 0 ? 0 : s.lastSpeed || 1 }); },
  cmd: (c) => {
    const g = get().game;
    if (!g) return { ok: false, message: 'No game' };
    const r = execute(g, g.playerId, c);
    if (!r.ok && r.message) get().notify(r.message);
    set({ rev: get().rev + 1 });
    return r;
  },
  set: (p) => set(p),
  selectSystem: (id, openView) => set({ systemId: id, planetId: null, fleetId: null, ...(openView && id != null ? { view: 'system' } : {}) }),
  selectPlanet: (id) => {
    const g = get().game;
    set({ planetId: id, fleetId: null, systemId: id != null && g ? g.planets[id].systemId : get().systemId });
  },
  selectFleet: (id) => set({ fleetId: id, planetId: null }),
  openScreen: (s) => set({ screen: get().screen === s && s !== 'map' ? 'map' : s }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  notify: (msg) => {
    set({ flash: msg });
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => set({ flash: null }), 2600);
  },
}));

let flashTimer = 0;
let lastEventId = 0;

const TOAST_KINDS = new Set(['war', 'peace', 'invasion', 'colony', 'research', 'rebellion', 'battle', 'fall', 'treaty', 'shortage', 'outpost', 'megastructure', 'raiders', 'diplomacy', 'victory', 'gameover', 'unrest', 'capture', 'discovery', 'trade']);
const PAUSE_KINDS = new Set(['war', 'invasion', 'rebellion', 'gameover', 'victory', 'unrest']);

/** Real-time loop: advances the simulation according to speed and surfaces new events. */
export function startLoop() {
  let acc = 0;
  let last = performance.now();
  let lastBump = 0;
  let lastAutosave = 0;
  const frame = (now: number) => {
    const ui = useUI.getState();
    const g = ui.game;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (g && ui.speed > 0 && !(g.gameOver && !g.gameOver.won)) {
      acc += dt * SPEEDS[ui.speed];
      let steps = 0;
      const t0 = performance.now();
      while (acc >= 1 && steps < 30 && performance.now() - t0 < 24) {
        step(g);
        acc -= 1;
        steps++;
      }
      if (acc > 3) acc = 3; // don't spiral if the machine can't keep up
      if (steps) {
        surfaceEvents(g);
        if (now - lastBump > 110) { lastBump = now; useUI.setState({ rev: useUI.getState().rev + 1 }); }
        if (g.tick - lastAutosave >= 360) {
          lastAutosave = g.tick;
          autosave(g);
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function surfaceEvents(g: GameState) {
  const ui = useUI.getState();
  const fresh = g.events.filter((e) => e.id >= lastEventId && (e.empires.length === 0 || e.empires.includes(g.playerId)));
  if (!fresh.length) return;
  lastEventId = g.nextId;
  const toasts = ui.toasts.slice();
  let pause = false;
  for (const ev of fresh) {
    if (!TOAST_KINDS.has(ev.kind)) continue;
    // Battles elsewhere in the galaxy that don't involve us are noise.
    // Only toast what touches the crown directly, plus galaxy-shaking news.
    if (!ev.empires.includes(g.playerId) && !['war', 'victory', 'gameover'].includes(ev.kind)) continue;
    toasts.push({ id: ev.id, ev });
    if (ui.pauseOnEvents && PAUSE_KINDS.has(ev.kind) && (ev.empires.includes(g.playerId) || ev.kind === 'war' && ev.text.includes(g.empires[g.playerId].name) || ev.kind === 'gameover' || ev.kind === 'victory')) pause = true;
  }
  useUI.setState({ toasts: toasts.slice(-3), ...(pause ? { speed: 0 } : {}) });
  for (const t of toasts.slice(-3)) {
    if (!toastTimers.has(t.id)) {
      toastTimers.add(t.id);
      window.setTimeout(() => useUI.getState().dismissToast(t.id), 7000);
    }
  }
}
const toastTimers = new Set<number>();

export async function saveGame(slot: string, name: string) {
  const g = useUI.getState().game;
  if (!g) return;
  await writeSave({ slot, name, realm: g.empires[g.playerId].name, tick: g.tick }, serialize(g));
}

async function autosave(g: GameState) {
  try { await writeSave({ slot: 'autosave', name: 'Autosave', realm: g.empires[g.playerId].name, tick: g.tick }, serialize(g)); } catch { /* storage unavailable */ }
}

export async function loadGame(slot: string) {
  const data = await readSave(slot);
  if (!data) throw new Error('Save not found');
  useUI.getState().load(deserialize(data));
}

export function useGame(): GameState {
  const g = useUI((s) => s.game);
  useUI((s) => s.rev);
  return g!;
}
