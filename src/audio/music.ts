// Generative soundtrack. Original music composed at runtime with Web Audio synthesis: slow
// chord progressions on detuned pads, a formant "choir", FM bells, a bass line, ostinato plucks
// and low drums, in a shared convolution reverb. Each musical context (menu, exploration,
// capital, management, diplomacy, war, megastructure, late game) has its own key, mode,
// progression, tempo and instrumentation. Contexts crossfade over several seconds; stingers
// mark major events and duck the music under them. Nothing is sampled from existing recordings.

export type MusicContext = 'menu' | 'galaxy' | 'capital' | 'peace' | 'diplomacy' | 'war' | 'mega' | 'late';
export type Stinger = 'era' | 'war' | 'triumph' | 'defeat' | 'mega';

const MODES: Record<string, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

interface Layers { pad: number; choir: number; bell: number; bass: number; pluck: number; drum: number; brass: number }
export interface ContextDef {
  label: string;
  root: number; // MIDI note of the tonic (octave 3)
  mode: keyof typeof MODES;
  prog: number[]; // scale degrees of successive chords
  chord: number; // seconds per chord
  layers: Partial<Layers>;
  bright: number; // 0..1 pad filter brightness
  pluckRate?: 2 | 4; // ostinato notes per chord-beat
  sevenths?: boolean;
}

export const CONTEXTS: Record<MusicContext, ContextDef> = {
  menu: { label: 'Empire entry', root: 50, mode: 'aeolian', prog: [0, 5, 3, 4, 0, 5, 6, 4], chord: 8, layers: { pad: 0.5, choir: 0.32, bell: 0.14, bass: 0.3 }, bright: 0.38, sevenths: true },
  galaxy: { label: 'Galaxy exploration', root: 52, mode: 'lydian', prog: [0, 1, 0, 4, 5, 1, 3, 4], chord: 9, layers: { pad: 0.42, bell: 0.3, bass: 0.22, choir: 0.12 }, bright: 0.55, sevenths: true },
  peace: { label: 'Empire management', root: 53, mode: 'ionian', prog: [0, 4, 5, 3, 0, 2, 3, 4], chord: 7, layers: { pad: 0.42, bell: 0.2, bass: 0.3, pluck: 0.1 }, bright: 0.5, pluckRate: 2 },
  capital: { label: 'Capital development', root: 48, mode: 'mixolydian', prog: [0, 6, 3, 0, 4, 6, 3, 4], chord: 6, layers: { pad: 0.38, bass: 0.36, pluck: 0.2, drum: 0.12, bell: 0.1 }, bright: 0.45, pluckRate: 4 },
  diplomacy: { label: 'Political tension', root: 49, mode: 'dorian', prog: [0, 3, 0, 6, 5, 3, 1, 4], chord: 8, layers: { pad: 0.44, choir: 0.2, bass: 0.28, pluck: 0.08, bell: 0.08 }, bright: 0.3, pluckRate: 2, sevenths: true },
  war: { label: 'War', root: 45, mode: 'harmonic', prog: [0, 5, 6, 4, 0, 3, 6, 4], chord: 4, layers: { pad: 0.32, brass: 0.26, bass: 0.42, drum: 0.42, pluck: 0.18 }, bright: 0.5, pluckRate: 4 },
  mega: { label: 'Megastructure construction', root: 50, mode: 'lydian', prog: [0, 4, 1, 5, 0, 2, 1, 4], chord: 10, layers: { pad: 0.52, choir: 0.38, bell: 0.2, bass: 0.34, drum: 0.06 }, bright: 0.62, sevenths: true },
  late: { label: 'Late-game civilisation', root: 47, mode: 'lydian', prog: [0, 2, 1, 3, 0, 5, 1, 4], chord: 12, layers: { pad: 0.45, choir: 0.48, bell: 0.3, bass: 0.26 }, bright: 0.58, sevenths: true },
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Notes of the chord on scale degree `d` (stacked thirds within the mode). */
export function chordNotes(def: ContextDef, d: number, sevenths = def.sevenths): number[] {
  const scale = MODES[def.mode];
  const note = (step: number) => def.root + scale[((step % 7) + 7) % 7] + 12 * Math.floor(step / 7);
  const out = [note(d), note(d + 2), note(d + 4)];
  if (sevenths) out.push(note(d + 6));
  return out;
}

function makeImpulse(ctx: BaseAudioContext, seconds = 3.6, decay = 2.6): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.35; // darker tail
      d[i] = lp * Math.pow(1 - i / n, decay);
    }
  }
  return buf;
}

/** One playing context: schedules its chords ahead of time into its own gain stage. */
class Section {
  readonly out: GainNode;
  private next: number;
  private i = 0;
  private stopped = false;
  private melody: number;
  constructor(private eng: MusicEngine, readonly id: MusicContext, private def: ContextDef, fadeIn: number) {
    const ctx = eng.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.0001;
    this.out.connect(eng.input);
    this.out.gain.setTargetAtTime(1, ctx.currentTime, fadeIn / 3);
    this.next = ctx.currentTime + 0.1;
    this.melody = 7 + Math.floor(Math.random() * 3);
  }
  stop(fade: number) {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.eng.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    setTimeout(() => this.out.disconnect(), (fade + this.def.chord + 6) * 1000);
  }
  get live() { return !this.stopped; }
  /** schedule every chord that starts within the look-ahead window */
  pump(horizon: number) {
    if (this.stopped) return;
    while (this.next < horizon) {
      this.chord(this.next, this.def.prog[this.i % this.def.prog.length]);
      this.next += this.def.chord;
      this.i++;
    }
  }
  private chord(t: number, deg: number) {
    const d = this.def, L = d.layers, e = this.eng, dur = d.chord;
    const notes = chordNotes(d, deg);
    if (L.pad) e.pad(this.out, notes.map(hz), t, dur, L.pad, d.bright);
    if (L.choir) e.choir(this.out, notes.slice(0, 3).map((n) => hz(n + 12)), t, dur, L.choir);
    if (L.bass) e.bass(this.out, hz(notes[0] - 12), t, dur, L.bass);
    if (L.brass) e.brass(this.out, notes.slice(0, 3).map((n) => hz(n - 12)), t + dur * 0.02, dur * 0.9, L.brass);
    if (L.pluck) {
      const n = (d.pluckRate ?? 2) * 4, step = dur / n;
      const pat = [notes[0], notes[2], notes[1] + 12, notes[2]];
      for (let k = 0; k < n; k++) e.pluck(this.out, hz(pat[k % pat.length] + 12), t + k * step, step * 0.9, L.pluck * (k % 4 === 0 ? 1 : 0.7));
    }
    if (L.drum) {
      const beats = Math.round(dur / (d.chord <= 4 ? 0.5 : 1));
      for (let k = 0; k < beats; k++) {
        const accent = k % 4 === 0 ? 1 : k % 2 === 0 ? 0.55 : 0.3;
        if (d.chord > 4 && k % 2) continue;
        e.drum(this.out, t + k * (dur / beats), L.drum * accent);
      }
    }
    if (L.bell) {
      // a sparse melody: a random walk over the mode, one or two notes per chord
      const scale = MODES[d.mode];
      for (let k = 0; k < 2; k++) {
        if (Math.random() > 0.65) continue;
        this.melody = Math.max(3, Math.min(13, this.melody + [-2, -1, 1, 2, 0][Math.floor(Math.random() * 5)]));
        const m = d.root + 12 + scale[((this.melody % 7) + 7) % 7] + 12 * Math.floor(this.melody / 7);
        e.bell(this.out, hz(m), t + dur * (0.15 + k * 0.45 + Math.random() * 0.1), L.bell);
      }
    }
  }
}

export class MusicEngine {
  readonly input: GainNode;
  private reverb: ConvolverNode;
  private wet: GainNode;
  private sections: Section[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  current: MusicContext | null = null;

  constructor(readonly ctx: AudioContext, private out: AudioNode, private duck?: GainNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 0.9;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.input.connect(out);
    this.input.connect(this.reverb);
    this.reverb.connect(this.wet);
    this.wet.connect(out);
  }

  /** Crossfade to a context (no-op when it is already playing). */
  play(id: MusicContext, fade = 6) {
    if (this.current === id && this.sections.some((s) => s.live && s.id === id)) return;
    for (const s of this.sections) s.stop(fade);
    this.sections = this.sections.filter((s) => s.live);
    this.sections.push(new Section(this, id, CONTEXTS[id], fade));
    this.current = id;
    if (!this.timer) this.timer = setInterval(() => this.pump(), 250);
    this.pump();
  }

  stop(fade = 3) {
    for (const s of this.sections) s.stop(fade);
    this.sections = [];
    this.current = null;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Number of live sections (a context switch briefly has two; never more). */
  get liveSections() { return this.sections.filter((s) => s.live).length; }

  private pump() {
    const horizon = this.ctx.currentTime + 1.6;
    for (const s of this.sections) s.pump(horizon);
  }

  // ------------------------------------------------------------- instruments

  private env(g: GainNode, t: number, dur: number, peak: number, a: number, r: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(a, dur - r * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + r);
  }

  pad(dest: AudioNode, freqs: number[], t: number, dur: number, vol: number, bright: number) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 0.7;
    const lo = 300 + bright * 900, hi = 900 + bright * 2400;
    f.frequency.setValueAtTime(lo, t);
    f.frequency.linearRampToValueAtTime(hi, t + dur * 0.55);
    f.frequency.linearRampToValueAtTime(lo, t + dur + 3);
    const g = ctx.createGain();
    this.env(g, t, dur, (vol * 0.11) / Math.sqrt(freqs.length), 2.4, 3.2);
    f.connect(g); g.connect(dest);
    for (const fr of freqs) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det + (Math.random() * 4 - 2);
        o.connect(f); o.start(t); o.stop(t + dur + 3.5);
      }
    }
    const sub = ctx.createOscillator();
    sub.type = 'triangle'; sub.frequency.value = freqs[0] / 2;
    const sg = ctx.createGain(); sg.gain.value = 0.5;
    sub.connect(sg); sg.connect(f); sub.start(t); sub.stop(t + dur + 3.5);
  }

  choir(dest: AudioNode, freqs: number[], t: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g, t, dur, vol * 0.05, 3, 3.5);
    g.connect(dest);
    // "ah" formants
    const formants: [number, number, number][] = [[750, 7, 1], [1150, 9, 0.55], [2600, 12, 0.18]];
    const bus = ctx.createGain();
    for (const [fq, q, a] of formants) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
      const ga = ctx.createGain(); ga.gain.value = a;
      bus.connect(bp); bp.connect(ga); ga.connect(g);
    }
    const vib = ctx.createOscillator(); vib.frequency.value = 4.6;
    const vg = ctx.createGain(); vg.gain.value = 5; // cents
    vib.connect(vg); vib.start(t); vib.stop(t + dur + 4);
    for (const fr of freqs) {
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
        vg.connect(o.detune);
        o.connect(bus); o.start(t); o.stop(t + dur + 4);
      }
    }
  }

  bass(dest: AudioNode, freq: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ctx.createGain();
    this.env(g, t, dur, vol * 0.22, 0.6, 1.8);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(dest);
    for (const x of [o, o2]) { x.start(t); x.stop(t + dur + 2); }
  }

  brass(dest: AudioNode, freqs: number[], t: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ctx.createGain();
    this.env(g, t, dur, (vol * 0.09) / Math.sqrt(freqs.length), 0.18, 1.2);
    f.connect(g); g.connect(dest);
    for (const fr of freqs) for (const det of [-5, 4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 1.4);
    }
  }

  pluck(dest: AudioNode, freq: number, t: number, dur: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(380, t + Math.min(0.25, dur));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.06, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, dur));
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.2);
  }

  bell(dest: AudioNode, freq: number, t: number, vol: number) {
    const ctx = this.ctx;
    const car = ctx.createOscillator(); car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.frequency.value = freq * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 2.2, t); mg.gain.exponentialRampToValueAtTime(freq * 0.05, t + 2.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.07, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.2 - 0.6; car.connect(g); g.connect(pan); pan.connect(dest); } else { car.connect(g); g.connect(dest); }
    for (const x of [car, mod]) { x.start(t); x.stop(t + 4.2); }
  }

  drum(dest: AudioNode, t: number, vol: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.5, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.75);
    // skin noise
    const n = ctx.createBufferSource(); n.buffer = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180; bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(bp); bp.connect(ng); ng.connect(dest); n.start(t); n.stop(t + 0.3);
  }

  private noiseBuf: AudioBuffer | null = null;
  noise(): AudioBuffer {
    if (!this.noiseBuf) {
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  // ------------------------------------------------------------- stingers

  /** A short orchestral cue for a major event; the music dips beneath it. */
  stinger(kind: Stinger) {
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    const dest = ctx.createGain(); dest.gain.value = 1; dest.connect(this.out); dest.connect(this.reverb);
    setTimeout(() => dest.disconnect(), 12000);
    const len = 6;
    if (this.duck) {
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setTargetAtTime(0.35, t, 0.3);
      this.duck.gain.setTargetAtTime(1, t + len - 1.5, 1.2);
    }
    const D = (root: number, mode: keyof typeof MODES): ContextDef => ({ label: '', root, mode, prog: [0], chord: len, layers: {}, bright: 0.6 });
    if (kind === 'era' || kind === 'triumph') {
      const def = D(kind === 'era' ? 50 : 53, 'ionian');
      const c = chordNotes(def, 0, false);
      this.brass(dest, [hz(c[0] - 12), hz(c[2] - 12)], t, 0.9, 0.9);
      this.brass(dest, c.map((n) => hz(n - 12)), t + 0.9, 1.1, 0.9);
      this.brass(dest, chordNotes(def, 4, false).map((n) => hz(n - 12)), t + 2, 0.8, 0.8);
      this.brass(dest, [...c, c[0] + 12].map((n) => hz(n - 12)), t + 2.8, 3, 1);
      this.choir(dest, c.map((n) => hz(n + 12)), t + 2.8, 3, 0.8);
      this.drum(dest, t, 0.6); this.drum(dest, t + 0.9, 0.5); this.drum(dest, t + 2.8, 0.8);
      if (kind === 'triumph') for (let k = 0; k < 6; k++) this.bell(dest, hz(c[k % 3] + 24), t + 3 + k * 0.18, 0.5);
    } else if (kind === 'war') {
      const def = D(45, 'harmonic');
      for (let k = 0; k < 3; k++) this.drum(dest, t + k * 0.55, 0.9);
      this.brass(dest, chordNotes(def, 0, false).map((n) => hz(n - 12)), t + 1.65, 2.6, 1);
      this.brass(dest, [hz(def.root - 23)], t + 1.65, 3, 0.8);
      this.drum(dest, t + 1.65, 1);
    } else if (kind === 'defeat') {
      const def = D(45, 'aeolian');
      this.pad(dest, chordNotes(def, 0).map(hz), t, 3, 0.9, 0.2);
      this.pad(dest, chordNotes(def, 5).map((n) => hz(n - 12)), t + 3, 3, 0.9, 0.15);
      this.choir(dest, chordNotes(def, 0, false).map(hz), t + 0.5, 5, 0.6);
    } else if (kind === 'mega') {
      const def = D(50, 'lydian');
      this.pad(dest, chordNotes(def, 0).map(hz), t, 5, 1.1, 0.7);
      this.choir(dest, chordNotes(def, 0, false).map((n) => hz(n + 12)), t + 0.6, 4.5, 0.9);
      this.bass(dest, hz(def.root - 24), t, 5, 0.8);
      for (let k = 0; k < 4; k++) this.bell(dest, hz(chordNotes(def, 1)[k % 4] + 24), t + 1.5 + k * 0.4, 0.4);
    }
  }
}
