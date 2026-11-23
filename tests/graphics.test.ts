import { describe, expect, it } from 'vitest';
import { loadGraphics, resolveCapital, viewQuality, FrameGate, GRAPHICS_DEFAULTS, GRAPHICS_KEY, type Device } from '../src/ui/graphics';

const desk: Device = { coarsePointer: false, width: 1600, cores: 12, software: false };
const store = (v: unknown) => ({ getItem: (k: string) => (k === GRAPHICS_KEY ? JSON.stringify(v) : null) });

describe('graphics settings', () => {
  it('defaults to automatic and ignores unknown or corrupt values', () => {
    expect(loadGraphics(null)).toEqual(GRAPHICS_DEFAULTS);
    expect(loadGraphics(store({ capital: 'castle', quality: 'ultra' }))).toEqual(GRAPHICS_DEFAULTS);
    expect(loadGraphics({ getItem: () => '{not json' })).toEqual(GRAPHICS_DEFAULTS);
    expect(loadGraphics(store({ capital: 'classic', quality: 'desktop', stats: true }))).toEqual({ ...GRAPHICS_DEFAULTS, capital: 'classic', quality: 'desktop', stats: true });
  });

  it('automatic: the megacity at medium quality on a desktop, low quality on phones and small machines', () => {
    expect(resolveCapital(GRAPHICS_DEFAULTS, desk)).toEqual({ style: 'megacity', quality: 'medium' });
    expect(resolveCapital(GRAPHICS_DEFAULTS, { ...desk, coarsePointer: true }).quality).toBe('mobile');
    expect(resolveCapital(GRAPHICS_DEFAULTS, { ...desk, width: 700 }).quality).toBe('mobile');
    expect(resolveCapital(GRAPHICS_DEFAULTS, { ...desk, cores: 4 }).quality).toBe('mobile');
  });

  it('automatic falls back to the classic city when WebGL runs in software; explicit choices win', () => {
    expect(resolveCapital(GRAPHICS_DEFAULTS, { ...desk, software: true }).style).toBe('classic');
    expect(resolveCapital({ capital: 'megacity', quality: 'auto' }, { ...desk, software: true }).style).toBe('megacity');
    expect(resolveCapital({ capital: 'classic', quality: 'desktop' }, desk)).toEqual({ style: 'classic', quality: 'desktop' });
    expect(resolveCapital({ capital: 'auto', quality: 'desktop' }, desk)).toEqual({ style: 'megacity', quality: 'desktop' });
  });

  it('integrated graphics get the low tier automatically; the player can still choose', () => {
    expect(resolveCapital(GRAPHICS_DEFAULTS, { ...desk, integrated: true }).quality).toBe('mobile');
    expect(resolveCapital({ ...GRAPHICS_DEFAULTS, quality: 'desktop' }, { ...desk, integrated: true }).quality).toBe('desktop');
  });

  it('view quality: software rendering is lightest, high quality is opt-in', () => {
    const soft = viewQuality(GRAPHICS_DEFAULTS, { ...desk, software: true });
    expect(soft).toMatchObject({ tier: 'mobile', antialias: false, maxDpr: 1, shadows: false });
    expect(viewQuality(GRAPHICS_DEFAULTS, desk).tier).toBe('medium');
    expect(viewQuality({ ...GRAPHICS_DEFAULTS, quality: 'desktop' }, desk)).toMatchObject({ maxDpr: 2, shadows: true });
  });
});

describe('frame gate', () => {
  const q = viewQuality(GRAPHICS_DEFAULTS, desk); // medium: 30 fps running, 15 idle
  it('renders at the running rate while time advances, slower when idle, full rate while handled', () => {
    const g = new FrameGate(() => q);
    const count = (from: number, ms: number, running: boolean) => { let n = 0; for (let t = from; t < from + ms; t += 1000 / 120) if (g.due(t, running)) n++; return n; };
    expect(count(0, 1000, true)).toBeGreaterThanOrEqual(29);
    expect(count(1000, 1000, true)).toBeLessThanOrEqual(31);
    expect(count(2000, 1000, false)).toBeLessThanOrEqual(16);
    g.poke(1e9);
    expect(count(3000, 1000, false)).toBeGreaterThanOrEqual(58);
  });
  it('an invalidation renders the next frame at once', () => {
    const g = new FrameGate(() => q);
    expect(g.due(0, false)).toBe(true);
    expect(g.due(5, false)).toBe(false);
    g.invalidate();
    expect(g.due(6, false)).toBe(true);
  });
});

describe('adaptive map resolution', () => {
  it('lowers the resolution when frames are slow and restores it when they are fast, in auto quality only', async () => {
    const { ResolutionGovernor } = await import('../src/ui/graphics');
    let auto = true;
    const gov = new ResolutionGovernor(() => auto);
    let t = 0;
    for (let i = 0; i < 300; i++) { t += 50; gov.frame(t, true); } // 20 fps
    expect(gov.scale).toBeLessThan(1);
    expect(gov.scale).toBeGreaterThanOrEqual(0.6);
    for (let i = 0; i < 600; i++) { t += 16; gov.frame(t, true); } // 60 fps
    expect(gov.scale).toBe(1);
    // idle frames (not a full-rate burst) are never measured
    for (let i = 0; i < 300; i++) { t += 200; gov.frame(t, false); }
    expect(gov.scale).toBe(1);
    for (let i = 0; i < 300; i++) { t += 50; gov.frame(t, true); }
    auto = false; gov.frame(t + 50, true);
    expect(gov.scale).toBe(1);
  });
});
