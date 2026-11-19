// Galactic disk glow baked once per galaxy with a fragment shader: a warm
// bulge and bar, spiral arms of blue-white star clouds, rose and teal emission
// nebulae and dark dust lanes, following the same barred log-spiral geometry
// the generator uses to place systems (sim/galaxy.ts).

import * as THREE from 'three';
import { NOISE_GLSL } from './planet3d';

const FRAG = /* glsl */ `
uniform float uBar; uniform float uRp; uniform vec3 uSeed;
varying vec2 vUv;
${NOISE_GLSL}
// Matches sim/galaxy.ts: log spirals from rMin = 0.2R with a 13 degree pitch,
// two major arms at the bar ends and two minor arms between them.
void main(){
  vec2 d = (vUv - 0.5) * 2.0 * uRp;   // in units of R
  float r = length(d);
  float ang = atan(d.y, d.x);
  float phi = ang - uBar - log(max(r, 0.2) / 0.2) / tan(0.2269);
  float arms = pow(0.5 + 0.5 * cos(4.0 * phi), 3.0) * (0.55 + 0.45 * pow(cos(2.0 * phi), 2.0));
  arms *= smoothstep(0.12, 0.3, r) * smoothstep(1.15, 0.55, r);
  vec2 bd = vec2(cos(-uBar) * d.x - sin(-uBar) * d.y, sin(-uBar) * d.x + cos(-uBar) * d.y);
  float bar = exp(-pow(bd.x / 0.3, 2.0) - pow(bd.y / 0.07, 2.0));
  float bulge = exp(-r * r / 0.012);
  vec3 p = vec3(d * 4.0, 0.0) + uSeed;
  float n = fbm(p, 6);
  float fine = fbm(p * 3.3 + 5.0, 4);
  float disk = exp(-r / 0.35) * 0.35;
  float dens = (arms * (0.6 + n * 0.8) + disk * (0.5 + n * 0.6));
  float lane = pow(0.5 + 0.5 * cos(4.0 * (phi - 0.1)), 12.0) * smoothstep(0.15, 0.35, r) * smoothstep(1.1, 0.5, r);
  float dust = lane * smoothstep(0.35, 0.7, fine);
  vec3 c = vec3(0.32, 0.4, 0.58) * dens * 0.75;
  float neb = smoothstep(0.6, 0.82, fbm(p * 1.6 + 11.0, 5)) * arms;
  c += mix(vec3(0.75, 0.24, 0.42), vec3(0.2, 0.58, 0.62), smoothstep(0.4, 0.6, fbm(p * 0.7 + 31.0, 3))) * neb * 0.6;
  c += vec3(1.0, 0.8, 0.52) * (bulge * 1.1 + bar * 0.45) + vec3(0.6, 0.45, 0.38) * exp(-r * 6.0) * 0.25;
  c *= 1.0 - dust * 0.8;
  c *= smoothstep(1.2, 0.95, r);
  gl_FragColor = vec4(c, 1.0);
}`;

/** Bake the galactic disk glow. `extent` is the half-width covered, in units of the galaxy radius R. */
export function bakeGalaxyNebula(size: number, barAngle: number, extent: number, seed: number): HTMLCanvasElement | null {
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
      uniforms: { uBar: { value: barAngle }, uRp: { value: extent }, uSeed: { value: new THREE.Vector3((seed % 97) * 0.37, (seed % 89) * 0.41, (seed % 83) * 0.29) } },
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
