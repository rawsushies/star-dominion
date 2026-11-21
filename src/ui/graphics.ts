// Graphics preferences, kept in this browser: which capital view to draw and at what quality.
//   capital: 'megacity' (the monumental city), 'classic' (the original lighter view), or 'auto'
//            (the megacity, unless the browser renders WebGL in software, where it would crawl)
//   quality: the megacity's render tier, or 'auto' (mobile tier on phones, tablets and machines
//            with few cores; medium elsewhere; the desktop tier is opt-in)

import type { QualityTier } from './render/pipeline';

export type CapitalStyle = 'auto' | 'megacity' | 'classic';
export type QualityPref = 'auto' | QualityTier;
export interface GraphicsSettings { capital: CapitalStyle; quality: QualityPref }

export const GRAPHICS_KEY = 'sd.graphics.v1';
export const GRAPHICS_DEFAULTS: GraphicsSettings = { capital: 'auto', quality: 'auto' };

function storage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function loadGraphics(store: Pick<Storage, 'getItem'> | null = storage()): GraphicsSettings {
  try {
    const raw = JSON.parse(store?.getItem(GRAPHICS_KEY) ?? '{}') as Partial<GraphicsSettings>;
    return {
      capital: (['auto', 'megacity', 'classic'] as const).includes(raw.capital as CapitalStyle) ? raw.capital as CapitalStyle : GRAPHICS_DEFAULTS.capital,
      quality: (['auto', 'mobile', 'medium', 'desktop'] as const).includes(raw.quality as QualityPref) ? raw.quality as QualityPref : GRAPHICS_DEFAULTS.quality,
    };
  } catch { return { ...GRAPHICS_DEFAULTS }; }
}

let current = loadGraphics();
const listeners = new Set<() => void>();

export function graphics(): GraphicsSettings { return current; }

export function setGraphics(patch: Partial<GraphicsSettings>) {
  current = { ...current, ...patch };
  try { storage()?.setItem(GRAPHICS_KEY, JSON.stringify(current)); } catch { /* not persisted */ }
  for (const l of listeners) l();
}

export function onGraphicsChange(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }

export interface Device { coarsePointer: boolean; width: number; cores: number; software: boolean }

let probed: boolean | null = null;
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
  };
}

/** The capital view and tier to use for these settings on this device. */
export function resolveCapital(s: GraphicsSettings, d: Device): { style: 'megacity' | 'classic'; quality: QualityTier } {
  const style = s.capital === 'auto' ? (d.software ? 'classic' : 'megacity') : s.capital;
  const quality: QualityTier = s.quality !== 'auto' ? s.quality : d.coarsePointer || d.width < 900 || d.cores <= 4 ? 'mobile' : 'medium';
  return { style, quality };
}
