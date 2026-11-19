// Megastructure lab (development only): /megalab.html?stage=<n>&focus=<id>
// Renders the real system view with every megastructure placed in the player's home system at the
// requested completed stage (the following stage shows as scaffold), for visual checks.
import { newGame } from '../sim/engine';
import { MEGASTRUCTURES } from '../sim/data/megastructures';
import { SystemView3D, orbitCam } from '../ui/render/system3d';

const q = new URLSearchParams(location.search);
const want = Number(q.get('stage') ?? 99);
const only = q.get('only')?.split(',');
const s = newGame({ seed: 7 });
const me = s.empires[s.playerId];
const sys = s.galaxy.systems[me.capitalSystemId!];
// a shipyard for the orbital ring, and a starbase
s.planets[me.capitalPlanetId!].colony!.buildings.shipyard = 1;
sys.starbase = Math.max(sys.starbase, 2);
sys.megastructures = MEGASTRUCTURES.filter((d) => !only || only.includes(d.id)).map((d) => {
  const stage = Math.min(d.stages, want);
  return { id: d.id, ownerId: me.id, stage, progress: stage < d.stages ? Math.floor(d.stageDays / 2) : 0, building: stage < d.stages };
});
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ov = (document.getElementById('ov') as HTMLCanvasElement).getContext('2d')!;
const view = new SystemView3D(canvas);
orbitCam.auto = false;
document.getElementById('bar')!.textContent = `${sys.megastructures.length} megastructures at stage ≤ ${want} in ${sys.name}`;
let frames = 0;
const loop = (t: number) => {
  const w = innerWidth, h = innerHeight, dpr = Math.min(2, devicePixelRatio);
  if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; (ov.canvas as HTMLCanvasElement).width = w * dpr; (ov.canvas as HTMLCanvasElement).height = h * dpr; }
  view.frame(s, sys, w, h, dpr, q.has('still') ? 1000 : t, null, null, ov);
  if (frames === 0) { // the view frames a new system on its first frame; apply camera overrides after
    if (q.get('dist')) orbitCam.dist = Number(q.get('dist'));
    if (q.get('phi')) orbitCam.phi = Number(q.get('phi'));
    if (q.get('theta')) orbitCam.theta = Number(q.get('theta'));
  }
  if (++frames === 90) document.body.dataset.ready = '1';
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
