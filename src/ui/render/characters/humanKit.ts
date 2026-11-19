// Human characters assembled at runtime from the Quaternius base character, modular outfit and
// animation packs (scripts/blender/build_characters.py builds chars2/male.glb, female.glb, anims.glb).
// One skinned model per sex holds every part; a HumanSpec says which parts show, how the outfit
// textures are recoloured (a gradient map with separate cloth and leather palettes), the skin and
// hair tones, proportions and the animation to play.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { instance, loadAsset } from '../assets/loader';
import type { AssetId } from '../assets/catalog';

export type Sex = 'male' | 'female';
export type OutfitPart = 'ranger' | 'peasant';
export type Hair = 'hair_buzzed' | 'hair_simpleparted' | 'hair_long' | 'hair_buns' | 'hair_buzzedfemale' | null;

/** Three-stop gradient (shadow, mid, highlight) applied to the luminance of an outfit texture. */
export type Ramp = [number, number, number];
export interface Palette { cloth: Ramp; leather: Ramp; keep?: number }

export interface HumanSpec {
  sex: Sex;
  body: OutfitPart; arms: OutfitPart; legs: OutfitPart; feet: OutfitPart;
  hood?: boolean; pauldron?: boolean;
  hair: Hair; beard?: boolean;
  skin: number; hairColor: number;
  palette: Palette;
  /** overall height factor (about 0.94..1.06) and shoulder breadth factor */
  height: number; build: number;
  anim: string;
  /** a sidearm held in the right hand */
  prop?: 'pistol' | 'revolver';
}

export const HUMAN_ASSETS: Record<Sex | 'anims' | 'props', AssetId> = { male: 'human_male', female: 'human_female', anims: 'human_anims', props: 'human_props' };

/** Held props: length in metres, and where the grip sits from the hand (model space: +Z forward, +Y up). */
export const GRIP = { length: 0.24, offset: new THREE.Vector3(0.045, -0.035, 0.04) };

/** Median skin colour of the packs' skin textures; tones are applied as a ratio to it. */
const BASE_SKIN = new THREE.Color().setRGB(170 / 255, 115 / 255, 80 / 255, THREE.SRGBColorSpace);

export function loadHumanKit(): Promise<GLTF[]> {
  return Promise.all([loadAsset(HUMAN_ASSETS.male), loadAsset(HUMAN_ASSETS.female), loadAsset(HUMAN_ASSETS.anims), loadAsset(HUMAN_ASSETS.props)]);
}

const lin = (hex: number) => new THREE.Color(hex);

/** Outfit material: the texture's luminance through the palette ramps. Ranger cloth is the green
 * fabric (green above red); Peasant cloth is the light shirt fabric. Everything else is leather. */
function outfitMaterial(src: THREE.MeshStandardMaterial, palette: Palette, mode: OutfitPart): THREE.MeshStandardMaterial {
  const m = src.clone();
  const u = {
    uC: { value: palette.cloth.map(lin) }, uL: { value: palette.leather.map(lin) },
    uKeep: { value: palette.keep ?? 0.12 }, uMode: { value: mode === 'ranger' ? 0 : 1 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uC[3]; uniform vec3 uL[3]; uniform float uKeep; uniform int uMode;
vec3 ramp(vec3 c[3], float l) { return l < 0.5 ? mix(c[0], c[1], l * 2.0) : mix(c[1], c[2], (l - 0.5) * 2.0); }`)
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 texel = texture2D(map, vMapUv);
  float lum = clamp(dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722)) * 2.2, 0.0, 1.0);
  float cloth = uMode == 0 ? smoothstep(-0.005, 0.03, texel.g - texel.r) : smoothstep(0.28, 0.42, lum);
  vec3 g = mix(ramp(uL, lum), ramp(uC, lum), cloth);
  diffuseColor *= vec4(mix(g, texel.rgb, uKeep), texel.a);
#endif`);
  };
  m.customProgramCacheKey = () => `outfit-${mode}`;
  return m;
}

const PARTS = new Set(['head', 'eyes', 'eyebrows_regular', 'eyebrows_female', 'hair_beard', 'hair_buzzed', 'hair_simpleparted', 'hair_long', 'hair_buns', 'hair_buzzedfemale',
  'ranger_body', 'ranger_arms', 'ranger_legs', 'ranger_feet', 'ranger_hood', 'ranger_pauldron', 'peasant_body', 'peasant_arms', 'peasant_legs', 'peasant_feet']);
const isOutfit = (name: string) => /Ranger|Peasant/i.test(name);
const isSkin = (name: string) => /Superhero|Regular/i.test(name);
const isHair = (name: string) => /Hair/i.test(name);

/** A posed, dressed, animated human. Call `update(dt)` each frame and `dispose()` when done. */
export class Human {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  private owned: THREE.Material[] = [];
  private action: THREE.AnimationAction | null = null;

  constructor(spec: HumanSpec) {
    const model = instance(HUMAN_ASSETS[spec.sex]);
    if (!model) throw new Error('human kit not loaded');
    this.root = model;
    const show = new Set<string>(['head', 'eyes', spec.sex === 'male' ? 'eyebrows_regular' : 'eyebrows_female']);
    show.add(`${spec.body}_body`); show.add(`${spec.arms}_arms`); show.add(`${spec.legs}_legs`); show.add(`${spec.feet}_feet`);
    if (spec.hood) show.add('ranger_hood');
    if (spec.pauldron) show.add('ranger_pauldron');
    if (spec.hair && !spec.hood) show.add(spec.hair);
    if (spec.beard && spec.sex === 'male') show.add('hair_beard');
    const skin = lin(spec.skin), ratio = new THREE.Color(skin.r / BASE_SKIN.r, skin.g / BASE_SKIN.g, skin.b / BASE_SKIN.b);
    const cache = new Map<THREE.Material, THREE.Material>();
    // parts are nodes named by the build script (three drops the dots: head.001 -> head001, and a
    // multi-material part becomes a group whose child meshes carry other names); visibility is set on
    // the part's node and inherited by everything under it
    const partOf = (o: THREE.Object3D) => o.name.replace(/(_\d+|\d{3})+$/, '');
    model.traverse((o) => { const k = partOf(o); if (PARTS.has(k)) o.visible = show.has(k); });
    const shown = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh || !shown(mesh)) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned bounds do not follow the animation
      const swap = (mt: THREE.Material) => {
        let out = cache.get(mt);
        if (out) return out;
        const std = mt as THREE.MeshStandardMaterial;
        const part = /Ranger/i.test(mt.name) ? 'ranger' : 'peasant';
        if (isOutfit(mt.name)) out = outfitMaterial(std, spec.palette, part);
        else if (isSkin(mt.name)) { out = std.clone(); (out as THREE.MeshStandardMaterial).color.copy(ratio); }
        else if (isHair(mt.name)) { out = std.clone(); (out as THREE.MeshStandardMaterial).color.copy(lin(spec.hairColor)); }
        else out = mt;
        if (out !== mt) this.owned.push(out);
        cache.set(mt, out);
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    // proportions: overall height, and broader or narrower shoulders
    model.scale.setScalar(spec.height);
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone && /^clavicle_/.test(o.name)) o.scale.set(1, spec.build, spec.build);
    });
    this.mixer = new THREE.AnimationMixer(model);
    this.play(spec.anim);
    if (spec.prop) this.hold(spec.prop);
  }

  /** The kit's animation clips (shared by every human; anims.glb lends only its clips). */
  static clips(): THREE.AnimationClip[] { return animClips; }

  /** Put a prop from the kit in the right hand. The figure is posed first, then the prop is aligned
   * in model space (barrel forward along +Z, up +Y) and expressed in the hand bone's frame, so it
   * follows the hand through the animation. */
  hold(prop: 'pistol' | 'revolver') {
    const props = instance(HUMAN_ASSETS.props);
    const src = props?.getObjectByName(`prop_${prop}`);
    const hand = this.root.getObjectByName('hand_r');
    if (!src || !hand) return;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
    const item = src.clone(true);
    const box = new THREE.Box3().setFromObject(item), size = box.getSize(new THREE.Vector3());
    item.position.sub(box.getCenter(new THREE.Vector3())).add(new THREE.Vector3(size.x * 0.28, 0, 0)); // grip behind the middle
    const holder = new THREE.Group();
    holder.add(item);
    // desired world transform: barrel (+X of the prop) along the figure's forward, at the hand
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const wantQ = rootQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
    const wantP = hand.getWorldPosition(new THREE.Vector3()).add(GRIP.offset.clone().multiplyScalar(this.root.scale.x).applyQuaternion(rootQ));
    const handQ = hand.getWorldQuaternion(new THREE.Quaternion()), handS = hand.getWorldScale(new THREE.Vector3()).x;
    holder.quaternion.copy(handQ.clone().invert().multiply(wantQ));
    holder.position.copy(hand.worldToLocal(wantP));
    holder.scale.setScalar((GRIP.length * this.root.scale.x) / Math.max(size.x, 1e-3) / handS);
    holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    holder.name = 'held_prop';
    hand.add(holder);
  }

  play(name: string, fade = 0.25) {
    const clip = animClips.find((c) => c.name === name) ?? animClips.find((c) => c.name === 'idle');
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset().play();
    if (this.action && this.action !== next) this.action.crossFadeTo(next, fade, false);
    this.action = next;
  }

  /** Play a clip once, then return to `base`. */
  gesture(name: string, base: string) {
    const clip = animClips.find((c) => c.name === name);
    if (!clip) return;
    const a = this.mixer.clipAction(clip);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.reset().play();
    this.action?.crossFadeTo(a, 0.3, false);
    this.action = a;
    const back = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== a) return;
      this.mixer.removeEventListener('finished', back);
      this.play(base, 0.4);
    };
    this.mixer.addEventListener('finished', back);
  }

  update(dt: number) { this.mixer.update(dt); }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const m of this.owned) m.dispose();
    this.owned = [];
    this.root.removeFromParent();
  }
}

let animClips: THREE.AnimationClip[] = [];
/** Load the kit and register its clips; resolves when humans can be built. */
export async function readyHumans(): Promise<void> {
  const [, , anims] = await loadHumanKit();
  animClips = anims.animations;
}
