import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Dev server only: serve dev-assets/candidates at /candidates for the asset comparison
 * gallery (compare.html). Candidate packs are third-party downloads that are not approved
 * for production, so they live outside public/ and never reach the production build.
 */
function candidateAssets(mount = '/candidates', dir = 'dev-assets/candidates'): Plugin {
  const root = resolve(__dirname, dir);
  const types: Record<string, string> = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.obj': 'text/plain', '.mtl': 'text/plain', '.fbx': 'application/octet-stream', '.dae': 'model/vnd.collada+xml', '.tga': 'image/x-tga' };
  return {
    name: `candidate-assets${mount}`,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(mount, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = resolve(root, '.' + rel);
        if (file !== root && !file.startsWith(root + sep)) { res.statusCode = 403; res.end(); return; }
        let st;
        try { st = statSync(file); } catch { res.statusCode = 404; res.end(`Candidate file not found: ${rel}. Run npm run candidates:fetch.`); return; }
        if (!st.isFile()) { next(); return; }
        res.setHeader('Content-Type', types[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(st.size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), candidateAssets(), candidateAssets('/tevy-candidates', 'dev-assets/tevy')],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    // libraries in their own files: a game update does not make players download them again
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three/')) return 'three';
          if (/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
    // three.js alone is ~700 kB minified and is needed from the title screen
    chunkSizeWarningLimit: 900,
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
