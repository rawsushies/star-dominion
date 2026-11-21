import { describe, expect, it } from 'vitest';
import { loadGraphics, resolveCapital, GRAPHICS_DEFAULTS, GRAPHICS_KEY, type Device } from '../src/ui/graphics';

const desk: Device = { coarsePointer: false, width: 1600, cores: 12, software: false };
const store = (v: unknown) => ({ getItem: (k: string) => (k === GRAPHICS_KEY ? JSON.stringify(v) : null) });

describe('graphics settings', () => {
  it('defaults to automatic and ignores unknown or corrupt values', () => {
    expect(loadGraphics(null)).toEqual(GRAPHICS_DEFAULTS);
    expect(loadGraphics(store({ capital: 'castle', quality: 'ultra' }))).toEqual(GRAPHICS_DEFAULTS);
    expect(loadGraphics({ getItem: () => '{not json' })).toEqual(GRAPHICS_DEFAULTS);
    expect(loadGraphics(store({ capital: 'classic', quality: 'desktop' }))).toEqual({ capital: 'classic', quality: 'desktop' });
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
});
