import { describe, expect, it, vi } from 'vitest';
import manifest from '../src/audio/manifest.json';
import { existsSync, statSync } from 'node:fs';
import { AUDIO_DEFAULTS, loadAudioSettings, saveAudioSettings } from '../src/audio/settings';
import { AudioManager, Throttle } from '../src/audio/manager';
import { MusicEngine, CONTEXTS, chordNotes } from '../src/audio/music';
import { musicFor, sceneFor, commandSound, eventSound } from '../src/audio/director';
import { newGame } from '../src/sim/engine';
import type { UIState } from '../src/ui/store';

// ---------------------------------------------------------------- a minimal fake Web Audio graph

class Param {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
let liveSources = 0;
class Node {
  gain = new Param(); frequency = new Param(); detune = new Param(); Q = new Param(); pan = new Param(); delayTime = new Param(); playbackRate = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  type = ''; buffer: unknown = null; loop = false; onended: (() => void) | null = null;
  connect(n: unknown) { return n; }
  disconnect() {}
  start() { liveSources++; }
  stop() { liveSources--; this.onended?.(); }
}
class FakeCtx {
  currentTime = 0; sampleRate = 8000; state: 'running' | 'suspended' = 'suspended'; destination = new Node();
  createGain() { return new Node(); } createDynamicsCompressor() { return new Node(); } createBufferSource() { return new Node(); }
  createOscillator() { return new Node(); } createBiquadFilter() { return new Node(); } createConvolver() { return new Node(); }
  createStereoPanner() { return new Node(); } createDelay() { return new Node(); }
  createBuffer(ch: number, n: number) { const d = Array.from({ length: ch }, () => new Float32Array(n)); return { duration: n / this.sampleRate, getChannelData: (i: number) => d[i] }; }
  decodeAudioData() { return Promise.resolve({ duration: 1 }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
const fakeCtx = () => new FakeCtx() as unknown as AudioContext;

// ---------------------------------------------------------------- tests

describe('audio settings', () => {
  it('defaults, clamps and survives corrupt or missing storage', () => {
    expect(loadAudioSettings(null)).toEqual(AUDIO_DEFAULTS);
    expect(loadAudioSettings({ getItem: () => '{not json' })).toEqual(AUDIO_DEFAULTS);
    expect(loadAudioSettings({ getItem: () => JSON.stringify({ master: 3, music: -1, sfx: 0.25, muted: true }) })).toMatchObject({ master: 1, music: 0, sfx: 0.25, muted: true, ambient: AUDIO_DEFAULTS.ambient });
    const store: Record<string, string> = {};
    saveAudioSettings({ ...AUDIO_DEFAULTS, music: 0.1 }, { setItem: (k, v) => { store[k] = v; } });
    expect(loadAudioSettings({ getItem: (k) => store[k] ?? null }).music).toBe(0.1);
    expect(() => saveAudioSettings(AUDIO_DEFAULTS, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
  });
});

describe('throttling', () => {
  it('enforces a minimum gap, a per-sound voice limit and a global cap', () => {
    const t = new Throttle();
    expect(t.allow('a', 0, 100, 2)).toBe(true);
    expect(t.allow('a', 50, 100, 2)).toBe(false); // too soon
    expect(t.allow('a', 150, 100, 2)).toBe(true);
    expect(t.allow('a', 300, 100, 2)).toBe(false); // two voices live
    t.release('a');
    expect(t.allow('a', 400, 100, 2)).toBe(true);
    const c = new Throttle();
    for (let i = 0; i < 5; i++) expect(c.allow(`s${i}`, 0, 0, 9, 5)).toBe(true);
    expect(c.allow('s9', 0, 0, 9, 5)).toBe(false);
  });
});

describe('sound assets', () => {
  it('every sound in the manifest exists in both formats, with a licence', () => {
    for (const [id, s] of Object.entries(manifest.sounds)) {
      expect(s.license, id).toBe('CC0 1.0');
      expect(s.author).toMatch(/Kenney/);
      for (const f of s.files) for (const ext of ['ogg', 'm4a']) {
        const p = `public/assets/audio/sfx/${f.file}.${ext}`;
        expect(existsSync(p), p).toBe(true);
        expect(statSync(p).size).toBeLessThan(200_000);
      }
    }
  });
});

describe('audio manager', () => {
  it('does nothing until unlocked, then builds the buses once', () => {
    const m = new AudioManager(fakeCtx, '/x/');
    expect(m.play('ui.click')).toBe(false); // locked: silent, no error
    m.unlock();
    expect(m.ctx).not.toBeNull();
    const ctx = m.ctx;
    m.unlock();
    expect(m.ctx).toBe(ctx); // never a second context
    expect(m.buses.music && m.buses.sfx && m.buses.ambient).toBeTruthy();
  });

  it('reports unsupported browsers instead of failing', () => {
    const m = new AudioManager(() => null, '/x/');
    m.unlock();
    expect(m.state).toBe('unsupported');
    expect(m.play('ui.click')).toBe(false);
  });

  it('skips a missing file once and keeps playing others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn((url: string) => Promise.resolve(url.includes('ui.error') ? { ok: false, status: 404 } : { ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }));
    vi.stubGlobal('fetch', fetchMock);
    const m = new AudioManager(fakeCtx, '/x/');
    m.unlock();
    expect(m.play('ui.error')).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(m.failed.has('ui.error')).toBe(true);
    expect(m.voices('ui.error')).toBe(0); // the reserved voice was released
    expect(m.play('ui.confirm')).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(m.failed.size).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  it('mutes globally and respects bus volumes', () => {
    const m = new AudioManager(fakeCtx, '/x/');
    m.unlock();
    m.set({ muted: true });
    expect(m.audible('sfx')).toBe(false);
    expect(m.play('ui.click')).toBe(false);
    m.set({ muted: false, sfx: 0 });
    expect(m.audible('sfx')).toBe(false);
    expect(m.audible('music')).toBe(true);
    m.reset();
    expect(m.settings).toEqual(AUDIO_DEFAULTS);
  });
});

describe('generative music', () => {
  it('builds chords inside the mode', () => {
    const c = chordNotes(CONTEXTS.peace, 0, false);
    expect(c.map((n) => n - CONTEXTS.peace.root)).toEqual([0, 4, 7]); // a major triad on the tonic of an ionian context
    expect(chordNotes(CONTEXTS.war, 0, false).map((n) => n - CONTEXTS.war.root)).toEqual([0, 3, 7]);
  });

  it('crossfades without duplicating sections', () => {
    vi.useFakeTimers();
    const ctx = new FakeCtx() as unknown as AudioContext;
    const out = (ctx as unknown as FakeCtx).createGain() as unknown as AudioNode;
    const m = new MusicEngine(ctx, out);
    m.play('galaxy');
    m.play('galaxy'); // same context: no new section
    expect(m.liveSections).toBe(1);
    m.play('war');
    expect(m.liveSections).toBe(1); // the old one is fading, no longer live
    expect(m.current).toBe('war');
    for (const id of Object.keys(CONTEXTS) as (keyof typeof CONTEXTS)[]) m.play(id);
    expect(m.liveSections).toBe(1);
    m.stinger('era'); m.stinger('war'); m.stinger('mega'); m.stinger('triumph'); m.stinger('defeat');
    m.stop();
    expect(m.liveSections).toBe(0);
    vi.useRealTimers();
  });
});

describe('audio director', () => {
  const g = newGame({ seed: 3, galaxySize: 'small', aiCount: 2 });
  const view = (p: Partial<UIState>) => ({ game: g, screen: 'map', view: 'galaxy', windows: [], ...p }) as unknown as UIState;
  it('chooses music from what the player sees and what the realm lives through', () => {
    expect(musicFor(view({ game: null }))).toBe('menu');
    expect(musicFor(view({}))).toBe('galaxy');
    expect(musicFor(view({ screen: 'capital', windows: [{ id: 'capital', min: false }] as unknown as UIState['windows'] }))).toBe('capital');
    expect(musicFor(view({ screen: 'diplomacy', windows: [{ id: 'diplomacy', min: false }] as unknown as UIState['windows'] }))).toBe('diplomacy');
    expect(musicFor(view({ screen: 'economy', windows: [{ id: 'economy', min: false }] as unknown as UIState['windows'] }))).toBe('peace');
    // a minimised window is not what the player is looking at
    expect(musicFor(view({ screen: 'capital', windows: [{ id: 'capital', min: true }] as unknown as UIState['windows'] }))).toBe('galaxy');
    const rival = g.empires.find((e) => e.kind === 'major' && e.id !== g.playerId)!;
    g.wars.push({ id: 999, attackers: [rival.id], defenders: [g.playerId], startTick: 0, score: 0, name: 'Test war' });
    expect(musicFor(view({ screen: 'capital', windows: [{ id: 'capital', min: false }] as unknown as UIState['windows'] }))).toBe('war');
    g.wars.pop();
  });

  it('chooses ambience', () => {
    expect(sceneFor(view({ game: null }))).toBe('none');
    expect(sceneFor(view({}))).toBe('space');
    expect(sceneFor(view({ view: 'system' }))).toBe('orbit');
    expect(sceneFor(view({ screen: 'capital', windows: [{ id: 'capital', min: false }] as unknown as UIState['windows'] }))).toBe('city');
    expect(sceneFor(view({ screen: 'fleets', windows: [{ id: 'fleets', min: false }] as unknown as UIState['windows'] }))).toBe('fleet');
  });

  it('maps commands and events to sounds', () => {
    expect(commandSound({ type: 'queueBuilding', planetId: 0, building: 'mining' }, { ok: true })).toEqual({ sound: 'build.start' });
    expect(commandSound({ type: 'queueBuilding', planetId: 0, building: 'mining' }, { ok: false, message: 'x' })).toEqual({ sound: 'ui.error' });
    expect(commandSound({ type: 'declareWar', target: 1 }, { ok: true })).toEqual({ stinger: 'war' });
    const ev = (kind: string, extra: Partial<{ empires: number[]; title: string; text: string; severity: 'good' }> = {}) => ({ id: 1, tick: 0, kind, severity: 'info' as const, title: '', text: '', empires: [g.playerId], ...extra });
    expect(eventSound(ev('research'), g).sound).toBe('research.done');
    expect(eventSound(ev('research', { empires: [99] }), g).sound).toBeUndefined();
    expect(eventSound(ev('era'), g).stinger).toBe('era');
    expect(eventSound(ev('battle'), g)).toMatchObject({ sound: 'combat.distant' });
    expect(eventSound(ev('megastructure', { title: 'Dyson Swarm: stage 3/3 complete', text: 'The Dyson Swarm at X is fully operational.' }), g)).toEqual({ sound: 'mega.stage', stinger: 'mega' });
    expect(eventSound(ev('gameover', { empires: [] }), g).stinger).toBe('defeat');
  });
});
