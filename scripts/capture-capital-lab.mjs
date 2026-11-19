// Renders the capital laboratory headlessly and saves the comparison screenshots:
//   docs/asset-previews/m12/<variant>-<desktop|phone>[-<suffix>].jpg
// and prints frame-time and GPU-counter measurements per variant and tier.
// Usage: npm run dev, npm run candidates:fetch, then node scripts/capture-capital-lab.mjs [baseUrl] [--perf]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173';
const perf = args.includes('--perf');
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const out = resolve(import.meta.dirname, '../docs/asset-previews/m12');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const SHOTS = [
  ['a', 'variant=a'], ['b', 'variant=b&quality=desktop'], ['c', 'variant=c&quality=desktop'],
  ['c-ortho', 'variant=c&quality=desktop&projection=orthographic'], ['c-mobile', 'variant=c&quality=mobile'], ['b-mobile', 'variant=b&quality=mobile'],
];
const problems = [];
const results = [];
for (const [name, query] of SHOTS) {
  if (only && !only.split(',').includes(name)) continue;
  for (const [size, viewport] of Object.entries(SIZES)) {
    if (name.includes('mobile') && size === 'desktop' && !perf) continue;
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(`${name}/${size}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' || /failed to load/.test(m.text())) problems.push(`${name}/${size}: ${m.text()}`); });
    await page.goto(`${base}/capitallab.html?${query}&still=1`);
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}-${size}.jpg`, type: 'jpeg', quality: 86 });
    if (perf) {
      // frame times of continuous rendering, plus the GPU counters of the last frame
      const r = await page.evaluate(() => new Promise((done) => {
        // at least 3 s and 12 frames (software rendering can be slow), at most 60 s
        const times = []; let last = performance.now(); const start = last;
        const tick = (t) => { times.push(t - last); last = t; if ((t - start < 3000 || times.length < 14) && t - start < 60000) requestAnimationFrame(tick); else done({ times, s: window.__lab.stats() }); };
        requestAnimationFrame(tick);
      }));
      const sorted = r.times.slice(2).sort((x, y) => x - y);
      const med = sorted[Math.floor(sorted.length / 2)], p95 = sorted[Math.floor(sorted.length * 0.95)];
      results.push({ name, size, medianMs: +med.toFixed(1), p95Ms: +p95.toFixed(1), fps: +(1000 / med).toFixed(1), calls: r.s.calls, triangles: r.s.triangles, geometries: r.s.geometries, textures: r.s.textures });
    }
    console.log(`✓ ${name}-${size}`);
    await page.close();
  }
}
await browser.close();
if (perf) { console.table(results); writeFileSync(`${out}/perf.json`, JSON.stringify(results, null, 2)); }
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
