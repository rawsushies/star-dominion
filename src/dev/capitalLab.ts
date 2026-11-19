// Capital laboratory (development only): open /capitallab.html on the dev server.
//   A — the production capital, unchanged
//   B — the production scene with the new lighting and post-processing pipeline
//   C — the terraced island diorama (KayKit environment, CC0)
// Every variant renders the same sample capital (src/dev/sampleCapital.ts) from the same camera
// angle. Query: variant=a|b|c, quality=desktop|medium|mobile, projection=perspective|orthographic,
// still=1 (no motion, no HUD: for screenshots). Fetch the KayKit packs first: npm run candidates:fetch.

const params = new URLSearchParams(location.search);
if (params.has('gallery')) void import('./capitalLabGallery').then((m) => m.renderGallery());
else void import('./capitalLabLive');
