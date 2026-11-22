// The audio manager: one AudioContext for the whole game, created or resumed after the first
// user gesture (browser autoplay rules), with master, music, effects and ambience buses.
// Sound effects are decoded once and cached; each sound has a minimum gap and a voice limit,
// and the whole mix has a voice cap, so bursts of events never pile up. A missing or unsupported
// file is reported once and then skipped: the game is fully playable with no audio at all.

import manifest from './manifest.json';
import { AUDIO_DEFAULTS, loadAudioSettings, saveAudioSettings, type AudioSettings } from './settings';

export type Bus = 'music' | 'sfx' | 'ambient';
export type SoundId = keyof typeof manifest.sounds;

interface SoundRule { gap: number; voices: number; volume: number; bus: Bus }
const RULES: Partial<Record<SoundId, Partial<SoundRule>>> = {
  'ui.hover': { gap: 70, voices: 1, volume: 0.5 },
  'ui.click': { gap: 40, voices: 2 },
  'ui.open': { gap: 120, voices: 1 },
  'ui.close': { gap: 120, voices: 1 },
  'combat.laser': { gap: 90, voices: 3 },
  'combat.explosion': { gap: 160, voices: 2 },
  'combat.distant': { gap: 600, voices: 1 },
  'notify.info': { gap: 800 }, 'notify.good': { gap: 800 }, 'notify.warn': { gap: 1200 }, 'notify.danger': { gap: 1500 },
  'mega.stage': { gap: 3000, voices: 1 },
  'amb.metal': { bus: 'ambient', gap: 1500, voices: 2 },
};
const DEFAULT_RULE: SoundRule = { gap: 60, voices: 3, volume: 1, bus: 'sfx' };
export function ruleFor(id: SoundId): SoundRule { return { ...DEFAULT_RULE, ...RULES[id] }; }

const MAX_VOICES = 24;

/** Per-sound throttle: minimum gap between plays and a cap on simultaneous voices. Pure, testable. */
export class Throttle {
  private last = new Map<string, number>();
  private live = new Map<string, number>();
  total = 0;
  allow(id: string, now: number, gap: number, voices: number, cap = MAX_VOICES): boolean {
    if (now - (this.last.get(id) ?? -1e9) < gap) return false;
    if ((this.live.get(id) ?? 0) >= voices || this.total >= cap) return false;
    this.last.set(id, now);
    this.live.set(id, (this.live.get(id) ?? 0) + 1);
    this.total++;
    return true;
  }
  release(id: string) {
    this.live.set(id, Math.max(0, (this.live.get(id) ?? 0) - 1));
    this.total = Math.max(0, this.total - 1);
  }
  voices(id: string) { return this.live.get(id) ?? 0; }
}

type Listener = () => void;

export class AudioManager {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  buses: Partial<Record<Bus, GainNode>> = {};
  /** music ducking (stingers lower the music under them) */
  duck: GainNode | null = null;
  settings: AudioSettings;
  state: 'locked' | 'running' | 'suspended' | 'unsupported' = 'locked';
  readonly failed = new Set<string>();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private throttle = new Throttle();
  private listeners = new Set<Listener>();
  private readyFns: ((ctx: AudioContext) => void)[] = [];
  private ext: string | null = null;
  private base: string;
  private voiceGain: GainNode | null = null;
  private voiceSrc: AudioBufferSourceNode | null = null;
  private voiceBuffers = new Map<string, Promise<AudioBuffer | null>>();
  /** the line being spoken, for the UI (null when silent) */
  speaking: string | null = null;

  constructor(private makeContext: () => AudioContext | null = defaultContext, base = (import.meta.env?.BASE_URL ?? '/') + 'assets/audio/sfx/') {
    this.settings = loadAudioSettings();
    this.base = base;
  }

  /** Called on the first user gesture: creates (or resumes) the context and wires the buses. */
  unlock() {
    if (this.state === 'unsupported') return;
    if (!this.ctx) {
      let ctx: AudioContext | null = null;
      try { ctx = this.makeContext(); } catch { ctx = null; }
      if (!ctx) { this.state = 'unsupported'; this.emit(); return; }
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      // a gentle limiter keeps stacked sounds from clipping
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
      comp.connect(this.master);
      for (const b of ['music', 'sfx', 'ambient'] as Bus[]) { const g = ctx.createGain(); g.connect(comp); this.buses[b] = g; }
      this.voiceGain = ctx.createGain(); this.voiceGain.connect(comp);
      this.duck = ctx.createGain();
      this.duck.connect(this.buses.music!);
      this.applyVolumes(true);
      const fns = this.readyFns; this.readyFns = [];
      for (const f of fns) { try { f(ctx); } catch { /* an engine failing to start must not break audio */ } }
    }
    if (this.ctx.state === 'suspended' && !this.settings.muted) this.ctx.resume().catch(() => {});
    this.state = this.settings.muted ? 'suspended' : 'running';
    this.emit();
  }

  /** Run `fn` with the context as soon as audio is unlocked (immediately if it already is). */
  whenReady(fn: (ctx: AudioContext) => void) {
    if (this.ctx) fn(this.ctx);
    else this.readyFns.push(fn);
  }

  bus(b: Bus): AudioNode | null { return b === 'music' ? this.duck : this.buses[b] ?? null; }

  set(p: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...p };
    saveAudioSettings(this.settings);
    this.applyVolumes();
    this.emit();
  }

  reset() { this.set({ ...AUDIO_DEFAULTS }); }

  private applyVolumes(instant = false) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const s = this.settings;
    const t = ctx.currentTime, k = instant ? 0.001 : 0.08;
    // perceptual curve: slider position squared
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master * s.master, t, k);
    this.buses.music?.gain.setTargetAtTime(s.music * s.music, t, k);
    this.buses.sfx?.gain.setTargetAtTime(s.sfx * s.sfx, t, k);
    this.buses.ambient?.gain.setTargetAtTime(s.ambient * s.ambient, t, k);
    this.voiceGain?.gain.setTargetAtTime(s.voice * s.voice, t, k);
    // a muted or silent mix suspends the context, which stops all audio processing
    const silent = s.muted || s.master === 0;
    if (silent && ctx.state === 'running') { setTimeout(() => { if ((this.settings.muted || this.settings.master === 0) && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 200); this.state = 'suspended'; }
    else if (!silent && ctx.state === 'suspended' && this.state !== 'locked') { ctx.resume().catch(() => {}); this.state = 'running'; }
  }

  /** Is anything audible on this bus? (no work is done for silent buses) */
  audible(b: Bus): boolean {
    const s = this.settings;
    return !!this.ctx && !s.muted && s.master > 0 && (b === 'music' ? s.music : b === 'sfx' ? s.sfx : s.ambient) > 0;
  }

  private extension(): string {
    if (this.ext) return this.ext;
    try {
      const a = typeof Audio !== 'undefined' ? new Audio() : null;
      this.ext = a && a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
    } catch { this.ext = 'ogg'; }
    return this.ext;
  }

  /** Decode (once) and cache a file; resolves null when it is missing or cannot be decoded. */
  buffer(file: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    let p = this.buffers.get(file);
    if (!p) {
      const url = `${this.base}${file}.${this.extension()}`;
      p = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
        .then((data) => ctx.decodeAudioData(data))
        .catch((err: unknown) => {
          if (!this.failed.has(file)) { this.failed.add(file); console.warn(`[audio] ${file} unavailable (${err instanceof Error ? err.message : String(err)}); continuing without it`); }
          return null;
        });
      this.buffers.set(file, p);
    }
    return p;
  }

  /** Warm the cache for the sounds that should respond instantly. */
  preload(ids: SoundId[]) { for (const id of ids) for (const f of manifest.sounds[id].files) void this.buffer(f.file); }

  /** Play a sound effect. Returns false when it was throttled, silent or unavailable. */
  play(id: SoundId, opt: { volume?: number; pan?: number; rate?: number; delay?: number } = {}): boolean {
    const def = manifest.sounds[id];
    const rule = ruleFor(id);
    const ctx = this.ctx;
    if (!def || !ctx || !this.audible(rule.bus)) return false;
    if (!this.throttle.allow(id, performance.now(), rule.gap, rule.voices)) return false;
    const file = def.files[Math.floor(Math.random() * def.files.length)].file;
    void this.buffer(file).then((buf) => {
      if (!buf || !this.ctx) { this.throttle.release(id); return; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = (opt.rate ?? 1) * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.value = rule.volume * (opt.volume ?? 1);
      let node: AudioNode = g;
      if (opt.pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = opt.pan; g.connect(p); node = p; }
      src.connect(g);
      node.connect(this.bus(rule.bus)!);
      src.onended = () => { this.throttle.release(id); src.disconnect(); g.disconnect(); if (node !== g) node.disconnect(); };
      src.start(ctx.currentTime + (opt.delay ?? 0));
    });
    return true;
  }

  /**
   * The advisor speaks a recorded line (public/assets/audio/voice/<id>). A new line cuts off the
   * one before; music dips underneath. Returns false when silent or unavailable.
   */
  say(id: string, onEnd?: () => void): boolean {
    const ctx = this.ctx;
    const s = this.settings;
    if (!ctx || s.muted || s.master === 0 || s.voice === 0 || !this.voiceGain) return false;
    this.hush();
    let p = this.voiceBuffers.get(id);
    if (!p) {
      const url = `${(import.meta.env?.BASE_URL ?? '/')}assets/audio/voice/${id}.${this.extension()}`;
      p = fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then((d) => ctx.decodeAudioData(d)).catch(() => null);
      this.voiceBuffers.set(id, p);
    }
    this.speaking = id;
    this.emit();
    void p.then((buf) => {
      if (!buf || this.speaking !== id || !this.voiceGain) { if (this.speaking === id) { this.speaking = null; this.emit(); } return; }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceGain);
      const t = ctx.currentTime;
      this.duck?.gain.setTargetAtTime(0.35, t, 0.15);
      src.onended = () => {
        src.disconnect();
        if (this.voiceSrc !== src) return;
        this.voiceSrc = null; this.speaking = null;
        this.duck?.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
        this.emit();
        onEnd?.();
      };
      this.voiceSrc = src;
      src.start(t + 0.05);
    });
    return true;
  }

  /** Stop the advisor mid-line. */
  hush() {
    const src = this.voiceSrc;
    this.voiceSrc = null;
    if (src) { try { src.stop(); } catch { /* already stopped */ } src.disconnect(); }
    if (this.ctx) this.duck?.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
    if (this.speaking) { this.speaking = null; this.emit(); }
  }

  /** A looping sample on a bus, faded in; returns a stop function that fades it out. */
  loop(id: SoundId, bus: Bus, volume: number, fade = 2.5): () => void {
    const ctx = this.ctx;
    const def = manifest.sounds[id];
    if (!ctx || !def) return () => {};
    let stopped = false;
    let src: AudioBufferSourceNode | null = null;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.bus(bus)!);
    void this.buffer(def.files[0].file).then((buf) => {
      if (!buf || stopped) return;
      src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      src.connect(g);
      src.start(ctx.currentTime, Math.random() * buf.duration);
      g.gain.setTargetAtTime(volume, ctx.currentTime, fade / 3);
    });
    return () => {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, fade / 3);
      setTimeout(() => { try { src?.stop(); } catch { /* already stopped */ } src?.disconnect(); g.disconnect(); }, fade * 1000 + 200);
    };
  }

  onChange(fn: Listener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { for (const l of this.listeners) l(); }

  /** Live voices of a sound (tests and diagnostics). */
  voices(id: SoundId) { return this.throttle.voices(id); }
}

function defaultContext(): AudioContext | null {
  const W = typeof window !== 'undefined' ? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }) : null;
  const C = W?.AudioContext ?? W?.webkitAudioContext;
  return C ? new C({ latencyHint: 'interactive' }) : null;
}

/** The game's single audio manager. */
export const audio = new AudioManager();

/** Unlock audio on the first real user gesture (autoplay rules); safe to call more than once. */
export function installAudioUnlock(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window) {
  const go = () => { audio.unlock(); if (audio.ctx?.state === 'running' || audio.state === 'unsupported') off(); };
  const off = () => { for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) target.removeEventListener(ev, go, true); };
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) target.addEventListener(ev, go, true);
}
