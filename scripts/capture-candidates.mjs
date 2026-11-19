// Renders the comparison gallery headlessly and saves documentation previews:
//   docs/asset-previews/m11/<category>.jpg      every rendered set of a category, side by side
//   docs/asset-previews/m11/set-<id>.jpg        one set on its own
// Usage: start the dev server (npm run dev), fetch candidates (npm run candidates:fetch), then
//   node scripts/capture-candidates.mjs [baseUrl]      (default http://localhost:5173)
// Exits non-zero if any model failed to load or the page logged an error.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = resolve(import.meta.dirname, '../docs/asset-previews/m11');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });

async function shot(query, file) {
  await page.goto(`${base}/compare.html?capture=1&${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const errors = await page.evaluate(() => Number(document.body.dataset.errors));
  await page.screenshot({ path: `${out}/${file}`, type: 'jpeg', quality: 82 });
  console.log(`${errors ? '✗' : '✓'} ${file}${errors ? ` (${errors} models failed)` : ''}`);
  if (errors) problems.push(`${file}: ${errors} models failed to load`);
}

const { CANDIDATE_SETS } = await import(resolve(import.meta.dirname, '../src/dev/candidates.ts')).catch(() => ({ CANDIDATE_SETS: null }));
const cats = ['capital', 'ships', 'heroes', 'villains'];
for (const c of cats) await shot(`cat=${c}`, `${c}.jpg`);
const ids = process.env.SET_IDS?.split(',') ?? (CANDIDATE_SETS ? CANDIDATE_SETS.filter((s) => s.items?.length).map((s) => s.id) : []);
for (const id of ids) await shot(`set=${id}`, `set-${id}.jpg`);
await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
