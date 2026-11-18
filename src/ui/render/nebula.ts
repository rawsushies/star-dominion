// Galactic backdrop baked once per galaxy with a fragment shader: a warm
// barred core, spiral arms of blue-white star clouds, rose and teal emission
// nebulae and dark dust lanes, following the same arm geometry the generator
// uses to place systems.

import * as THREE from 'three';
import { NOISE_GLSL } from './planet3d';

const FRAG = /* glsl */ `
uniform float uArms; uniform float uRg; uniform vec3 uSeed;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 d = vUv - 0.5;
  float r = length(d) / uRg;            // 0 at core, 1 at the galaxy rim
  float ang = atan(d.y, d.x);
  float t = clamp((r - 0.09) / 0.91, 0.0, 1.0);
  float armPhase = (ang - t * 3.0) * uArms / 6.2831853;
  float arm = mix(0.55, pow(0.5 + 0.5 * cos(armPhase * 6.2831853), 2.5), smoothstep(0.08, 0.3, r));
  vec3 p = vec3(vUv * 7.0, 0.0) + uSeed;
  float n = fbm(p, 6);
  float fine = fbm(p * 3.1 + 5.0, 5);
  float fall = smoothstep(1.15, 0.2, r) * smoothstep(0.5, 0.42, max(abs(d.x), abs(d.y)));
  float stars = (arm * 0.75 + 0.25) * fall * (0.55 + n * 0.8);
  // dust lanes trail the arms
  float lane = pow(0.5 + 0.5 * cos((armPhase - 0.12) * 6.2831853), 10.0) * smoothstep(0.15, 0.4, r) * fall;
  float dust = lane * smoothstep(0.35, 0.65, fine);
  vec3 c = vec3(0.30, 0.38, 0.55) * stars * 0.55;
  // emission nebulae
  float neb = smoothstep(0.58, 0.82, fbm(p * 1.7 + 11.0, 5)) * arm * fall;
  float hue = fbm(p * 0.8 + 31.0, 3);
  c += mix(vec3(0.70, 0.22, 0.38), vec3(0.18, 0.55, 0.58), smoothstep(0.4, 0.6, hue)) * neb * 0.55;
  // core
  float core = exp(-r * r * 26.0);
  c += vec3(1.0, 0.78, 0.50) * core * 0.6 + vec3(0.55, 0.42, 0.40) * exp(-r * 7.0) * 0.25;
  c *= 1.0 - dust * 0.85;
  c += vec3(0.008, 0.012, 0.020);
  gl_FragColor = vec4(c, 1.0);
}`;

export function bakeGalaxyNebula(size: number, arms: number, galaxyRadiusFrac: number, seed: number): HTMLCanvasElement | null {
  try {
    const cv = document.createElement('canvas');
    const r = new THREE.WebGLRenderer({ canvas: cv, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(size, size, false);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      uniforms: { uArms: { value: arms }, uRg: { value: galaxyRadiusFrac }, uSeed: { value: new THREE.Vector3((seed % 97) * 0.37, (seed % 89) * 0.41, (seed % 83) * 0.29) } },
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    r.render(scene, cam);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d')!.drawImage(cv, 0, 0);
    mat.dispose();
    r.dispose();
    r.forceContextLoss();
    return out;
  } catch {
    return null;
  }
}
