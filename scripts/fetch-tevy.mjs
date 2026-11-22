// Fetches CC0 models from tevy.dev (https://tevy.dev, "All assets are CC0 1.0") at pinned
// versions, checks each file's sha256 against the site's catalogue, and records what was taken.
//   node scripts/fetch-tevy.mjs candidates   -> dev-assets/tevy/ (all candidates, for review)
//   node scripts/fetch-tevy.mjs              -> public/assets/models/tevy/ (the selected set)
// Files are GLB with meshopt geometry and KTX2 textures; the game decodes both
// (src/ui/render/assets/tevyLoader.ts, transcoder bundled in public/basis/).
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// slug -> [version, LODs to take]. LOD 0 is full detail; higher numbers have fewer triangles.
export const SELECTED = JSON.parse(readFileSync(new URL('./tevy-selection.json', import.meta.url)));

const mode = process.argv[2] ?? 'selected';
const OUT = mode === 'candidates' ? 'dev-assets/tevy' : 'public/assets/models/tevy';
mkdirSync(OUT, { recursive: true });

const catalogue = await (await fetch('https://tevy.dev/models.json')).json();
const bySlug = new Map(catalogue.models.map((m) => [m.slug, m]));
const list = mode === 'candidates' ? JSON.parse(readFileSync(new URL('./tevy-candidates.json', import.meta.url))) : SELECTED;
const manifest = { source: 'tevy.dev', license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', fetched: new Date().toISOString().slice(0, 10), models: [] };
for (const [slug, [version, lods]] of Object.entries(list)) {
  const meta = bySlug.get(slug) ?? (await (await fetch(`https://tevy.dev/models/${slug}.json`)).json());
  if (!meta) throw new Error(`unknown model ${slug}`);
  if (meta.license !== 'CC0-1.0') throw new Error(`${slug} is ${meta.license}, not CC0`);
  // the catalogue lists the latest version; older versions are read from the model's own metadata
  let files = meta.files;
  if (meta.version !== version) {
    const full = await (await fetch(`https://tevy.dev/models/${slug}.json`)).json();
    files = full.versions?.find((v) => v.version === version)?.files;
    if (!files) throw new Error(`${slug} has no version ${version}`);
  }
  const taken = [];
  for (const lod of lods) {
    const f = files.find((x) => x.lod === lod);
    if (!f) throw new Error(`${slug} v${version} has no LOD ${lod}`);
    const dst = join(OUT, `${slug}.lod${lod}.glb`);
    if (!existsSync(dst) || createHash('sha256').update(readFileSync(dst)).digest('hex') !== f.sha256) {
      const buf = Buffer.from(await (await fetch(`https://tevy.dev${f.path}`)).arrayBuffer());
      const sum = createHash('sha256').update(buf).digest('hex');
      if (sum !== f.sha256) throw new Error(`${slug} lod${lod}: checksum mismatch`);
      writeFileSync(dst, buf);
    }
    taken.push({ lod, file: dst.replace(/^public\//, ''), bytes: f.bytes, triangles: f.triangles, sha256: f.sha256 });
  }
  manifest.models.push({ slug, name: meta.name, version, page: `https://tevy.dev/models/${slug}`, dimensions: meta.dimensions, parts: meta.parts, animations: meta.animations, files: taken });
  console.log(`${slug} v${version}: ${taken.map((t) => `lod${t.lod} ${(t.bytes / 1024).toFixed(0)} KB ${t.triangles} tris`).join(', ')}`);
}
// seamless PBR ground materials (1K colour and normal maps, KTX2)
if (mode !== 'candidates') {
  const mats = await (await fetch('https://tevy.dev/materials.json')).json();
  const bySlugM = new Map(mats.materials.map((m) => [m.slug, m]));
  manifest.materials = [];
  const MOUT = 'public/assets/textures/tevy';
  mkdirSync(MOUT, { recursive: true });
  for (const [slug, version] of Object.entries(JSON.parse(readFileSync(new URL('./tevy-materials.json', import.meta.url))))) {
    const meta = bySlugM.get(slug);
    if (!meta || meta.license !== 'CC0-1.0' || meta.version !== version) throw new Error(`material ${slug} v${version} unavailable or not CC0`);
    const taken = [];
    for (const kind of ['color', 'normal']) {
      const f = meta.files.find((x) => x.path.endsWith(`/${kind}-1k.ktx2`));
      const dst = join(MOUT, `${slug}-${kind}-1k.ktx2`);
      if (!existsSync(dst) || createHash('sha256').update(readFileSync(dst)).digest('hex') !== f.sha256) {
        const buf = Buffer.from(await (await fetch(`https://tevy.dev${f.path}`)).arrayBuffer());
        if (createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error(`${slug} ${kind}: checksum mismatch`);
        writeFileSync(dst, buf);
      }
      taken.push({ file: dst.replace(/^public\//, ''), bytes: f.bytes, sha256: f.sha256 });
    }
    manifest.materials.push({ slug, name: meta.name, version, tileSize: meta.tileSize, page: `https://tevy.dev/materials/${slug}`, files: taken });
    console.log(`material ${slug} v${version}: ${taken.map((t) => `${(t.bytes / 1024).toFixed(0)} KB`).join(', ')}`);
  }
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
