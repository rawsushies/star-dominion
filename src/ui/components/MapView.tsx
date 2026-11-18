import { useEffect, useRef } from 'react';
import { useUI } from '../store';
import { drawGalaxy, hitSystem, screenToWorld, type Camera, type FleetMark } from '../render/galaxyRenderer';
import { SystemView3D, orbitCam, type SysHit } from '../render/system3d';
import { getLedger } from '../../sim/engine';


export const camera: Camera = { x: 0, y: 0, zoom: 0.8 };
let cameraForGame: unknown = null;

export function focusSystem(id: number) {
  const g = useUI.getState().game;
  if (!g) return;
  const s = g.galaxy.systems[id];
  camera.x = s.x; camera.y = s.y;
  if (camera.zoom < 0.9) camera.zoom = 1.1;
}

export function MapView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const view = useUI((s) => s.view);
  const systemId = useUI((s) => s.systemId);
  const pending = useUI((s) => s.pendingOrder);
  const game = useUI((s) => s.game);
  useUI((s) => s.rev);

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    let marks: FleetMark[] = [];
    let hits: SysHit[] = [];
    let hover: number | null = null;
    let sys3d: SystemView3D | null = null;
    let drag: null | { x: number; y: number; cx: number; cy: number; moved: boolean } = null;
    const g0 = useUI.getState().game;
    if (g0 && cameraForGame !== g0) {
      cameraForGame = g0;
      const cap = g0.empires[g0.playerId].capitalSystemId;
      if (cap != null) { camera.x = g0.galaxy.systems[cap].x; camera.y = g0.galaxy.systems[cap].y; camera.zoom = 1.0; }
    }

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
      }
      return { w: r.width, h: r.height, dpr };
    };

    const draw = (t: number) => {
      const ui = useUI.getState();
      const g = ui.game;
      if (g) {
        const { w, h, dpr } = size();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (ui.view === 'system' && ui.systemId != null) {
          if (!sys3d) { try { sys3d = new SystemView3D(glRef.current!); } catch { sys3d = null; } }
          glRef.current!.style.visibility = 'visible';
          ctx.clearRect(0, 0, w, h);
          hits = sys3d ? sys3d.frame(g, g.galaxy.systems[ui.systemId], w, h, dpr, t, ui.planetId, ui.fleetId, ctx) : [];
          marks = [];
        } else {
          glRef.current!.style.visibility = 'hidden';
          let routes: { path: number[]; status: string }[] | undefined;
          if (ui.mapMode === 'trade') {
            const L = getLedger(g, g.empires[g.playerId]);
            routes = Object.values(L.planets).filter((p) => p.routePath.length > 1).map((p) => ({ path: p.routePath, status: p.routeStatus }));
          }
          marks = drawGalaxy(ctx, g, { w, h, dpr, cam: camera, selectedSystem: ui.systemId, selectedFleet: ui.fleetId, hoverSystem: hover, mode: ui.mapMode, routes, time: t });
          hits = [];
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const local = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false };
      (drag as any).lx = e.clientX; (drag as any).ly = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      const ui = useUI.getState();
      if (drag && ui.view === 'system') {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        orbitCam.auto = false;
        orbitCam.theta += (e.clientX - (drag as any).lx) * 0.006;
        orbitCam.phi = Math.max(0.25, Math.min(1.5, orbitCam.phi - (e.clientY - (drag as any).ly) * 0.005));
        (drag as any).lx = e.clientX; (drag as any).ly = e.clientY;
      }
      if (drag && ui.view === 'galaxy') {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        camera.x = drag.cx - dx / camera.zoom;
        camera.y = drag.cy - dy / camera.zoom;
      }
      if (ui.game && ui.view === 'galaxy') {
        const p = local(e);
        hover = hitSystem(ui.game, camera, p.w, p.h, p.x, p.y);
      }
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const wasDrag = drag?.moved;
      drag = null;
      if (wasDrag) return;
      const ui = useUI.getState();
      const g = ui.game;
      if (!g) return;
      const p = local(e);
      if (ui.view === 'system') {
        const hit = hits.find((hh) => (hh.x - p.x) ** 2 + (hh.y - p.y) ** 2 <= hh.r * hh.r);
        if (!hit) { ui.set({ planetId: null, fleetId: null }); return; }
        if (hit.kind === 'planet') ui.selectPlanet(hit.id);
        else if (hit.kind === 'fleet') ui.selectFleet(hit.id);
        else ui.set({ planetId: null, fleetId: null });
        return;
      }
      const sys = hitSystem(g, camera, p.w, p.h, p.x, p.y);
      if (ui.pendingOrder && sys != null) {
        applyPending(sys);
        return;
      }
      const fm = marks.find((m) => (m.x - p.x) ** 2 + (m.y - p.y) ** 2 < 64);
      if (fm) { ui.selectFleet(fm.id); ui.set({ systemId: g.fleets[fm.id]?.systemId ?? ui.systemId }); return; }
      ui.selectSystem(sys);
    };
    const onDbl = (e: MouseEvent) => {
      const ui = useUI.getState();
      if (!ui.game || ui.view !== 'galaxy') return;
      const p = local(e);
      const sys = hitSystem(ui.game, camera, p.w, p.h, p.x, p.y);
      if (sys != null && ui.game.empires[ui.game.playerId].explored.includes(sys)) ui.set({ view: 'system', systemId: sys, planetId: null });
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const ui = useUI.getState();
      const g = ui.game;
      if (!g || ui.fleetId == null) return;
      const f = g.fleets[ui.fleetId];
      if (!f || f.ownerId !== g.playerId) return;
      let target: number | null = null;
      if (ui.view === 'galaxy') {
        const p = local(e);
        target = hitSystem(g, camera, p.w, p.h, p.x, p.y);
      } else target = ui.systemId;
      if (target != null) ui.cmd({ type: 'moveFleet', fleetId: f.id, target });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (useUI.getState().view === 'system') { orbitCam.dist = Math.max(8, Math.min(160, orbitCam.dist * Math.exp(e.deltaY * 0.0012))); return; }
      if (useUI.getState().view !== 'galaxy') return;
      const p = local(e);
      const [wx, wy] = screenToWorld(camera, p.w, p.h, p.x, p.y);
      const z = Math.max(0.25, Math.min(3.2, camera.zoom * Math.exp(-e.deltaY * 0.0015)));
      camera.zoom = z;
      const [nx, ny] = screenToWorld(camera, p.w, p.h, p.x, p.y);
      camera.x += wx - nx;
      camera.y += wy - ny;
    };
    cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('dblclick', onDbl);
    cv.addEventListener('contextmenu', onContext);
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cv.removeEventListener('dblclick', onDbl);
      cv.removeEventListener('contextmenu', onContext);
      cv.removeEventListener('wheel', onWheel);
      sys3d?.dispose();
    };
  }, []);

  const set = useUI((s) => s.set);
  const sysName = game && systemId != null ? game.galaxy.systems[systemId].name : '';
  return (
    <>
      <div className="map-layer"><canvas ref={glRef} className="gl" aria-hidden style={{ visibility: 'hidden' }} /><canvas ref={ref} aria-label="Galactic map" /></div>
      {view === 'system' && (
        <div className="sys-crumb">
          <button className="btn small" onClick={() => set({ view: 'galaxy' })}>Back to galaxy</button>
          <span className="nm">{sysName}</span>
          <span className="hint">Drag to orbit · scroll to zoom</span>
        </div>
      )}
      {pending && (
        <div className="order-banner glass">
          <span>{pending.kind === 'move' ? 'Choose a destination system' : pending.kind === 'patrol' ? 'Choose the far end of the patrol route' : pending.kind === 'outpost' ? 'Choose an unclaimed system for the outpost' : 'Choose a system to blockade'}</span>
          <button className="btn small" onClick={() => set({ pendingOrder: null })}>Cancel</button>
        </div>
      )}
    </>
  );
}

function applyPending(target: number) {
  const ui = useUI.getState();
  const g = ui.game!;
  const po = ui.pendingOrder!;
  const f = g.fleets[po.fleetId];
  ui.set({ pendingOrder: null });
  if (!f) return;
  if (po.kind === 'move') ui.cmd({ type: 'moveFleet', fleetId: f.id, target });
  else if (po.kind === 'patrol') ui.cmd({ type: 'fleetOrder', fleetId: f.id, order: { type: 'patrol', a: f.systemId, b: target, leg: 0 } });
  else if (po.kind === 'outpost') ui.cmd({ type: 'fleetOrder', fleetId: f.id, order: { type: 'outpost', systemId: target } });
  else if (po.kind === 'blockade') ui.cmd({ type: 'fleetOrder', fleetId: f.id, order: { type: 'blockade', systemId: target } });
}
