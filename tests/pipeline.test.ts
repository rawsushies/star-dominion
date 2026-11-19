import { describe, expect, it, vi } from 'vitest';
import { TIERS, detectTier } from '../src/ui/render/pipeline';

describe('render quality tiers', () => {
  it('cheaper tiers never cost more than richer ones', () => {
    const [m, md, d] = [TIERS.mobile, TIERS.medium, TIERS.desktop];
    expect(m.shadowMap).toBeLessThan(md.shadowMap);
    expect(md.shadowMap).toBeLessThan(d.shadowMap);
    expect(m.maxPixelRatio).toBeLessThanOrEqual(md.maxPixelRatio);
    expect(m.gtao!.samples).toBeLessThan(d.gtao!.samples);
    expect(m.gtao!.resolution).toBeLessThan(d.gtao!.resolution);
    expect(m.density).toBeLessThan(d.density);
    expect(m.bloom).toBeNull(); // mobile skips bloom entirely
    expect(d.bloom!.threshold).toBeGreaterThan(1); // only emissive lights bloom
  });
  it('detects device classes from hardware hints', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4, deviceMemory: 3, maxTouchPoints: 5 });
    vi.stubGlobal('screen', { width: 390, height: 844 });
    expect(detectTier()).toBe('mobile');
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, deviceMemory: 16, maxTouchPoints: 0 });
    vi.stubGlobal('screen', { width: 2560, height: 1440 });
    expect(detectTier()).toBe('desktop');
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, deviceMemory: 8, maxTouchPoints: 10 });
    vi.stubGlobal('screen', { width: 1024, height: 1366 });
    expect(detectTier()).toBe('medium');
    vi.unstubAllGlobals();
  });
});
