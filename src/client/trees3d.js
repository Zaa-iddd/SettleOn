// Leafy tree and conifer models in a hand-painted pixel-art style: a thick, twisting purplish-brown trunk
// with flared roots and branches, carrying several separate leaf clusters (a big crown plus
// side clusters). Each cluster is a dark core covered in small rounded leaf cards, so silhouettes
// are bumpy, colored in hard bands from pale yellow-green on top to deep teal underneath.
// Everything is merged into one vertex-colored geometry per variant (draw with vertexColors).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../shared/world.js';

// leaf bands, darkest → brightest (sRGB hex; three converts to linear)
const LEAF_BANDS = [0x2a5a45, 0x3f7a3a, 0x63a03a, 0x93c64b, 0xc6dc7c].map((h) => new THREE.Color(h));
// conifers: the same bands, a little cooler and deeper
const PINE_BANDS = [0x214a40, 0x2f6a45, 0x478a47, 0x6dab53, 0xa3cc76].map((h) => new THREE.Color(h));
const BARK = [0x3e2232, 0x5e3438, 0x7e4a46].map((h) => new THREE.Color(h)); // shadow, mid, highlight
// redwoods: warm red-brown bark and deep, cool canopy greens
const REDWOOD_BARK = [0x4a2018, 0x7a3a26, 0xa45a3a].map((h) => new THREE.Color(h));
const REDWOOD_BANDS = [0x173a2c, 0x21503a, 0x2f6a40, 0x48874a, 0x76aa5e].map((h) => new THREE.Color(h));
const SUN = new THREE.Vector3(16, 21, 11).normalize();
const UP = new THREE.Vector3(0, 1, 0);

// geometries are built once and shared by every scene (the map editor rebuilds scenes often)
const geoCache = new Map();
function cached(key, build) {
  if (!geoCache.has(key)) { const g = build(); g.userData.shared = true; geoCache.set(key, g); }
  return geoCache.get(key);
}
// Level of detail: far-away trees use the same shapes with far fewer leaf cards (LOW_DETAIL of them).
// Leaves draw from their own seeded stream, so a low-detail tree keeps the exact trunk and clusters.
const LOW_DETAIL = 0.18;
let leafDetail = 1;
function detailed(lo, build) {
  leafDetail = lo ? LOW_DETAIL : 1;
  try { return build(); } finally { leafDetail = 1; }
}

// merge parts with mixed attributes: keep only position, normal, color
function merge(parts) {
  return mergeGeometries(parts.map((g) => {
    const out = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'color'].includes(k)) out.deleteAttribute(k);
    return out;
  }));
}

function colorize(geo, fn) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const c = fn(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i), i);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A tapered tube along points, with spiral bark streaks. r0 → r1 radius from start to end. */
function limb(points, r0, r1, rand, radial = 6, seg = 8, bark = BARK) {
  if (leafDetail < 1) { radial = Math.max(4, radial - 2); seg = Math.max(2, Math.ceil(seg / 2)); } // low detail
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = geo.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  const twist = rand() * 6;
  return colorize(geo, (p, n, k) => {
    const i = Math.floor(k / (radial + 1)), j = k % (radial + 1);
    const streak = Math.sin((j / radial) * Math.PI * 4 + (i / seg) * 5 + twist);
    const lit = n.dot(SUN);
    return streak > 0.55 ? bark[0] : lit > 0.45 && streak < -0.2 ? bark[2] : bark[1];
  });
}

/** A clump of foliage: dark core + pointed leaf cards on an ellipsoid shell. */
export function leafCluster(cx, cy, cz, rx, ry, rand, density = 480, bands = LEAF_BANDS, leafScale = 0) {
  const parts = [];
  // core: faceted, each facet one leaf band from its facing (so gaps between leaves read as foliage)
  const core = new THREE.IcosahedronGeometry(1, leafDetail < 1 ? 0 : 1).scale(rx * 0.88, ry * 0.9, rx * 0.9).translate(cx, cy, cz);
  core.computeVertexNormals();
  const fn = new THREE.Vector3(), fa = new THREE.Vector3(), fb = new THREE.Vector3(), fc = new THREE.Vector3();
  const cpos = core.attributes.position, ccol = new Float32Array(cpos.count * 3);
  for (let f = 0; f < cpos.count; f += 3) {
    fa.fromBufferAttribute(cpos, f); fb.fromBufferAttribute(cpos, f + 1); fc.fromBufferAttribute(cpos, f + 2);
    fn.subVectors(fc, fb).cross(fa.clone().sub(fb)).normalize();
    const shade = 0.34 + fn.y * 0.28 + fn.dot(SUN) * 0.14 + (rand() - 0.5) * 0.12;
    const c = bands[Math.max(0, Math.min(3, Math.floor(shade * 5 - 0.6)))];
    for (let k = 0; k < 3; k++) ccol.set([c.r, c.g, c.b], (f + k) * 3);
  }
  core.setAttribute('color', new THREE.BufferAttribute(ccol, 3));
  parts.push(core);

  const count = Math.max(leafDetail < 1 ? 6 : 20, Math.round(density * rx * rx * leafDetail));
  rand = rng(Math.floor(rand() * 4294967296)); // leaves get their own stream (same shapes at any detail)
  const verts = [], norms = [], cols = [];
  const dir = new THREE.Vector3(), p = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), n = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // direction biased upward a little (fewer leaves hidden underneath)
    const y = -0.75 + rand() * 1.75, a = rand() * Math.PI * 2, rr = Math.sqrt(Math.max(0, 1 - Math.min(1, y) ** 2));
    dir.set(Math.cos(a) * rr, Math.min(1, y), Math.sin(a) * rr).normalize();
    const shell = 0.92 + rand() * 0.16;
    p.set(cx + dir.x * rx * shell, cy + dir.y * ry * shell, cz + dir.z * rx * shell);
    // leaf points outward and droops down, like overlapping shingles
    tmp.set(dir.x, 0, dir.z).multiplyScalar(0.7).addScaledVector(UP, -0.35).add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.7));
    t1.copy(tmp).addScaledVector(dir, -tmp.dot(dir)).normalize();
    t2.crossVectors(dir, t1).normalize();
    const L = (0.15 + rand() * 0.06) * (leafScale || Math.max(0.75, Math.min(1.25, rx / 0.4))), W = L * 0.8;
    // rounded oval leaf: 6 points on an ellipse, centred a bit toward the tip, cupped outward
    const lift = 0.02 + rand() * 0.02;
    const ring = [];
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      ring.push(p.clone().addScaledVector(t1, L * (0.15 + ca * 0.5)).addScaledVector(t2, W * 0.5 * sa)
        .addScaledVector(dir, lift * (0.5 + ca * 0.5) - 0.015));
    }
    // banded shade: up-facing, high and sun-facing leaves are brightest
    const h = (p.y - cy) / ry;
    const shade = 0.4 + dir.y * 0.3 + h * 0.15 + dir.dot(SUN) * 0.15 + (rand() - 0.5) * 0.22;
    const band = bands[Math.max(0, Math.min(4, Math.floor(shade * 5 - 0.7)))];
    n.copy(dir).multiplyScalar(0.45).add(UP).normalize();
    // one outward-facing side per leaf (wind so the face normal points along dir); fan of 4 triangles
    const flip = tmp.subVectors(ring[1], ring[0]).cross(t2.clone().subVectors(ring[2], ring[0])).dot(dir) < 0;
    for (let k = 1; k < 5; k++) {
      const tri = flip ? [ring[0], ring[k + 1], ring[k]] : [ring[0], ring[k], ring[k + 1]];
      for (const v of tri) { verts.push(v.x, v.y, v.z); norms.push(n.x, n.y, n.z); cols.push(band.r, band.g, band.b); }
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  parts.push(leaves);
  return merge(parts);
}

// Leafy trees grow a taller trunk than the original model: the canopy is lifted by LEAFY_LIFT (base units)
export const LEAFY_TALL = 1.6; // trunk height multiplier
export const LEAFY_LIFT = 0.95 * (LEAFY_TALL - 1);

/** One leafy tree variant (base units: about 2.3 tall before the tree's scale). */
export const leafyTreeGeometry = (variant, lo = false) => cached(`leafy${variant}${lo ? 'lo' : ''}`, () => detailed(lo, () => buildLeafy(variant)));
function buildLeafy(variant) {
  const rand = rng(9000 + variant * 31);
  const parts = [];
  // twisting trunk: an S-curve leaning a little
  const lean = rand() * Math.PI * 2, bend = 0.06 + rand() * 0.05, ph = rand() * 6;
  const trunkPts = [];
  for (let i = 0; i <= 5; i++) {
    const y = (i / 5) * 0.95 * LEAFY_TALL;
    const off = Math.sin(y * 5 + ph) * bend;
    trunkPts.push(new THREE.Vector3(Math.cos(lean) * off, y, Math.sin(lean) * off));
  }
  parts.push(limb(trunkPts, 0.16, 0.075, rand, 6, 10));
  const top = trunkPts[5];
  // flared roots
  const roots = 3 + Math.floor(rand() * 2);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rand() * 0.8, d = 0.2 + rand() * 0.08;
    parts.push(limb([new THREE.Vector3(0, 0.22, 0), new THREE.Vector3(Math.cos(a) * d * 0.55, 0.06, Math.sin(a) * d * 0.55), new THREE.Vector3(Math.cos(a) * d, -0.03, Math.sin(a) * d)], 0.08, 0.025, rand, 5, 4));
  }
  // crown on top of the trunk
  parts.push(leafCluster(top.x, 1.2 + LEAFY_LIFT, top.z, 0.5 + rand() * 0.06, 0.33, rand));
  // side clusters on branches, spread around, at a few heights
  const sides = 3 + Math.floor(rand() * 2), a0 = rand() * Math.PI * 2;
  for (let i = 0; i < sides; i++) {
    const a = a0 + (i / sides) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    const d = 0.5 + rand() * 0.14, h = 0.68 + rand() * 0.28 - (i === 0 ? 0.08 : 0) + LEAFY_LIFT * 0.85;
    const r = 0.27 + rand() * 0.08;
    const from = trunkPts[3 + Math.floor(rand() * 2)];
    const end = new THREE.Vector3(Math.cos(a) * d, h - r * 0.4, Math.sin(a) * d);
    const mid = from.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.08, 0));
    parts.push(limb([from.clone(), mid, end], 0.055, 0.03, rand, 5, 5));
    parts.push(leafCluster(end.x, h, end.z, r, r * 0.68, rand));
  }
  return merge(parts);
}

/** Conifer variant: a straight trunk with tiers of flattened rounded-leaf clusters narrowing to a tip. */
export const pineTreeGeometry = (variant, lo = false) => cached(`pine${variant}${lo ? 'lo' : ''}`, () => detailed(lo, () => buildPine(variant)));
function buildPine(variant) {
  const rand = rng(7000 + variant * 37);
  const parts = [];
  const sway = (rand() - 0.5) * 0.06;
  parts.push(limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(sway * 0.5, 0.6, 0), new THREE.Vector3(sway, 1.3, 0)], 0.11, 0.04, rand, 6, 5));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rand();
    parts.push(limb([new THREE.Vector3(0, 0.18, 0), new THREE.Vector3(Math.cos(a) * 0.12, 0.04, Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a) * 0.2, -0.03, Math.sin(a) * 0.2)], 0.06, 0.02, rand, 5, 4));
  }
  // tiers: [height, radius] from the wide bottom skirt to the tip
  const tiers = [[0.54, 0.5], [0.82, 0.41], [1.07, 0.31], [1.28, 0.21], [1.45, 0.12]];
  for (const [h, r] of tiers) {
    const t = h / 1.2;
    parts.push(leafCluster(sway * t + (rand() - 0.5) * 0.03, h, (rand() - 0.5) * 0.03, r * (0.95 + rand() * 0.1), r * 0.5 + 0.03, rand, 480, PINE_BANDS));
  }
  return merge(parts);
}

/**
 * Redwood variant (world-scale: about 11.5 tall at s = 1): a straight, thick, tapering red trunk
 * with flared buttress roots and a high, dense, layered canopy that spreads ~2.4 wide at its
 * base, so neighbouring redwoods close the sky and shade the forest floor.
 */
export const redwoodGeometry = (variant, lo = false) => cached(`redwood${variant}${lo ? 'lo' : ''}`, () => detailed(lo, () => buildRedwood(variant)));
function buildRedwood(variant) {
  const rand = rng(5000 + variant * 41);
  const parts = [];
  const lean = (rand() - 0.5) * 0.25;
  parts.push(limb([new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.3, 4, 0), new THREE.Vector3(lean, 10.5, lean * 0.3)], 0.46, 0.12, rand, 8, 10, REDWOOD_BARK));
  // buttress roots
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rand() * 0.5, d = 0.62 + rand() * 0.2;
    parts.push(limb([new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(Math.cos(a) * d * 0.5, 0.25, Math.sin(a) * d * 0.5), new THREE.Vector3(Math.cos(a) * d, -0.05, Math.sin(a) * d)], 0.2, 0.05, rand, 6, 4, REDWOOD_BARK));
  }
  // a few short bare branch stubs low on the trunk
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2, h = 3.2 + rand() * 1.4;
    parts.push(limb([new THREE.Vector3(0, h, 0), new THREE.Vector3(Math.cos(a) * 0.55, h + 0.25, Math.sin(a) * 0.55)], 0.07, 0.03, rand, 5, 2, REDWOOD_BARK));
  }
  // canopy tiers [height, radius], wide and dense near the bottom, narrowing to the crown
  const tiers = [[5.6, 2.4], [6.9, 2.1], [8.1, 1.7], [9.3, 1.25], [10.4, 0.8], [11.2, 0.4]];
  for (const [h, r] of tiers) {
    const t = h / 10.5;
    parts.push(leafCluster(lean * t + (rand() - 0.5) * 0.2, h, lean * 0.3 * t + (rand() - 0.5) * 0.2,
      r * (0.95 + rand() * 0.1), r * 0.36 + 0.25, rand, 62, REDWOOD_BANDS, 2.0));
  }
  return merge(parts);
}

// Coconut palms (after the user's pixel-art palm reference): a curved, ringed trunk and long arching feather
// fronds, each a spine with pointed leaflets down both sides (light near the spine, dark toward the tips).
const PALM_RING = [0x5a341e, 0xa06a3a, 0xcf9a5c].map((h) => new THREE.Color(h)); // dark groove, tan, lit tan
const PALM_BANDS = [0x1f6a3a, 0x2f8a3c, 0x55b040, 0x86cf4e, 0xb6e26a].map((h) => new THREE.Color(h));
const COCONUT = [0x3a2418, 0x573620, 0x7a4e2c].map((h) => new THREE.Color(h));

/**
 * Coconut palm variant (about 2.6 tall at s = 1): a slender curved trunk with bark rings and a flared base,
 * 9–10 arching feather fronds with serrated pointed leaflets, a young upright frond and a few coconuts.
 */
export const palmTreeGeometry = (variant, lo = false) => cached(`palm${variant}${lo ? 'lo' : ''}`, () => detailed(lo, () => buildPalm(variant)));

/** One feather frond from `top` heading at yaw `a`: arches up, then droops. Returns a vertex-coloured geometry. */
function palmFrond(top, a, len, rise, droop, tone, rand) {
  const stations = leafDetail < 1 ? 7 : 13, verts = [], norms = [], cols = [];
  const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const spine = (u) => new THREE.Vector3(top.x + dir.x * len * u, top.y + 0.06 + rise * Math.sin(u * Math.PI * 0.62) * 1.2 - droop * u * u, top.z + dir.z * len * u);
  const side = new THREE.Vector3(), tan = new THREE.Vector3(), n = new THREE.Vector3(), tip = new THREE.Vector3(), mid = new THREE.Vector3();
  const tri = (p0, p1, p2, band) => {
    for (const v of [p0, p1, p2, p0, p2, p1]) { verts.push(v.x, v.y, v.z); norms.push(n.x, n.y, n.z); cols.push(band.r, band.g, band.b); }
  };
  const pick = (shade) => PALM_BANDS[Math.max(0, Math.min(4, Math.floor(shade * 5)))];
  for (let i = 0; i < stations; i++) {
    const u0 = i / stations, u1 = (i + 1) / stations, p0 = spine(u0), p1 = spine(u1);
    tan.subVectors(spine(Math.min(1, u1 + 0.05)), spine(Math.max(0, u0 - 0.05))).normalize();
    side.crossVectors(tan, UP).normalize();
    // long leaflets mid-frond, shrinking to a point at the end
    const w = 0.5 * Math.sin(Math.PI * Math.min(1, 0.2 + u0 * 0.95)) * (1 - u0 * 0.3) * (0.9 + rand() * 0.2);
    for (const sg of [-1, 1]) {
      tip.copy(p0).lerp(p1, 0.6).addScaledVector(side, sg * w).addScaledVector(tan, w * 0.7);
      tip.y -= w * (0.12 + 0.3 * u0); // leaflets hang down off the rib
      mid.copy(p0).lerp(tip, 0.5).lerp(p1, 0.25); mid.y += 0.015;
      n.copy(side).multiplyScalar(sg * 0.3).add(UP).normalize();
      const shade = tone + 0.18 * (1 - u0) + (rand() - 0.5) * 0.18 + (dir.dot(SUN) * 0.1);
      tri(p0, p1, mid, pick(shade + 0.12)); // light inner part
      tri(p1, mid, tip, pick(shade - 0.12)); // darker pointed tip
    }
  }
  // a pointed terminal leaflet along the spine
  const e = spine(1), e0 = spine(0.92);
  n.copy(UP);
  tip.copy(e).addScaledVector(dir, 0.1); tip.y -= 0.07;
  side.crossVectors(dir, UP).normalize().multiplyScalar(0.035);
  tri(e0.clone().add(side), e0.clone().sub(side), tip, pick(tone - 0.05));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

/** Where the trunk of palm `variant` is at height fraction u (0 base … 1 crown), in the model's local space. */
export function palmTrunkLocal(variant, u) {
  const rand = rng(11000 + variant * 29);
  const lean = rand() * Math.PI * 2, bend = 0.4 + rand() * 0.25, H = 2.2 + rand() * 0.3, ph = rand() * 6;
  const off = bend * u * u + Math.sin(u * 5 + ph) * 0.03;
  return { x: Math.cos(lean) * off, y: u * H, z: Math.sin(lean) * off };
}

function buildPalm(variant) {
  const rand = rng(11000 + variant * 29);
  const parts = [];
  const lean = rand() * Math.PI * 2, bend = 0.4 + rand() * 0.25, H = 2.2 + rand() * 0.3, ph = rand() * 6;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8, off = bend * u * u + Math.sin(u * 5 + ph) * 0.03; // arcs over, with a slight wobble
    pts.push(new THREE.Vector3(Math.cos(lean) * off, u * H, Math.sin(lean) * off));
  }
  const trunk = limb(pts, 0.125, 0.078, rand, 7, leafDetail < 1 ? 14 : 56, BARK);
  // ringed bark: dark grooves between tan bands, lit on the sunny side
  colorize(trunk, (p, nrm) => {
    const f = ((p.y / 0.15) % 1 + 1) % 1;
    return f < 0.3 ? PALM_RING[0] : nrm.dot(SUN) > 0.35 ? PALM_RING[2] : PALM_RING[1];
  });
  parts.push(trunk);
  for (let i = 0; i < 3; i++) { // flared base
    const a = (i / 3) * Math.PI * 2 + rand() * 0.8;
    parts.push(limb([new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(Math.cos(a) * 0.1, 0.05, Math.sin(a) * 0.1), new THREE.Vector3(Math.cos(a) * 0.19, -0.03, Math.sin(a) * 0.19)], 0.06, 0.02, rand, 5, 4, PALM_RING));
  }
  const top = pts[8];
  // crown: fronds all round, the lower ones longer and drooping, upper ones shorter and lifted
  const fronds = 9 + Math.floor(rand() * 2), a0 = rand() * Math.PI * 2;
  for (let i = 0; i < fronds; i++) {
    const a = a0 + (i / fronds) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const low = i % 2; // alternate high and low fronds
    parts.push(palmFrond(top, a, 1.3 + rand() * 0.25 - low * 0.12, 0.3 + (1 - low) * 0.25 + rand() * 0.1, 0.6 + low * 0.5 + rand() * 0.15, 0.5 - low * 0.12 + rand() * 0.12, rand));
  }
  parts.push(palmFrond(top, rand() * 6.28, 0.65, 0.55, 0.25, 0.72, rand)); // young frond standing up
  const nuts = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < nuts; i++) { // coconuts under the crown
    const a = rand() * Math.PI * 2, d = 0.07 + rand() * 0.04;
    const g = new THREE.IcosahedronGeometry(0.075, 0).translate(top.x + Math.cos(a) * d, top.y - 0.05 - rand() * 0.06, top.z + Math.sin(a) * d);
    parts.push(colorize(g, (p, nrm) => (nrm.dot(SUN) > 0.4 ? COCONUT[2] : nrm.y < -0.2 ? COCONUT[0] : COCONUT[1])));
  }
  return merge(parts);
}

/** Bush: one or two low leaf clusters in the same style (about 0.3 radius). */
export const bushGeometry = () => cached('bush', buildBush);
function buildBush() {
  const rand = rng(777);
  return merge([
    leafCluster(0, 0.24, 0, 0.3, 0.22, rand),
    leafCluster(0.16, 0.36, -0.04, 0.17, 0.13, rand),
  ]);
}
