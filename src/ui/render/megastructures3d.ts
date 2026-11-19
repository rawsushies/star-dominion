// Megastructures in the system view: staged 3D models assembled from sourced kit parts and NASA
// hardware (scripts/blender/assemble_megastructures.py).
// Each model holds one node per construction stage; completed stages are shown, and the stage
// under construction appears as a translucent wireframe scaffold. Swarm panels and lattice relays
// are instanced, with their count following construction.

import * as THREE from 'three';
import type { GameState, StarSystem, MegaInstance as Megastructure } from '../../sim/types';
import { MEGA_BY_ID } from '../../sim/data/megastructures';
import { instance, loadAsset, normalised } from './assets/loader';
import type { AssetId } from './assets/catalog';

export const MEGA_ASSET: Record<string, AssetId> = {
  orbital_ring: 'mega_orbital_ring', bastion: 'mega_bastion', dyson_swarm: 'mega_dyson_panel', stellar_collector: 'mega_stellar_collector',
  hypergate: 'mega_hypergate', grand_archive: 'mega_grand_archive', lattice: 'mega_lattice_relay', sector_array: 'mega_sector_array', continuum_engine: 'mega_continuum_engine',
};
export const MEGA_ASSETS = Object.values(MEGA_ASSET);

export interface MegaContext {
  starRadius: number;
  maxR: number;
  /** current position of a planet (they orbit), or null */
  planetPos(planetId: number): THREE.Vector3 | null;
  planetRadius(planetId: number): number;
  starbasePos: THREE.Vector3 | null;
}

const scaffold = new THREE.MeshBasicMaterial({ color: 0x8fd8ff, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false });

/** Show stage nodes 1..done; the next stage (if under construction) as scaffold; hide the rest. */
function applyStages(root: THREE.Object3D, done: number, building: boolean) {
  root.traverse((o) => {
    const m = /^stage_(\d+)/.exec(o.name);
    if (!m) return;
    const n = Number(m[1]);
    o.visible = n <= done || (building && n === done + 1);
    if (building && n === done + 1) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = scaffold; });
  });
}

function frac(m: Megastructure): number {
  const def = MEGA_BY_ID[m.id];
  return (m.stage + (m.building ? m.progress / def.stageDays : 0)) / def.stages;
}

interface Placed { obj: THREE.Object3D; follow?: { planetId: number; offset: THREE.Vector3 }; spin?: number }

/** Build every megastructure of a system. Call `update` each frame; call `dispose` when leaving. */
export class SystemMegastructures {
  readonly group = new THREE.Group();
  private placed: Placed[] = [];
  private owned: THREE.Object3D[] = [];
  private disposed = false;

  constructor(private state: GameState, private sys: StarSystem, private ctx: MegaContext) {
    void Promise.allSettled(MEGA_ASSETS.map(loadAsset)).then(() => { if (!this.disposed) this.build(); });
  }

  private build() {
    const { ctx, sys, state } = this;
    const R = ctx.starRadius;
    const anchorPlanet = (preferShipyard: boolean) => {
      const own = sys.planetIds.map((id) => state.planets[id]).filter((p) => p.colony && p.colony.ownerId === sys.owner);
      const pick = (preferShipyard ? own.find((p) => (p.colony!.buildings.shipyard ?? 0) > 0) : undefined) ?? own.sort((a, b) => b.colony!.pops - a.colony!.pops)[0];
      return pick?.id ?? null;
    };
    sys.megastructures.forEach((m, i) => {
      const asset = MEGA_ASSET[m.id];
      if (!asset) return;
      const def = MEGA_BY_ID[m.id];
      const done = Math.min(m.stage, def.stages);
      if (m.id === 'dyson_swarm' || m.id === 'lattice') { this.instanced(m, asset); return; }
      const src = instance(asset);
      if (!src) return;
      applyStages(src, done, m.building);
      let obj: THREE.Object3D, follow: Placed['follow'], spin = 0;
      const side = i % 2 ? -1 : 1;
      switch (m.id) {
        case 'orbital_ring': {
          const pid = anchorPlanet(true);
          const pr = pid != null ? ctx.planetRadius(pid) : 0.6;
          obj = normalised(src, { length: pr * 5.2 });
          if (pid != null) follow = { planetId: pid, offset: new THREE.Vector3(0, 0, 0) };
          obj.rotation.x = -0.12; spin = 0.02;
          break;
        }
        case 'grand_archive': {
          const pid = anchorPlanet(false);
          obj = normalised(src, { height: R * 1.4 });
          if (pid != null) follow = { planetId: pid, offset: new THREE.Vector3(1.6, 0.6, 0.8) };
          spin = 0.05;
          break;
        }
        case 'bastion': {
          obj = normalised(src, { length: R * 1.3 });
          const p = ctx.starbasePos?.clone() ?? new THREE.Vector3(R * 2.6, 0.6, -R * 1.4);
          obj.position.copy(p).add(new THREE.Vector3(1.4, 0.4, 1.2));
          spin = 0.03;
          break;
        }
        case 'hypergate': {
          obj = normalised(src, { length: R * 2.4 });
          obj.position.set(-(ctx.maxR + 2.5), 0.5, ctx.maxR * 0.25);
          obj.rotation.y = Math.PI / 2;
          break;
        }
        case 'stellar_collector': {
          obj = normalised(src, { length: R * 3.2 });
          obj.position.set(side * R * 2.6, R * 0.4, R * 1.4);
          obj.lookAt(0, obj.position.y, 0); obj.rotateY(-Math.PI / 2); // dish (+X in the model) faces the star
          break;
        }
        case 'sector_array': {
          obj = normalised(src, { length: R * 4.4 });
          obj.position.set(0, R * 4.2, 0);
          spin = 0.01;
          break;
        }
        case 'continuum_engine': {
          obj = normalised(src, { length: R * 3.4 });
          obj.position.set(-side * R * 3.6, R * 0.8, -R * 2.2);
          spin = 0.08;
          break;
        }
        default:
          obj = normalised(src, { length: R * 2 });
      }
      obj.userData.megaId = m.id;
      this.group.add(obj);
      this.placed.push({ obj, follow, spin });
    });
  }

  /** Dyson collectors on shells around the star; lattice relays in orbit round the realm's world. */
  private instanced(m: Megastructure, asset: AssetId) {
    const src = instance(asset);
    if (!src) return;
    const { ctx } = this;
    const R = ctx.starRadius;
    const f = frac(m);
    const dyson = m.id === 'dyson_swarm';
    const count = dyson ? Math.round(700 * f) : Math.max(4, Math.round(24 * f));
    if (!count) return;
    src.updateMatrixWorld(true);
    const parts: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
    src.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.visible !== false) parts.push({ geo: mesh.geometry, mat: mesh.material as THREE.Material, local: mesh.matrixWorld.clone() }); });
    const holder = new THREE.Group();
    const size = dyson ? R * 0.085 : 0.22;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(size, size, size);
    const look = new THREE.Matrix4();
    const meshes = parts.map((p) => new THREE.InstancedMesh(p.geo, p.mat, count));
    for (let i = 0; i < count; i++) {
      const h1 = fract(Math.sin((i + 1) * 12.9898) * 43758.5453), h2 = fract(Math.sin((i + 1) * 78.233) * 12345.678), h3 = fract(Math.sin((i + 1) * 39.425) * 24634.633);
      if (dyson) {
        // three tilted shells; panels face the star
        const shell = i % 3, rr = R * (1.9 + shell * 0.35 + h3 * 0.15);
        const u = h1 * 2 - 1, a = h2 * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos.set(Math.cos(a) * s * rr, u * rr * 0.9, Math.sin(a) * s * rr);
        look.lookAt(pos, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
        q.setFromRotationMatrix(look);
      } else {
        const a = (i / count) * Math.PI * 2, incl = (i % 3 - 1) * 0.5;
        pos.set(Math.cos(a) * 1.7, Math.sin(a) * incl, Math.sin(a) * 1.7);
        q.setFromEuler(new THREE.Euler(0, -a, 0));
      }
      m4.compose(pos, q, scl);
      meshes.forEach((im, k) => im.setMatrixAt(i, m4.clone().multiply(parts[k].local)));
    }
    for (const im of meshes) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); holder.add(im); this.owned.push(im); }
    let follow: Placed['follow'];
    if (!dyson) {
      const own = this.sys.planetIds.map((id) => this.state.planets[id]).filter((p) => p.colony && p.colony.ownerId === this.sys.owner).sort((a, b) => b.colony!.pops - a.colony!.pops)[0];
      if (own) follow = { planetId: own.id, offset: new THREE.Vector3() };
      holder.scale.setScalar(own ? Math.max(1, ctx.planetRadius(own.id) * 1.4) : 1);
    }
    holder.userData.megaId = m.id;
    this.group.add(holder);
    this.placed.push({ obj: holder, follow, spin: dyson ? 0.01 : 0.15 });
  }

  update(dt: number) {
    for (const p of this.placed) {
      if (p.follow) { const at = this.ctx.planetPos(p.follow.planetId); if (at) p.obj.position.copy(at).add(p.follow.offset); }
      if (p.spin) p.obj.rotation.y += p.spin * dt;
    }
  }

  dispose() {
    this.disposed = true;
    // instanced meshes own only their instance buffers; geometry and materials belong to the model cache
    for (const o of this.owned) (o as THREE.InstancedMesh).dispose();
    this.group.clear();
  }
}

function fract(x: number) { return x - Math.floor(x); }
