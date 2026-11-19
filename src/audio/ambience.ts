// Ambience: one environmental bed at a time, crossfaded when the scene changes.
//   space  - the galaxy map: a low, slowly breathing drone and filtered deep noise, with rare
//            distant pings
//   orbit  - inside a system: thin solar wind (swept band-passed noise) over the drone
//   city   - the capital: industrial hum (Kenney engine loop), machinery and distant metal
//   fleet  - fleet and war windows: ship engines (Kenney engine loop) over the drone
// Synthesised layers are original; sampled layers are Kenney CC0 loops (see manifest.json).

import type { AudioManager } from './manager';

export type AmbientScene = 'none' | 'space' | 'orbit' | 'city' | 'fleet';

interface Bed { stop: (fade: number) => void }

export class AmbienceEngine {
  scene: AmbientScene = 'none';
  private bed: Bed | null = null;
  private brown: AudioBuffer | null = null;

  constructor(private ctx: AudioContext, private out: AudioNode, private mgr: AudioManager) {}

  set(scene: AmbientScene, fade = 3) {
    if (scene === this.scene) return;
    this.bed?.stop(fade);
    this.bed = null;
    this.scene = scene;
    if (scene === 'none') return;
    this.bed = this.make(scene, fade);
  }

  private brownNoise(): AudioBuffer {
    if (this.brown) return this.brown;
    const n = this.ctx.sampleRate * 4;
    const buf = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
      // fold the ends together so the loop has no click
      const xf = 2048;
      for (let i = 0; i < xf; i++) { const k = i / xf; d[i] = d[i] * k + d[n - xf + i] * (1 - k); }
    }
    this.brown = buf;
    return buf;
  }

  private make(scene: AmbientScene, fade: number): Bed {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(1, t, fade / 3);
    g.connect(this.out);
    const nodes: AudioScheduledSourceNode[] = [];
    const stops: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    // shared: a deep drone of two slightly beating sines and filtered brown noise
    const drone = (level: number, root = 55) => {
      const dg = ctx.createGain(); dg.gain.value = level; dg.connect(g);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
      const lg = ctx.createGain(); lg.gain.value = level * 0.45;
      lfo.connect(lg); lg.connect(dg.gain); lfo.start(); nodes.push(lfo);
      for (const [f, a] of [[root, 0.5], [root * 1.5 + 0.35, 0.28], [root * 2 - 0.2, 0.16]] as const) {
        const o = ctx.createOscillator(); o.frequency.value = f;
        const og = ctx.createGain(); og.gain.value = a * 0.12;
        o.connect(og); og.connect(dg); o.start(); nodes.push(o);
      }
      const n = ctx.createBufferSource(); n.buffer = this.brownNoise(); n.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
      const ng = ctx.createGain(); ng.gain.value = 0.22;
      n.connect(lp); lp.connect(ng); ng.connect(dg); n.start(); nodes.push(n);
    };

    if (scene === 'space') {
      drone(0.9, 55);
      // rare, distant pings: a soft high sine with a long tail
      const ping = () => {
        if (!this.mgr.audible('ambient')) { timer = setTimeout(ping, 8000); return; }
        const at = ctx.currentTime + 0.05;
        const o = ctx.createOscillator(); o.frequency.value = [1760, 2093, 2349, 2637][Math.floor(Math.random() * 4)];
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, at); og.gain.exponentialRampToValueAtTime(0.012, at + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
        const d = ctx.createDelay(1); d.delayTime.value = 0.42;
        const fb = ctx.createGain(); fb.gain.value = 0.4;
        o.connect(og); og.connect(g); og.connect(d); d.connect(fb); fb.connect(d); fb.connect(g);
        o.start(at); o.stop(at + 3.6);
        setTimeout(() => { og.disconnect(); d.disconnect(); fb.disconnect(); }, 8000);
        timer = setTimeout(ping, 9000 + Math.random() * 14000);
      };
      timer = setTimeout(ping, 4000 + Math.random() * 6000);
    } else if (scene === 'orbit') {
      drone(0.65, 49);
      const n = ctx.createBufferSource(); n.buffer = this.brownNoise(); n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 1.2;
      const sweep = ctx.createOscillator(); sweep.frequency.value = 0.07;
      const sg = ctx.createGain(); sg.gain.value = 260;
      sweep.connect(sg); sg.connect(bp.frequency);
      const wg = ctx.createGain(); wg.gain.value = 0.5;
      n.connect(bp); bp.connect(wg); wg.connect(g);
      n.start(); sweep.start(); nodes.push(n, sweep);
      stops.push(this.mgr.loop('amb.machines', 'ambient', 0.25, fade));
    } else if (scene === 'city') {
      drone(0.35, 41);
      stops.push(this.mgr.loop('amb.industry', 'ambient', 0.55, fade));
      stops.push(this.mgr.loop('amb.machines', 'ambient', 0.35, fade));
      const clank = () => {
        this.mgr.play('amb.metal', { volume: 0.25 + Math.random() * 0.3, pan: Math.random() * 1.6 - 0.8, rate: 0.7 + Math.random() * 0.25 });
        timer = setTimeout(clank, 3500 + Math.random() * 7000);
      };
      timer = setTimeout(clank, 2500);
    } else if (scene === 'fleet') {
      drone(0.5, 46);
      stops.push(this.mgr.loop('amb.fleet', 'ambient', 0.6, fade));
    }

    return {
      stop: (f: number) => {
        if (timer) clearTimeout(timer);
        for (const s of stops) s();
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, f / 3);
        setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* stopped */ } n.disconnect(); } g.disconnect(); }, f * 1000 + 400);
      },
    };
  }
}
