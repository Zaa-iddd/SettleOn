// Builds the 3D scene for an island (src/shared/world.js) or an endless world, streamed in chunks
// around the player (src/shared/endless.js).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Effects } from './effects.js';
import { Atmosphere } from './atmosphere.js';
import { boatGeometry } from './boat.js';
import { leafyTreeGeometry, pineTreeGeometry, palmTreeGeometry, palmTrunkLocal, redwoodGeometry, bushGeometry } from './trees3d.js';
import { Ambient, WIND } from './ambient.js';
import { WORLD, SEA, K, toWorld, rng, cellKey, MIN_LEVEL, STEP } from '../shared/world.js';
import { CH } from '../shared/endless.js';
import { WAVE_GLSL, waveClock } from './waves.js';

export const SKY = 0xa3d2ec; // a soft, slightly hazy blue

// Time of day (hours 0–24). Keyframes blend linearly and wrap at midnight:
// sky/fog colour, sun (or moon) colour and total intensity, hemisphere fill, and a cloud tint.
const DAY_KEYS = [
  // nights are moody and gloomy: a muted slate-blue murk, dim but readable (lanterns, the campfire
  // and fireflies still matter)
  { h: 0,    sky: 0x141a28, sun: 0x9aa8c8, sunI: 0.5, hemiSky: 0x4a5470, hemiGround: 0x1c1c26, hemiI: 0.58, cloud: 0x2c3244 },
  { h: 4.5,  sky: 0x181e2e, sun: 0x9aa8c8, sunI: 0.5, hemiSky: 0x4a5470, hemiGround: 0x1c1c26, hemiI: 0.58, cloud: 0x2c3244 },
  { h: 6,    sky: 0xeea283, sun: 0xffa466, sunI: 2.0, hemiSky: 0xc4b0dc, hemiGround: 0x6a5450, hemiI: 1.25, cloud: 0xffc4b0 },
  { h: 8,    sky: 0xa9d3ee, sun: 0xffd9a8, sunI: 2.4, hemiSky: 0xc6dcfa, hemiGround: 0x74624e, hemiI: 1.4, cloud: 0xfff6ea },
  { h: 10,   sky: SKY,      sun: 0xffe0b4, sunI: 2.75, hemiSky: 0xc6dcfa, hemiGround: 0x74624e, hemiI: 1.55, cloud: 0xfff6ea },
  { h: 15.5, sky: SKY,      sun: 0xffe0b4, sunI: 2.75, hemiSky: 0xc6dcfa, hemiGround: 0x74624e, hemiI: 1.55, cloud: 0xfff6ea },
  { h: 17.5, sky: 0xf2b486, sun: 0xffb46e, sunI: 2.5, hemiSky: 0xe6c2c0, hemiGround: 0x7a5a4c, hemiI: 1.6, cloud: 0xffd6b8 },
  { h: 19,   sky: 0xc8707c, sun: 0xff7a50, sunI: 1.6, hemiSky: 0xb48ab8, hemiGround: 0x54404a, hemiI: 1.35, cloud: 0xd88a96 },
  { h: 20.5, sky: 0x1a2032, sun: 0x9aa8c8, sunI: 0.5, hemiSky: 0x4a5470, hemiGround: 0x1c1c26, hemiI: 0.58, cloud: 0x2c3244 },
  { h: 24,   sky: 0x141a28, sun: 0x9aa8c8, sunI: 0.5, hemiSky: 0x4a5470, hemiGround: 0x1c1c26, hemiI: 0.58, cloud: 0x2c3244 },
];
export const DEFAULT_TIME = 10;
const DEEP_DIM = 0.45; // how much the sky fill dims when fully inside the deep forest
const SHADOW_DEPTH = 0.25; // share of the sky fill moved into the main sun (higher = darker shadows)
const _ca = new THREE.Color(), _cb = new THREE.Color();
const lerpHex = (out, a, b, t) => out.copy(_ca.setHex(a)).lerp(_cb.setHex(b), t);

const mats = new Map();
export function mat(color, opts = {}) {
  const key = `${color}:${JSON.stringify(opts)}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return mats.get(key);
}

// Side of the terrain height ring buffer (cells, indexed mod HT), read by terrain AO and the water.
// It must be wider than everything loaded at once: chunks stay loaded out to UNLOAD_R (74) on every
// side, so up to ~164 cells across. At 128, chunks on opposite sides overwrote each other's heights,
// which drew shore foam on every tile edge after walking away and back.
const HT = 256;
// terrain columns reach down to here: 1 below the deepest seabed (MIN_LEVEL), so drop-offs never show gaps
const COL_BASE = MIN_LEVEL * STEP - 1;
const jitter = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };

// one InstancedMesh for a list of items (null when the list is empty)
function instanced(geometry, material, items, place, { shadows = true } = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4();
  items.forEach((it, i) => { place(m, it, i); mesh.setMatrixAt(i, m); });
  mesh.count = items.length;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------- textured terrain ----------
// Pixel-art surface detail is generated in the shader from world position (16 texels per
// unit), so it stays crisp on columns of any height. Each column carries its ground kind
// and top height as instanced attributes. Grass sides become dirt with a jagged grass lip;
// snow gets a snow lip over rock; rock has horizontal strata.
const TERRAIN_GLSL = /* glsl */`
  varying vec3 vWPos;
  varying vec3 vONormal;
  varying float vKind;
  varying float vTop;
  varying vec2 vUnder; // ground under placed blocks: (top height, kind), x = -1 when none
  uniform sampler2D uHeights; // column heights (R channel), a ring buffer indexed by cell mod HT
  float colH(vec2 cell) { return texture2D(uHeights, (mod(cell, ${HT.toFixed(1)}) + 0.5) / ${HT.toFixed(1)}).r; }
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
  vec3 pick(float r, vec3 base, vec3 dark, vec3 light, float pd, float pl) {
    return r < pd ? dark : (r > 1.0 - pl ? light : base);
  }
  // Grass top in the style of the user's reference tile: a mid-green base with soft, blocky
  // blotches of lighter green and a few darker patches. Two octaves of value noise are
  // sampled at texel-snapped positions (16 per unit) and banded into 4 tones, so the
  // blotches come out as chunky pixel shapes that flow across tile borders.
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = h21(i), b = h21(i + vec2(1.0, 0.0)), c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec3 grassBase(vec2 cell, bool forest) {
    vec3 c = vec3(0.46, 0.61, 0.31); // a soft, warm sage green (calmer than the earlier lime)
    return forest ? c * vec3(0.86, 0.9, 0.86) : c;
  }
  vec3 leafHi(vec3 base) { return base * vec3(1.3, 1.2, 1.35); }
  vec3 grassTop(vec2 uv, vec2 tx, float r, bool forest) {
    vec3 base = grassBase(floor(uv), forest);
    vec2 q = (tx + 0.5) / 16.0;                       // texel-snapped world position
    float n = vnoise(q * 2.6) * 0.62 + vnoise(q * 6.5 + 13.7) * 0.38;
    if (n > 0.68) return base * vec3(1.18, 1.13, 1.2);  // brightest blotches
    if (n > 0.57) return base * vec3(1.08, 1.06, 1.09); // light blotches
    if (n < 0.29) return base * vec3(0.88, 0.91, 0.88); // darker patches
    return base;
  }
  vec3 dirt(vec2 tx, float r) {
    vec3 c = vec3(0.55, 0.37, 0.24);
    // sparse 2-texel pebbles on a 6×6 grid instead of per-texel noise
    vec2 blk = floor(tx / 6.0);
    vec2 lp = 1.0 + floor(vec2(h21(blk + 13.3), h21(blk + 17.1)) * 4.0);
    vec2 d = tx - blk * 6.0 - lp;
    if (h21(blk + 5.5) < 0.6 && (d == vec2(0.0) || d == vec2(1.0, 0.0))) c = vec3(0.44, 0.29, 0.18);
    return c;
  }
  // Side of a grass block: grass hangs over the edge as uneven 1-2 texel strands
  // (2-4 texels long, with occasional longer drips), bright along the top row and darker
  // toward the tips; a shadow texel sits under each tip and a few sprouts dot the dirt.
  vec3 grassSide(vec2 tx, float depth, bool forest, float r) {
    vec3 base = grassBase(vec2(0.0), forest);
    float dt = floor(depth * 16.0);                    // texels below the top edge
    float cx = tx.x;
    float strand = floor(cx / (h21(vec2(floor(cx / 4.0), 31.0)) > 0.5 ? 2.0 : 1.0)); // 1-2 texel wide strands
    float len = 2.0 + floor(h21(vec2(strand, 7.0 + vKind)) * 3.0);
    if (h21(vec2(floor(cx / 2.0), 11.0 + vKind)) > 0.78) len += 2.0 + floor(h21(vec2(cx, 13.0)) * 3.0); // drips
    if (dt < len) {
      if (dt < 1.0) return base * 1.14;                // sunlit top row
      if (dt >= len - 1.0) return base * 0.7;          // darker strand tip
      if (h21(vec2(cx, dt) + 5.3) > 0.86) return base * 1.12; // a few highlight pixels
      return dt < 2.0 ? base : base * 0.86;
    }
    if (dt < len + 1.0) return vec3(0.30, 0.19, 0.12);  // shadow right under each strand
    if (dt < len + 4.0 && h21(vec2(cx, dt) + 9.1) < 0.05) return base * 0.75; // sprouts / roots
    return dirt(tx, r);
  }
  // Deep forest floor: dark moss in blocky blotches with patches of fallen red needles
  vec3 deepTop(vec2 tx) {
    vec2 q = (tx + 0.5) / 16.0;
    float n = vnoise(q * 2.2 + 3.1) * 0.6 + vnoise(q * 7.0 + 21.7) * 0.4;
    float needles = vnoise(q * 1.3 + 41.0);
    if (needles > 0.66 && n < 0.6) return n < 0.42 ? vec3(0.34, 0.20, 0.13) : vec3(0.44, 0.27, 0.16); // red needle litter
    if (n > 0.66) return vec3(0.27, 0.42, 0.17);   // moss highlights
    if (n < 0.32) return vec3(0.15, 0.25, 0.11);   // dark moss
    return vec3(0.20, 0.33, 0.14);
  }
  // Mountain trail: packed dirt with trodden patches and sparse gravel; dusted with snow up high
  vec3 trailTop(vec2 tx, float y) {
    vec2 q = (tx + 0.5) / 16.0;
    vec3 c = vnoise(q * 3.0 + 5.0) > 0.62 ? vec3(0.62, 0.49, 0.33) : vec3(0.71, 0.57, 0.39);
    vec2 blk = floor(tx / 5.0);
    vec2 d = tx - blk * 5.0 - floor(vec2(h21(blk + 3.1), h21(blk + 8.7)) * 4.0);
    if (h21(blk + 1.7) < 0.45 && d.x >= 0.0 && d.y >= 0.0 && d.x < 2.0 && d.y < 1.0) c = vec3(0.60, 0.58, 0.54);
    if (y >= 12.5) c = mix(c, vec3(0.93, 0.95, 0.97), 0.5);
    return c;
  }
  // Exposed dirt: an irregular, texel-stepped blob of bare earth inside the tile, with a darker rim and a
  // few grass sprouts; the rest of the tile is normal grass, so patches never look square
  vec3 dirtPatch(vec2 uv, vec2 tx, float r) {
    vec2 cell = floor(uv), f = (floor(fract(uv) * 16.0) + 0.5) / 16.0 - 0.5;
    float ang = atan(f.y, f.x);
    float rad = 0.28 + 0.1 * h21(cell + 2.3) + 0.06 * sin(ang * 3.0 + h21(cell) * 6.28) + 0.04 * sin(ang * 5.0 + h21(cell + 1.1) * 6.28);
    float d = length(f);
    if (d > rad) return grassTop(uv, tx, r, false);
    vec3 c = vec3(0.56, 0.42, 0.28);
    vec2 blk = floor(tx / 4.0);
    vec2 pd = tx - blk * 4.0 - floor(vec2(h21(blk + 3.7), h21(blk + 9.2)) * 3.0);
    if (h21(blk + 6.1) < 0.4 && pd == vec2(0.0)) c = vec3(0.46, 0.34, 0.22);     // pebbles
    if (d > rad - 0.07) c *= 0.82;                                                 // rim
    if (h21(tx + 4.4) > 0.94) c = grassBase(cell, false) * 0.9;                    // sprouts
    return c;
  }
  vec3 rock(float r, float y) {
    float band = 0.86 + 0.14 * h21(vec2(floor(y * 6.0), 5.0));
    return pick(r, vec3(0.56, 0.54, 0.50), vec3(0.44, 0.42, 0.39), vec3(0.64, 0.62, 0.58), 0.08, 0.06) * band;
  }
  vec3 sand(float r, bool wet) {
    vec3 base = wet ? vec3(0.79, 0.73, 0.54) : vec3(0.91, 0.85, 0.63);
    return pick(r, base, base * 0.9, base * 1.05, 0.12, 0.08);
  }
  vec3 snow(float r) { return pick(r, vec3(0.95, 0.96, 0.97), vec3(0.85, 0.89, 0.94), vec3(1.0), 0.08, 0.05); }

  // Soft, pixel-stepped ambient occlusion: darken tile tops next to taller neighbours
  // and the bottoms of walls where they meet lower ground.
  float terrainAO(bool top) {
    float half_ = ${(WORLD / 2).toFixed(1)};
    if (top) {
      vec2 cell = floor(vWPos.xz + half_);
      vec2 f = (floor(fract(vWPos.xz + half_) * 16.0) + 0.5) / 16.0; // snapped to texels
      float h = vTop, occ = 0.0;
      vec2 dirs[8] = vec2[8](vec2(1,0), vec2(-1,0), vec2(0,1), vec2(0,-1), vec2(1,1), vec2(-1,1), vec2(1,-1), vec2(-1,-1));
      for (int i = 0; i < 8; i++) {
        vec2 d = dirs[i];
        float rise = colH(cell + d) - h;
        if (rise <= 0.01) continue;
        // distance from this texel to the shared edge / corner
        vec2 e = mix(f, 1.0 - f, step(0.5, d)) ;   // per-axis distance toward d
        float dist = (d.x != 0.0 && d.y != 0.0) ? length(vec2(e.x, e.y)) : (d.x != 0.0 ? e.x : e.y);
        occ += clamp(rise / 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.42, dist)) * ((d.x != 0.0 && d.y != 0.0) ? 0.6 : 1.0);
      }
      return 1.0 - min(occ, 1.0) * 0.38;
    }
    vec2 n = vec2(vONormal.x, vONormal.z);
    vec2 cell = floor(vWPos.xz - n * 0.01 + half_);
    float below = colH(cell + n);              // ground level in front of this wall
    float y = (floor((vWPos.y - below) * 16.0) + 0.5) / 16.0;
    return 1.0 - (1.0 - smoothstep(0.0, 0.3, y)) * 0.22;
  }

  // Village cobblestones: staggered pale stones (rows of 5 texels, ~7 wide) with rounded
  // corners, a lit top edge and shaded bottom, and grass growing in the gaps.
  vec3 cobble(vec2 tx) {
    float row = floor(tx.y / 5.0);
    float x = tx.x + floor(h21(vec2(row, 3.0)) * 7.0);
    float cell = floor(x / 7.0);
    float lx = x - cell * 7.0, ly = tx.y - row * 5.0;
    if (lx < 1.0 || ly < 1.0 || (lx < 2.0 && ly < 2.0) || (lx > 5.0 && ly > 3.0)) return vec3(0.36, 0.56, 0.20);
    vec3 st = mix(vec3(0.82, 0.80, 0.70), vec3(0.72, 0.70, 0.62), h21(vec2(cell, row) + 0.5));
    if (ly < 2.0) st *= 1.08;
    if (ly > 3.0) st *= 0.86;
    return st;
  }

  vec3 terrainColor() {
    bool top = vONormal.y > 0.5;
    vec2 uv = top ? vWPos.xz : (abs(vONormal.x) > 0.5 ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y));
    vec2 tx = floor(uv * 16.0);
    float r = h21(tx);
    float pch = h21(floor(uv * 1.5) + 17.0);
    // below the placed blocks, a column's sides show the ground that was there (its own kind and lip)
    float kindF = vKind, topH = vTop;
    if (!top && vUnder.x > -0.5 && vWPos.y < vUnder.x - 0.002) { kindF = vUnder.y; topH = vUnder.x; }
    int k = int(kindF + 0.5);
    float depth = topH - vWPos.y;                        // how far below the (layer's) top
    float lip = 0.1 + floor(h21(vec2(floor(tx.x / 3.0), 3.0 + vKind)) * 2.0) * 0.0625; // gently stepped overhang
    vec3 c;
    if (k == 2 || k == 3) {                              // grass / forest
      if (top) c = grassTop(uv, tx, r, k == 3);
      else c = grassSide(tx, depth, k == 3, r);
    } else if (k == 7) {                                 // deep forest
      if (top) c = deepTop(tx);
      else c = grassSide(tx, depth, true, r) * vec3(0.55, 0.62, 0.55);
    } else if (k == 11 || k == 12) {                     // placed wood: plank block (12: planks turned 90°)
      vec2 p = top ? tx : vec2(tx.x, floor(vWPos.y * 16.0));
      if (k == 12) p = p.yx;
      float row = floor(p.y / 4.0), lp = p.y - row * 4.0;
      float joint = mod(p.x + floor(h21(vec2(row, 5.0)) * 12.0), 12.0);
      c = mix(vec3(0.64, 0.44, 0.26), vec3(0.58, 0.39, 0.22), h21(vec2(row, floor((p.x + floor(h21(vec2(row, 5.0)) * 12.0)) / 12.0))));
      if (lp < 1.0) c = vec3(0.40, 0.26, 0.15);          // seam between planks
      else if (joint < 1.0) c *= 0.75;                     // end joints, staggered per row
      else if (lp < 2.0) c *= 1.08;                        // lit plank edge
      if (joint > 5.0 && joint < 6.0 && lp > 1.0 && lp < 3.0 && h21(vec2(row, 9.0)) > 0.5) c = vec3(0.30, 0.28, 0.27); // nail
    } else if (k == 13) {                                // wooden wall: a log-cabin block, one round log per block
      // sides: a horizontal log per 8 texels (one STEP), rounded by shading, with a dark gap between
      // logs, bark streaks, and pale cut ends at the column's corners. Top: the logs seen from above.
      float ly = top ? mod(tx.y, 8.0) : mod(floor(vWPos.y * 16.0 + 0.001), 8.0);
      float run = tx.x;                                    // texels along the log
      float course = top ? floor(tx.y / 8.0) : floor(vWPos.y * 2.0 + 0.001);
      float edge = mod(run, 16.0);                         // position within the tile along the log
      float round_ = sin((ly + 0.5) / 8.0 * 3.14159);      // 0 at the gaps, 1 mid-log
      c = mix(vec3(0.36, 0.22, 0.12), vec3(0.62, 0.40, 0.22), round_);
      if (h21(vec2(floor(run / 3.0), course * 7.0 + ly)) > 0.78) c *= 0.82;   // bark streaks
      if (ly < 1.0) c = vec3(0.27, 0.17, 0.10);           // the gap between logs
      else if (ly < 2.0) c *= 1.12;                        // lit top of each log
      if (!top && (edge < 1.5 || edge > 14.5) && ly >= 1.0) { // cut log ends at the corners
        float rr = abs(ly - 4.5);
        c = rr > 2.6 ? vec3(0.40, 0.25, 0.13) : rr > 1.5 ? vec3(0.86, 0.68, 0.42) : vec3(0.74, 0.55, 0.30);
      }
    } else if (k == 10) {                                // dug soil: all bare earth
      if (top) {
        vec2 blk = floor(tx / 4.0);
        vec2 pd = tx - blk * 4.0 - floor(vec2(h21(blk + 3.7), h21(blk + 9.2)) * 3.0);
        c = vnoise((tx + 0.5) / 16.0 * 3.0 + 9.0) > 0.6 ? vec3(0.50, 0.37, 0.25) : vec3(0.55, 0.41, 0.27);
        if (h21(blk + 6.1) < 0.45 && pd == vec2(0.0)) c = vec3(0.44, 0.32, 0.21);
      } else c = dirt(tx, r);
    } else if (k == 9) {                                 // meadow tile with exposed dirt
      if (top) c = dirtPatch(uv, tx, r);
      else c = grassSide(tx, depth, false, r);
    } else if (k == 8) {                                 // mountain trail
      c = top ? trailTop(tx, vTop) : (topH >= 11.5 ? rock(r, vWPos.y) : dirt(tx, r));
    } else if (k == 6) {                                 // village path
      c = top ? cobble(tx) : grassSide(tx, depth, false, r);
    } else if (k == 1) {                                 // sand
      c = top ? sand(r, false) : sand(r, false) * (depth < 0.06 ? 1.0 : 0.93);
    } else if (k == 0) {                                 // seabed: sand in the shallows, teal over the reefs, dark in the deep
      float bd = ${SEA.toFixed(2)} - vTop;
      c = mix(sand(r, true), vec3(0.28, 0.56, 0.55), 0.2 + 0.5 * smoothstep(0.2, 1.4, bd));
      c = mix(c, vec3(0.08, 0.22, 0.30), smoothstep(1.4, 4.6, bd));
      c *= top ? 1.0 - 0.15 * smoothstep(0.3, 1.5, bd) : 0.82;
    } else if (k == 4) {                                 // rock
      c = rock(r, top ? 0.0 : vWPos.y);
      if (top && h21(floor(uv * 3.0) + 41.0) > 0.8) c = mix(c, vec3(0.42, 0.55, 0.30), 0.55); // mossy patches
    } else {                                             // snow
      if (top || depth < lip + 0.05) c = snow(r);
      else c = rock(r, vWPos.y);
    }
    // tiny per-column tint so big flat areas don't look flat
    c *= 0.985 + 0.03 * h21(floor(vWPos.xz) + 0.37);
    c *= terrainAO(top);
    return lin(c);
  }
`;

function terrainMaterial(heightTex) {
  const m = new THREE.MeshLambertMaterial();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHeights = { value: heightTex };
    Object.assign(sh.uniforms, seeThrough);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${SEE_VERT}
        attribute float aKind;
        attribute float aTop;
        attribute vec2 aUnder;
        varying vec3 vWPos;
        varying vec3 vONormal;
        varying float vKind;
        varying float vTop;
        varying vec2 vUnder;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vONormal = normal;
        vKind = aKind;
        vTop = aTop;
        vUnder = aUnder;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSeeDepth = -mvPosition.z;
        {
          // only columns that stand between the camera and the player (counting just the part
          // above SEE_GROUND over the feet) open up
          vec3 cb = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 ct = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 1.0)).xyz;
          cb.y = max(cb.y, uSeeFeet + ${SEE_GROUND.toFixed(2)});
          vSeeOcc = ct.y > cb.y ? seeOcc(cb, ct, 0.71) : 0.0;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${TERRAIN_GLSL}
        ${SEE_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        // hills and cliffs in front of the player open up like the tree canopies, but only above
        // SEE_GROUND over the player's feet, so the ground and small steps in front stay solid
        if (vWPos.y > uSeeFeet + ${SEE_GROUND.toFixed(2)}) seeCut(vSeeDepth, 0.0);`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( terrainColor(), opacity );');
  };
  return m;
}

// ---------- foliage ----------
export const wind = { value: 0 };
export const waveTime = { value: 0 }; // the swell's clock (waves.js waveClock), shared by every player

// Lambert material whose vertices sway with the wind, more toward the top.
function swayMaterial(color, strength, side = THREE.FrontSide, vertexColors = false) {
  // Foliage writes stencil 1 like the characters do, so standing in grass doesn't trigger the
  // see-through character silhouette (that's only for hills, trees and ruins).
  const m = new THREE.MeshLambertMaterial({
    color, side, vertexColors,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        // a calm rustle, plus slow gusts that roll across the land along the wind (WIND in ambient.js)
        float sw = 0.8 * sin(uTime * 1.6 + ip.x * 0.8 + ip.z * 0.6) + 0.3 * sin(uTime * 2.9 + ip.z * 1.3);
        float gust = sin(dot(ip.xz, vec2(0.944, 0.33)) * 0.24 - uTime * 0.85);
        gust = smoothstep(0.15, 1.0, gust) * (0.6 + 0.4 * sin(ip.x * 0.05 - ip.z * 0.07 + uTime * 0.13));
        sw += gust * 1.5;
        float lift = max(transformed.y, 0.0);
        transformed.x += sw * ${strength.toFixed(3)} * lift;
        transformed.z += sw * ${(strength * 0.5).toFixed(3)} * lift;`);
  };
  // the strength is baked into the shader, so each strength needs its own program
  m.customProgramCacheKey = () => `sway:${strength}`;
  return m;
}

// Fluffy grass clumps like hand-drawn pixel-art grass: a mound of pointed leaves leaning
// outward, colored deep green at the base to bright lime at the tips (vertex colors).
// All normals point up so the lighting stays flat and the painted gradient reads clearly.
// Each leaf is one triangle, so tens of thousands of clumps stay cheap.
const LEAF_DARK = new THREE.Color(0x3a6a2c), LEAF_MID = new THREE.Color(0x66994a), LEAF_TIP = new THREE.Color(0xa9c678); // softer, less contrast against the ground // toned down
function leafClumpGeometry({ leaves, height, spread, width, seed }) {
  const rand = (k) => { const v = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const pos = [], col = [];
  const push = (v, c) => { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); };
  for (let k = 0; k < leaves; k++) {
    const a = (k / leaves) * Math.PI * 2 + rand(k) * 0.9;
    const inner = k % 3 === 0; // some upright leaves in the middle make it fluffy
    const lean = inner ? 0.1 + rand(k + 50) * 0.2 : 0.55 + rand(k + 50) * 0.4;
    const h = height * (inner ? 1 : 0.65 + rand(k + 100) * 0.35);
    const r0 = inner ? 0 : spread * (0.2 + rand(k + 150) * 0.5);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const w = width * (0.8 + rand(k + 200) * 0.5);
    const base = dir.clone().multiplyScalar(r0);
    const tip = base.clone().addScaledVector(dir, Math.sin(lean) * h).setY(Math.cos(lean) * h);
    // inner leaves stay darker so each clump has depth; outer tips catch the light
    const tipCol = LEAF_MID.clone().lerp(LEAF_TIP, inner ? 0.15 + rand(k + 250) * 0.3 : 0.45 + rand(k + 250) * 0.55);
    // both windings, so the leaf is visible from either side without DoubleSide
    // (DoubleSide would flip the up-normal on back faces and render them dark)
    const left = base.clone().addScaledVector(perp, w / 2), right = base.clone().addScaledVector(perp, -w / 2);
    push(left, LEAF_DARK); push(right, LEAF_DARK); push(tip, tipCol);
    push(right, LEAF_DARK); push(left, LEAF_DARK); push(tip, tipCol);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  return g;
}
const tuftGeometry = () => leafClumpGeometry({ leaves: 10, height: 0.2, spread: 0.2, width: 0.15, seed: 1 });
const tallGrassGeometry = () => leafClumpGeometry({ leaves: 16, height: 0.34, spread: 0.32, width: 0.2, seed: 2 });

function fernGeometry() {
  const leaves = [];
  for (let k = 0; k < 6; k++) {
    leaves.push(new THREE.BoxGeometry(0.07, 0.02, 0.32).translate(0, 0, 0.16).rotateX(-0.55).rotateY((k / 6) * Math.PI * 2 + 0.3));
  }
  return mergeGeometries(leaves);
}

function reedGeometry() {
  const blades = [];
  for (const [x, z, h, tilt] of [[0, 0, 0.55, 0], [-0.06, 0.03, 0.42, -0.25], [0.06, -0.02, 0.38, 0.3], [0.02, 0.06, 0.3, 0.15]]) {
    blades.push(new THREE.BoxGeometry(0.03, h, 0.03).translate(0, h / 2, 0).rotateZ(tilt).translate(x, 0, z));
  }
  return mergeGeometries(blades);
}

const TREE_VARIANTS = 4, PINE_VARIANTS = 3, PALM_VARIANTS = 3, REDWOOD_VARIANTS = 3;

// Tree canopies (and terrain, see terrainMaterial) open up around the local player: fragments in
// front of the character and inside a circle around it on screen are discarded with a 4×4 Bayer
// dither at the edge, so the player is visible through them. Shadows use the depth material, so they stay.
// see-through hole: radius in world units around the player, and its minimum share of the screen height;
// past the hole, only SEE_RING of the pixels are kept, back to solid at SEE_FADE × the radius
const SEE_R = 1.7, SEE_MIN = 0.11, SEE_RING = 0.5, SEE_FADE = 2.6;
const SEE_GROUND = 0.6; // terrain opens up only this far above the player's feet
const seeThrough = {
  uSeePos: { value: new THREE.Vector2(-9999, -9999) }, // player, in render-target pixels
  uSeeRadius: { value: 0 }, // in render-target pixels
  uSeeDepth: { value: 0 }, // player's distance along the view axis
  uSeeFeet: { value: -999 }, // player's feet height (world y)
  uSeeWorld: { value: new THREE.Vector3(0, -999, 0) }, // player's middle (world)
};
// Only objects that actually stand between the camera and the player open up: each instance's
// vertical axis (a capsule of radius r) is tested against the camera→player sight line in the
// vertex shader, giving vSeeOcc (1 = in the way, fading to 0 over SEE_OCC_SOFT past r).
const SEE_OCC_SOFT = 0.6;
const SEE_TRUNK = 1.0; // share of a tree trunk's pixels kept in the see-through hole (1 = stays solid)
const SEE_VERT = /* glsl */`
  varying float vSeeDepth;
  varying float vSeeOcc;
  uniform vec3 uSeeWorld; uniform float uSeeFeet;
  // shortest distance between segments p1-q1 and p2-q2
  float seeSegDist(vec3 p1, vec3 q1, vec3 p2, vec3 q2) {
    vec3 d1 = q1 - p1, d2 = q2 - p2, r = p1 - p2;
    float a = max(dot(d1, d1), 1e-6), e = max(dot(d2, d2), 1e-6), f = dot(d2, r);
    float c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
    float s = den > 1e-6 ? clamp((b * f - c * e) / den, 0.0, 1.0) : 0.0;
    float t = (b * s + f) / e;
    if (t < 0.0) { t = 0.0; s = clamp(-c / a, 0.0, 1.0); }
    else if (t > 1.0) { t = 1.0; s = clamp((b - c) / a, 0.0, 1.0); }
    return distance(p1 + d1 * s, p2 + d2 * t);
  }
  float seeOcc(vec3 base, vec3 top, float r) {
    return 1.0 - smoothstep(r, r + ${SEE_OCC_SOFT.toFixed(2)}, seeSegDist(cameraPosition, uSeeWorld, base, top));
  }`;
// fragment-shader helpers: seeCut(view depth) discards the fragment if it's in the see-through hole
const SEE_GLSL = /* glsl */`
  varying float vSeeDepth;
  varying float vSeeOcc;
  uniform vec2 uSeePos; uniform float uSeeRadius; uniform float uSeeDepth; uniform float uSeeFeet;
  float seeBayer(vec2 p) {
    ivec2 i = ivec2(mod(p, 4.0));
    float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    return (m[i.x + i.y * 4] + 0.5) / 16.0;
  }
  // minKeep: the least share of pixels kept (trunks stay solid)
  void seeCut(float depth, float minKeep) {
    if (uSeeRadius > 0.0 && depth < uSeeDepth - 0.25) {
      float d = distance(gl_FragCoord.xy, uSeePos) / uSeeRadius;
      // fully open in the middle, then a wide half see-through (dithered) ring that thickens
      // back to solid by SEE_FADE radii, like the clouds' soft hole
      float keep = min(smoothstep(0.6, 1.0, d), ${SEE_RING.toFixed(2)} + ${(1 - SEE_RING).toFixed(2)} * smoothstep(1.0, ${SEE_FADE.toFixed(2)}, d));
      keep = 1.0 - vSeeOcc * (1.0 - keep); // only on objects in the way
      keep = max(keep, minKeep);
      if (keep < seeBayer(gl_FragCoord.xy)) discard;
    }
  }`;
// `minY`: only fragments above this world height open up (a boat's cabin, not its deck).
// `occ`: [y0, y1, r] = each instance's axis (local y) and radius (local units, scaled with it);
// only instances whose axis passes near the camera→player line open up. Without it, always.
export function seeThroughMaterial(params, { minY = null, occ = null } = {}) {
  const m = new THREE.MeshLambertMaterial(params);
  const low = minY === null ? '' : `if (vSeeY > ${minY.toFixed(3)}) `;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, seeThrough);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying float vSeeY;
        ${SEE_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSeeDepth = -mvPosition.z;
        ${occ ? `#ifdef USE_INSTANCING
          {
            mat4 im = modelMatrix * instanceMatrix;
            float sc = length(im[0].xyz);
            vSeeOcc = seeOcc((im * vec4(0.0, ${occ[0].toFixed(2)}, 0.0, 1.0)).xyz, (im * vec4(0.0, ${occ[1].toFixed(2)}, 0.0, 1.0)).xyz, ${occ[2].toFixed(2)} * sc);
          }
        #else
          vSeeOcc = 1.0;
        #endif` : 'vSeeOcc = 1.0;'}
        #ifdef USE_INSTANCING
          vSeeY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;
        #else
          vSeeY = (modelMatrix * vec4(transformed, 1.0)).y;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSeeY;
        ${SEE_GLSL}`)
      .replace('#include <color_pars_fragment>', `#include <color_pars_fragment>
        // trees: bark (redder than green, unlike every leaf band) never fades away
        float seeTrunk() {
          #if defined( USE_COLOR )
            return vColor.r > vColor.g ? ${SEE_TRUNK.toFixed(2)} : 0.0;
          #else
            return 0.0;
          #endif
        }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        ${low}seeCut(vSeeDepth, ${occ ? 'seeTrunk()' : '0.0'});`);
  };
  m.customProgramCacheKey = () => `see:${minY}:${occ}`; // a program per variant
  return m;
}
const _seeV = new THREE.Vector3();
const CHUNK = 16; // cells per side of an instancing chunk (see chunkInstances)
// Shadow map size: 1024² still gives more shadow texels per unit than art pixels at normal zoom
// (2048² filled ~40× more pixels than the scene itself)
const SHADOW_MAP = 1024;
const LANTERN_LIGHTS = 4; // lantern lights: the local player + the 3 nearest other players
const LANTERN_RANGE = 8, LANTERN_I = 2.2;
const FIREFLY_LIGHTS = 4; // point lights shared by the fireflies nearest the player (each one costs every lit pixel)
const FIREFLY_LIGHT_I = 0.4; // peak intensity of each, at full night (kept subtle)

// Redwoods near the player are cut away above head height (cone-shaped: the allowed height grows
// with horizontal distance), with a dithered edge, so the camera can see under the canopy. The cut
// only affects the visible mesh; shadows (depth material) keep the full canopy, so it stays dark.
const cutaway = { uCutPlayer: { value: new THREE.Vector3(0, -999, 0) }, uCutCam: { value: new THREE.Vector2() } };
// corridor from the player to the camera (plus `width` around it): redwood parts higher than
// `above` over the player are cut, the allowed height rising by `slope` per unit outside the corridor
export const CUTAWAY = { above: 2.4, width: 3.0, slope: 1.6, fade: 1.0 };
function redwoodMaterial() {
  const m = seeThroughMaterial({ vertexColors: true }, { occ: [0, 11.6, 2.5] });
  const inner = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    inner(sh);
    Object.assign(sh.uniforms, cutaway);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cutW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cutW = instanceMatrix * cutW;
        #endif
        vCutW = (modelMatrix * cutW).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCutW;
        uniform vec3 uCutPlayer;
        uniform vec2 uCutCam;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          vec2 ca = uCutPlayer.xz, cab = uCutCam - ca;
          float ct = clamp(dot(vCutW.xz - ca, cab) / max(dot(cab, cab), 1e-4), 0.0, 1.0);
          float dseg = distance(vCutW.xz, ca + cab * ct);   // distance to the player→camera corridor
          float maxH = uCutPlayer.y + ${CUTAWAY.above.toFixed(2)} + max(0.0, dseg - ${CUTAWAY.width.toFixed(2)}) * ${CUTAWAY.slope.toFixed(2)};
          float keep = 1.0 - clamp((vCutW.y - maxH) / ${CUTAWAY.fade.toFixed(2)}, 0.0, 1.0);
          if (keep < seeBayer(gl_FragCoord.xy)) discard;
        }`);
  };
  return m;
}

/** Open tree canopies around the player. `pos` = character feet, `rtW/rtH` = render-target size. */
/** Map editor: show everything (no see-through circle, no redwood cutaway). */
export function setEditorView() {
  seeThrough.uSeeRadius.value = 0;
  cutaway.uCutPlayer.value.set(0, 1e4, 0);
}

export function setSeeThrough(camera, pos, rtW, rtH) {
  if (!pos) { seeThrough.uSeeRadius.value = 0; return; } // off (boat edit mode: you're looking at the boat, not yourself)
  const depth = -_seeV.set(pos.x, pos.y + 0.5, pos.z).applyMatrix4(camera.matrixWorldInverse).z;
  if (depth <= camera.near) { seeThrough.uSeeRadius.value = 0; return; }
  _seeV.set(pos.x, pos.y + 0.5, pos.z).project(camera);
  seeThrough.uSeePos.value.set((_seeV.x * 0.5 + 0.5) * rtW, (_seeV.y * 0.5 + 0.5) * rtH);
  // SEE_R world units around the character, in render-target pixels, but never smaller than
  // SEE_MIN of the screen height, so the hole stays big enough to spot you when zoomed out
  const worldR = (SEE_R / depth) * (rtH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
  seeThrough.uSeeRadius.value = Math.max(worldR, rtH * SEE_MIN);
  seeThrough.uSeeDepth.value = depth;
  seeThrough.uSeeFeet.value = pos.y;
  seeThrough.uSeeWorld.value.set(pos.x, pos.y + 0.5, pos.z);
  cutaway.uCutPlayer.value.set(pos.x, pos.y, pos.z);
  cutaway.uCutCam.value.set(camera.position.x, camera.position.z);
}

// Shared geometries (built once, flagged so dispose() keeps them)
const geoCache = new Map();
function sharedGeo(key, build) {
  if (!geoCache.has(key)) { const g = build(); g.userData.shared = true; geoCache.set(key, g); }
  return geoCache.get(key);
}
// A wild flower: slim stem, two leaves, an orange centre and five tilted petals. Petals carry aPetal = 1 and
// take the instance colour (see flowerMaterial); the stem, leaves and centre keep their own colours.
function flowerGeometry() {
  const parts = [];
  const add = (w, h, d, x, y, z, ry, tz, hex, petal) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, tz, 'YZX')), new THREE.Vector3(1, 1, 1)));
    const n = g.attributes.position.count, c = new THREE.Color(hex), col = [];
    for (let i = 0; i < n; i++) col.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aPetal', new THREE.Float32BufferAttribute(new Array(n).fill(petal), 1));
    parts.push(g);
  };
  add(0.014, 0.12, 0.014, 0, 0.06, 0, 0, 0, 0x4f9a3a, 0); // stem
  add(0.06, 0.012, 0.026, 0.026, 0.04, 0, 0, 0.5, 0x5fae44, 0); // leaves, one each side
  add(0.05, 0.012, 0.024, -0.022, 0.065, 0.004, Math.PI, 0.5, 0x4a8f34, 0);
  const HY = 0.135;
  add(0.036, 0.034, 0.036, 0, HY, 0, 0, 0, 0xe89a20, 0); // centre
  for (let k = 0; k < 5; k++) { // petals
    const a = (k / 5) * Math.PI * 2 + 0.3, r = 0.04;
    add(0.052, 0.014, 0.04, Math.cos(a) * r, HY - 0.004, -Math.sin(a) * r, a, 0.3, 0xffffff, 1);
  }
  return mergeGeometries(parts);
}
function flowerMaterial() {
  const m = swayMaterial(0xffffff, 0.3, THREE.FrontSide, true);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh) => {
    base(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPetal;')
      .replace('#include <color_vertex>', `vColor = vec4(color.rgb, 1.0);
        #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, aPetal);
        #endif`);
  };
  m.customProgramCacheKey = () => 'sway:0.3:petal';
  return m;
}
const GEO = {
  tuft: () => sharedGeo('tuft', tuftGeometry),
  tall: () => sharedGeo('tall', tallGrassGeometry),
  fern: () => sharedGeo('fern', fernGeometry),
  reed: () => sharedGeo('reed', reedGeometry),
  rock: () => sharedGeo('rock', () => new THREE.DodecahedronGeometry(1, 0)),
  flower: () => sharedGeo('flower', flowerGeometry),
  cattail: () => sharedGeo('cattail', () => new THREE.BoxGeometry(0.06, 0.13, 0.06)),
  berry: () => sharedGeo('berry', () => new THREE.BoxGeometry(0.06, 0.06, 0.06)),
  stem: () => sharedGeo('stem', () => new THREE.CylinderGeometry(0.025, 0.03, 0.1, 5).translate(0, 0.05, 0)),
  cap: () => sharedGeo('cap', () => new THREE.CylinderGeometry(0.03, 0.085, 0.06, 6).translate(0, 0.12, 0)),
  seaweed: () => sharedGeo('seaweed', seaweedGeometry),
  seagrass: () => sharedGeo('seagrass', seagrassGeometry),
  // a loose pebble with a smaller one beside it (players pick these up)
  pebble: () => sharedGeo('pebble', () => mergeGeometries([
    new THREE.DodecahedronGeometry(0.13, 0).scale(1, 0.6, 0.85).translate(0, 0.06, 0),
    new THREE.DodecahedronGeometry(0.07, 0).scale(1, 0.7, 1).translate(0.16, 0.04, 0.06),
  ])),
  cotton: () => sharedGeo('cotton', cottonGeometry),
  cairn: () => sharedGeo('cairn', () => mergeGeometries([
    new THREE.DodecahedronGeometry(0.17, 0).scale(1, 0.6, 1).translate(0, 0.08, 0),
    new THREE.DodecahedronGeometry(0.12, 0).scale(1, 0.65, 1).translate(0.02, 0.22, -0.01),
    new THREE.DodecahedronGeometry(0.08, 0).scale(1, 0.7, 1).translate(-0.01, 0.33, 0.01),
  ])),
  // lily pad: a flat disc with a notch, just above the water line
  lily: () => sharedGeo('lily', () => new THREE.CircleGeometry(0.2, 10, 0.4, Math.PI * 2 - 0.55).rotateX(-Math.PI / 2).translate(0, 0.025, 0)),
  lilyFlower: () => sharedGeo('lilyFlower', () => mergeGeometries([
    new THREE.BoxGeometry(0.09, 0.05, 0.09).translate(0, 0.05, 0),
    new THREE.BoxGeometry(0.05, 0.05, 0.05).translate(0, 0.09, 0),
  ])),
};

// ---------- cotton plant (gathered for Cotton Balls): a slim stalk, a few green leaves and white bolls in brown husks ----------
function cottonGeometry() {
  const parts = [], col = new THREE.Color();
  const put = (g, hex, y0 = null) => { // flat-shaded part with one vertex colour (pale toward the top when y0 is given)
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { col.setHex(hex); if (y0 !== null) col.multiplyScalar(0.86 + Math.min(0.14, Math.max(0, p.getY(i) - y0) * 1.2)); c.set([col.r, col.g, col.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  put(new THREE.BoxGeometry(0.035, 0.46, 0.035).translate(0, 0.23, 0), 0x5f8a3a);
  // leaves: flat, angled up and out at different heights and turns
  for (let k = 0; k < 6; k++) {
    const leaf = new THREE.BoxGeometry(0.2, 0.02, 0.09).translate(0.11, 0, 0);
    leaf.rotateZ(0.45 - (k % 2) * 0.15).rotateY(k * 1.1 + 0.3).translate(0, 0.09 + k * 0.05, 0);
    put(leaf, k % 2 ? 0x4f9a3a : 0x5aa844);
  }
  // bolls: a brown husk with a fluffy white puff (three small lumps) bursting out of it
  const bolls = [[0.1, 0.3, 0.03], [-0.09, 0.38, -0.05], [0.02, 0.47, 0.1], [-0.05, 0.27, 0.1], [0.06, 0.44, -0.09], [0, 0.52, 0]];
  for (const [x, y, z] of bolls) {
    put(new THREE.DodecahedronGeometry(0.045, 0).scale(1, 0.7, 1).translate(x, y - 0.035, z), 0x8a6a42);
    put(new THREE.IcosahedronGeometry(0.075, 0).translate(x, y + 0.02, z), 0xfdfdf8, y - 0.06);
    put(new THREE.IcosahedronGeometry(0.052, 0).translate(x + 0.045, y + 0.0, z + 0.015), 0xf3f1e6, y - 0.06);
    put(new THREE.IcosahedronGeometry(0.052, 0).translate(x - 0.04, y + 0.03, z - 0.02), 0xffffff, y - 0.06);
  }
  return mergeGeometries(parts);
}

// ---------- coral reefs (waterLife in world.js): original low-poly corals ----------
// Geometry is pale grey-to-white with darker bases (vertex colours); each instance gets its colour from
// CORAL_COLORS (or STAR_COLORS for starfish), so one mesh per shape serves every colour.
export const CORAL_COLORS = [0xff6f91, 0xff8a4c, 0xb07ae8, 0xffd04a, 0x3fd8c4, 0xf0584e]; // pink, coral orange, violet, yellow, teal, red
const STAR_COLORS = [0xff7a3c, 0xe8504a, 0xffb84a];
function coralParts(build) {
  const parts = [], col = new THREE.Color();
  // a box from (x, y0) up `h`, leaning by (ax, az), shaded darker at the base and pale at the tip
  const add = (g, lo = 0.62, hi = 1.0, y0 = 0, h = 0.5) => {
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = Math.max(0, Math.min(1, (p.getY(i) - y0) / h)); col.setScalar(lo + (hi - lo) * k); c.set([col.r, col.g, col.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  build(add);
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geo;
}
// branching (staghorn) coral: a stub with antler branches reaching up and out
const coralBranchGeometry = () => coralParts((add) => {
  add(new THREE.BoxGeometry(0.09, 0.14, 0.09).translate(0, 0.07, 0), 0.55, 0.75, 0, 0.5);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + 0.3, lean = 0.45 + (i % 3) * 0.18, len = 0.22 + (i % 2) * 0.12;
    const g = new THREE.BoxGeometry(0.045, len, 0.045).translate(0, len / 2, 0).rotateX(lean).rotateY(a).translate(0, 0.1, 0);
    add(g, 0.7, 1.0, 0.05, 0.45);
    const tip = new THREE.BoxGeometry(0.035, 0.12, 0.035).translate(0, 0.06, 0).rotateX(lean * 0.3).rotateY(a + 0.4)
      .translate(Math.sin(a) * Math.sin(lean) * len, 0.1 + Math.cos(lean) * len, Math.cos(a) * Math.sin(lean) * len);
    add(tip, 0.85, 1.08, 0.1, 0.45);
  }
});
// brain coral: a low dome with grooved bands
const coralBrainGeometry = () => coralParts((add) => {
  const g = new THREE.IcosahedronGeometry(0.24, 1).scale(1, 0.62, 1).translate(0, 0.06, 0).toNonIndexed();
  add(g, 0.7, 1.0, -0.05, 0.25);
  const c = g.attributes.color, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (Math.floor((p.getX(i) + p.getZ(i) * 0.6) * 22) % 2) c.setXYZ(i, c.getX(i) * 0.8, c.getY(i) * 0.8, c.getZ(i) * 0.8);
});
// sea fan: flat slats fanning out from a short stem, criss-crossed by a few thin bars
const coralFanGeometry = () => coralParts((add) => {
  add(new THREE.BoxGeometry(0.05, 0.1, 0.03).translate(0, 0.05, 0), 0.5, 0.7, 0, 0.6);
  for (let i = -3; i <= 3; i++) add(new THREE.BoxGeometry(0.03, 0.48, 0.016).translate(0, 0.24, 0).rotateZ(i * 0.2).translate(0, 0.08, 0), 0.68, 1.02, 0.05, 0.55);
  for (const y of [0.24, 0.38]) add(new THREE.BoxGeometry(0.2 + y * 0.9, 0.018, 0.018).translate(0, y, 0), 0.9, 0.95, 0, 0.6);
});
// tube coral: a cluster of short open tubes with dark mouths
const coralTubeGeometry = () => coralParts((add) => {
  for (const [x, z, h, r] of [[0, 0, 0.32, 0.05], [0.09, 0.03, 0.24, 0.04], [-0.07, 0.06, 0.2, 0.04], [0.02, -0.09, 0.27, 0.045], [-0.08, -0.06, 0.15, 0.035]]) {
    add(new THREE.CylinderGeometry(r, r * 1.1, h, 6).translate(x, h / 2, z), 0.62, 1.0, 0, 0.32);
    add(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.01, 6).translate(x, h + 0.004, z), 0.25, 0.25, 0, 1);
  }
});
// anemone: a soft base with a ring of tentacles (sways with the current)
const anemoneGeometry = () => coralParts((add) => {
  add(new THREE.CylinderGeometry(0.08, 0.1, 0.07, 8).translate(0, 0.035, 0), 0.6, 0.8, 0, 0.3);
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, rr = i < 8 ? 0.06 : 0.03, lean = i < 8 ? 0.55 : 0.2;
    add(new THREE.BoxGeometry(0.018, 0.17, 0.018).translate(0, 0.085, 0).rotateX(lean).rotateY(a).translate(Math.sin(a) * rr, 0.06, Math.cos(a) * rr), 0.8, 1.1, 0.06, 0.2);
  }
});
// starfish: five flat arms on the sand
const starfishGeometry = () => coralParts((add) => {
  add(new THREE.CylinderGeometry(0.035, 0.04, 0.02, 6).translate(0, 0.012, 0), 0.9, 0.9, 0, 1);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.035, 0.016, 0.12).translate(0, 0.01, 0.07).rotateY(i * 1.2566), 0.85, 0.85, 0, 1);
});
const CORAL_GEO = [coralBranchGeometry, coralBrainGeometry, coralFanGeometry, coralTubeGeometry, anemoneGeometry, starfishGeometry];
const coralGeo = (t) => sharedGeo(`coral${t}`, CORAL_GEO[t]);

// seaweed: three thin ribbons, 1 unit tall (scaled to the water depth per instance)
function seaweedGeometry() {
  const parts = [];
  for (const [x, z, a, tilt] of [[0, 0, 0.2, 0.05], [0.05, 0.03, 1.4, -0.12], [-0.04, -0.03, 2.5, 0.1]]) {
    parts.push(new THREE.BoxGeometry(0.06, 1, 0.012).translate(0, 0.5, 0).rotateZ(tilt).rotateY(a).translate(x, 0, z));
  }
  return mergeGeometries(parts);
}

// seagrass: a clump of nine slim blades, 1 unit tall, leaning out a little (scaled per instance)
function seagrassGeometry() {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + 0.3, r = 0.03 + (i % 3) * 0.035, h = 0.75 + ((i * 37) % 10) / 40;
    parts.push(new THREE.BoxGeometry(0.035, h, 0.008).translate(0, h / 2, 0).rotateZ(0.08 + (i % 4) * 0.07).rotateY(a).translate(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  return mergeGeometries(parts);
}
// Lambert material that bobs with the water surface (same motion as the water plane in update())
function bobMaterial(params) {
  const m = new THREE.MeshLambertMaterial(params);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += sin(uTime * 0.8) * 0.03;');
  };
  return m;
}
// ---------- log piles ----------
// A pile holds up to 6 logs lying side by side: 3 on the ground, 2 in the dips above, 1 on top.
const LOG_R = 0.165, LOG_RISE = LOG_R * Math.sqrt(3);
/** Where log number i of a pile lies: [across, height] from the tile's middle and ground. */
export const LOG_SLOTS = [[-2 * LOG_R, LOG_R], [0, LOG_R], [2 * LOG_R, LOG_R], [-LOG_R, LOG_R + LOG_RISE], [LOG_R, LOG_R + LOG_RISE], [0, LOG_R + 2 * LOG_RISE]];
/** Position of log i in a pile turned r (0: logs along x, 1: along z), relative to the tile's middle. */
export const logOffset = (i, r, out) => (r ? out.set(LOG_SLOTS[i][0], LOG_SLOTS[i][1], 0) : out.set(0, LOG_SLOTS[i][1], LOG_SLOTS[i][0]));
// One log lying along x: an 8-sided trunk with streaky bark, and pale cut ends with a darker growth ring.
function logGeometry() {
  const parts = [], col = new THREE.Color();
  const paint = (g, pick) => {
    g = g.toNonIndexed();
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col.setHex(pick(Math.floor(i / 3))); c.set([col.r, col.g, col.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const BARK = [0x7a4a26, 0x8a5730, 0x6a3f20, 0x9a6336];
  // bark: 3 rings of facets along the log, each facet one of four browns (streaks)
  paint(new THREE.CylinderGeometry(LOG_R, LOG_R, 0.96, 8, 3, true).rotateZ(Math.PI / 2), (f) => BARK[(f * 7 + (f >> 1) * 3) % 4]);
  for (const side of [-1, 1]) { // cut ends: dark rim, pale wood, a growth ring, a pale heart
    const disc = (r, x, hex) => paint(new THREE.CircleGeometry(r, 8).rotateY(side * Math.PI / 2).translate(side * x, 0, 0), () => hex);
    disc(LOG_R, 0.48, 0x5a3418);
    disc(LOG_R * 0.86, 0.482, 0xe0b46a);
    disc(LOG_R * 0.58, 0.484, 0xb98842);
    disc(LOG_R * 0.42, 0.486, 0xe6bf78);
  }
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geo;
}
/** The log model (shared, never disposed), also for the placement preview in main.js. */
export const logGeo = () => sharedGeo('log', logGeometry);


// The workbench (original model, after the user's reference): a desk with a plank back board and
// pinned notes, a drawer cabinet on the right, an open shelf on the left, and bits and pieces on top.
// Fits one tile, front toward +z, standing on y = 0. Vertex-coloured boxes merged into one geometry.
function workbenchGeometry() {
  const parts = [], col = new THREE.Color();
  const add = (w, h, d, color, x, y, z, rz = 0) => { // a box centred at (x, y, z), optionally tilted
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    col.setHex(color);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  const LIGHT = 0xc9945c, WOOD = 0xa87444, MID = 0x94633a, DARK = 0x74492a, DEEP = 0x553420;
  const BLUE = 0x4f8fd0, NAVY = 0x35669e, WHITE = 0xeef3f8, GREEN = 0x5fa83a, MOSS = 0x3f7a2a, GREY = 0x8e949b, TAN = 0xd9b27a;
  // legs on the left, a drawer cabinet on the right
  for (const z of [-0.19, 0.19]) add(0.07, 0.46, 0.07, DARK, -0.42, 0.23, z);
  add(0.36, 0.42, 0.44, MID, 0.27, 0.25, 0);
  add(0.07, 0.04, 0.07, DARK, 0.12, 0.02, 0.19); add(0.07, 0.04, 0.07, DARK, 0.42, 0.02, 0.19);
  add(0.07, 0.04, 0.07, DARK, 0.12, 0.02, -0.19); add(0.07, 0.04, 0.07, DARK, 0.42, 0.02, -0.19);
  for (const y of [0.35, 0.15]) { // two drawers with handles
    add(0.3, 0.16, 0.03, WOOD, 0.27, y, 0.225);
    add(0.12, 0.035, 0.03, DEEP, 0.27, y, 0.245);
  }
  // the open shelf, with a few things on it
  add(0.52, 0.04, 0.42, WOOD, -0.17, 0.15, 0);
  add(0.07, 0.07, 0.16, BLUE, -0.33, 0.205, 0.08); add(0.07, 0.06, 0.12, NAVY, -0.25, 0.2, 0.1);
  add(0.16, 0.08, 0.1, GREEN, -0.1, 0.21, 0.1); add(0.04, 0.085, 0.105, MOSS, -0.1, 0.21, 0.1);
  // table top with a darker apron under it
  add(0.9, 0.05, 0.46, DARK, 0, 0.445, 0);
  add(0.98, 0.06, 0.54, LIGHT, 0, 0.5, 0);
  // back board: two posts, planks, a top rail
  for (const x of [-0.45, 0.45]) add(0.07, 0.46, 0.07, WOOD, x, 0.76, -0.225);
  add(0.84, 0.36, 0.035, MID, 0, 0.75, -0.235);
  add(0.84, 0.025, 0.04, DARK, 0, 0.75, -0.232); // the seam between the planks
  add(1.0, 0.05, 0.12, LIGHT, 0, 0.99, -0.22);
  // notes pinned to the board
  add(0.15, 0.17, 0.012, BLUE, -0.24, 0.78, -0.212, 0.3); add(0.09, 0.03, 0.014, WHITE, -0.24, 0.8, -0.21, 0.3);
  add(0.11, 0.1, 0.012, WHITE, -0.07, 0.72, -0.212, -0.25);
  add(0.08, 0.08, 0.012, WHITE, 0.1, 0.82, -0.212, 0.35);
  add(0.15, 0.18, 0.012, BLUE, 0.26, 0.78, -0.212, -0.08); add(0.1, 0.03, 0.014, WHITE, 0.26, 0.82, -0.21, -0.08); add(0.1, 0.03, 0.014, WHITE, 0.26, 0.76, -0.21, -0.08);
  // on the table: a cutting grid, offcuts, a stone, a green roll, blue tins
  add(0.24, 0.012, 0.16, DEEP, -0.26, 0.536, 0.08);
  for (const x of [-0.33, -0.26, -0.19]) for (const z of [0.045, 0.115]) add(0.05, 0.014, 0.05, MID, x, 0.538, z);
  add(0.09, 0.04, 0.05, TAN, -0.04, 0.55, 0.1); add(0.07, 0.035, 0.05, TAN, 0.03, 0.548, 0.04);
  add(0.14, 0.09, 0.1, GREY, 0.1, 0.575, -0.08);
  add(0.16, 0.1, 0.1, GREEN, 0.3, 0.58, -0.02); add(0.04, 0.105, 0.105, MOSS, 0.3, 0.58, -0.02);
  add(0.07, 0.06, 0.07, BLUE, 0.42, 0.56, 0.06); add(0.06, 0.05, 0.06, NAVY, 0.4, 0.555, 0.15);
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geo;
}

// ---------- furniture (crafted at the workbench; see FURNITURE in world.js) ----------
// Original cozy models, each fitting one tile, front toward +z (it faces whoever placed it),
// standing on y = 0. Vertex-coloured boxes merged into one geometry, like the workbench.
function boxModel(build) {
  const parts = [], col = new THREE.Color();
  const add = (w, h, d, color, x, y, z, rx = 0, rz = 0, ry = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    col.setHex(color);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  build(add);
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geo;
}
const FW = { LIGHT: 0xc9945c, WOOD: 0xa87444, MID: 0x94633a, DARK: 0x74492a, DEEP: 0x553420 };

const chairGeometry = () => boxModel((add) => {
  for (const x of [-0.17, 0.17]) for (const z of [-0.17, 0.17]) add(0.06, 0.32, 0.06, FW.DARK, x, 0.16, z);
  add(0.46, 0.06, 0.46, FW.WOOD, 0, 0.35, 0);
  add(0.38, 0.05, 0.36, 0x6fae4a, 0, 0.405, 0.02);           // a leafy green cushion
  add(0.3, 0.012, 0.28, 0x8fcf5a, 0, 0.432, 0.02);
  for (const x of [-0.19, 0.19]) add(0.06, 0.48, 0.06, FW.MID, x, 0.6, -0.2); // back posts
  add(0.44, 0.07, 0.05, FW.LIGHT, 0, 0.82, -0.2);            // top rail
  for (const x of [-0.08, 0, 0.08]) add(0.045, 0.34, 0.035, FW.WOOD, x, 0.6, -0.2); // slats
  add(0.36, 0.04, 0.04, FW.DARK, 0, 0.27, 0.2);              // a stretcher between the front legs
});

const tableGeometry = () => boxModel((add) => {
  for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) add(0.08, 0.5, 0.08, FW.DARK, x, 0.25, z);
  add(0.8, 0.08, 0.8, FW.MID, 0, 0.47, 0);                   // apron
  add(0.94, 0.06, 0.94, FW.LIGHT, 0, 0.54, 0);               // top
  for (const z of [-0.155, 0.155]) add(0.94, 0.008, 0.012, FW.WOOD, 0, 0.574, z); // plank seams
  add(0.5, 0.01, 0.34, 0xeee2c8, 0.04, 0.575, 0.04);         // a little runner
  add(0.09, 0.1, 0.09, 0xc06a44, -0.22, 0.62, -0.16);        // a terracotta pot
  add(0.1, 0.02, 0.1, 0xa8553a, -0.22, 0.675, -0.16);
  add(0.02, 0.1, 0.02, 0x4a8f30, -0.22, 0.73, -0.16);        // with a flower
  add(0.07, 0.05, 0.07, 0xf2c94c, -0.22, 0.79, -0.16);
  add(0.035, 0.035, 0.035, 0xe07a2a, -0.22, 0.8, -0.13);
  add(0.07, 0.08, 0.07, 0xeef3f8, 0.2, 0.61, 0.14);          // a mug
  add(0.03, 0.05, 0.02, 0xeef3f8, 0.25, 0.61, 0.14);
  add(0.18, 0.025, 0.13, 0x4f8fd0, 0.18, 0.585, -0.18);      // a book
});

const bedGeometry = () => boxModel((add) => {
  for (const x of [-0.37, 0.37]) for (const z of [-0.43, 0.43]) add(0.08, 0.16, 0.08, FW.DARK, x, 0.08, z);
  add(0.8, 0.14, 0.94, FW.MID, 0, 0.2, 0);                   // frame
  for (const x of [-0.37, 0.37]) add(0.08, 0.78, 0.08, FW.WOOD, x, 0.39, -0.45); // headboard posts
  add(0.68, 0.46, 0.05, FW.LIGHT, 0, 0.5, -0.45);            // headboard
  add(0.68, 0.05, 0.06, FW.DARK, 0, 0.73, -0.45);
  for (const x of [-0.37, 0.37]) add(0.08, 0.5, 0.08, FW.WOOD, x, 0.25, 0.45); // footboard
  add(0.68, 0.22, 0.05, FW.LIGHT, 0, 0.36, 0.45);
  add(0.72, 0.12, 0.86, 0xf3e6c8, 0, 0.33, 0);               // mattress, cream linen
  add(0.5, 0.1, 0.2, 0xffffff, 0, 0.43, -0.3);               // pillow
  add(0.46, 0.02, 0.16, 0xe8eef4, 0, 0.485, -0.3);
  add(0.76, 0.1, 0.56, 0x5fa83a, 0, 0.39, 0.12);             // a quilt of leaves
  add(0.77, 0.04, 0.12, 0x4a8f30, 0, 0.42, -0.12);           // folded-back edge
  for (const [x, z] of [[-0.2, 0.05], [0.12, 0.2], [0.22, -0.02], [-0.1, 0.3]]) add(0.12, 0.012, 0.1, 0x8fcf5a, x, 0.446, z); // leaf pattern
});

// the lamp's frame; its glowing panes are lampGlowGeometry (an unlit HDR mesh, so it blooms)
const lampGeometry = () => boxModel((add) => {
  add(0.34, 0.06, 0.34, FW.DEEP, 0, 0.03, 0);
  add(0.22, 0.05, 0.22, FW.DARK, 0, 0.085, 0);
  add(0.08, 0.9, 0.08, FW.MID, 0, 0.55, 0);                  // post
  add(0.26, 0.04, 0.26, 0x3a3532, 0, 1.0, 0);                // lantern bottom
  for (const x of [-0.11, 0.11]) for (const z of [-0.11, 0.11]) add(0.03, 0.26, 0.03, 0x3a3532, x, 1.15, z);
  add(0.28, 0.05, 0.28, 0x3a3532, 0, 1.3, 0);                // cap
  add(0.16, 0.06, 0.16, 0x2c2826, 0, 1.355, 0);
  add(0.05, 0.05, 0.05, 0x2c2826, 0, 1.405, 0);
});
const lampGlowGeometry = () => { const g = new THREE.BoxGeometry(0.19, 0.22, 0.19).translate(0, 1.15, 0); g.deleteAttribute('uv'); return g; };

const shelfGeometry = () => boxModel((add) => {
  const z0 = -0.24; // stands against the back of its tile
  for (const x of [-0.43, 0.43]) add(0.06, 1.24, 0.36, FW.MID, x, 0.62, z0);
  add(0.92, 1.18, 0.03, FW.DEEP, 0, 0.62, z0 - 0.165);       // back panel
  for (const y of [0.04, 0.42, 0.8, 1.22]) add(0.86, 0.05, 0.36, FW.WOOD, 0, y, z0);
  add(0.96, 0.05, 0.4, FW.LIGHT, 0, 1.26, z0);               // top
  const BOOKS = [0x4f8fd0, 0xe0334a, 0x5fa83a, 0xf2c94c, 0x8a5aa8, 0xeee2c8, 0x35669e, 0xc06a44];
  [0.065, 0.445].forEach((y, row) => {                       // two rows of books
    let x = -0.38, i = row * 3;
    while (x < 0.36) {
      const w = 0.05 + ((i * 37) % 4) * 0.012, h = 0.24 + ((i * 53) % 5) * 0.025;
      if ((i * 7 + row) % 9 !== 4) add(w, h, 0.24, BOOKS[(i * 5 + row) % BOOKS.length], x + w / 2, y + h / 2, z0 + 0.02);
      x += w + 0.008; i++;
    }
  });
  add(0.14, 0.12, 0.14, 0xc06a44, -0.22, 0.885, z0 + 0.02);  // top shelf: a potted plant, a jar, a pebble
  add(0.2, 0.14, 0.2, 0x5fa83a, -0.22, 1.01, z0 + 0.02);
  add(0.1, 0.16, 0.1, 0xbfe3ef, 0.05, 0.905, z0 + 0.02);
  add(0.12, 0.06, 0.1, 0xb0aba0, 0.26, 0.855, z0 + 0.04);
});

// ---- decorations (also crafted at the workbench; placed on land or on a boat's deck) ----
const crateGeometry = () => boxModel((add) => {
  add(0.62, 0.54, 0.62, FW.LIGHT, 0, 0.27, 0);
  for (const s of [-1, 1]) {
    for (const y of [0.05, 0.49]) { add(0.64, 0.07, 0.02, FW.DARK, 0, y, s * 0.315); add(0.02, 0.07, 0.64, FW.DARK, s * 0.315, y, 0); }
    add(0.02, 0.62, 0.07, FW.DARK, s * 0.315, 0.27, 0, 0.72); add(0.07, 0.62, 0.02, FW.DARK, 0, 0.27, s * 0.315, 0, 0.72); // braces
  }
  add(0.36, 0.28, 0.36, FW.WOOD, 0.08, 0.68, -0.06); // a smaller crate on top
  add(0.38, 0.05, 0.38, FW.DARK, 0.08, 0.8, -0.06);
});
// a round barrel: curved staves of uneven tone bulging out in the middle, iron hoops and a lid
function barrelGeometry() {
  const parts = [], col = new THREE.Color(), H = 0.66, STAVES = 14;
  const R = (y) => 0.235 + 0.05 * Math.sin(Math.PI * y / H); // the bulge
  const push = (g, hex, mul = 1) => {
    g = g.index ? g.toNonIndexed() : g;
    col.setHex(hex).multiplyScalar(mul);
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const profile = [];
  for (let i = 0; i <= 8; i++) { const y = (i / 8) * H; profile.push(new THREE.Vector2(R(y), y)); }
  const tones = [FW.WOOD, FW.LIGHT, FW.MID, FW.WOOD, FW.LIGHT, FW.WOOD, FW.MID];
  for (let i = 0; i < STAVES; i++) { // each stave its own strip, so the tones read as planks
    const step = (Math.PI * 2) / STAVES;
    push(new THREE.LatheGeometry(profile, 2, i * step, step), tones[(i * 3) % tones.length], 0.94 + ((i * 7) % 5) * 0.03);
  }
  for (const y of [0.1, 0.33, 0.56]) { // iron hoops hugging the bulge
    const h = y === 0.33 ? 0.035 : 0.045;
    push(new THREE.CylinderGeometry(R(y + h / 2) + 0.012, R(y - h / 2) + 0.012, h, 28).translate(0, y, 0), 0x3a3532);
  }
  push(new THREE.CylinderGeometry(R(H) - 0.015, R(H) - 0.015, 0.02, 24).translate(0, H - 0.03, 0), FW.MID); // the lid, set in a little
  push(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 10).translate(0.08, H - 0.01, 0.05), FW.DARK); // a bung
  const geo = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return geo;
}
const planterGeometry = () => boxModel((add) => {
  add(0.38, 0.32, 0.38, 0xc06a44, 0, 0.16, 0); // a terracotta pot
  add(0.44, 0.06, 0.44, 0xa8553a, 0, 0.33, 0);
  add(0.34, 0.03, 0.34, 0x5a3a22, 0, 0.35, 0);
  add(0.06, 0.25, 0.06, FW.DARK, 0, 0.45, 0); // a little potted tree
  for (const [x, y, z, s, c] of [[0, 0.72, 0, 0.42, 0x5fa83a], [0.14, 0.62, 0.1, 0.26, 0x4a8f30], [-0.13, 0.64, -0.08, 0.28, 0x6fbe46], [0.04, 0.9, -0.04, 0.26, 0x8fcf5a], [-0.08, 0.58, 0.14, 0.2, 0x4a8f30]]) add(s, s, s, c, x, y, z);
});
const flowerboxGeometry = () => boxModel((add) => {
  add(0.86, 0.22, 0.32, FW.MID, 0, 0.11, 0);
  add(0.9, 0.04, 0.36, FW.LIGHT, 0, 0.23, 0);
  add(0.8, 0.03, 0.26, 0x5a3a22, 0, 0.25, 0);
  const FL = [0xf2c94c, 0xe05a8a, 0xffffff, 0x9fb8ff, 0xe0334a, 0xf2c94c];
  for (let i = 0; i < 6; i++) {
    const x = -0.33 + i * 0.13, z = (i % 2 ? 0.05 : -0.05), h = 0.14 + (i % 3) * 0.05;
    add(0.025, h, 0.025, 0x4a8f30, x, 0.26 + h / 2, z);
    add(0.09, 0.06, 0.09, FL[i], x, 0.28 + h, z);
    add(0.08, 0.03, 0.05, 0x6fbe46, x + 0.04, 0.3, z);
  }
});
const seatGeometry = () => boxModel((add) => { // a garden bench
  for (const x of [-0.38, 0.38]) { add(0.07, 0.38, 0.07, FW.DARK, x, 0.19, 0.12); add(0.07, 0.8, 0.07, FW.DARK, x, 0.4, -0.14); }
  for (const z of [-0.06, 0.06, 0.18]) add(0.9, 0.04, 0.11, z === 0.06 ? FW.LIGHT : FW.WOOD, 0, 0.4, z);
  for (const y of [0.56, 0.7]) add(0.86, 0.09, 0.03, FW.LIGHT, 0, y, -0.15);
  for (const x of [-0.38, 0.38]) add(0.06, 0.04, 0.36, FW.MID, x, 0.55, 0.02); // armrests
});
const pennantGeometry = () => boxModel((add) => { // a pennant on a pole
  add(0.3, 0.08, 0.3, FW.DEEP, 0, 0.04, 0);
  add(0.06, 1.7, 0.06, FW.MID, 0, 0.9, 0);
  add(0.09, 0.09, 0.09, 0xe0b040, 0, 1.78, 0); // a brass finial
  [0.56, 0.44, 0.32, 0.2, 0.09].forEach((l, i) => add(l, 0.07, 0.02, i % 2 ? 0xd8433a : 0xe85a4a, 0.03 + l / 2, 1.62 - i * 0.065, 0)); // the pennant
  add(0.14, 0.05, 0.022, 0xf4efe4, 0.16, 1.56, 0); // a white stripe
});

const FURN_BUILD = [workbenchGeometry, chairGeometry, tableGeometry, bedGeometry, lampGeometry, shelfGeometry, crateGeometry, barrelGeometry, planterGeometry, flowerboxGeometry, seatGeometry, pennantGeometry];
/** The model for a furniture type (index into FURNITURE; shared, never disposed). Also the placement preview. */
export const furnitureGeometry = (t) => sharedGeo(`furn${t}`, FURN_BUILD[t] ?? workbenchGeometry);
export const LAMP_TYPE = 4;
/** The glowing part of a furniture type (the lamp's panes), or null. */
export const furnitureGlowGeometry = (t) => (t === LAMP_TYPE ? sharedGeo('lampGlow', lampGlowGeometry) : null);

// a stable per-object number from its position (variants, rotation and tint don't depend on list order)
const posKey = (o) => Math.floor(o.x * 7.31 + o.z * 131.7);

// Endless worlds stream CH×CH-cell chunks around the player (see endless.js)
const LOAD_R0 = 50; // world units from the player to a chunk's nearest edge (more when zoomed out past 34, see updateChunks)
const LOAD_BUDGET_MS = 5; // per frame
const TREE_LOD_R = 20; // trees in chunks farther than this from the player use low-detail models
const SMALL_R = 30; // grass, flowers, ferns, reeds and mushrooms are hidden in chunks farther than this
const MOTE_CAP = 4096;

export class WorldScene {
  constructor(world) {
    this.world = world;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 38, 75);

    // warm golden sun + cool sky fill so shadows read slightly blue
    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x6b5a48, 1.35);
    scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xffe4bd, 1.5));
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 200 });
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    // Layers. Three.js uses a shadow camera's own layers when any non-zero layer is enabled:
    //  - 0: normal scenery (seen, and casts through the main sun)
    //  - 2: clouds (seen by the main camera; cast only through the weaker cloud sun, so they dim the
    //    ground gently instead of blacking it out like tree shadows)
    //  - 31: shadow-only casters for the main sun (low-detail tree twins, see addDecor)
    //  - 1: shadow-only casters for the cloud sun (redwood twins, so the deep forest stays dark)
    sun.shadow.camera.layers.enable(31);
    const cloudSun = (this.cloudSun = new THREE.DirectionalLight(0xffe4bd, 1.6));
    cloudSun.castShadow = true;
    Object.assign(cloudSun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 200 });
    cloudSun.shadow.mapSize.set(SHADOW_MAP / 2, SHADOW_MAP / 2);
    cloudSun.shadow.camera.layers.set(1);
    cloudSun.shadow.camera.layers.enable(2);
    scene.add(cloudSun, cloudSun.target);
    this.sunOffset = new THREE.Vector3(16, 21, 11); // a bit lower for longer, cozier shadows

    this.cloudRes = { value: new THREE.Vector2(1, 1) }; // render-target size, set each frame by main.js
    // column heights for terrain AO: a HT×HT ring buffer indexed by cell mod HT (see TERRAIN_GLSL)
    this.heightTex = new THREE.DataTexture(new Float32Array(HT * HT), HT, HT, THREE.RedFormat, THREE.FloatType);
    this.heightTex.needsUpdate = true;
    this.terrainMat = terrainMaterial(this.heightTex);
    this.mats = {
      leaf: seeThroughMaterial({ vertexColors: true }, { occ: [0.2, 2.13, 0.85] }), // leafy trees and pines
      // redwoods: cut away near the player (see redwoodMaterial)
      red: redwoodMaterial(),
      rock: mat(0x9a958a),
      flower: flowerMaterial(),
      tuft: swayMaterial(0xffffff, 0.3, THREE.FrontSide, true),
      tall: swayMaterial(0xffffff, 0.25, THREE.FrontSide, true),
      fern: swayMaterial(0xffffff, 0.25),
      reed: swayMaterial(0xffffff, 0.3),
      cattail: mat(0x7a4a2a),
      bush: new THREE.MeshLambertMaterial({ vertexColors: true }),
      berry: mat(0xe0334a),
      stem: mat(0xf3ead8),
      cap: mat(0xd8452f),
      seaweed: swayMaterial(0xffffff, 0.1),
      seagrass: swayMaterial(0xffffff, 0.16),
      coral: new THREE.MeshLambertMaterial({ vertexColors: true }),
      coralSway: swayMaterial(0xffffff, 0.12, THREE.FrontSide, true), // sea fans and anemones sway with the current
      seaRock: mat(0x7d8a72),
      cairn: mat(0xa8a39a),
      pebble: mat(0xc2bdb1),
      cotton: swayMaterial(0xffffff, 0.22, THREE.FrontSide, true),
      lily: bobMaterial({ color: 0xffffff }),
      lilyFlower: bobMaterial({ color: 0xffffff }),
    };
    this.gems = [];
    this.buildWater();
    this.buildMotes();
    if (world.endless) {
      this.chunks = new Map(); // cellKey(cx, cz) -> { cx, cz, group, data, gems }
      this.live = { flowers: [], reeds: [], trees: [], redwoods: [], lilies: [], corals: [], cotton: [], pebbles: [], bushes: [], rocks: [] }; // what's loaded now (ambient life, chopping)
    } else {
      this.terrain = this.terrainMesh(0, 0, WORLD, WORLD);
      scene.add(this.terrain);
      this.writeHeights(0, 0, WORLD, WORLD);
      this.addDecor(scene, world);
      this.addFoliage(scene, world);
      this.gems = this.addRuins(scene, world.ruins);
      this.setMotes(world.motes);
      this.live = world;
    }
    this.buildCamp();
    this.buildClouds();
    if (!world.endless) this.chunkInstances();
    this.setTimeOfDay(DEFAULT_TIME);
    this.ambient = new Ambient(world, scene, this.live);
    this.effects = new Effects(scene);
    this.ambient.effects = this.effects; // fish splash when they leap
    this.atmosphere = new Atmosphere(world, scene); // campfire embers and smoke, daytime pollen
    this.shadowHalf = 22;
  }

  /**
   * Island performance: split every big static InstancedMesh (trees, grass, rocks, flowers...) into
   * CHUNK×CHUNK-cell pieces, so the camera and the shadow pass skip what's off-screen
   * (an instanced mesh is culled as a whole by its bounding sphere). Endless worlds are built per chunk.
   */
  chunkInstances() {
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
    const skip = new Set([this.terrain, this.moteMesh]);
    for (const mesh of [...this.scene.children]) {
      if (!mesh.isInstancedMesh || skip.has(mesh) || mesh.count < 64) continue;
      const groups = new Map();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        const key = Math.floor((p.x + WORLD / 2) / CHUNK) * 1000 + Math.floor((p.z + WORLD / 2) / CHUNK);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
      }
      if (groups.size < 2) continue;
      for (const idx of groups.values()) {
        const part = new THREE.InstancedMesh(mesh.geometry, mesh.material, idx.length);
        idx.forEach((src, j) => {
          mesh.getMatrixAt(src, m); part.setMatrixAt(j, m);
          if (mesh.instanceColor) { mesh.getColorAt(src, c); part.setColorAt(j, c); }
        });
        part.castShadow = mesh.castShadow;
        part.receiveShadow = mesh.receiveShadow;
        part.renderOrder = mesh.renderOrder;
        part.layers.mask = mesh.layers.mask;
        part.computeBoundingSphere();
        this.scene.add(part);
      }
      this.scene.remove(mesh);
      mesh.dispose();
    }
  }

  // ---------- endless worlds: chunk streaming ----------

  /** Load and unload chunks around `focus` (spending at most budgetMs, but always at least one chunk). */
  updateChunks(focus, budgetMs = LOAD_BUDGET_MS) {
    const fx = focus.x + WORLD / 2, fz = focus.z + WORLD / 2; // in cells
    const dist = (cx, cz) => {
      const x0 = cx * CH, z0 = cz * CH;
      return Math.hypot(Math.max(0, x0 - fx, fx - x0 - CH), Math.max(0, z0 - fz, fz - z0 - CH));
    };
    // zoomed out past the normal limit (aboard a boat), load further so the screen corners aren't empty
    const LOAD_R = Math.max(LOAD_R0, LOAD_R0 + ((this.camDist ?? 10) - 34) * 1.3), UNLOAD_R = LOAD_R + 24;
    let changed = false;
    for (const [k, rec] of this.chunks) {
      if (dist(rec.cx, rec.cz) > UNLOAD_R) { this.unloadChunk(rec); this.chunks.delete(k); changed = true; }
    }
    const r = Math.ceil(LOAD_R / CH) + 1, ccx = Math.floor(fx / CH), ccz = Math.floor(fz / CH);
    const want = [];
    for (let cz = ccz - r; cz <= ccz + r; cz++) {
      for (let cx = ccx - r; cx <= ccx + r; cx++) {
        const d = dist(cx, cz);
        if (d <= LOAD_R && !this.chunks.has(cellKey(cx, cz))) want.push([d, cx, cz]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    for (let i = 0; i < want.length; i++) {
      if (i > 0 && performance.now() - t0 > budgetMs) break;
      this.loadChunk(want[i][1], want[i][2]);
      changed = true;
    }
    if (changed) this.refreshLive();
  }

  /** Load everything around `focus` right away (at spawn). */
  preload(focus) {
    if (this.world.endless) this.updateChunks(focus, Infinity);
  }

  loadChunk(cx, cz) {
    const data = this.world.content(cx, cz);
    const g = new THREE.Group();
    g.add(this.terrainMesh(cx * CH, cz * CH, CH, CH));
    this.writeHeights(cx * CH - 1, cz * CH - 1, CH + 2, CH + 2);
    const lod = { hi: [], lo: [], small: [], far: false, near: true };
    this.addDecor(g, data, lod);
    this.addFoliage(g, data, lod);
    const gems = this.addRuins(g, data.ruins);
    this.scene.add(g);
    this.chunks.set(cellKey(cx, cz), { cx, cz, group: g, data, gems, lod });
  }

  /**
   * Level of detail for endless chunks: trees farther than TREE_LOD_R from the player switch to
   * their low-detail twins, and grass, flowers, ferns, reeds and mushrooms farther than SMALL_R are
   * hidden. Only matters zoomed out (up close, all of the view is within these distances).
   */
  updateLod(focus) {
    const fx = focus.x + WORLD / 2, fz = focus.z + WORLD / 2;
    for (const rec of this.chunks.values()) {
      const x0 = rec.cx * CH, z0 = rec.cz * CH;
      const d = Math.hypot(Math.max(0, x0 - fx, fx - x0 - CH), Math.max(0, z0 - fz, fz - z0 - CH));
      const { lod } = rec;
      const far = d > TREE_LOD_R, near = d < SMALL_R;
      if (far !== lod.far) {
        lod.far = far;
        for (const m of lod.hi) m.visible = !far;
        for (const m of lod.lo) { if (far) m.layers.enable(0); else m.layers.disable(0); } // always casts shadows
      }
      if (near !== lod.near) {
        lod.near = near;
        for (const m of lod.small) m.visible = near;
      }
    }
  }

  unloadChunk(rec) {
    this.scene.remove(rec.group);
    rec.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }

  /**
   * A cell was dug. Endless: rebuild its chunk (new terrain, path tables, no plants on the dug cell).
   * Island: update that one terrain column and hide the plants standing on it.
   */
  refreshCell(ix, iz) {
    const { world } = this;
    if (world.endless) {
      const cx = Math.floor(ix / CH), cz = Math.floor(iz / CH), key = cellKey(cx, cz);
      const rec = this.chunks.get(key);
      if (rec) { this.unloadChunk(rec); this.chunks.delete(key); this.loadChunk(cx, cz); this.refreshLive(); }
      else this.writeHeights(ix, iz, 1, 1);
      return;
    }
    const i = iz * WORLD + ix, mesh = this.terrain, m = new THREE.Matrix4();
    m.makeScale(1, world.heights[i] - COL_BASE, 1).setPosition(toWorld(ix), COL_BASE, toWorld(iz));
    mesh.setMatrixAt(i, m);
    mesh.geometry.attributes.aKind.array[i] = world.kinds[i];
    mesh.geometry.attributes.aTop.array[i] = world.heights[i];
    const u = world.under(ix, iz), ua = mesh.geometry.attributes.aUnder;
    ua.array[i * 2] = u ? u[0] : -1;
    ua.array[i * 2 + 1] = u ? u[1] : -1;
    mesh.instanceMatrix.needsUpdate = mesh.geometry.attributes.aKind.needsUpdate = mesh.geometry.attributes.aTop.needsUpdate = ua.needsUpdate = true;
    this.writeHeights(ix, iz, 1, 1);
    // hide plants whose instances stand on this cell (trees and rocks never do: you can't dig there)
    const x0 = toWorld(ix) - 0.5, z0 = toWorld(iz) - 0.5, p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.scene.traverse((o) => {
      if (!o.isInstancedMesh || o === mesh || o === this.moteMesh || !o.frustumCulled) return;
      let dirty = false;
      for (let j = 0; j < o.count; j++) {
        o.getMatrixAt(j, m);
        p.setFromMatrixPosition(m);
        if (p.x >= x0 && p.x < x0 + 1 && p.z >= z0 && p.z < z0 + 1) { o.setMatrixAt(j, zero); dirty = true; }
      }
      if (dirty) o.instanceMatrix.needsUpdate = true;
    });
  }

  /**
   * Hover highlight for things a click acts on (main.js `hoverTarget`): a cream outline (an inverted
   * hull: the same model, back faces only, pushed out along its normals) plus a soft pulsing glow on
   * the object itself. `h` = { kind: 'bush' | 'pebble' | 'frog' | 'bench' | 'pile' | 'boat', obj } or null.
   */
  setHighlight(h, t, camDist) {
    if (!this.hl) {
      // The glow pass marks the object's visible pixels in the stencil (2); the hull (the same model,
      // both sides, pushed out along its normals) then draws only outside them, so the outline is a
      // solid band around the silhouette even for one-sided leaf cards. Both are in the transparent
      // list so renderOrder runs glow (9) before hull (10).
      const width = { value: 0.04 };
      const hullMat = new THREE.MeshBasicMaterial({
        color: 0xfff4d2, side: THREE.DoubleSide, transparent: true, opacity: 1,
        stencilWrite: true, stencilRef: 2, stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp,
      });
      hullMat.onBeforeCompile = (sh) => {
        sh.uniforms.uW = width;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uW;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uW;');
      };
      hullMat.customProgramCacheKey = () => 'hlHull';
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xfff0c8, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.LessEqualDepth,
        // pulled a hair toward the camera: a plain (non-instanced) mesh, like a boat part, can land a little deeper than
        // this instanced copy, which then failed the depth test in stripes and let the outline paint over the part
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
        stencilWrite: true, stencilRef: 2, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
      });
      const mk = (mat, order) => {
        const m = new THREE.InstancedMesh(logGeo(), mat, 6); // up to a full log pile
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.renderOrder = order;
        m.visible = false;
        this.scene.add(m);
        return m;
      };
      this.hl = { width, hull: mk(hullMat, 10), glow: mk(glowMat, 9) };
    }
    const { hull, glow, width } = this.hl;
    hull.visible = glow.visible = false;
    if (!h) return;
    const o = h.obj, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const mats = [];
    let geo;
    const yawScale = (sc) => m.makeRotationY(o.r * 6.283).scale(s.set(sc, sc, sc)).setPosition(o.x, o.y, o.z).clone();
    if (h.kind === 'bush') { geo = bushGeometry(); mats.push(yawScale(0.9 + o.r * 0.6)); } // same transforms as addFoliage
    else if (h.kind === 'pebble') { geo = GEO.pebble(); mats.push(yawScale(0.85 + o.r * 0.5)); }
    else if (h.kind === 'cotton') { geo = GEO.cotton(); mats.push(yawScale(0.9 + o.r * 0.4)); }
    else if (h.kind === 'flower') { geo = GEO.flower(); mats.push(m.makeTranslation(o.x, o.y, o.z).clone()); }
    else if (h.kind === 'rock') { geo = GEO.rock(); mats.push(m.makeRotationY(jitter(posKey(o), 5) * 6).scale(s.set(o.s, o.s * 0.75, o.s)).setPosition(o.x, o.y + o.s * 0.35, o.z).clone()); } // as in the rock mesh
    else if (h.kind === 'frog') { const fm = this.ambient.frogMesh; geo = fm.geometry; fm.getMatrixAt(o.i, m); mats.push(m.clone()); }
    else if (h.kind === 'bench') { // [ix, iz, r, type], as in setBenches
      geo = furnitureGeometry(o[3] ?? 0);
      mats.push(m.compose(p.set(toWorld(o[0]), this.world.H(o[0], o[1]), toWorld(o[1])), q.setFromAxisAngle(up, o[2] * Math.PI / 2), s.set(1, 1, 1)).clone());
    } else if (h.kind === 'mesh') { // any single mesh, where it's drawn right now (a part of a boat in edit mode)
      geo = o.geometry;
      o.updateWorldMatrix(true, false);
      mats.push(o.matrixWorld.clone());
    } else if (h.kind === 'boat') { // a boat object from boat.js: its hull, where it's drawn right now
      geo = boatGeometry(o); // that boat's kind
      o.group.updateMatrixWorld();
      mats.push(o.group.matrixWorld.clone());
    } else if (h.kind === 'pile') { // [ix, iz, r, n], as in setPiles
      geo = logGeo();
      q.setFromAxisAngle(up, o[2] * Math.PI / 2);
      for (let i = 0; i < o[3]; i++) {
        logOffset(i, o[2], p);
        p.x += toWorld(o[0]); p.y += this.world.H(o[0], o[1]); p.z += toWorld(o[1]);
        mats.push(m.compose(p, q, s.set(1, 1, 1)).clone());
      }
    }
    if (!geo || !mats.length) return;
    width.value = Math.max(0.035, camDist * 0.0052); // about 2 art pixels at any zoom
    glow.material.opacity = 0.05 + 0.035 * Math.sin(t * 4.5); // a gentle pulse that doesn't wash the colours out
    for (const mesh of [hull, glow]) {
      mesh.geometry = geo;
      mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.count = mats.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = true;
    }
  }

  /** Log piles placed by players (world.piles: cellKey -> [ix, iz, r, n]), rebuilt whenever they change. */
  setPiles(piles) {
    if (this.pileMesh) { this.scene.remove(this.pileMesh); this.pileMesh.dispose(); this.pileMesh = null; }
    const list = [...piles.values()], total = list.reduce((s, p) => s + p[3], 0);
    if (!total) return;
    if (!this.benchMat) this.benchMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const mesh = new THREE.InstancedMesh(logGeo(), this.benchMat, total);
    let k = 0;
    for (const [ix, iz, r, n] of list) {
      q.setFromAxisAngle(up, r * Math.PI / 2);
      for (let i = 0; i < n; i++) {
        logOffset(i, r, p);
        p.x += toWorld(ix); p.y += this.world.H(ix, iz); p.z += toWorld(iz);
        mesh.setMatrixAt(k++, m.compose(p, q, one));
      }
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.pileMesh = mesh;
    this.scene.add(mesh);
  }

  /**
   * Furniture placed by players (world.benches: cellKey -> [ix, iz, rot, type]), rebuilt whenever it
   * changes: one instanced mesh per type, plus the lamps' glowing panes (unlit HDR, so they bloom).
   */
  setBenches(benches) {
    for (const mesh of this.benchMeshes ?? []) { this.scene.remove(mesh); mesh.dispose(); }
    this.benchMeshes = [];
    const byType = new Map();
    for (const b of benches.values()) { const t = b[3] ?? 0; if (!byType.has(t)) byType.set(t, []); byType.get(t).push(b); }
    if (!byType.size) return;
    if (!this.benchMat) this.benchMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const build = (geo, mat, list, shadows) => {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([ix, iz, r], i) => {
        p.set(toWorld(ix), this.world.H(ix, iz), toWorld(iz));
        mesh.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(up, r * Math.PI / 2), one));
      });
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.benchMeshes.push(mesh);
      this.scene.add(mesh);
    };
    for (const [t, list] of byType) {
      build(furnitureGeometry(t), this.benchMat, list, true);
      if (t === LAMP_TYPE) {
        this.lampGlowMat ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.05, 0.32) }); // warm amber, still bright enough to bloom
        build(sharedGeo('lampGlow', lampGlowGeometry), this.lampGlowMat, list, false);
      }
    }
  }

  /** Island: hide the berries on a bush (picked, or the bush was broken). */
  hideBerries(b) {
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.scene.traverse((o) => {
      if (!o.isInstancedMesh || o.material !== this.mats.berry) return;
      let dirty = false;
      for (let j = 0; j < o.count; j++) {
        o.getMatrixAt(j, m);
        p.setFromMatrixPosition(m);
        if (Math.hypot(p.x - b.x, p.z - b.z) < 0.42 && Math.abs(p.y - b.y) < 0.8) { o.setMatrixAt(j, zero); dirty = true; }
      }
      if (dirty) o.instanceMatrix.needsUpdate = true;
    });
  }

  /**
   * Shake a tree (an axe hit): its instances (the detailed mesh and the low-detail shadow twin) sway about the
   * trunk's base, away from (dx, dz), in a quick damped wobble. `amp` is the first swing in radians.
   */
  shakeTree(t, dx, dz, amp = 0.07) {
    this.shakes ??= [];
    this.shakes = this.shakes.filter((s) => { if (s.t !== t) return true; s.end(); return false; }); // a new hit restarts it
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), parts = [], M = this.mats;
    this.scene.traverse((o) => {
      if (!o.isInstancedMesh || (o.material !== M.leaf && o.material !== M.red)) return;
      for (let j = 0; j < o.count; j++) {
        o.getMatrixAt(j, m);
        p.setFromMatrixPosition(m);
        if (Math.abs(p.x - t.x) < 0.01 && Math.abs(p.z - t.z) < 0.01 && Math.abs(p.y - t.y) < 0.01) parts.push([o, j, m.clone()]);
      }
    });
    if (!parts.length) return;
    const len = Math.hypot(dx, dz) || 1;
    const shake = {
      t, parts, age: 0, dur: 0.75, amp,
      axis: new THREE.Vector3(dz / len, 0, -dx / len), // tip away from the hit
      end() { for (const [o, j, orig] of parts) { o.setMatrixAt(j, orig); o.instanceMatrix.needsUpdate = true; } },
    };
    this.shakes.push(shake);
  }
  updateShakes(dt) {
    if (!this.shakes?.length) return;
    const w = new THREE.Matrix4(), r = new THREE.Matrix4(), out = new THREE.Matrix4();
    this.shakes = this.shakes.filter((s) => {
      s.age += dt;
      if (s.age >= s.dur) { s.end(); return false; }
      const k = s.age / s.dur, ang = s.amp * Math.sin(k * Math.PI * 4.5) * (1 - k) ** 2;
      const { x, y, z } = s.t;
      w.makeTranslation(x, y, z).multiply(r.makeRotationAxis(s.axis, ang)).multiply(r.makeTranslation(-x, -y, -z));
      for (const [o, j, orig] of s.parts) { o.setMatrixAt(j, out.multiplyMatrices(w, orig)); o.instanceMatrix.needsUpdate = true; }
      return true;
    });
  }

  /** Island: hide the instances of a chopped tree, broken bush or picked pebble (the endless world rebuilds the chunk instead). */
  hideTree(t) {
    if (this.shakes) this.shakes = this.shakes.filter((s) => Math.abs(s.t.x - t.x) > 0.01 || Math.abs(s.t.z - t.z) > 0.01); // don't put it back
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.scene.traverse((o) => {
      if (!o.isInstancedMesh || o === this.terrain || o === this.moteMesh || !o.frustumCulled) return;
      let dirty = false;
      for (let j = 0; j < o.count; j++) {
        o.getMatrixAt(j, m);
        p.setFromMatrixPosition(m);
        if (Math.abs(p.x - t.x) < 0.01 && Math.abs(p.z - t.z) < 0.01 && Math.abs(p.y - t.y) < 0.01) { o.setMatrixAt(j, zero); dirty = true; }
      }
      if (dirty) o.instanceMatrix.needsUpdate = true;
    });
  }

  // gather what's loaded: ambient life, fireflies and gems use these
  refreshLive() {
    const flowers = [], reeds = [], trees = [], motes = [], gems = [], lilies = [], redwoods = [], bushes = [], pebbles = [], corals = [], rocks = [], cotton = [];
    for (const { data, gems: g } of this.chunks.values()) {
      rocks.push(...data.rocks);
      bushes.push(...data.bushes);
      pebbles.push(...data.pebbles);
      cotton.push(...data.cotton);
      flowers.push(...data.flowers);
      lilies.push(...data.lilies);
      corals.push(...(data.corals ?? []));
      redwoods.push(...data.redwoods);
      reeds.push(...data.reeds);
      trees.push(...data.trees);
      motes.push(...data.motes);
      gems.push(...g);
    }
    Object.assign(this.live, { flowers, reeds, trees, lilies, redwoods, bushes, pebbles, corals, rocks, cotton });
    this.gems = gems;
    this.setMotes(motes);
  }

  // ---------- builders (the island builds everything once; endless worlds once per chunk) ----------

  /** Terrain columns for the cells [x0, x0+w) × [z0, z0+h), one instanced box each. */
  terrainMesh(x0, z0, w, h) {
    const { H, kind } = this.world;
    const N = w * h;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const kindAttr = new Float32Array(N), topAttr = new Float32Array(N), underAttr = new Float32Array(N * 2).fill(-1);
    const mesh = new THREE.InstancedMesh(geo, this.terrainMat, N);
    const m = new THREE.Matrix4(), under = this.world.under;
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const ix = x0 + x, iz = z0 + z, i = z * w + x;
        const top = H(ix, iz);
        m.makeScale(1, top - COL_BASE, 1).setPosition(toWorld(ix), COL_BASE, toWorld(iz)); // down to below the deepest seabed, so edges never show gaps
        mesh.setMatrixAt(i, m);
        kindAttr[i] = kind(ix, iz);
        topAttr[i] = top;
        const u = under?.(ix, iz); // the ground under placed blocks
        if (u) { underAttr[i * 2] = u[0]; underAttr[i * 2 + 1] = u[1]; }
      }
    }
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kindAttr, 1));
    geo.setAttribute('aTop', new THREE.InstancedBufferAttribute(topAttr, 1));
    geo.setAttribute('aUnder', new THREE.InstancedBufferAttribute(underAttr, 2));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** Copy column heights of [x0, x0+w) × [z0, z0+h) into the AO height ring buffer. */
  writeHeights(x0, z0, w, h) {
    const data = this.heightTex.image.data, H = this.world.H;
    for (let iz = z0; iz < z0 + h; iz++) {
      const row = (((iz % HT) + HT) % HT) * HT;
      for (let ix = x0; ix < x0 + w; ix++) data[row + (((ix % HT) + HT) % HT)] = H(ix, iz);
    }
    this.heightTex.needsUpdate = true;
  }

  // trees, redwoods, rocks and flowers. With `lod` ({hi, lo, small} arrays, endless chunks), each tree
  // mesh gets a hidden low-detail twin, and flowers count as small stuff (see updateLod)
  addDecor(target, d, lod = null) {
    const { trees, redwoods, rocks, flowers } = d;
    const M = this.mats;
    const add = (mesh) => { if (mesh) target.add(mesh); return mesh; };
    const pines = trees.filter((t) => t.pine), palms = trees.filter((t) => t.palm), leafy = trees.filter((t) => !t.pine && !t.palm);
    // trees (trees3d.js): leafy trees and conifers, each in a few shape variants
    const addVariants = (list, count, makeGeo, material, salt, layer1) => {
      for (let v = 0; v < count; v++) {
        const group = list.filter((t) => Math.floor(jitter(posKey(t), salt) * count) % count === v);
        const place = (m, t) => m.makeRotationY(jitter(posKey(t), salt + 1) * 6).scale(new THREE.Vector3(t.s, t.s, t.s)).setPosition(t.x, t.y, t.z);
        // Shadows are drawn from the low-detail twin only: the detailed mesh is seen but casts nothing,
        // and the twin sits on shadow-only layers (31 for the sun; redwoods also 1, so their canopy blocks
        // the cloud sun and the deep forest stays dark). Far chunks also show the twin (updateLod adds layer 0).
        const hi = add(instanced(makeGeo(v), material, group, place));
        if (!hi) continue;
        hi.castShadow = false;
        const lo = add(instanced(makeGeo(v, true), material, group, place));
        lo.layers.set(31);
        if (layer1) lo.layers.enable(1);
        if (lod) { lod.hi.push(hi); lod.lo.push(lo); }
        for (const mesh of [hi, lo]) {
          group.forEach((t, i) => mesh.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(0.92 + jitter(posKey(t), salt + 2) * 0.16)));
        }
      }
    };
    addVariants(leafy, TREE_VARIANTS, leafyTreeGeometry, M.leaf, 11);
    addVariants(pines, PINE_VARIANTS, pineTreeGeometry, M.leaf, 21);
    addVariants(palms, PALM_VARIANTS, palmTreeGeometry, M.leaf, 41);
    addVariants(redwoods, REDWOOD_VARIANTS, redwoodGeometry, M.red, 13, true);
    add(instanced(GEO.rock(), M.rock, rocks, (m, r) => {
      m.makeRotationY(jitter(posKey(r), 5) * 6).scale(new THREE.Vector3(r.s, r.s * 0.75, r.s)).setPosition(r.x, r.y + r.s * 0.35, r.z);
    }));
    // flowers: tiny colored blocks with per-instance color
    const fl = add(instanced(GEO.flower(), M.flower, flowers, (m, f) => m.makeTranslation(f.x, f.y, f.z), { shadows: false }));
    const c = new THREE.Color();
    if (fl) flowers.forEach((f, i) => fl.setColorAt(i, c.setHex(f.c)));
    if (fl && lod) lod.small.push(fl);
  }

  // grass, ferns, reeds, bushes and mushrooms (fireflies are global: setMotes). With `lod`, everything
  // but bushes counts as small stuff, hidden in far chunks (see updateLod)
  addFoliage(target, d, lod = null) {
    const { tufts, tallGrass, bushes, ferns, mushrooms, reeds, pebbles = [], cotton = [], seaweed = [], seaRocks = [], lilies = [], cairns = [], corals = [], seagrass = [] } = d;
    const M = this.mats;
    const c = new THREE.Color();
    const add = (mesh) => { if (mesh) target.add(mesh); return mesh; };
    const small = (mesh) => { if (mesh) { target.add(mesh); lod?.small.push(mesh); } return mesh; };
    const tint = (mesh, items, base, spread) => {
      items.forEach((it, i) => mesh?.setColorAt(i, c.setHex(base).multiplyScalar(1 - spread / 2 + it.r * spread)));
      return mesh;
    };
    const yawScale = (m, it, sc) => m.makeRotationY(it.r * 6.283).scale(new THREE.Vector3(sc, sc, sc)).setPosition(it.x, it.y, it.z);

    small(tint(instanced(GEO.tuft(), M.tuft, tufts, (m, t) => yawScale(m, t, 0.85 + t.r * 0.6), { shadows: false }), tufts, 0xffffff, 0.22));
    small(tint(instanced(GEO.tall(), M.tall, tallGrass, (m, t) => yawScale(m, t, 0.85 + t.r * 0.45), { shadows: false }), tallGrass, 0xffffff, 0.18));
    small(tint(instanced(GEO.fern(), M.fern, ferns, (m, f) => yawScale(m, f, 0.9 + f.r * 0.5), { shadows: false }), ferns, 0x3f8a3c, 0.25));
    // reeds standing in water carry their own scale (s) so they poke out of the surface
    small(tint(instanced(GEO.reed(), M.reed, reeds, (m, r) => yawScale(m, r, r.s ?? 0.9 + r.r * 0.4), { shadows: false }), reeds, 0x8fae4a, 0.25));
    const cattails = reeds.filter((r) => r.cattail);
    small(instanced(GEO.cattail(), M.cattail, cattails, (m, r) => {
      const sc = r.s ?? 0.9 + r.r * 0.4;
      m.makeTranslation(r.x, r.y + 0.55 * sc, r.z);
    }, { shadows: false }));

    add(tint(instanced(bushGeometry(), M.bush, bushes, (m, b) => yawScale(m, b, 0.9 + b.r * 0.6)), bushes, 0xffffff, 0.2));
    const berries = [];
    bushes.filter((b) => b.berries).forEach((b) => {
      const sc = 0.8 + b.r * 0.5;
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + b.r * 6;
        berries.push({ x: b.x + Math.cos(a) * 0.27 * sc, y: b.y + (0.15 + (k % 3) * 0.1) * sc, z: b.z + Math.sin(a) * 0.27 * sc });
      }
    });
    small(instanced(GEO.berry(), M.berry, berries, (m, b) => m.makeTranslation(b.x, b.y, b.z), { shadows: false }));
    small(instanced(GEO.stem(), M.stem, mushrooms, (m, mu) => yawScale(m, mu, 0.8 + mu.r * 0.6), { shadows: false }));
    small(instanced(GEO.cap(), M.cap, mushrooms, (m, mu) => yawScale(m, mu, 0.8 + mu.r * 0.6), { shadows: false }));

    small(tint(instanced(GEO.pebble(), M.pebble, pebbles, (m, p) => yawScale(m, p, 0.85 + p.r * 0.5), { shadows: false }), pebbles, 0xffffff, 0.16));
    small(instanced(GEO.cotton(), M.cotton, cotton, (m, c) => yawScale(m, c, 0.9 + c.r * 0.4), { shadows: false })); // harvest them for Cotton Balls
    // trail markers: little stone cairns beside mountain trails
    add(instanced(GEO.cairn(), M.cairn, cairns, (m, c) => m.makeRotationY(c.r * 6.283).setPosition(c.x, c.y, c.z)));
    // coral reefs: one mesh per shape, each coral coloured from the reef palette (starfish their own)
    for (let t = 0; t < CORAL_GEO.length; t++) {
      const items = corals.filter((co) => co.type === t);
      const mesh = small(instanced(coralGeo(t), t === 2 || t === 4 ? M.coralSway : M.coral, items, (m, co) => yawScale(m, co, co.s ?? 1), { shadows: false }));
      if (mesh) items.forEach((co, i) => mesh.setColorAt(i, c.setHex((t === 5 ? STAR_COLORS : CORAL_COLORS)[co.c % (t === 5 ? 3 : 6)]).multiplyScalar(1.02 + co.r * 0.2)));
    }
    // underwater: seaweed ribbons reaching most of the way up to the surface, and mossy rocks
    small(tint(instanced(GEO.seaweed(), M.seaweed, seaweed, (m, w) => {
      m.makeRotationY(w.r * 6.283).scale(new THREE.Vector3(1, Math.max(0.15, (w.h - 0.08) * (0.55 + w.r * 0.4)), 1)).setPosition(w.x, w.y, w.z);
    }, { shadows: false }), seaweed, 0x3c8a5a, 0.35));
    // seagrass meadows: short clumps of blades swaying with the current
    small(tint(instanced(GEO.seagrass(), M.seagrass, seagrass, (m, g) => {
      m.makeRotationY(g.r * 6.283).scale(new THREE.Vector3(1, (0.22 + g.h * 0.32) * (0.7 + g.r * 0.6), 1)).setPosition(g.x, g.y, g.z);
    }, { shadows: false }), seagrass, 0x4f9a48, 0.4));
    small(instanced(GEO.rock(), M.seaRock, seaRocks, (m, r) => {
      m.makeRotationY(r.r * 6.283).scale(new THREE.Vector3(r.s, r.s * 0.7, r.s)).setPosition(r.x, r.y + r.s * 0.2, r.z);
    }, { shadows: false }));
    // lily pads float on the surface (scaled flat so they bob exactly with the water), some flowering
    small(tint(instanced(GEO.lily(), M.lily, lilies, (m, l) => {
      const sc = 0.8 + l.r * 0.6;
      m.makeRotationY(l.r * 40).scale(new THREE.Vector3(sc, 1, sc)).setPosition(l.x, l.y, l.z);
    }, { shadows: false }), lilies, 0x5aa83c, 0.3));
    const blooms = lilies.filter((l) => l.flower);
    const bloomMesh = small(instanced(GEO.lilyFlower(), M.lilyFlower, blooms, (m, l) => m.makeTranslation(l.x + 0.03, l.y, l.z - 0.02), { shadows: false }));
    blooms.forEach((l, i) => bloomMesh.setColorAt(i, c.setHex(l.r < 0.5 ? 0xf6a6c8 : 0xfff4e8)));
  }

  // Fireflies / light motes (HDR so they bloom), animated in update(). One fixed-capacity mesh for
  // the whole scene; setMotes() swaps the list (the island's, or what's loaded in an endless world).
  buildMotes() {
    const s = this.scene;
    this.motes = [];
    this.moteMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.4, 0.9) }), MOTE_CAP);
    this.moteMesh.count = 0;
    this.moteMesh.frustumCulled = false;
    s.add(this.moteMesh);
    // soft glow halo around each firefly, faded in at night (setTimeOfDay sets uGlow)
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTE_CAP * 3), 3));
    glowGeo.setAttribute('aTw', new THREE.BufferAttribute(new Float32Array(MOTE_CAP), 1));
    glowGeo.setDrawRange(0, 0);
    this.moteGlow = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
      uniforms: { uGlow: { value: 0 }, uRes: this.cloudRes, uSize: { value: 0.55 } },
      vertexShader: /* glsl */`
        attribute float aTw;
        uniform vec2 uRes;
        uniform float uSize;
        varying float vTw;
        void main() {
          vTw = aTw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * projectionMatrix[1][1] * uRes.y * 0.5 / -mv.z; // world-size disc
        }`,
      fragmentShader: /* glsl */`
        uniform float uGlow;
        varying float vTw;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 2.0) * uGlow * (0.45 + 0.55 * vTw);
          a = floor(a * 5.0 + 0.5) / 5.0; // stepped, pixel-art falloff
          if (a <= 0.0) discard;
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.45) * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.moteGlow.frustumCulled = false;
    s.add(this.moteGlow);
    // a small pool of warm point lights that follow the fireflies nearest the player at night,
    // so they light up the grass and trees around them (fixed count: no shader recompiles)
    this.motePos = new Float32Array(MOTE_CAP * 3);
    this.moteTw = new Float32Array(MOTE_CAP);
    // players' lanterns: a fixed pool (your own + the nearest others), switched on at night with the firefly lights
    this.lanternLights = Array.from({ length: LANTERN_LIGHTS }, () => {
      const light = new THREE.PointLight(0xffc477, 0, LANTERN_RANGE, 1.1);
      light.visible = false;
      s.add(light);
      return light;
    });
    this.fireflyLights = Array.from({ length: FIREFLY_LIGHTS }, () => {
      const light = new THREE.PointLight(0xfff0c0, 0, 2.0, 2);
      s.add(light);
      return { light, idx: -1, fade: 0 };
    });
    this.fireflyPick = 0;
  }

  setMotes(list) {
    this.motes = list.length > MOTE_CAP ? list.slice(0, MOTE_CAP) : list;
    this.moteMesh.count = this.motes.length;
    this.moteGlow.geometry.setDrawRange(0, this.motes.length);
    for (const l of this.fireflyLights) { l.idx = -1; l.fade = 0; l.light.intensity = 0; }
    this.fireflyPick = 0;
  }

  // ruins: rings of pillars with an altar and a spinning gem; returns the gems
  addRuins(target, ruins) {
    const stone = mat(0xbdb6a3), dark = mat(0x9c9584);
    const gems = [];
    for (const ru of ruins) {
      const g = new THREE.Group();
      for (const p of ru.pillars) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, p.h, 0.5).translate(0, p.h / 2, 0), stone);
        pillar.position.set(p.x, ru.y, p.z);
        pillar.rotation.y = Math.atan2(p.x - ru.x, p.z - ru.z);
        g.add(pillar);
        if (p.h > 1.5) {
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.14, 0.66), dark);
          cap.position.set(p.x, ru.y + p.h + 0.07, p.z);
          cap.rotation.y = pillar.rotation.y;
          g.add(cap);
        }
      }
      const altar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.7).translate(0, 0.25, 0), dark);
      altar.position.set(ru.x, ru.y, ru.z);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), new THREE.MeshLambertMaterial({ color: 0x7ef0ff, emissive: 0x2aa6c4, emissiveIntensity: 3.5 }));
      gem.position.set(ru.x, ru.y + 0.85, ru.z);
      gem.userData.baseY = gem.position.y;
      g.add(altar, gem);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      target.add(g);
      gems.push(gem);
    }
    return gems;
  }

  buildWater() {
    // a big plane that follows the player (update), so it covers any endless ocean too
    // 2-unit quads so the open-water swell (waves.js) can lift its vertices; it's moved in whole quads (update)
    const geo = new THREE.PlaneGeometry(400, 400, 200, 200).rotateX(-Math.PI / 2);
    // Sun glints are kept subtle: a dimmer, tighter highlight, gentler ripple normals, and a cap on the
    // reflected sun (a low sun used to light up a huge checkered glare across the sea).
    const wm = new THREE.MeshPhongMaterial({ color: 0x3f8fd6, specular: 0x8f8a80, shininess: 240, transparent: true, opacity: 0.74 });
    const heightTex = this.heightTex;
    wm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = wind;
      sh.uniforms.uHeights = { value: heightTex };
      sh.uniforms.uWaveT = waveTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWaterPos;
          uniform float uWaveT;
          uniform sampler2D uHeights;
          float wColH(vec2 cell) { return texture2D(uHeights, (mod(cell, ${HT.toFixed(1)}) + 0.5) / ${HT.toFixed(1)}).r; }
          ${WAVE_GLSL}`)
        // the swell: lift each vertex and tilt its normal (open water only; the envelope is 0 over the shallows)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vec2 wP0 = (modelMatrix * vec4(position, 1.0)).xz;
          vec3 wRaw = waveRaw(wP0) * waveEnv(wP0);
          objectNormal = normalize(vec3(-wRaw.y, 1.0, -wRaw.z));`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += wRaw.x;\nvWaveH = wRaw.x;\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        .replace('varying vec3 vWaterPos;', 'varying vec3 vWaterPos;\nvarying float vWaveH;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWaterPos;
          varying float vWaveH;
          uniform float uTime;
          uniform sampler2D uHeights; // column heights ring buffer (see TERRAIN_GLSL)
          float wColH(vec2 cell) { return texture2D(uHeights, (mod(cell, ${HT.toFixed(1)}) + 0.5) / ${HT.toFixed(1)}).r; }
          vec2 wHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }`)
        // Water colour from the depth of the seabed below: shallow water is light turquoise and see-through,
        // deep water is bluer and more solid. On top: pixel ripple bands (8 per unit) drifting across the
        // surface, and a stepped foam line along the shore that ebbs in and out.
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
          vec2 wcell = vWaterPos.xz + ${(WORLD / 2).toFixed(1)};
          vec2 cellI = floor(wcell);
          // depth blended between cell centres (texel-snapped), so shallows fade into the ocean without tile edges
          vec2 dp = wcell - 0.5, dc = floor(dp), df = floor(fract(dp) * 16.0) / 16.0;
          float bedH = mix(mix(wColH(dc), wColH(dc + vec2(1.0, 0.0)), df.x), mix(wColH(dc + vec2(0.0, 1.0)), wColH(dc + vec2(1.0, 1.0)), df.x), df.y);
          float depth = clamp(${SEA.toFixed(2)} - min(bedH, ${SEA.toFixed(2)}), 0.0, 6.0);
          // Layers, from the beach out: clear turquoise shallows (you see the sand), a teal lagoon over the
          // reefs (still clear enough to see the coral), open blue water, deep blue, and a dark abyss.
          float l1 = smoothstep(0.2, 0.75, depth), l2 = smoothstep(0.9, 1.7, depth), l3 = smoothstep(1.8, 2.9, depth), l4 = smoothstep(3.2, 4.6, depth);
          vec3 wc = mix(vec3(0.38, 0.84, 0.84), vec3(0.20, 0.68, 0.76), l1);
          wc = mix(wc, vec3(0.13, 0.48, 0.72), l2);
          wc = mix(wc, vec3(0.08, 0.31, 0.58), l3);
          wc = mix(wc, vec3(0.04, 0.15, 0.36), l4);
          float wAlpha = mix(0.38, 0.5, l1);
          wAlpha = mix(wAlpha, 0.74, l2);
          wAlpha = mix(wAlpha, 0.86, l3);
          wAlpha = mix(wAlpha, 0.93, l4);
          float oceanT = smoothstep(0.9, 2.0, depth);            // open water: fainter ripples
          float shallowT = mix(0.8, 0.2, oceanT);                // ripple strength (gentle)
          {
            // Pixel caustics: drifting cellular (Voronoi) noise snapped to 10 texels per unit. Cell borders are
            // bright light-blue lines with a softer band inside them; each cell's interior gets one of three shades.
            vec2 P = (floor(wcell * 10.0) + 0.5) / 10.0 * 1.15;
            P += vec2(sin(P.y * 2.7 + uTime * 0.28), sin(P.x * 2.3 - uTime * 0.35)) * 0.13; // wobbly borders (slow drift)
            vec2 g = floor(P), fp = fract(P);
            float d1 = 8.0, d2 = 8.0; vec2 id1 = g;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 nb = vec2(float(i), float(j));
              vec2 o = 0.5 + 0.38 * sin(uTime * 0.38 + 6.2831 * wHash2(g + nb));
              vec2 rv = nb + o - fp;
              float d = dot(rv, rv);
              if (d < d1) { d2 = d1; d1 = d; id1 = g + nb; } else if (d < d2) d2 = d;
            }
            float edge = sqrt(d2) - sqrt(d1);
            float shade = wHash2(id1 + 7.3).x;
            wc *= mix(1.0, shade < 0.33 ? 0.86 : shade < 0.66 ? 1.0 : 1.1, shallowT);
            if (edge < 0.085) { wc = mix(wc, vec3(0.66, 0.90, 0.96), 0.85 * shallowT); wAlpha += 0.16 * shallowT; }
            else if (edge < 0.19) { wc = mix(wc, vec3(0.44, 0.76, 0.92), 0.35 * shallowT); wAlpha += 0.05 * shallowT; }
          }
          // the swell (waves.js): troughs a little darker, crests a little lighter, so the rollers read as they pass
          wc *= 1.0 + clamp(vWaveH, -0.4, 0.4) * 0.45;
          wc = mix(wc, vec3(0.52, 0.80, 0.93), smoothstep(0.14, 0.34, vWaveH) * 0.3);
          vec2 fr = floor(fract(wcell) * 16.0) / 16.0; // texel-snapped position in the cell
          float shoreD = 1.0;
          if (wColH(cellI + vec2(1.0, 0.0)) >= ${SEA.toFixed(2)}) shoreD = min(shoreD, 0.9375 - fr.x);
          if (wColH(cellI - vec2(1.0, 0.0)) >= ${SEA.toFixed(2)}) shoreD = min(shoreD, fr.x);
          if (wColH(cellI + vec2(0.0, 1.0)) >= ${SEA.toFixed(2)}) shoreD = min(shoreD, 0.9375 - fr.y);
          if (wColH(cellI - vec2(0.0, 1.0)) >= ${SEA.toFixed(2)}) shoreD = min(shoreD, fr.y);
          float foamW = 0.07 + 0.06 * (0.5 + 0.5 * sin(uTime * 1.7 + (cellI.x + cellI.y) * 1.3));
          if (shoreD < foamW) { wc = vec3(0.93, 0.98, 1.0); wAlpha = 0.88; }
          else if (shoreD < foamW + 0.0625) { wc = mix(wc, vec3(0.85, 0.96, 1.0), 0.45); wAlpha += 0.12; }
          vec4 diffuseColor = vec4(pow(wc, vec3(2.2)), clamp(wAlpha, 0.0, 0.95));`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 wp = floor(vWaterPos.xz * 8.0) / 8.0; // ripples snapped to an 8-per-unit grid
          float wa = sin(wp.x * 3.1 + uTime * 1.7) + sin(wp.y * 2.3 - uTime * 1.3) + sin((wp.x + wp.y) * 5.7 + uTime * 2.9) * 0.5;
          float wb = sin(wp.y * 3.7 + uTime * 1.9) + sin(wp.x * 2.9 + uTime * 1.1) + sin((wp.x - wp.y) * 6.3 - uTime * 2.3) * 0.5;
          normal = normalize(normal + (viewMatrix * vec4(wa * 0.05, 0.0, wb * 0.05, 0.0)).xyz);`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(0.14)) * (1.0 - 0.7 * smoothstep(12.0, 36.0, length(vViewPosition)));`);
    };
    this.water = new THREE.Mesh(geo, wm);
    this.water.position.y = SEA;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  buildCamp() {
    const { camp } = this.world;
    const g = new THREE.Group();
    g.position.set(camp.x, camp.y, camp.z);
    const log = new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6).rotateZ(Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const l = new THREE.Mesh(log, mat(0x6b4226));
      l.position.y = 0.07;
      l.rotation.y = (k * Math.PI) / 4;
      g.add(l);
    }
    const stoneGeo = new THREE.DodecahedronGeometry(0.11, 0);
    for (let k = 0; k < 9; k++) {
      const st = new THREE.Mesh(stoneGeo, mat(0x8a857a));
      const a = (k / 9) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.45, 0.06, Math.sin(a) * 0.45);
      g.add(st);
    }
    this.flames = [];
    const flameColors = [0xffd23f, 0xff8c2a, 0xff5a1f];
    flameColors.forEach((col, k) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.22 - k * 0.05, 0.3 + k * 0.08, 0.22 - k * 0.05).translate(0, 0.15, 0),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.2 - k * 0.4) })); // HDR so it blooms
      f.position.y = 0.1;
      this.flames.push(f);
      g.add(f);
    });
    g.traverse((o) => { if (o.isMesh && o.material.isMeshLambertMaterial) { o.castShadow = true; o.receiveShadow = true; } });
    this.fireLight = new THREE.PointLight(0xff9a3c, 5, 8, 1.6);
    this.fireLight.position.set(0, 0.8, 0);
    g.add(this.fireLight);
    this.scene.add(g);
  }

  // Boxy pixel-art cumulus clouds (styled after the user's reference, but blocky): each cloud
  // is a clump of overlapping box puffs, shaded in soft bands from warm cream-peach on top and on the
  // sunward side, through peachy pink, to lilac/lavender underneath. They sit in a layer below
  // the zoomed-out camera, fade in as you zoom out, keep the screen centre (the player) clear,
  // fade when very close to the camera, and always cast gentle shadows via the cloud sun.
  buildClouds() {
    this.clouds = [];
    const sunDir = this.sunOffset.clone().normalize();
    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir }, uOpacity: { value: 0 }, uRes: this.cloudRes, uTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */`
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 mv = viewMatrix * w;
          vView = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun;
        uniform float uOpacity;
        uniform vec2 uRes;
        uniform vec3 uTint;
        varying vec3 vN;
        varying vec3 vView;
        void main() {
          vec3 n = normalize(vN);
          float lit = dot(n, uSun) * 0.6 + n.y * 0.45;
          vec3 c;
          if (lit > 0.62) c = vec3(1.00, 0.91, 0.78);      // warm sunlit tops
          else if (lit > 0.3) c = vec3(0.98, 0.82, 0.76);  // peach
          else if (lit > 0.0) c = vec3(0.88, 0.74, 0.80);  // pink-lilac
          else if (lit > -0.3) c = vec3(0.74, 0.66, 0.82); // lilac
          else c = vec3(0.60, 0.55, 0.74);                 // lavender undersides
          c = pow(c, vec3(2.2)) * uTint;                   // to linear for the HDR pipeline, tinted by time of day
          vec2 sc = gl_FragCoord.xy / uRes - 0.5;
          // an oval hole shaped like the screen (wider on wide screens), with a long, soft fade around the clear middle
          float hole = smoothstep(0.2, 0.8, length(sc));
          float a = uOpacity * hole * hole * smoothstep(3.0, 7.0, length(vView));
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
    });

    const rand = rng(this.world.seed + 991); // seeded: the sine `jitter` hash is too correlated for 2D scatter
    // boxy puffs: each "puff" is an axis-aligned block sized like the sphere it replaces
    const puff = (r, x, y, z) => new THREE.BoxGeometry(r * 1.8, r * 1.5, r * 1.6).translate(x, y, z);
    for (let k = 0; k < 34; k++) {
      const R = 1.7 + rand() * 1.3;
      const parts = [puff(R, 0, R * 0.55, 0)];                      // big central billow
      const ring = 4 + Math.floor(rand() * 4);
      for (let i = 0; i < ring; i++) {                               // lower puffs around it
        const a = (i / ring) * Math.PI * 2 + rand() * 0.6;
        const r = R * (0.5 + rand() * 0.3);
        const d = R * (0.9 + rand() * 0.45);
        parts.push(puff(r, Math.cos(a) * d * 1.4, r * 0.45, Math.sin(a) * d * 0.8));
      }
      const tops = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < tops; i++) {                               // towering top billows
        const r = R * (0.55 + rand() * 0.25);
        parts.push(puff(r, (rand() - 0.5) * R, R * (1.05 + rand() * 0.3), (rand() - 0.5) * R * 0.5));
      }
      const mesh = new THREE.Mesh(mergeGeometries(parts), this.cloudMat);
      mesh.scale.y = 0.8; // slightly flattened, cumulus-like
      mesh.castShadow = true;
      mesh.renderOrder = 5;
      mesh.layers.set(2); // clouds: seen by the main camera, cast through the cloud sun
      const g = new THREE.Group();
      g.add(mesh);
      g.position.set((rand() - 0.5) * 120, 16.5 + rand() * 1.5, (rand() - 0.5) * 120); // above the redwood tops
      this.clouds.push(g);
      this.scene.add(g);
    }
  }

  /**
   * Set the time of day, in hours 0–24 (0 = midnight, 12 = noon). The sun rises in the east (+x)
   * at 6, crosses the southern sky (toward the camera) and sets in the west at 18; at night a
   * dim cool moon takes over the same lights. Colours blend through DAY_KEYS.
   */
  setTimeOfDay(hours) {
    const h = ((hours % 24) + 24) % 24;
    this.timeOfDay = h;
    let i = 0;
    while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1].h <= h) i++;
    const a = DAY_KEYS[i], b = DAY_KEYS[i + 1], t = (h - a.h) / (b.h - a.h);
    const num = (k) => a[k] + (b[k] - a[k]) * t;

    lerpHex(this.scene.background, a.sky, b.sky, t);
    this.scene.fog.color.copy(this.scene.background);
    lerpHex(this.hemi.color, a.hemiSky, b.hemiSky, t);
    lerpHex(this.hemi.groundColor, a.hemiGround, b.hemiGround, t);
    // shadow depth: part of the sky fill is moved into the main sun, so lit areas keep their
    // brightness while shaded areas (which only get fill + cloud sun) get darker
    const hemiI = num('hemiI');
    this.baseHemiI = hemiI * (1 - SHADOW_DEPTH); // dimmed further inside the deep forest (applyDarkness)
    lerpHex(this.cloudMat.uniforms.uTint.value, a.cloud, b.cloud, t);

    // sun by day (east at 6 → west at 18), moon by night (its own arc, 18 → 6); both keep a minimum
    // height so shadows never stretch across the whole island. The light swings from one to the
    // other gradually through dusk (18:15–20:30) and dawn (4:30–5:55), while it's dim, instead of
    // jumping from west to east at a fixed minute.
    const PI = Math.PI, clamp = THREE.MathUtils.clamp, ss = THREE.MathUtils.smoothstep;
    const sa = clamp(((h - 6) / 12) * PI, 0, PI);
    const ma = clamp(((((h - 18) + 24) % 24) / 12) * PI, 0, PI);
    const moonW = h >= 12 ? ss(h, 18.25, 20.5) : 1 - ss(h, 4.5, 5.9);
    const dir = new THREE.Vector3(Math.cos(sa), Math.max(0.18, Math.sin(sa)), 0.45).normalize()
      .lerp(new THREE.Vector3(Math.cos(ma), Math.max(0.35, Math.sin(ma)), 0.45).normalize(), moonW)
      .normalize();
    this.sunOffset.copy(dir).multiplyScalar(70); // far enough above the tallest redwoods
    this.cloudMat.uniforms.uSun.value.copy(dir);
    const color = lerpHex(new THREE.Color(), a.sun, b.sun, t), total = num('sunI');
    this.sun.color.copy(color);
    this.cloudSun.color.copy(color);
    this.sun.intensity = total * (1.5 / 3.1) + hemiI * SHADOW_DEPTH * 1.2; // main/cloud split (see the cloud shadow notes) + the moved fill
    this.cloudSun.intensity = total * (1.6 / 3.1);
    // fireflies: a soft halo from dusk to dawn, and a bit brighter at night
    this.timeNight = THREE.MathUtils.clamp((2.4 - total) / 1.6, 0, 1);
    this.applyDarkness();
  }

  /**
   * Combine the time of day with how deep in the redwood forest the player is (this.deep, 0..1):
   * inside, the sky fill dims and the fireflies glow and light up as if it were night.
   */
  applyDarkness() {
    const deep = this.deep ?? 0;
    this.hemi.intensity = this.baseHemiI * (1 - DEEP_DIM * deep);
    const night = (this.night = Math.max(this.timeNight ?? 0, deep * 0.85));
    this.moteGlow.material.uniforms.uGlow.value = night * 0.45;
    this.moteMesh.material.color.setRGB(2.6, 2.4, 0.9).multiplyScalar(1 + night * 0.5);
  }

  /** Move the firefly light pool onto the fireflies nearest the player (night only). */
  updateFireflyLights(dt, focus) {
    const night = this.night ?? 0, lights = this.fireflyLights;
    if (!lights.length) return;
    // The lights only exist at night (by the clock): even at intensity 0 every light costs each lit pixel.
    // Switching them changes the shader light count (one recompile), so it follows the time of day only,
    // not the deep forest (which keeps its glowing fireflies, just without extra light).
    const on = (this.timeNight ?? 0) > 0.02;
    if (on !== this.fireflyLightsOn) {
      this.fireflyLightsOn = on;
      for (const l of lights) l.light.visible = on;
      for (const l of this.lanternLights) l.visible = on;
    }
    if (!on || night <= 0) { for (const l of lights) { l.light.intensity = 0; l.idx = -1; l.fade = 0; } return; }
    // re-pick the nearest fireflies a few times a second
    this.fireflyPick -= dt;
    if (this.fireflyPick <= 0) {
      this.fireflyPick = 0.4;
      const P = this.motePos, best = [];
      for (let i = 0; i < this.motes.length; i++) {
        const d = (P[i * 3] - focus.x) ** 2 + (P[i * 3 + 2] - focus.z) ** 2;
        if (d > 22 * 22) continue;
        if (best.length < lights.length) best.push([d, i]);
        else if (d < best[best.length - 1][0]) best[best.length - 1] = [d, i];
        else continue;
        best.sort((a, b) => a[0] - b[0]);
      }
      const want = new Set(best.map((b) => b[1]));
      const free = lights.filter((l) => !want.has(l.idx));
      for (const l of lights) if (want.has(l.idx)) want.delete(l.idx);
      for (const idx of want) { const l = free.pop(); l.idx = idx; l.fade = 0; }
      for (const l of free) l.idx = -1;
    }
    for (const l of lights) {
      if (l.idx < 0) { l.light.intensity = 0; continue; }
      l.fade = Math.min(1, l.fade + dt * 2.5);
      const i = l.idx;
      l.light.position.set(this.motePos[i * 3], this.motePos[i * 3 + 1], this.motePos[i * 3 + 2]);
      l.light.intensity = FIREFLY_LIGHT_I * night * l.fade * (0.45 + 0.55 * this.moteTw[i]);
    }
  }

  /** Map editor (islands): push edited heights/kinds (this.world.heights/kinds) to the terrain right away. */
  updateTerrain() {
    const { heights, kinds } = this.world;
    const mesh = this.terrain, geo = mesh.geometry, m = new THREE.Matrix4();
    const kindA = geo.attributes.aKind, topA = geo.attributes.aTop;
    for (let iz = 0; iz < WORLD; iz++) {
      for (let ix = 0; ix < WORLD; ix++) {
        const i = iz * WORLD + ix;
        m.makeScale(1, heights[i] - COL_BASE, 1).setPosition(toWorld(ix), COL_BASE, toWorld(iz));
        mesh.setMatrixAt(i, m);
        kindA.array[i] = kinds[i];
        topA.array[i] = heights[i];
      }
    }
    mesh.instanceMatrix.needsUpdate = kindA.needsUpdate = topA.needsUpdate = true;
    this.writeHeights(0, 0, WORLD, WORLD);
    mesh.computeBoundingSphere();
  }

  /** Free GPU resources (geometries shared through caches are kept). */
  dispose() {
    this.scene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.isLight && o.shadow) o.shadow.dispose();
    });
    this.heightTex?.dispose();
  }

  /** Lantern lights at night: `spots` are { x, y, z, ry } of players (yours first). Flickers gently. */
  setLanterns(spots, t) {
    const n = this.timeNight ?? 0;
    this.lanternLights.forEach((l, i) => {
      const p = spots[i];
      if (!p || n <= 0) { l.intensity = 0; return; }
      // above the head with a soft falloff, so it spreads over the ground instead of glaring on the face
      l.position.set(p.x + Math.sin(p.ry ?? 0) * 0.2, p.y + 1.6, p.z + Math.cos(p.ry ?? 0) * 0.2);
      l.intensity = LANTERN_I * n * (0.92 + 0.05 * Math.sin(t * 9 + i * 2) + 0.03 * Math.sin(t * 23 + i));
    });
  }

  /** Open tree canopies around the player (see setSeeThrough). */
  setSeeThrough(camera, pos, rtW, rtH) { setSeeThrough(camera, pos, rtW, rtH); }

  update(t, dt, focus, camDist = 10) {
    this.camDist = camDist;
    wind.value = t;
    if (this.world.endless) { this.updateChunks(focus); this.updateLod(focus); }
    // how deep in the redwood forest the player is: share of DEEP cells in the 7×7 around them, smoothed
    {
      const W = WORLD, cx = Math.floor(focus.x + W / 2), cz = Math.floor(focus.z + W / 2);
      let n = 0;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (this.world.kind(cx + dx, cz + dz) === K.DEEP) n++;
      const target = Math.min(1, n / 30);
      const before = this.deep ?? 0;
      this.deep = before + (target - before) * (1 - Math.exp(-dt * 1.5));
      if (Math.abs(this.deep - before) > 1e-4) this.applyDarkness();
    }
    this.ambient.update(t, dt, focus);
    this.effects.update(dt);
    this.updateShakes(dt);
    this.atmosphere.update(t, dt, focus, this.night ?? 0, this.timeNight ?? 0);

    // zoomed out: push fog back, widen shadow coverage, fade the cloud layer in
    this.scene.fog.near = 28 + camDist;
    this.scene.fog.far = 65 + camDist * 1.3;
    const half = Math.min(46, Math.max(22, camDist * 1.45));
    if (Math.abs(half - this.shadowHalf) > 0.5) {
      this.shadowHalf = half;
      for (const l of [this.sun, this.cloudSun]) {
        Object.assign(l.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
        l.shadow.camera.updateProjectionMatrix();
      }
    }
    const cloudAlpha = Math.min(1, Math.max(0, (camDist - 23) / 7)) * 0.9; // once the camera is up above the cloud layer
    this.cloudMat.uniforms.uOpacity.value = cloudAlpha;

    // drifting, twinkling fireflies
    const mm = new THREE.Matrix4();
    const glowOn = this.moteGlow.material.uniforms.uGlow.value > 0;
    const gp = this.moteGlow.geometry.attributes.position, gt = this.moteGlow.geometry.attributes.aTw;
    this.moteGlow.visible = glowOn;
    this.motes.forEach((f, i) => {
      const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.3 + i * 1.7));
      const x = f.x + Math.sin(t * 0.6 + i) * 0.35, y = f.y + Math.sin(t * 1.1 + i * 2.1) * 0.18, z = f.z + Math.cos(t * 0.5 + i * 1.3) * 0.35;
      mm.makeScale(tw, tw, tw).setPosition(x, y, z);
      if (glowOn) { gp.setXYZ(i, x, y, z); gt.setX(i, tw); }
      this.motePos[i * 3] = x; this.motePos[i * 3 + 1] = y; this.motePos[i * 3 + 2] = z; this.moteTw[i] = tw;
      this.moteMesh.setMatrixAt(i, mm);
    });
    this.moteMesh.instanceMatrix.needsUpdate = true;
    if (glowOn) gp.needsUpdate = gt.needsUpdate = true;
    this.updateFireflyLights(dt, focus);
    // keep the shadow camera centered on the player, snapped to shadow texels to avoid shimmering
    const texel = (this.shadowHalf * 2) / SHADOW_MAP;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunOffset.x, this.sunOffset.y, fz + this.sunOffset.z);
    this.cloudSun.target.position.copy(this.sun.target.position);
    this.cloudSun.position.copy(this.sun.position);

    // clouds drift with the wind and wrap around within ±60 of the player
    for (const c of this.clouds) {
      c.position.x += WIND.x * dt * 0.9;
      c.position.z += WIND.z * dt * 0.9;
      if (c.position.x > focus.x + 60) c.position.x -= 120;
      else if (c.position.x < focus.x - 60) c.position.x += 120;
      if (c.position.z > focus.z + 60) c.position.z -= 120;
      else if (c.position.z < focus.z - 60) c.position.z += 120;
    }
    // the water plane follows the player (its ripples are in world space, so nothing slides)
    // (in whole 2-unit quads, so the swell's vertices don't slide across the waves)
    this.water.position.set(Math.round(focus.x / 2) * 2, SEA + Math.sin(t * 0.8) * 0.03, Math.round(focus.z / 2) * 2);
    waveTime.value = waveClock();
    this.flames.forEach((f, k) => {
      f.scale.y = 0.8 + Math.abs(Math.sin(t * (7 + k * 3) + k)) * 0.5;
      f.rotation.y = t * (1 + k);
    });
    const tn = this.timeNight ?? 0; // at night the campfire is a beacon: brighter and further-reaching
    this.fireLight.intensity = 4.5 + tn * 3 + Math.sin(t * 13) * 0.7 + Math.sin(t * 7.3) * 0.5;
    this.fireLight.distance = 8 + tn * 7;
    for (const gem of this.gems) {
      gem.rotation.y = t * 1.5;
      gem.position.y = gem.userData.baseY + Math.sin(t * 2 + gem.position.x) * 0.06;
    }
  }
}

/** The point on a placed palm's trunk at height fraction u, in world space (the same transform addDecor gives its instance). */
export function palmTrunk(t, u) {
  const v = Math.floor(jitter(posKey(t), 41) * PALM_VARIANTS) % PALM_VARIANTS, yaw = jitter(posKey(t), 42) * 6;
  const l = palmTrunkLocal(v, u), c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: t.x + (c * l.x + s * l.z) * t.s, y: t.y + l.y * t.s, z: t.z + (-s * l.x + c * l.z) * t.s };
}
