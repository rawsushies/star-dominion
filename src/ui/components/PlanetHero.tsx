import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Planet } from '../../sim/types';
import { buildPlanet } from '../render/planet3d';

/** A live, slowly rotating 3D render of one planet (used for large portraits). */
export function PlanetHero({ planet, size }: { planet: Planet; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lights = planet.colony ? Math.min(1, planet.colony.pops / 25) : 0;
  useEffect(() => {
    const cv = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(size * 1.3);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, W, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
    cam.position.set(0, 0.25, 6.6);
    cam.lookAt(0, 0, 0);
    const p = buildPlanet(planet.type, planet.id * 7919 + 13, lights, true);
    if (planet.type === 'gas_giant') p.group.scale.setScalar(0.62);
    scene.add(p.group);
    p.setLight(new THREE.Vector3(-0.85, 0.35, 0.55));
    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      p.setTime((t - t0) * 6 + planet.id * 1000);
      renderer.render(scene, cam);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); p.dispose(); renderer.dispose(); renderer.forceContextLoss(); };
  }, [planet.type, planet.id, size, lights]);
  return <canvas ref={ref} className="planet-hero" style={{ width: size * 1.3, height: size * 1.3, margin: -size * 0.15 }} aria-hidden />;
}
