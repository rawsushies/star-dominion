import type { GameState } from '../../sim/types';
import { useEffect, useRef } from 'react';
import { questBeacons } from '../../guidance/beacons';
import { useUI } from '../store';
import { GalaxyView3D, galaxyCam, focusGalaxyOn, type FleetMark } from '../render/galaxy3d';
import { SystemView3D, orbitCam, type SysHit } from '../render/system3d';
import { PlanetView3D, planetCam } from '../render/planetScene';
import { getLedger } from '../../sim/engine';
import { isExplored } from '../../sim/territory';
import { FrameGate, ResolutionGovernor, currentViewQuality } from '../graphics';

let cameraForGame: unknown = null;

/** Centre the galaxy camera on a system, zooming in to local scale when far out. */
export function focusSystem(id: number) {
  const g = useUI.getState().game;
  if (!g) return;
  const s = g.galaxy.systems[id];
  focusGalaxyOn(s.x, s.y, s.z ?? 0, Math.min(galaxyCam.dist, 1400));
}

/** Frame a whole sector. */
export function focusSector(id: number) {
  const g = useUI.getState().game;
  const sec = g?.galaxy.sectors?.[id];
  if (!g || !sec) return;
  focusGalaxyOn(sec.x, sec.y, sec.z, Math.max(1600, Math.sqrt(sec.systems) * 260));
}

/** Zoom out to show the whole galaxy. */
export function showWholeGalaxy() {
  const g = useUI.getState().game;
  if (!g) return;
  const R = g.galaxy.shape?.R ?? g.galaxy.width / 2;
  focusGalaxyOn(g.galaxy.width / 2, g.galaxy.height / 2, 0, R * 2.4);
  galaxyCam.pitch = 1.05;
}

export function MapView() {
  const ref = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const sysRef = useRef<HTMLCanvasElement>(null);
  const view = useUI((s) => s.view);
  const systemId = useUI((s) => s.systemId);
  const planetId = useUI((s) => s.planetId);
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
    let gal: GalaxyView3D | null = null;
    let sys3d: SystemView3D | null = null;
    let planet3d: PlanetView3D | null = null;
    let drag: null | { x: number; y: number; lx: number; ly: number; moved: boolean; orbit: boolean } = null;
    const keys = new Set<string>();
    const g0 = useUI.getState().game;
    if (g0 && cameraForGame !== g0) {
      cameraForGame = g0;
      const cap = g0.empires[g0.playerId].capitalSystemId;
      if (cap != null) { const c = g0.galaxy.systems[cap]; focusGalaxyOn(c.x, c.y, c.z ?? 0, 1300); galaxyCam.pitch = 0.95; galaxyCam.yaw = 0.6; }
    }

    const size = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(currentViewQuality().tier === 'desktop' ? 2 : 1.5, window.devicePixelRatio || 1) * gov.scale;
      if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
        cv.width = Math.round(r.width * dpr);
        cv.height = Math.round(r.height * dpr);
      }
      return { w: r.width, h: r.height, dpr };
    };
    const show = (which: 'galaxy' | 'system' | 'planet') => {
      glRef.current!.style.visibility = which === 'galaxy' ? 'visible' : 'hidden';
      sysRef.current!.style.visibility = which === 'galaxy' ? 'hidden' : 'visible';
    };

    let last = performance.now();
    // render only as often as needed: full rate while the player handles the map, less when idle
    const gate = new FrameGate();
    const gov = new ResolutionGovernor();
    (window as unknown as { __sdRes?: ResolutionGovernor }).__sdRes = gov;
    let seenTick = -1;
    const unsub = useUI.subscribe((st, prev) => {
      if (st.view !== prev.view || st.systemId !== prev.systemId || st.planetId !== prev.planetId || st.fleetId !== prev.fleetId || st.mapMode !== prev.mapMode || st.pendingOrder !== prev.pendingOrder) gate.poke(400);
    });
    const draw = (t: number) => {
      const ui = useUI.getState();
      const g = ui.game;
      // the full-screen capital covers the map: draw nothing underneath it
      if (ui.view === 'capital') { raf = requestAnimationFrame(draw); return; }
      if (keys.size) gate.poke(200);
      if (g && g.tick !== seenTick && ui.speed === 0) { seenTick = g.tick; gate.invalidate(); }
      if (!gate.due(t, ui.speed > 0)) { raf = requestAnimationFrame(draw); return; }
      gov.frame(t, gate.active(t));
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (g) {
        const { w, h, dpr } = size();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (ui.view === 'planet' && ui.planetId != null) {
          show('planet');
          if (sys3d) { sys3d.dispose(); sys3d = null; }
          if (!planet3d) { try { planet3d = new PlanetView3D(sysRef.current!, currentViewQuality()); } catch { planet3d = null; } }
          ctx.clearRect(0, 0, w, h);
          planet3d?.frame(g, g.planets[ui.planetId], w, h, dpr, t);
          hits = []; marks = [];
        } else if (ui.view === 'system' && ui.systemId != null) {
          show('system');
          if (planet3d) { planet3d.dispose(); planet3d = null; }
          if (!sys3d) { try { sys3d = new SystemView3D(sysRef.current!, currentViewQuality()); } catch { sys3d = null; } }
          ctx.clearRect(0, 0, w, h);
          hits = sys3d ? sys3d.frame(g, g.galaxy.systems[ui.systemId], w, h, dpr, t, ui.planetId, ui.fleetId, ctx) : [];
          marks = [];
        } else {
          show('galaxy');
          if (!gal) { try { gal = new GalaxyView3D(glRef.current!, currentViewQuality()); } catch { gal = null; } }
          // keyboard panning and rotation
          const panSpeed = galaxyCam.dist * 0.9 * dt;
          const fx = -Math.cos(galaxyCam.yaw), fz = -Math.sin(galaxyCam.yaw);
          if (keys.has('w')) { galaxyCam.tx += fx * panSpeed; galaxyCam.ty += fz * panSpeed; }
          if (keys.has('s')) { galaxyCam.tx -= fx * panSpeed; galaxyCam.ty -= fz * panSpeed; }
          if (keys.has('a')) { galaxyCam.tx += fz * panSpeed; galaxyCam.ty -= fx * panSpeed; }
          if (keys.has('d')) { galaxyCam.tx -= fz * panSpeed; galaxyCam.ty += fx * panSpeed; }
          if (keys.has('q')) galaxyCam.yaw -= dt * 1.2;
          if (keys.has('e')) galaxyCam.yaw += dt * 1.2;
          let routes: { path: number[]; status: string }[] | undefined;
          if (ui.mapMode === 'trade') {
            const L = getLedger(g, g.empires[g.playerId]);
            routes = Object.values(L.planets).filter((p) => p.routePath.length > 1).map((p) => ({ path: p.routePath, status: p.routeStatus }));
          }
          marks = gal ? gal.frame(g, { w, h, dpr, time: t, selectedSystem: ui.systemId, selectedFleet: ui.fleetId, hoverSystem: hover, mode: ui.mapMode, routes, beacons: cachedBeacons(g, ui.rev) }, ctx) : [];
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
      gate.poke();
      if (e.button !== 0 && e.button !== 1) return;
      const orbit = e.button === 1 || e.shiftKey || e.altKey || useUI.getState().view !== 'galaxy';
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, orbit };
      if (e.button === 1) e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (e.target === cv || drag) gate.poke(300);
      const ui = useUI.getState();
      if (drag) {
        const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
        drag.lx = e.clientX; drag.ly = e.clientY;
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
        if (ui.view === 'system') {
          orbitCam.auto = false;
          orbitCam.theta += dx * 0.006;
          orbitCam.phi = Math.max(0.25, Math.min(1.5, orbitCam.phi - dy * 0.005));
        } else if (ui.view === 'planet') {
          planetCam.yaw += dx * 0.006;
          planetCam.pitch = Math.max(-1.2, Math.min(1.2, planetCam.pitch + dy * 0.005));
        } else if (drag.orbit) {
          galaxyCam.yaw += dx * 0.005;
          galaxyCam.pitch = Math.max(0.08, Math.min(1.55, galaxyCam.pitch + dy * 0.005));
        } else {
          // pan along the galactic plane, relative to the camera heading
          const k = galaxyCam.dist * 0.0016;
          const fx = -Math.cos(galaxyCam.yaw), fz = -Math.sin(galaxyCam.yaw);
          galaxyCam.tx += (fz * dx - fx * dy) * k * -1;
          galaxyCam.ty += (-fx * dx - fz * dy) * k * -1;
        }
      }
      if (ui.game && ui.view === 'galaxy' && gal) {
        const p = local(e);
        hover = gal.pick(ui.game, p.x, p.y, 12, false);
      }
    };
    const onUp = (e: MouseEvent) => {
      // only a press that began on the map is a map click: releasing the mouse over a panel or a
      // button must not pick the star behind it (that changed the selection and ate the click)
      if (!drag) return;
      if (e.button !== 0) { drag = null; return; }
      const wasDrag = drag.moved;
      drag = null;
      if (wasDrag) return;
      const ui = useUI.getState();
      const g = ui.game;
      if (!g) return;
      const p = local(e);
      if (ui.view === 'planet') return;
      if (ui.view === 'system') {
        const hit = hits.find((hh) => (hh.x - p.x) ** 2 + (hh.y - p.y) ** 2 <= hh.r * hh.r);
        if (!hit) { ui.set({ planetId: null, fleetId: null }); return; }
        if (hit.kind === 'planet') ui.selectPlanet(hit.id);
        else if (hit.kind === 'fleet') ui.selectFleet(hit.id);
        else ui.set({ planetId: null, fleetId: null });
        return;
      }
      if (!gal) return;
      const sys = gal.pick(g, p.x, p.y, 12, false);
      if (ui.pendingOrder && sys != null) { applyPending(sys); return; }
      const fm = marks.find((m) => (m.x - p.x) ** 2 + (m.y - p.y) ** 2 < 64);
      if (fm) { ui.selectFleet(fm.id); ui.set({ systemId: g.fleets[fm.id]?.systemId ?? ui.systemId }); return; }
      ui.selectSystem(sys);
    };
    const onDbl = (e: MouseEvent) => {
      gate.poke();
      const ui = useUI.getState();
      if (!ui.game) return;
      if (ui.view === 'system' && ui.planetId != null) { ui.set({ view: 'planet' }); return; }
      if (ui.view !== 'galaxy' || !gal) return;
      const p = local(e);
      const sys = gal.pick(ui.game, p.x, p.y, 12, false);
      if (sys != null && isExplored(ui.game.empires[ui.game.playerId], sys)) ui.set({ view: 'system', systemId: sys, planetId: null });
    };
    const onContext = (e: MouseEvent) => {
      gate.poke();
      e.preventDefault();
      const ui = useUI.getState();
      const g = ui.game;
      if (!g || ui.fleetId == null) return;
      const f = g.fleets[ui.fleetId];
      if (!f || f.ownerId !== g.playerId) return;
      let target: number | null = null;
      if (ui.view === 'galaxy' && gal) {
        const p = local(e);
        target = gal.pick(g, p.x, p.y, 14, false);
      } else target = ui.systemId;
      if (target != null) ui.cmd({ type: 'moveFleet', fleetId: f.id, target });
    };
    const onWheel = (e: WheelEvent) => {
      gate.poke();
      e.preventDefault();
      const view = useUI.getState().view;
      if (view === 'system') { orbitCam.dist = Math.max(8, Math.min(160, orbitCam.dist * Math.exp(e.deltaY * 0.0012))); return; }
      if (view === 'planet') { planetCam.dist = Math.max(2.2, Math.min(14, planetCam.dist * Math.exp(e.deltaY * 0.0012))); return; }
      const g = useUI.getState().game;
      if (!g || !gal) return;
      const p = local(e);
      const R = g.galaxy.shape?.R ?? g.galaxy.width / 2;
      const before = gal.planePoint(p.x, p.y, p.w, p.h);
      const nd = Math.max(80, Math.min(R * 3, galaxyCam.dist * Math.exp(e.deltaY * 0.0013)));
      const f = nd / galaxyCam.dist;
      galaxyCam.dist = nd;
      // zoom toward the point under the cursor
      if (before && f < 1) {
        galaxyCam.tx += (before[0] - galaxyCam.tx) * (1 - f);
        galaxyCam.ty += (before[1] - galaxyCam.ty) * (1 - f);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      gate.poke();
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) { keys.clear(); return; }
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(k)) { if (e.type === 'keydown') keys.add(k); else keys.delete(k); }
    };
    cv.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    cv.addEventListener('dblclick', onDbl);
    cv.addEventListener('contextmenu', onContext);
    cv.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    // a key released while the window is not focused never sends keyup: forget held keys on blur
    const onBlur = () => keys.clear();
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      unsub();
      cancelAnimationFrame(raf);
      cv.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      cv.removeEventListener('dblclick', onDbl);
      cv.removeEventListener('contextmenu', onContext);
      cv.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      gal?.dispose(); sys3d?.dispose(); planet3d?.dispose();
    };
  }, []);

  const set = useUI((s) => s.set);
  const sys = game && systemId != null ? game.galaxy.systems[systemId] : null;
  const sector = sys && sys.sector != null ? game!.galaxy.sectors?.[sys.sector] : null;
  const planet = game && planetId != null ? game.planets[planetId] : null;
  const galaxyName = game?.settings.galaxySize === 'milky' ? 'Milky Way' : 'Galaxy';
  return (
    <>
      <div className="map-layer"><canvas ref={glRef} aria-hidden /><canvas ref={sysRef} aria-hidden style={{ visibility: 'hidden' }} /><canvas ref={ref} aria-label="Galactic map" /></div>
      {view !== 'capital' && <nav className="sys-crumb" aria-label="Location">
        <button className="crumb" onClick={() => { set({ view: 'galaxy' }); showWholeGalaxy(); }}>{galaxyName}</button>
        {sector && <><span className="sep">›</span><button className="crumb" onClick={() => { set({ view: 'galaxy' }); focusSector(sector.id); }}>{sector.name}</button></>}
        {sys && game && isExplored(game.empires[game.playerId], sys.id) && <><span className="sep">›</span><button className={view === 'system' ? 'crumb on' : 'crumb'} onClick={() => set({ view: 'system' })}>{sys.name}</button></>}
        {planet && view !== 'galaxy' && <><span className="sep">›</span><button className={view === 'planet' ? 'crumb on' : 'crumb'} onClick={() => set({ view: 'planet' })}>{planet.name}</button></>}
        <span className="hint">{view === 'galaxy' ? 'Drag to pan · Shift-drag or middle-drag to tilt · scroll to zoom · WASD, Q/E · double-click a system to enter' : view === 'system' ? 'Drag to orbit · scroll to zoom · double-click a selected planet to land' : 'Drag to orbit · scroll to zoom'}</span>
      </nav>}
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

let beaconCache: { tick: number; rev: number; ids: number[] } = { tick: -1, rev: -1, ids: [] };
function cachedBeacons(g: GameState, rev: number): number[] {
  if (beaconCache.tick !== g.tick || beaconCache.rev !== rev) beaconCache = { tick: g.tick, rev, ids: questBeacons(g) };
  return beaconCache.ids;
}
