// Real-time 3D planets (Three.js). Every world is a lit sphere whose surface is
// generated in the fragment shader from 3D simplex noise: continents and seas,
// dunes, ice sheets, lava fissures or gas bands, with a separate cloud layer,
// ocean glint, night-side city lights and an atmospheric scattering shell.
// No textures or external assets are used, so every planet is unique and free.

import * as THREE from 'three';
import { PLANET_TYPES } from '../../sim/data/planets';
import type { PlanetType } from '../../sim/types';

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int oct){float a=0.5,s=0.0,n=0.0;for(int i=0;i<8;i++){if(i>=oct)break;s+=a*snoise(p);n+=a;p=p*2.03+vec3(1.7,9.2,3.1);a*=0.5;}return s/n*0.5+0.5;}
float ridged(vec3 p,int oct){float a=0.5,s=0.0,n=0.0;for(int i=0;i<8;i++){if(i>=oct)break;s+=a*(1.0-abs(snoise(p)));n+=a;p=p*2.1+vec3(3.3,1.1,7.7);a*=0.5;}return s/n;}
`;

const VERT = /* glsl */ `
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
void main(){
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform int uKind; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uHi; uniform vec3 uAtmo;
uniform float uAtmoK; uniform float uSea; uniform float uIce; uniform float uCloud; uniform float uLights;
uniform vec3 uSeed; uniform float uRot; uniform float uCloudRot; uniform vec3 uLight; uniform float uDetail;
varying vec3 vPos; varying vec3 vN; varying vec3 vV;
${NOISE_GLSL}
vec3 rotY(vec3 p, float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
float height(vec3 p){
  if(uKind==0){ return fbm(p*1.5+uSeed,6)*0.75 + ridged(p*3.0+uSeed,4)*0.25; }
  if(uKind==1){ return fbm(p*2.0+uSeed,6); }
  if(uKind==2){ return fbm(p*1.8+uSeed,5); }
  if(uKind==3){ return fbm(p*2.2+uSeed,5); }
  return fbm(p*1.6+uSeed,4);
}
void main(){
  vec3 p = rotY(normalize(vPos), uRot);
  vec3 n = normalize(vN);
  vec3 L = normalize(uLight);
  vec3 V = normalize(vV);
  float h = height(p);
  vec3 col; float spec = 0.0; float land = 1.0; vec3 emit = vec3(0.0);
  if(uKind==5){
    // gas giant: turbulent latitudinal bands and a long-lived storm
    float warp = fbm(p*vec3(1.5,7.0,1.5)+uSeed,5);
    float b = sin(p.y*14.0 + warp*6.0 + uSeed.x) * 0.5 + 0.5;
    float b2 = sin(p.y*33.0 + warp*9.0) * 0.5 + 0.5;
    col = mix(uDeep, uMid, b);
    col = mix(col, uHi, smoothstep(0.6, 1.0, b2) * 0.55);
    vec3 sc = normalize(vec3(0.6, -0.28, 0.75));
    float storm = smoothstep(0.24, 0.0, distance(p, sc) + snoise(p*9.0)*0.03);
    col = mix(col, uHi*1.05 + vec3(0.08,0.02,0.0), storm*0.8);
    land = 0.0;
  } else if(uKind==0){
    // terrestrial: seas, coasts, lowland vegetation, highlands, snowcaps
    if(h < uSea){
      float d = smoothstep(uSea-0.22, uSea, h);
      col = mix(uDeep*0.7, uDeep*1.35 + vec3(0.0,0.06,0.08), d);
      spec = 1.0; land = 0.0;
    } else {
      float t = (h-uSea)/(1.0-uSea);
      float moist = fbm(p*2.7+uSeed+7.0,4);
      vec3 low = mix(uMid, uMid*vec3(1.25,1.1,0.75), smoothstep(0.45,0.75,moist));
      col = mix(low, uHi, smoothstep(0.08, 0.55, t));
      col = mix(col, vec3(0.92,0.94,0.96), smoothstep(0.62, 0.8, t));
      col = mix(col, uMid*1.6+vec3(0.15,0.12,0.05), smoothstep(0.02,0.0,t)*0.5); // beaches
    }
    float cap = abs(p.y) + (fbm(p*4.0+uSeed,3)-0.5)*0.25;
    col = mix(col, vec3(0.93,0.96,1.0), smoothstep(uIce, uIce+0.04, cap));
  } else if(uKind==1){
    // arid and barren: dune seas, mesas and impact craters
    col = mix(uDeep, uMid, smoothstep(0.25,0.6,h));
    col = mix(col, uHi, smoothstep(0.55,0.85,h));
    float dunes = sin(dot(p, vec3(18.0, 40.0, 11.0)) + fbm(p*5.0+uSeed,3)*8.0);
    col *= 0.93 + dunes*0.04;
    float cr = 1.0 - smoothstep(0.0, 0.08, abs(snoise(p*6.0+uSeed)) );
    col = mix(col, uDeep*0.8, cr*0.35*uDetail);
  } else if(uKind==2){
    // ice: glacial shelves cut by deep blue fractures
    col = mix(uMid, uHi, smoothstep(0.3,0.75,h));
    if(uSea>0.0) col = mix(uDeep, col, smoothstep(uSea-0.05, uSea+0.05, h));
    float crack = 1.0 - smoothstep(0.0, 0.035, abs(snoise(p*3.5+uSeed)));
    col = mix(col, uDeep*1.2, crack*0.7);
    spec = 0.35;
  } else if(uKind==3){
    // volcanic: basalt crust with glowing magma fissures
    col = mix(uDeep*0.6, uMid*0.8, h);
    float f = abs(fbm(p*3.0+uSeed+3.0,5)-0.5);
    float lava = 1.0 - smoothstep(0.0, 0.05, f);
    emit = uHi * lava * 1.6 + vec3(1.0,0.35,0.05) * pow(lava,3.0);
    col = mix(col, uHi*0.6, lava*0.5);
  } else {
    // toxic: swirling dense chemical cloud deck
    vec3 q = p*2.0+uSeed;
    float w = fbm(q + vec3(fbm(q,4), fbm(q+5.2,4), 0.0)*1.8, 5);
    col = mix(uDeep, uMid, w);
    col = mix(col, uHi, smoothstep(0.6,0.9,w));
    land = 0.0;
  }
  // bump-mapped relief for solid worlds
  if(uKind<=3 && land>0.5){
    float e = 0.012;
    vec3 t1 = normalize(cross(n, vec3(0.0,1.0,0.0)+vec3(0.0001)));
    vec3 t2 = cross(n, t1);
    vec3 pt1 = rotY(normalize(vPos + t1*e), uRot), pt2 = rotY(normalize(vPos + t2*e), uRot);
    float k = uKind==0 ? 3.5 : 5.0;
    n = normalize(n - (t1*(height(pt1)-h) + t2*(height(pt2)-h)) / e * k * 0.01 * uDetail);
  }
  float diff = dot(n, L);
  float lit = smoothstep(-0.08, 0.9, diff);
  vec3 c = col * (0.045 + lit * 1.05);
  // terminator warmth through the atmosphere
  c += uAtmo * uAtmoK * 0.08 * smoothstep(0.25, 0.0, abs(diff));
  // ocean / ice glint
  vec3 Hh = normalize(L + V);
  c += vec3(1.0,0.96,0.88) * pow(max(dot(n, Hh), 0.0), 60.0) * spec * 0.7 * step(0.0, diff);
  // city lights on the night side
  if(uLights > 0.0 && land > 0.5){
    float region = smoothstep(0.5, 0.62, fbm(p*2.2+uSeed+11.0,3));
    float city = fbm(p*28.0+uSeed+40.0,4);
    float th = 0.66 - uLights*0.05;
    float k = smoothstep(th, th+0.07, city) * region * (1.0 - smoothstep(-0.05, 0.18, diff)) * (0.35 + uLights*0.65);
    c += vec3(1.0,0.72,0.38) * k * 1.3;
  }
  c += emit * (1.0 - lit*0.6);
  // clouds
  if(uCloud > 0.0){
    vec3 cp = rotY(normalize(vPos), uCloudRot);
    float cl = fbm(cp*2.4 + uSeed*1.3 + 20.0, 6);
    float ca = smoothstep(0.62 - uCloud*0.22, 0.86, cl) * min(1.0, uCloud*1.4);
    vec3 cc = mix(vec3(1.0), uAtmo, 0.15) * (0.03 + smoothstep(-0.1, 0.9, dot(normalize(vN), L)) * 1.0);
    c = mix(c, cc, ca);
  }
  // inner atmospheric rim
  float fres = pow(1.0 - max(dot(normalize(vN), V), 0.0), 2.6);
  c = mix(c, uAtmo * (0.06 + smoothstep(-0.3, 0.8, dot(normalize(vN), L)) * 1.1), fres * uAtmoK * 0.85);
  gl_FragColor = vec4(c, 1.0);
}`;

const ATMO_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main(){
  vec4 wp = modelMatrix * vec4(position,1.0);
  vN = normalize(mat3(modelMatrix)*normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FRAG = /* glsl */ `
uniform vec3 uAtmo; uniform vec3 uLight; uniform float uAtmoK;
varying vec3 vN; varying vec3 vV;
void main(){
  // Back faces of a shell at 1.09x: x runs 0 at the shell edge to ~0.4 at the planet limb.
  vec3 N = normalize(vN);
  float x = clamp(-dot(N, normalize(vV)) / 0.40, 0.0, 1.0);
  float a = pow(x, 1.8);
  float lit = smoothstep(-0.35, 0.7, dot(N, normalize(uLight)));
  gl_FragColor = vec4(uAtmo * a * (0.04 + lit * 1.1) * uAtmoK, 1.0);
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uMid; uniform vec3 uHi; uniform vec3 uSeed; uniform vec3 uLight;
varying vec2 vUv2; varying vec3 vW;
${NOISE_GLSL}
void main(){
  float r = length(vUv2);
  float band = fbm(vec3(r*26.0, uSeed.x, uSeed.y), 4);
  float gap = smoothstep(0.02, 0.0, abs(r - 1.78)) ;
  float a = smoothstep(1.35, 1.45, r) * smoothstep(2.3, 2.15, r) * (0.25 + band*0.75) * (1.0 - gap*0.9);
  vec3 c = mix(uMid, uHi, band) * 0.9;
  gl_FragColor = vec4(c * a, a * 0.85);
}`;
const RING_VERT = /* glsl */ `
varying vec2 vUv2; varying vec3 vW;
void main(){ vUv2 = position.xy; vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`;

function col(hex: string) { return new THREE.Color(hex); }

function seedVec(seed: number) {
  const f = (k: number) => (((Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1) + 1) % 1;
  return new THREE.Vector3(f(1) * 50, f(2) * 50, f(3) * 50);
}

interface Look { kind: number; sea: number; ice: number; cloud: number; atmoK: number }
const LOOKS: Record<PlanetType, Look> = {
  temperate: { kind: 0, sea: 0.52, ice: 0.86, cloud: 0.55, atmoK: 1 },
  ocean: { kind: 0, sea: 0.66, ice: 0.88, cloud: 0.6, atmoK: 1 },
  jungle: { kind: 0, sea: 0.42, ice: 0.96, cloud: 0.7, atmoK: 1 },
  gaia: { kind: 0, sea: 0.5, ice: 0.9, cloud: 0.5, atmoK: 1.1 },
  desert: { kind: 1, sea: 0, ice: 2, cloud: 0.08, atmoK: 0.6 },
  arid: { kind: 1, sea: 0, ice: 2, cloud: 0.2, atmoK: 0.7 },
  barren: { kind: 1, sea: 0, ice: 2, cloud: 0, atmoK: 0 },
  tundra: { kind: 2, sea: 0.4, ice: 0.7, cloud: 0.35, atmoK: 0.8 },
  frozen: { kind: 2, sea: 0, ice: 0.5, cloud: 0.2, atmoK: 0.7 },
  volcanic: { kind: 3, sea: 0, ice: 2, cloud: 0.25, atmoK: 0.7 },
  toxic: { kind: 4, sea: 0, ice: 2, cloud: 0, atmoK: 1.2 },
  gas_giant: { kind: 5, sea: 0, ice: 2, cloud: 0, atmoK: 0.9 },
} as Record<PlanetType, Look>;

export interface PlanetBuild { group: THREE.Group; surface: THREE.ShaderMaterial; setLight(dir: THREE.Vector3): void; setTime(t: number): void; dispose(): void }

const sphereHi = new THREE.SphereGeometry(1, 96, 64);
const sphereLo = new THREE.SphereGeometry(1, 40, 28);
const ringGeo = new THREE.RingGeometry(1.35, 2.3, 128, 1);

/** Build a planet (radius 1) with its atmosphere shell and, for some giants, a ring. */
export function buildPlanet(type: PlanetType, seed: number, lights = 0, hi = true): PlanetBuild {
  const def = PLANET_TYPES[type];
  const look = LOOKS[type] ?? LOOKS.barren;
  const atmo = def.atmosphere ? col(def.atmosphere) : new THREE.Color('#000000');
  const sv = seedVec(seed);
  const surface = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uKind: { value: look.kind }, uDeep: { value: col(def.palette[0]) }, uMid: { value: col(def.palette[1]) }, uHi: { value: col(def.palette[2]) },
      uAtmo: { value: atmo }, uAtmoK: { value: def.atmosphere ? look.atmoK : 0 }, uSea: { value: look.sea }, uIce: { value: look.ice },
      uCloud: { value: look.cloud }, uLights: { value: Math.min(1, lights) }, uSeed: { value: sv }, uRot: { value: (seed % 628) / 100 },
      uCloudRot: { value: (seed % 314) / 50 }, uLight: { value: new THREE.Vector3(-0.62, 0.45, 0.64) }, uDetail: { value: 1 },
    },
  });
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(hi ? sphereHi : sphereLo, surface);
  group.add(mesh);
  let atmoMat: THREE.ShaderMaterial | null = null;
  if (def.atmosphere && look.atmoK > 0) {
    atmoMat = new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
      uniforms: { uAtmo: { value: atmo }, uLight: surface.uniforms.uLight, uAtmoK: { value: look.atmoK } },
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const shell = new THREE.Mesh(sphereLo, atmoMat);
    shell.scale.setScalar(1.09);
    group.add(shell);
  }
  let ringMat: THREE.ShaderMaterial | null = null;
  if (type === 'gas_giant' && seed % 3 !== 0) {
    ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      uniforms: { uMid: { value: col(def.palette[1]) }, uHi: { value: col(def.palette[2]) }, uSeed: { value: sv }, uLight: surface.uniforms.uLight },
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2 + 0.38;
    ring.rotation.y = 0.2;
    group.add(ring);
  }
  const rot0 = surface.uniforms.uRot.value as number;
  const cl0 = surface.uniforms.uCloudRot.value as number;
  return {
    group, surface,
    setLight(dir) { (surface.uniforms.uLight.value as THREE.Vector3).copy(dir).normalize(); },
    setTime(t) { surface.uniforms.uRot.value = rot0 + t * 0.00004; surface.uniforms.uCloudRot.value = cl0 + t * 0.000055; },
    dispose() { surface.dispose(); atmoMat?.dispose(); ringMat?.dispose(); },
  };
}

// ---------- sprite baking (thumbnails and lists) ----------

let bakeRenderer: THREE.WebGLRenderer | null = null;
let bakeScene: THREE.Scene;
let bakeCam: THREE.OrthographicCamera;
const PAD = 1.24;

function bakery() {
  if (!bakeRenderer) {
    const cv = document.createElement('canvas');
    bakeRenderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
    bakeRenderer.setClearColor(0x000000, 0);
    bakeScene = new THREE.Scene();
    bakeCam = new THREE.OrthographicCamera(-PAD, PAD, PAD, -PAD, 0.1, 20);
    bakeCam.position.set(0, 0, 6);
  }
  return bakeRenderer;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
export interface PlanetLook { lights?: number }

/** A baked image of the planet, `size` px across the sphere (canvas includes 12% padding each side). */
export function planetSprite(type: PlanetType, seed: number, size: number, look: PlanetLook = {}): HTMLCanvasElement {
  const px = Math.max(8, Math.min(512, Math.round(size)));
  const lights = Math.min(1, look.lights ?? 0);
  const key = `${type}:${seed}:${px}:${Math.round(lights * 10)}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const W = Math.round(px * PAD);
  const out = document.createElement('canvas');
  out.width = W; out.height = W;
  try {
    const r = bakery();
    r.setPixelRatio(1);
    r.setSize(W, W, false);
    const p = buildPlanet(type, seed, lights, px > 48);
    if (type === 'gas_giant') p.group.scale.setScalar(0.62);
    p.surface.uniforms.uDetail.value = px < 40 ? 0.5 : 1;
    bakeScene.add(p.group);
    r.render(bakeScene, bakeCam);
    out.getContext('2d')!.drawImage(r.domElement, 0, 0);
    bakeScene.remove(p.group);
    p.dispose();
  } catch {
    const c = out.getContext('2d')!;
    c.fillStyle = PLANET_TYPES[type].palette[1];
    c.beginPath(); c.arc(W / 2, W / 2, px / 2, 0, Math.PI * 2); c.fill();
  }
  if (spriteCache.size > 600) spriteCache.clear();
  spriteCache.set(key, out);
  return out;
}

export function hexA(c: string, a: number): string {
  const n = parseInt(c.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
