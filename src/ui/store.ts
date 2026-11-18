// UI state and the real-time loop. The GameState lives outside React and is
// mutated only by the engine (step) and the command layer (execute). React
// re-renders on a throttled revision counter.

import { create } from 'zustand';
import { newGame as createGame, step } from '../sim/engine';
import { execute, type Command, type CommandResult } from '../sim/commands';
import { serialize, deserialize } from '../sim/save';
import { writeSave, readSave } from '../persistence/idb';
import { cloudUser, cloudWrite, cloudRead } from '../persistence/cloud';
import type { GameEvent, GameSettings, GameState } from '../sim/types';

export type ScreenId =
  | 'map' | 'kingdom' | 'planets' | 'system' | 'fleets' | 'military' | 'economy' | 'industry'
  | 'research' | 'diplomacy' | 'intel' | 'construction' | 'trade' | 'journal' | 'techtree' | 'heroes' | 'council';

export type MapMode = 'political' | 'resources' | 'military' | 'trade' | 'supply';

export const SPEEDS = [0, 2, 6, 15]; // days per second

export interface Toast { id: number; ev: GameEvent }

export interface Win { id: Exclude<ScreenId, 'map'>; x: number; y: number; w: number; h: number; z: number; min: boolean }

/** Default footprint of each window (fractions of the viewport, clamped in px). */
const WIN_SIZE: Partial<Record<ScreenId, [number, number]>> = {
  kingdom: [1040, 720], planets: [1120, 740], system: [980, 680], fleets: [980, 660], military: [1040, 700],
  economy: [1060, 700], industry: [1060, 720], research: [900, 660], techtree: [1180, 760], diplomacy: [1080, 720],
  intel: [940, 680], construction: [980, 660], trade: [940, 640], journal: [720, 640], heroes: [1120, 760], council: [1180, 780],
};

function placeWindow(id: Win['id'], wins: Win[], z: number): Win {
  const vw = window.innerWidth, vh = window.innerHeight;
  const [w0, h0] = WIN_SIZE[id] ?? [960, 660];
  const w = Math.min(w0, vw - 46 - 360 - 24 > 640 ? vw - 46 - 360 - 24 : vw - 70);
  const h = Math.min(h0, vh - 120);
  const k = wins.length % 6;
  const x = Math.max(56, Math.min(vw - w - 12, 64 + (vw - 46 - 360 - w) / 2 + k * 28));
  const y = Math.max(52, Math.min(vh - h - 12, 70 + k * 26));
  return { id, x, y, w, h, z, min: false };
}

export type UIState = UI;
interface UI {
  game: GameState | null;
  rev: number;
  speed: number;
  lastSpeed: number;
  screen: ScreenId;
  view: 'galaxy' | 'system' | 'planet';
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
  windows: Win[];
  eraSeen: number;
  zTop: number;
  focusWin: (id: Win['id']) => void;
  closeWin: (id: Win['id']) => void;
  patchWin: (id: Win['id'], p: Partial<Win>) => void;
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
  windows: [],
  eraSeen: 0,
  zTop: 10,
  focusWin: (id) => {
    const z = get().zTop + 1;
    set({ zTop: z, screen: id, windows: get().windows.map((w) => (w.id === id ? { ...w, z, min: false } : w)) });
  },
  closeWin: (id) => {
    const rest = get().windows.filter((w) => w.id !== id);
    const top = rest.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0];
    set({ windows: rest, screen: get().screen === id ? (top?.id ?? 'map') : get().screen });
  },
  patchWin: (id, p) => set({ windows: get().windows.map((w) => (w.id === id ? { ...w, ...p } : w)) }),
  start: (s) => {
    const g = createGame(s);
    lastEventId = g.nextId;
    set({ game: g, rev: 1, speed: 0, screen: 'map', windows: [], eraSeen: g.empires[g.playerId].era ?? 0, view: 'galaxy', systemId: g.empires[g.playerId].capitalSystemId, planetId: null, fleetId: null, toasts: [] });
  },
  load: (g) => {
    lastEventId = g.nextId;
    set({ game: g, rev: get().rev + 1, speed: 0, screen: 'map', windows: [], eraSeen: g.empires[g.playerId].era ?? 0, view: 'galaxy', systemId: g.empires[g.playerId].capitalSystemId, planetId: null, fleetId: null, toasts: [], menuOpen: false });
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
  openScreen: (s) => {
    if (s === 'map') { set({ screen: 'map' }); return; }
    const w = get().windows.find((x) => x.id === s);
    // toggling the focused, visible window from the neocom closes it
    if (w && get().screen === s && !w.min) { get().closeWin(s); return; }
    set({ screen: s });
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  notify: (msg) => {
    set({ flash: msg });
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => set({ flash: null }), 2600);
  },
}));

// Keep the window list in step with `screen`: focusing a screen opens its window;
// navigating to the map from inside a window closes the window that did it.
useUI.subscribe((st, prev) => {
  if (st.screen === prev.screen) return;
  if (st.screen !== 'map') {
    const id = st.screen;
    const have = st.windows.find((w) => w.id === id);
    const z = st.zTop + 1;
    if (!have) useUI.setState({ zTop: z, windows: [...st.windows, placeWindow(id, st.windows, z)] });
    else if (have.z !== st.zTop || have.min) useUI.setState({ zTop: z, windows: st.windows.map((w) => (w.id === id ? { ...w, z, min: false } : w)) });
  } else if (prev.screen !== 'map' && st.windows.some((w) => w.id === prev.screen) && st.windows === prev.windows) {
    useUI.setState({ windows: st.windows.filter((w) => w.id !== prev.screen) });
  }
});

let flashTimer = 0;
let lastEventId = 0;

const TOAST_KINDS = new Set(['era', 'war', 'peace', 'invasion', 'colony', 'research', 'rebellion', 'battle', 'fall', 'treaty', 'shortage', 'outpost', 'megastructure', 'raiders', 'diplomacy', 'victory', 'gameover', 'unrest', 'capture', 'discovery', 'trade']);
const PAUSE_KINDS = new Set(['era', 'war', 'invasion', 'rebellion', 'gameover', 'victory', 'unrest']);

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
  const meta = { slot, name, realm: g.empires[g.playerId].name, tick: g.tick };
  const data = serialize(g);
  await writeSave(meta, data);
  if (cloudUser()) await cloudWrite(meta, data);
}

async function autosave(g: GameState) {
  const meta = { slot: 'autosave', name: 'Autosave', realm: g.empires[g.playerId].name, tick: g.tick };
  const data = serialize(g);
  try { await writeSave(meta, data); } catch { /* local storage unavailable */ }
  if (cloudUser()) cloudWrite(meta, data).catch(() => useUI.getState().notify('Cloud autosave failed; your local autosave is safe.'));
}

export async function loadGame(slot: string) {
  const data = await readSave(slot);
  if (!data) throw new Error('Save not found');
  useUI.getState().load(deserialize(data));
}

export async function loadCloudGame(slot: string) {
  const data = await cloudRead(slot);
  if (!data) throw new Error('Cloud save not found');
  useUI.getState().load(deserialize(data));
}

export function useGame(): GameState {
  const g = useUI((s) => s.game);
  useUI((s) => s.rev);
  return g!;
}
