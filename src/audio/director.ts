// The audio director connects the game to the audio manager: it chooses the musical context and
// the ambience from what the player is looking at and what is happening to the realm, and turns
// player commands, realm events and interface actions into sound effects. All choices are pure
// functions of state (musicFor, sceneFor, commandSound, eventSound) so they can be tested.

import type { GameEvent, GameState } from '../sim/types';
import type { Command, CommandResult } from '../sim/commands';
import { useUI, onCommand, onPlayerEvents, type UIState } from '../ui/store';
import { audio, type SoundId } from './manager';
import { MusicEngine, type MusicContext, type Stinger } from './music';
import { AmbienceEngine, type AmbientScene } from './ambience';

type View = Pick<UIState, 'game' | 'screen' | 'view' | 'windows'>;

const DIPLOMATIC: string[] = ['diplomacy', 'council', 'intel', 'throne'];
const MILITARY: string[] = ['fleets', 'military', 'warroom'];

export function atWar(g: GameState): boolean {
  return g.wars.some((w) => w.attackers.includes(g.playerId) || w.defenders.includes(g.playerId));
}

/** The musical context for what the player sees and what the realm is living through. */
export function musicFor(s: View): MusicContext {
  const g = s.game;
  if (!g) return 'menu';
  if (atWar(g)) return 'war';
  const focus = s.windows.some((w) => w.id === s.screen && !w.min) ? s.screen : s.view === 'capital' ? 'capital' : 'map';
  const me = g.empires[g.playerId];
  if (focus === 'capital') return 'capital';
  if (DIPLOMATIC.includes(focus)) return 'diplomacy';
  if (focus === 'construction' || focus === 'system') {
    if (g.galaxy.systems.some((sys) => sys.megastructures.some((m) => m.ownerId === g.playerId && m.building))) return 'mega';
  }
  if ((me?.era ?? 0) >= 3) return 'late';
  if (focus === 'map') return 'galaxy';
  return 'peace';
}

/** The ambient bed. */
export function sceneFor(s: View): AmbientScene {
  if (!s.game) return 'none';
  const focus = s.windows.some((w) => w.id === s.screen && !w.min) ? s.screen : s.view === 'capital' ? 'capital' : 'map';
  if (focus === 'capital') return 'city';
  if (MILITARY.includes(focus)) return 'fleet';
  if (s.view === 'system' || s.view === 'planet') return 'orbit';
  return 'space';
}

const CMD_SOUND: Partial<Record<Command['type'], SoundId>> = {
  queueBuilding: 'build.start', capitalBuild: 'build.start', queueShip: 'build.start', buildStation: 'build.start', upgradeOperation: 'build.start', upgradeStarbase: 'build.start', startMegastructure: 'build.start',
  setResearch: 'ui.confirm', queueResearch: 'ui.confirm',
  recruitCharacter: 'recruit', recruitAdmiral: 'recruit',
  assignCharacter: 'character', learnSkill: 'character', equipItem: 'character', unequipItem: 'character', designateHeir: 'character', captive: 'character', payRansom: 'character', commissionItem: 'build.start', launchCovert: 'character',
  moveFleet: 'fleet.order', fleetOrder: 'fleet.order', mergeFleets: 'fleet.order', splitFleet: 'fleet.order', setStance: 'ui.toggle', assignAdmiral: 'character',
  market: 'res.trade',
  propose: 'diplomacy', proposeContract: 'diplomacy', respondProposal: 'treaty', proposePeace: 'diplomacy',
  issueDecree: 'ui.confirm', resolvePetition: 'ui.confirm', houseAction: 'ui.confirm', setPolicy: 'ui.toggle', changeGovernment: 'treaty', setDesignation: 'ui.confirm', setOperationMode: 'ui.toggle',
  demolish: 'ui.close', cancelQueue: 'ui.close', capitalCancel: 'ui.close', dequeueResearch: 'ui.close', revokeDecree: 'ui.close', cancelCovert: 'ui.close', breakTreaty: 'notify.warn', disbandFleet: 'ui.close', dismissCharacter: 'ui.close', dismantleOperation: 'ui.close',
};

/** The sound for a player command (or a stinger for declaring war). */
export function commandSound(c: Command, r: CommandResult): { sound?: SoundId; stinger?: Stinger } {
  if (!r.ok) return { sound: 'ui.error' };
  if (c.type === 'declareWar') return { stinger: 'war' };
  return { sound: CMD_SOUND[c.type] };
}

/** The sound for a realm event the player is told about. */
export function eventSound(ev: GameEvent, g: GameState): { sound?: SoundId; stinger?: Stinger; extra?: SoundId[] } {
  const playerId = g.playerId;
  const mine = ev.empires.includes(playerId);
  switch (ev.kind) {
    case 'era': return mine ? { stinger: 'era' } : {};
    case 'victory': return { stinger: 'triumph' };
    case 'gameover': return { stinger: 'defeat' };
    case 'war': return mine ? { stinger: 'war' } : { sound: 'notify.warn' };
    case 'research': return mine ? { sound: 'research.done' } : {};
    case 'megastructure': {
      const ours = mine || (ev.systemId != null && g.galaxy.systems[ev.systemId]?.owner === playerId);
      if (!ours || !/stage \d+\/\d+ complete/i.test(ev.title)) return {};
      return { sound: 'mega.stage', stinger: /fully operational/i.test(ev.text) ? 'mega' : undefined };
    }
    case 'battle': return mine ? { sound: 'combat.distant', extra: ['combat.laser', 'combat.explosion'] } : {};
    case 'invasion': case 'capture': return mine ? { sound: 'combat.explosion' } : {};
    case 'colony': case 'outpost': case 'construction': case 'shipyard': case 'starbase': case 'capital': return mine ? { sound: ev.severity === 'warn' || ev.severity === 'danger' ? 'notify.warn' : 'build.done' } : {};
    case 'treaty': case 'peace': return mine ? { sound: 'treaty' } : {};
    case 'diplomacy': return mine ? { sound: 'diplomacy' } : {};
    case 'character': return mine ? { sound: ev.severity === 'danger' ? 'notify.danger' : 'character' } : {};
    case 'trade': return mine ? { sound: 'res.trade' } : {};
    default:
      if (!mine) return {};
      return { sound: ev.severity === 'danger' ? 'notify.danger' : ev.severity === 'warn' ? 'notify.warn' : ev.severity === 'good' ? 'notify.good' : undefined };
  }
}

const PRIORITY: Partial<Record<SoundId, number>> = { 'notify.danger': 5, 'combat.explosion': 4, 'mega.stage': 4, 'research.done': 3, 'notify.warn': 3, 'combat.distant': 3, treaty: 2, 'build.done': 1 };

let music: MusicEngine | null = null;
let ambience: AmbienceEngine | null = null;
let installed = false;

/** Wire audio to the game. Idempotent: calling it twice installs nothing twice. */
export function installAudioDirector() {
  if (installed) return;
  installed = true;
  audio.whenReady((ctx) => {
    music = new MusicEngine(ctx, audio.buses.music!, audio.duck!);
    ambience = new AmbienceEngine(ctx, audio.buses.ambient!, audio);
    audio.preload(['ui.click', 'ui.hover', 'ui.open', 'ui.close', 'ui.confirm', 'ui.error', 'ui.select']);
    sync(true);
  });

  // musical context and ambience follow the interface, with a little patience so that flicking
  // between windows does not churn the music
  let pending: MusicContext | null = null;
  let pendingSince = 0;
  const sync = (force = false) => {
    if (!music || !ambience) return;
    const s = useUI.getState();
    const want = musicFor(s);
    const now = performance.now();
    if (want !== music.current) {
      const urgent = want === 'war' || want === 'menu' || music.current === 'menu' || music.current === null;
      if (pending !== want) { pending = want; pendingSince = now; }
      if (force || urgent || now - pendingSince > 5000) { music.play(want, urgent ? 3 : 6); pending = null; }
    } else pending = null;
    ambience.set(audio.audible('ambient') ? sceneFor(s) : 'none');
  };
  useUI.subscribe((st, prev) => {
    if (st.screen !== prev.screen || st.view !== prev.view || st.windows !== prev.windows || st.game !== prev.game) sync();
    // window open/close and map selection
    if (st.windows.length > prev.windows.length) audio.play('ui.open');
    else if (st.windows.length < prev.windows.length) audio.play('ui.close');
    if (st.systemId !== prev.systemId && st.systemId != null && st.game === prev.game) audio.play('ui.select', { volume: 0.7 });
  });
  setInterval(() => sync(), 2000); // wars start and end while the interface is still
  audio.onChange(() => sync());

  onCommand((c, r) => {
    const out = commandSound(c, r);
    if (out.stinger) music?.stinger(out.stinger);
    if (out.sound) audio.play(out.sound);
  });

  onPlayerEvents((events) => {
    const g = useUI.getState().game;
    if (!g) return;
    let best: { sound: SoundId; extra?: SoundId[] } | null = null;
    for (const ev of events) {
      const out = eventSound(ev, g);
      if (out.stinger) music?.stinger(out.stinger);
      if (out.sound && (!best || (PRIORITY[out.sound] ?? 0) > (PRIORITY[best.sound] ?? 0))) best = { sound: out.sound, extra: out.extra };
    }
    // one sound per burst of events (the most important), plus its accompaniment
    if (best) {
      audio.play(best.sound);
      best.extra?.forEach((x, i) => audio.play(x, { delay: 0.25 + i * 0.35, volume: 0.6, pan: Math.random() - 0.5 }));
    }
  });

  // interface: clicks and hovers on buttons, delegated once for the whole document
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement | null)?.closest('button, [role="button"], .li, .tab, select, input[type="checkbox"], input[type="range"]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if ((el as HTMLInputElement).type === 'range') return; // sliders preview their own bus
    audio.play('ui.click');
  }, true);
  let lastHover: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest('.neo-btn, .btn, .slot, .spd');
    if (!el || el === lastHover || (el as HTMLButtonElement).disabled) return;
    lastHover = el;
    audio.play('ui.hover');
  }, true);
}

/** For tests and diagnostics. */
export function audioDebug() {
  return { music: music?.current ?? null, sections: music?.liveSections ?? 0, scene: ambience?.scene ?? null, state: audio.state, ctx: audio.ctx?.state ?? null, failed: [...audio.failed] };
}

/** Play a stinger directly (used by the era dawn screen). */
export function playStinger(kind: Stinger) { music?.stinger(kind); }
