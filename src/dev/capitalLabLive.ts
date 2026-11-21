// Live view of the capital laboratory (loaded by capitalLab.ts when not in gallery mode).
import { CapitalView3D } from '../ui/render/capital3d';
import { DioramaCapitalView3D } from '../ui/render/capitalDiorama';
import { MegacityCapitalView3D } from '../ui/render/capitalMegacity';
import type { QualityTier } from '../ui/render/pipeline';
import { sampleCapital, capitalLabels } from './sampleCapital';

const q = new URLSearchParams(location.search);

const variant = (q.get('variant') ?? 'c') as 'a' | 'b' | 'c' | 'd';
const quality = (q.get('quality') ?? 'desktop') as QualityTier;
const projection = (q.get('projection') ?? 'perspective') as 'perspective' | 'orthographic';
const still = q.has('still');
const passes = { ao: q.get('ao') !== '0', bloom: q.get('bloom') !== '0' };
if (still) document.body.classList.add('still');

const canvas = document.querySelector('canvas')!;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const stats = document.getElementById('stats')!;
const { empire } = sampleCapital();
const labels = capitalLabels(empire);
let selected: number | null = null;

// the same camera angle for every variant; distance frames each scene's whole city
const ANGLE = { yaw: 0.32, pitch: 0.68 };
type View = { sync(e: typeof empire, l: typeof labels, s: number | null): void; dispose(): void; stats(): Record<string, unknown>; cam: { yaw: number; pitch: number; dist: number } };
let view: View;
const pick = (p: number | null) => { selected = p; view.sync(empire, labels, selected); (window as unknown as { __labPick?: number | null }).__labPick = p; };
if (variant === 'd') {
  const m = new MegacityCapitalView3D(canvas, overlay, empire.color, pick, { quality, still, passes });
  m.cameraLocked = true;
  Object.assign(m.cam, ANGLE, { dist: 250 }, q.has('dist') ? { dist: +q.get('dist')! } : {}, q.has('yaw') ? { yaw: +q.get('yaw')! } : {}, q.has('pitch') ? { pitch: +q.get('pitch')! } : {});
  view = m;
  m.ready.then(() => { view.sync(empire, labels, selected); markReady(); });
} else if (variant === 'c') {
  const d = new DioramaCapitalView3D(canvas, overlay, empire.color, pick, { quality, assetBase: '/candidates', projection, still, passes });
  Object.assign(d.cam, ANGLE, { dist: 152 });
  view = d;
  d.ready.then(() => { view.sync(empire, labels, selected); markReady(); });
} else {
  const v = new CapitalView3D(canvas, overlay, empire.color, pick, variant === 'b' ? { quality, passes } : {});
  Object.assign(v.cam, ANGLE, { dist: 56 });
  view = v;
  const wait = () => (v.assetsReady ? markReady() : setTimeout(wait, 100));
  wait();
}
view.sync(empire, labels, selected);

function markReady() {
  // let shadows, AO and labels settle for a few frames before declaring the view ready
  let n = 0;
  const tick = () => (++n < 20 ? requestAnimationFrame(tick) : (document.body.dataset.ready = '1'));
  requestAnimationFrame(tick);
}

(window as unknown as { __lab: unknown }).__lab = { view, variant, quality, projection, stats: () => view.stats() };

// HUD
document.querySelectorAll<HTMLButtonElement>('button[data-variant]').forEach((b) => {
  b.setAttribute('aria-pressed', String(b.dataset.variant === variant));
  b.addEventListener('click', () => { q.set('variant', b.dataset.variant!); location.search = q.toString(); });
});
for (const [id, val] of [['quality', quality], ['projection', projection]] as const) {
  const sel = document.getElementById(id) as HTMLSelectElement;
  sel.value = val;
  sel.disabled = variant === 'a' || (id === 'projection' && variant !== 'c');
  sel.addEventListener('change', () => { q.set(id, sel.value); location.search = q.toString(); });
}
setInterval(() => {
  const s = view.stats() as { fps: number; calls: number; triangles: number; tier: string };
  stats.textContent = `${s.fps.toFixed(0)} fps · ${s.calls} draws · ${(s.triangles / 1000).toFixed(0)}k tris · ${s.tier}`;
}, 500);
addEventListener('pagehide', () => view.dispose());

/**
 * Disposal check used by the browser tests: build a view on a detached canvas, render it for a
 * moment, dispose it, and report what the renderer still holds on the GPU (should be nothing).
 */
(window as unknown as { __labDisposeCheck: (v: 'b' | 'c' | 'd') => Promise<unknown> }).__labDisposeCheck = async (v) => {
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px;opacity:0;pointer-events:none';
  const o = document.createElement('div');
  document.body.append(c, o);
  if (v === 'd') {
    const m = new MegacityCapitalView3D(c, o, empire.color, () => {}, { quality: 'mobile', still: true });
    await m.ready; m.sync(empire, labels, null);
    await new Promise((r) => setTimeout(r, 600));
    const before = { ...m.renderer.info.memory };
    m.dispose();
    const after = { ...m.renderer.info.memory };
    c.remove(); o.remove();
    return { before, after };
  }
  const x = v === 'c'
    ? new DioramaCapitalView3D(c, o, empire.color, () => {}, { quality: 'mobile', assetBase: '/candidates', still: true })
    : new CapitalView3D(c, o, empire.color, () => {}, { quality: 'mobile' });
  if (x instanceof DioramaCapitalView3D) await x.ready;
  else await new Promise<void>((r) => { const w = () => (x.assetsReady ? r() : setTimeout(w, 50)); w(); });
  x.sync(empire, labels, null);
  await new Promise((r) => setTimeout(r, 600));
  const before = { ...x.renderer.info.memory };
  x.dispose();
  const after = { ...x.renderer.info.memory };
  c.remove(); o.remove();
  return { before, after };
};
