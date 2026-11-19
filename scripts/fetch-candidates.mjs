// Downloads the candidate asset packs listed in scripts/candidate-sources.json into
// dev-assets/candidates/<id>/ for the comparison gallery (compare.html, dev server only).
// Usage: npm run candidates:fetch [-- <pack-id> ...]   Requires `unzip` and `git` on PATH.
// Archives are third-party data: they are only extracted, never executed.
import { readFileSync, mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { packs } = JSON.parse(readFileSync(join(root, 'scripts/candidate-sources.json'), 'utf8'));
const only = process.argv.slice(2);
const outRoot = join(root, 'dev-assets/candidates');
mkdirSync(outRoot, { recursive: true });
let failed = 0;

/** The signed URL of a free upload on an itch.io page (the page's own "No thanks, just take me to
 * the downloads" flow: download page, then the upload's file request). Only for free packs. */
async function itchFreeUrl(page, fileName) {
  const jar = new Map();
  const keep = (r) => { for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); } return r; };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const csrfOf = (html) => /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];
  const html = await keep(await fetch(page)).text();
  if (!/"min_price":0|Name your own price|"actual_price":0/.test(html)) throw new Error('not a free pack');
  const ajax = { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' };
  const du = await keep(await fetch(`${page}/download_url`, { method: 'POST', headers: { ...ajax, cookie: cookie(), referer: page }, body: new URLSearchParams({ csrf_token: csrfOf(html) }) })).json();
  if (!du.url) throw new Error(`no download page: ${JSON.stringify(du)}`);
  const dl = await keep(await fetch(du.url, { headers: { cookie: cookie() } })).text();
  const m = new RegExp(`data-upload_id="(\\d+)"[\\s\\S]{0,800}?title="${fileName.replace(/[[\]().]/g, '\\$&')}"`).exec(dl);
  if (!m) throw new Error(`upload ${fileName} not listed`);
  const f = await (await fetch(`${page}/file/${m[1]}?source=game_download&after_download_lightbox=1&as_props=1`, { method: 'POST', headers: { ...ajax, cookie: cookie(), referer: du.url }, body: new URLSearchParams({ csrf_token: csrfOf(dl) }) })).json();
  if (!f.url) throw new Error(`no file url: ${JSON.stringify(f.errors ?? f).slice(0, 200)}`);
  return f.url;
}
for (const p of packs) {
  if (only.length && !only.includes(p.id)) continue;
  const dir = join(outRoot, p.into ?? p.id);
  const stamp = join(outRoot, `.${p.id}.done`);
  if (existsSync(stamp)) { console.log(`✓ ${p.id} (already fetched)`); continue; }
  try {
    if (p.git) {
      // the creator's own public repository: a shallow clone, without history
      rmSync(dir, { recursive: true, force: true });
      if (p.sparse) {
        // large repositories: fetch only the listed paths
        execFileSync('git', ['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', p.git, dir]);
        execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', '--no-cone', ...p.sparse.map((x) => `/${x}`)]);
        execFileSync('git', ['-C', dir, 'checkout', '--quiet', 'HEAD']);
      } else execFileSync('git', ['clone', '--quiet', '--depth', '1', p.git, dir]);
      rmSync(join(dir, '.git'), { recursive: true, force: true });
      writeFileSync(stamp, JSON.stringify({ git: p.git, at: new Date().toISOString() }));
      console.log(`✓ ${p.id} (git)`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const res = await fetch(p.itch ? await itchFreeUrl(p.itch, p.file) : p.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (/\.zip$/i.test(p.url ?? p.file)) {
      const zip = join(outRoot, `.${p.id}.zip`);
      writeFileSync(zip, buf);
      execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
      rmSync(zip);
    } else {
      // a single model file (.blend, .glb, ...): stored as published, opened only by Blender/three in the lab
      writeFileSync(join(dir, decodeURIComponent((p.url ?? p.file).split('/').pop())), buf);
    }
    writeFileSync(stamp, JSON.stringify({ url: p.url, bytes: buf.length, at: new Date().toISOString() }));
    console.log(`✓ ${p.id} ${(buf.length / 1e6).toFixed(1)} MB`);
  } catch (e) {
    failed++;
    console.error(`✗ ${p.id}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
