// Ocean swell: a few long rolling waves travelling with the wind, only on open water (they die away over the
// shallows, so beaches, reeds and lily pads stay calm). The same formula runs in JS (boats ride it: heave,
// pitch, roll, and a push while sailing) and in GLSL (the water plane's vertices). It's a function of world
// position and the wall clock, so every player sees the same sea.
import { SEA, WORLD } from '../shared/world.js';
// the wind direction (ambient.js WIND, which also drifts the clouds); copied to avoid an import cycle
const WIND = { x: 1, z: 0.35 };

// Every wave's frequency is a whole number of cycles per WAVE_CYCLE seconds, so time can wrap at WAVE_CYCLE
// (keeps the shader's float time small) without a jump.
export const WAVE_CYCLE = 600;
export const WAVE_SCALE = 1.4; // overall height (tuning knob)
// open water: none up to DEPTH0 deep, full from DEPTH1
const DEPTH0 = 0.8, DEPTH1 = 2.4;
const base = Math.atan2(WIND.z, WIND.x);
// a: height, len: wavelength, n: cycles per WAVE_CYCLE (90 → a 6.7 s period), ang: off the wind, ph: phase
export const WAVES = [
  { a: 0.13, len: 27, n: 90, ang: 0, ph: 0 },
  { a: 0.08, len: 17, n: 124, ang: 0.5, ph: 1.7 },
  { a: 0.045, len: 11, n: 163, ang: -0.65, ph: 4.1 },
].map((w) => ({ ...w, dx: Math.cos(base + w.ang), dz: Math.sin(base + w.ang), k: (2 * Math.PI) / w.len, om: (2 * Math.PI * w.n) / WAVE_CYCLE }));
export const WAVE_DIR = { x: WAVES[0].dx, z: WAVES[0].dz }; // the main swell's direction of travel

/** Wave time in seconds (wall clock, wrapped at WAVE_CYCLE). */
export const waveClock = () => (Date.now() / 1000) % WAVE_CYCLE;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// rougher and calmer stretches of sea (a slow pattern)
const seaState = (x, z) => 0.72 + 0.28 * Math.sin(x * 0.012 + z * 0.008) * Math.sin(x * 0.0071 - z * 0.0113 + 1.3);

/** Water depth at a world point, blended between cell centres like the water shader. */
export function depthAt(world, x, z) {
  const px = x + WORLD / 2 - 0.5, pz = z + WORLD / 2 - 0.5, cx = Math.floor(px), cz = Math.floor(pz), fx = px - cx, fz = pz - cz;
  const H = world.H;
  const h = (H(cx, cz) * (1 - fx) + H(cx + 1, cz) * fx) * (1 - fz) + (H(cx, cz + 1) * (1 - fx) + H(cx + 1, cz + 1) * fx) * fz;
  return Math.min(6, Math.max(0, SEA - Math.min(h, SEA)));
}

/** How strong the swell is at a world point (0 over the shallows, up to 1 on rough open sea). */
export function waveEnv(world, x, z) {
  return smooth(DEPTH0, DEPTH1, depthAt(world, x, z)) * seaState(x, z) * WAVE_SCALE;
}

/** Height of the swell above SEA at a world point, at wave time T (waveClock()). */
export function waveAt(world, x, z, T = waveClock(), env = waveEnv(world, x, z)) {
  if (env <= 0) return 0;
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin(w.k * (w.dx * x + w.dz * z) - w.om * T + w.ph);
  return h * env;
}

// GLSL: the same swell. Needs `float wColH(vec2 cell)` (the height ring buffer) and `uniform float uWaveT`.
export const WAVE_GLSL = /* glsl */ `
  float waveDepth(vec2 p) {
    vec2 dp = p + ${(WORLD / 2 - 0.5).toFixed(1)}, dc = floor(dp), df = fract(dp);
    float h = mix(mix(wColH(dc), wColH(dc + vec2(1.0, 0.0)), df.x), mix(wColH(dc + vec2(0.0, 1.0)), wColH(dc + vec2(1.0, 1.0)), df.x), df.y);
    return clamp(${SEA.toFixed(2)} - min(h, ${SEA.toFixed(2)}), 0.0, 6.0);
  }
  float waveEnv(vec2 p) {
    float s = 0.72 + 0.28 * sin(p.x * 0.012 + p.y * 0.008) * sin(p.x * 0.0071 - p.y * 0.0113 + 1.3);
    return smoothstep(${DEPTH0.toFixed(2)}, ${DEPTH1.toFixed(2)}, waveDepth(p)) * s * ${WAVE_SCALE.toFixed(3)};
  }
  // height (x) and slope (y, z: d/dx, d/dz) of the swell, before the envelope
  vec3 waveRaw(vec2 p) {
    vec3 r = vec3(0.0); float ph;
    ${WAVES.map((w) => `ph = ${w.k.toFixed(5)} * dot(vec2(${w.dx.toFixed(5)}, ${w.dz.toFixed(5)}), p) - ${w.om.toFixed(6)} * uWaveT + ${w.ph.toFixed(3)};
    r += vec3(${w.a.toFixed(4)} * sin(ph), vec2(${(w.a * w.k * w.dx).toFixed(5)}, ${(w.a * w.k * w.dz).toFixed(5)}) * cos(ph));`).join('\n    ')}
    return r;
  }
`;
