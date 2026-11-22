// Shared rendering pipeline for diorama-style 3D views (the capital laboratory first).
//
//   RenderPass  → scene into a linear HDR (half-float) target, MSAA on capable tiers
//   GTAOPass    → ground-truth ambient occlusion for contact shading (lower-cost mobile profile)
//   UnrealBloomPass → restrained bloom; the threshold sits above sunlit surfaces, so only
//                 emissive sci-fi lights bloom
//   OutputPass  → ACES filmic tone mapping and sRGB conversion, from the renderer settings
//
// Lighting: an HDR sky (Sky shader) is pre-filtered with PMREM into the scene environment, so
// PBR materials get matching reflections and ambient light; a directional sun casts shadows
// whose orthographic camera is fitted to the scene bounds in light space, with bias and
// normalBias derived from the shadow texel size.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export type QualityTier = 'mobile' | 'medium' | 'desktop';

export interface TierSettings {
  label: string;
  maxPixelRatio: number;
  msaa: number;
  shadowMap: number;
  shadowType: THREE.ShadowMapType;
  /** null disables ambient occlusion */
  gtao: { samples: number; denoiseSamples: number; resolution: number } | null;
  bloom: { strength: number; radius: number; threshold: number } | null;
  /** multiplier on decorative vegetation and props */
  density: number;
  /** camera distance beyond which small detail props are hidden */
  detailDistance: number;
  /** whether vegetation casts shadows and takes part in ambient occlusion */
  vegetationShadows: boolean;
  vegetationAO: boolean;
  /** use only the lighter tree models */
  lightVegetation: boolean;
}

export const TIERS: Record<QualityTier, TierSettings> = {
  desktop: { label: 'Desktop', maxPixelRatio: 2, msaa: 4, shadowMap: 4096, shadowType: THREE.PCFSoftShadowMap, gtao: { samples: 16, denoiseSamples: 16, resolution: 1 }, bloom: { strength: 0.32, radius: 0.35, threshold: 4.5 }, density: 1, detailDistance: 260, vegetationShadows: true, vegetationAO: true, lightVegetation: false },
  medium: { label: 'Medium', maxPixelRatio: 1.5, msaa: 2, shadowMap: 2048, shadowType: THREE.PCFSoftShadowMap, gtao: { samples: 12, denoiseSamples: 8, resolution: 0.75 }, bloom: { strength: 0.28, radius: 0.3, threshold: 4.5 }, density: 0.75, detailDistance: 190, vegetationShadows: true, vegetationAO: false, lightVegetation: false },
  mobile: { label: 'Mobile', maxPixelRatio: 1, msaa: 0, shadowMap: 1024, shadowType: THREE.PCFShadowMap, gtao: { samples: 8, denoiseSamples: 4, resolution: 0.5 }, bloom: null, density: 0.5, detailDistance: 140, vegetationShadows: false, vegetationAO: false, lightVegetation: true },
};

/** A conservative guess at the device class; callers can override it. */
export function detectTier(): QualityTier {
  if (typeof navigator === 'undefined') return 'desktop';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const touch = 'ontouchstart' in globalThis || (nav.maxTouchPoints ?? 0) > 0;
  const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600;
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 8;
  if ((touch && small) || mem <= 3 || cores <= 4) return 'mobile';
  if (touch || mem <= 6 || cores <= 6) return 'medium';
  return 'desktop';
}

/** Low-res AO: the AO buffers run at a fraction of the composer size, then blend up. */
class ScaledGTAOPass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, w: number, h: number, private factor: number) {
    super(scene, camera, Math.max(1, Math.round(w * factor)), Math.max(1, Math.round(h * factor)));
  }
  setSize(width: number, height: number) {
    super.setSize(Math.max(1, Math.round(width * this.factor)), Math.max(1, Math.round(height * this.factor)));
  }
  /**
   * Also leave out objects marked `userData.noAO` (water, transparent overlays): flat water
   * meeting a cliff otherwise reads as a deep crease and draws a dark ring around the coast.
   */
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse((o) => { if (o.userData.noAO) o.visible = false; });
  }
}

export interface SunOptions { elevation: number; azimuth: number; intensity: number; color?: THREE.ColorRepresentation }
/** Switch individual passes off for side-by-side comparison in the laboratory. */
export interface PassToggles { ao?: boolean; bloom?: boolean }

export class RenderPipeline {
  readonly settings: TierSettings;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: Sky;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator;
  private width = 1;
  private height = 1;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, camera: THREE.Camera, readonly tier: QualityTier, sun: SunOptions, passes: PassToggles = {}) {
    const t = (this.settings = TIERS[tier]);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = t.shadowType;
    renderer.setPixelRatio(Math.min(t.maxPixelRatio, globalThis.devicePixelRatio || 1));

    // sun and sky
    const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sun.elevation), THREE.MathUtils.degToRad(sun.azimuth));
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(dir);
    scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(4000);
    envSky.material.uniforms.sunPosition.value.copy(dir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) envSky.material.uniforms[k].value = u[k].value;
    envScene.add(envSky);
    this.envTarget = this.pmrem.fromScene(envScene, 0, 1, 5000);
    scene.environment = this.envTarget.texture;
    envSky.geometry.dispose(); envSky.material.dispose();

    this.sun = new THREE.DirectionalLight(sun.color ?? 0xfff3e0, sun.intensity);
    this.sun.position.copy(dir).multiplyScalar(200);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(t.shadowMap, t.shadowMap);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x5b6b45, 0.15);
    scene.add(this.hemi);

    // post-processing chain
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: t.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (t.gtao && passes.ao !== false) {
      this.gtao = new ScaledGTAOPass(scene, camera, 1, 1, t.gtao.resolution);
      this.gtao.updateGtaoMaterial({ samples: t.gtao.samples, radius: 0.55, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, distanceFallOff: 1.0 });
      this.gtao.updatePdMaterial({ samples: t.gtao.denoiseSamples, rings: 2, radius: 6, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
      this.gtao.blendIntensity = 0.9;
      this.composer.addPass(this.gtao);
    }
    if (t.bloom && passes.bloom !== false) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), t.bloom.strength, t.bloom.radius, t.bloom.threshold);
      this.composer.addPass(this.bloom);
    }
    this.output = new OutputPass();
    this.composer.addPass(this.output);
  }

  /**
   * Set how strongly the sky environment lights every material in `root` (three r160 has no
   * scene-wide environment intensity). Call after models are added.
   */
  setEnvironmentIntensity(root: THREE.Object3D, intensity: number) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) if ('envMapIntensity' in mat && mat.userData.envFixed !== true) mat.envMapIntensity = intensity;
    });
  }

  /**
   * Replace the procedural sky with a photographed one: an equirectangular image on a sky dome
   * (turned by `rotationY`, so its sun can be lined up with the light) that is also pre-filtered
   * into the scene environment. Returns the dome for the caller to add to the scene.
   */
  setSkyMap(tex: THREE.Texture, rotationY = 0, radius = 2000): THREE.Mesh {
    tex.colorSpace = THREE.SRGBColorSpace;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
    dome.rotation.y = rotationY;
    dome.renderOrder = -1;
    this.sky.visible = false;
    const envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(dome.geometry, dome.material);
    envDome.rotation.y = rotationY;
    envScene.add(envDome);
    const target = this.pmrem.fromScene(envScene, 0, 1, radius * 2);
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
    return dome;
  }

  /** Fit the sun's shadow camera tightly around `bounds`, seen from the sun. */
  fitShadow(bounds: THREE.Box3) {
    const centre = bounds.getCenter(new THREE.Vector3());
    const dir = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(dir, radius * 2);
    this.sun.updateMatrixWorld(true); this.sun.target.updateMatrixWorld(true);
    const view = new THREE.Matrix4().lookAt(this.sun.position, centre, new THREE.Vector3(0, 1, 0));
    const inv = view.clone().invert();
    const ls = new THREE.Box3();
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
      // into light view space (camera looks down -z)
      ls.expandByPoint(p.sub(this.sun.position).applyMatrix4(new THREE.Matrix4().extractRotation(inv)));
    }
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = ls.min.x; cam.right = ls.max.x; cam.bottom = ls.min.y; cam.top = ls.max.y;
    cam.near = Math.max(0.1, -ls.max.z - 1); cam.far = -ls.min.z + 1;
    cam.updateProjectionMatrix();
    const texel = Math.max(cam.right - cam.left, cam.top - cam.bottom) / this.settings.shadowMap;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = texel * 1.5;
    this.sun.shadow.needsUpdate = true;
  }

  setCamera(camera: THREE.Camera) {
    this.renderPass.camera = camera;
    if (this.gtao) this.gtao.camera = camera;
  }

  setSize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  render() {
    // count every pass of the frame (scene, AO normal pass, bloom, output), not just the last
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.composer.render();
  }

  /** GPU-side counters from the last frame (draw calls, triangles, live geometries and textures). */
  info() {
    const r = this.renderer.info;
    const passes = 1 + (this.gtao ? 1 : 0) + (this.bloom ? 1 : 0) + 1;
    return { calls: r.render.calls, triangles: r.render.triangles, geometries: r.memory.geometries, textures: r.memory.textures, passes, shadowMap: this.settings.shadowMap, pixelRatio: this.renderer.getPixelRatio(), aoScale: this.settings.gtao?.resolution ?? 0 };
  }

  dispose() {
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.output.dispose();
    this.renderPass.dispose();
    this.composer.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.sky.geometry.dispose(); this.sky.material.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.environment = null;
  }
}
