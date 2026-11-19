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
for (const p of packs) {
  if (only.length && !only.includes(p.id)) continue;
  const dir = join(outRoot, p.into ?? p.id);
  const stamp = join(outRoot, `.${p.id}.done`);
  if (existsSync(stamp)) { console.log(`✓ ${p.id} (already fetched)`); continue; }
  try {
    if (p.git) {
      // the creator's own public repository: a shallow clone, without history
      rmSync(dir, { recursive: true, force: true });
      execFileSync('git', ['clone', '--quiet', '--depth', '1', p.git, dir]);
      rmSync(join(dir, '.git'), { recursive: true, force: true });
      writeFileSync(stamp, JSON.stringify({ git: p.git, at: new Date().toISOString() }));
      console.log(`✓ ${p.id} (git)`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const res = await fetch(p.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = join(outRoot, `.${p.id}.zip`);
    writeFileSync(zip, buf);
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    rmSync(zip);
    writeFileSync(stamp, JSON.stringify({ url: p.url, bytes: buf.length, at: new Date().toISOString() }));
    console.log(`✓ ${p.id} ${(buf.length / 1e6).toFixed(1)} MB`);
  } catch (e) {
    failed++;
    console.error(`✗ ${p.id}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
