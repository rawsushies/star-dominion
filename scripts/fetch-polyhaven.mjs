// Fetches the megacity's sky and ground textures from Poly Haven (all CC0 1.0, https://polyhaven.com/license)
// and converts them for the web. Writes public/assets/textures/megacity/ and its manifest.json.
//   node scripts/fetch-polyhaven.mjs
// Needs ffmpeg (resizing) and python3 with numpy (HDR tone mapping, scripts/lib/tonemap_hdr.py).
import { mkdirSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const OUT = 'public/assets/textures/megacity';
const TMP = 'dev-assets/polyhaven';
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// role -> Poly Haven asset; maps: which texture maps to keep
const ASSETS = [
  { role: 'sky', id: 'kloppenheim_06_puresky', kind: 'hdri' },
  { role: 'street', id: 'clean_asphalt', kind: 'texture' },
  { role: 'lot', id: 'metal_plate', kind: 'texture' },
  { role: 'plaza', id: 'hexagonal_concrete_paving', kind: 'texture' },
  { role: 'land', id: 'hangar_concrete_floor', kind: 'texture' },
];

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function download(url, path) {
  if (existsSync(path) && statSync(path).size > 0) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
}
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);

const manifest = { source: 'Poly Haven', license: 'CC0 1.0', licenseUrl: 'https://polyhaven.com/license', assets: [] };
for (const a of ASSETS) {
  const info = await json(`https://api.polyhaven.com/info/${a.id}`);
  const files = await json(`https://api.polyhaven.com/files/${a.id}`);
  const out = [];
  if (a.kind === 'hdri') {
    const src = join(TMP, `${a.id}_2k.hdr`);
    await download(files.hdri['2k'].hdr.url, src);
    // a tone-mapped equirectangular JPEG serves as both the backdrop and the image-based light
    const dst = join(OUT, `${a.role}.jpg`);
    execFileSync('python3', ['scripts/lib/tonemap_hdr.py', src, dst, '0.5']);
    out.push(dst);
  } else {
    for (const [map, key] of [['color', 'Diffuse'], ['normal', 'nor_gl']]) {
      const src = join(TMP, `${a.id}_${map}_1k.jpg`);
      await download(files[key]['1k'].jpg.url, src);
      const dst = join(OUT, `${a.role}_${map}.jpg`);
      ff('-i', src, '-vf', `scale=${map === 'color' ? 512 : 256}:-1`, '-q:v', map === 'color' ? '4' : '5', dst);
      out.push(dst);
    }
  }
  manifest.assets.push({
    role: a.role, id: a.id, name: info.name, authors: Object.keys(info.authors ?? {}),
    page: `https://polyhaven.com/a/${a.id}`, files: out.map((p) => p.replace('public/', '')),
  });
  console.log(a.role, a.id, out.map((p) => `${(statSync(p).size / 1024).toFixed(0)} KB`).join(' '));
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
if (process.argv.includes('--clean')) rmSync(TMP, { recursive: true, force: true });
