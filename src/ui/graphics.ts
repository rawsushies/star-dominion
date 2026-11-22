// Graphics preferences, kept in this browser: which capital view to draw and at what quality.
//   capital: 'megacity' (the monumental city), 'classic' (the original lighter view), or 'auto'
//            (the megacity, unless the browser renders WebGL in software, where it would crawl)
//   quality: the megacity's render tier, or 'auto' (mobile tier on phones, tablets and machines
//            with few cores; medium elsewhere; the desktop tier is opt-in)

import type { QualityTier } from './render/pipeline';

export type CapitalStyle = 'auto' | 'megacity' | 'classic';
export type QualityPref = 'auto' | QualityTier;
export interface GraphicsSettings { capital: CapitalStyle; quality: QualityPref; /** frame-rate readout in the capital */ stats: boolean }

export const GRAPHICS_KEY = 'sd.graphics.v1';
export const GRAPHICS_DEFAULTS: GraphicsSettings = { capital: 'auto', quality: 'auto', stats: false };

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function loadGraphics(store: Pick<Storage, 'getItem'> | null = storage()): GraphicsSettings {
  try {
    const raw = JSON.parse(store?.getItem(GRAPHICS_KEY) ?? '{}') as Partial<GraphicsSettings>;
    return {
      capital: (['auto', 'megacity', 'classic'] as const).includes(raw.capital as CapitalStyle) ? raw.capital as CapitalStyle : GRAPHICS_DEFAULTS.capital,
      quality: (['auto', 'mobile', 'medium', 'desktop'] as const).includes(raw.quality as QualityPref) ? raw.quality as QualityPref : GRAPHICS_DEFAULTS.quality,
      stats: raw.stats === true,
    };
  } catch { return { ...GRAPHICS_DEFAULTS }; }
}

let current = loadGraphics();
const listeners = new Set<() => void>();

export function graphics(): GraphicsSettings { return current; }

export function setGraphics(patch: Partial<GraphicsSettings>) {
  current = { ...current, ...patch };
  vqCache = null;
  try { storage()?.setItem(GRAPHICS_KEY, JSON.stringify(current)); } catch { /* not persisted */ }
  for (const l of listeners) l();
}

export function onGraphicsChange(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

export interface Device { coarsePointer: boolean; width: number; cores: number; software: boolean; /** a modest integrated GPU */ integrated?: boolean }

let probed: boolean | null = null;
let integrated = false;
/** Whether WebGL runs on a modest integrated GPU (laptop Intel graphics, phone GPUs). */
export function integratedGpu(): boolean { softwareRenderer(); return integrated; }
/** Whether WebGL runs on a software rasteriser (SwiftShader, llvmpipe and the like). */
export function softwareRenderer(): boolean {
  if (probed != null) return probed;
  probed = false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      probed = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
      integrated = /intel|uhd|iris|mali|adreno|powervr|videocore/i.test(name);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* keep false */ }
  return probed;
}

export function currentDevice(): Device {
  const w = typeof window !== 'undefined' ? window : undefined;
  return {
    coarsePointer: !!w?.matchMedia?.('(pointer: coarse)').matches,
    width: w?.innerWidth ?? 1280,
    cores: (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8,
    software: typeof document !== 'undefined' ? softwareRenderer() : false,
    integrated: typeof document !== 'undefined' ? integratedGpu() : false,
  };
}

/** The capital view and tier to use for these settings on this device. */
export function resolveCapital(s: Pick<GraphicsSettings, 'capital' | 'quality'>, d: Device): { style: 'megacity' | 'classic'; quality: QualityTier } {
  const style = s.capital === 'auto' ? (d.software ? 'classic' : 'megacity') : s.capital;
  const quality: QualityTier = s.quality !== 'auto' ? s.quality : d.coarsePointer || d.width < 900 || d.cores <= 4 || d.integrated ? 'mobile' : 'medium';
  return { style, quality };
}

/** How the map, portraits and other 3D views render on this device (from the same quality setting as the capital). */
export interface ViewQuality { tier: QualityTier; antialias: boolean; maxDpr: number; stars: number; shadows: boolean; idleFps: number; runFps: number }

let vqCache: ViewQuality | null = null;
/** The current device's view quality (cached; recomputed when the graphics settings change). */
export function currentViewQuality(): ViewQuality { return (vqCache ??= viewQuality(graphics(), currentDevice())); }

export function viewQuality(s: Pick<GraphicsSettings, 'capital' | 'quality'>, d: Device): ViewQuality {
  // a software rasteriser crawls at any tier: use the lightest one unless the player chose otherwise
  const tier: QualityTier = s.quality === 'auto' && d.software ? 'mobile' : resolveCapital(s, d).quality;
  if (tier === 'mobile') return { tier, antialias: false, maxDpr: 1, stars: 0.35, shadows: false, idleFps: 10, runFps: 24 };
  if (tier === 'medium') return { tier, antialias: true, maxDpr: 1.25, stars: 0.7, shadows: false, idleFps: 15, runFps: 30 };
  return { tier, antialias: true, maxDpr: 2, stars: 1, shadows: true, idleFps: 30, runFps: 60 };
}

/**
 * A frame gate for render loops: render at full rate while the player interacts with a view,
 * at a lower rate otherwise, and not at all while the view is hidden or the tab is in the background.
 */
export class FrameGate {
  private last = -1e9;
  private activeUntil = 0;
  private forced = true;
  constructor(private q: () => ViewQuality = currentViewQuality) {}
  /** the player is touching this view: render at full rate for a moment */
  poke(ms = 900) { this.activeUntil = performance.now() + ms; this.forced = true; }
  /** something visible changed: render on the next frame */
  invalidate() { this.forced = true; }
  /** should this frame render? `running` is true while game time advances */
  due(t: number, running: boolean): boolean {
    if (typeof document !== 'undefined' && document.hidden) return false;
    const q = this.q();
    const fps = t < this.activeUntil ? 60 : running ? q.runFps : q.idleFps;
    if (!this.forced && t - this.last < 1000 / fps - 1) return false;
    this.forced = false;
    this.last = t;
    return true;
  }
}
