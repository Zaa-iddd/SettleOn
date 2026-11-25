// Boats: a cozy little ship you can walk around on, sail, paint, name and upgrade (original model, after the
// user's references: a painted band over a weathered plank hull, a board-walled cabin with white windows and
// flower boxes, a wheelhouse and mast with a pennant, cargo, lanterns and a ship's wheel at the stern; upgrades
// add an awning, string lights, bunting, life rings and fenders, fishing gear and an engine chimney).
//
// A boat is a moving platform with its own deck coordinates: local +z is the bow, +x starboard
// (three.js: a group turned by `yaw` maps local x to (cos yaw, −sin yaw) and local z to (sin yaw, cos yaw)).
// Riders keep a deck position (lx, lz); main.js turns it into a world position every frame, so
// people walking on deck move with the boat. Boats float on water tiles only (world.H < SEA).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEA, toCell } from '../shared/world.js';
import { seeThroughMaterial } from './world3d.js'; // (a circular import, used only lazily in materials())
import { BOAT_PALETTE, UPGRADE_KEYS, cleanLook, defaultLook } from '../shared/boatlook.js';

export const BOAT = {
  W: 1.2, BOW0: 1.0, TIP: 3.3, STERN: -3.0, // hull outline: half width, where the bow starts curving, bow tip, stern
  DECK: 0.45, // deck height above the sea surface
  HELM: [0, -2.42], // where the helmsman stands (the wheel is just in front)
  MAX_SPEED: 6.5, // tiles per second at full sail (walking is 3.2, swimming 1.8)
  // handling (main.js driveBoat): how fast the sail fills and the rudder swings, how quickly speed builds
  // (ACCEL) and how far it glides without sail (GLIDE: lower = longer), how hard the keel stops sideways
  // drift, the full turn rate (rad/s) once moving FULL_TURN_SPEED or faster, and the share left at a standstill
  // over shallow sand: top speed falls by up to SHALLOW_SLOW (fully once it has ridden up SHALLOW_LIFT), and it
  // slows at SAND_DRAG per second instead of gliding
  SHALLOW_SLOW: 0.65, SHALLOW_LIFT: 0.3, SAND_DRAG: 1.5,
  SAIL_RATE: 1.6, RUDDER_RATE: 3.5, ACCEL: 0.9, GLIDE: 0.45, KEEL: 2.2, TURN: 0.85, FULL_TURN_SPEED: 3, IDLE_TURN: 0.15,
  RIDER_R: 0.2, // a person's radius on deck
};
// The throttle (a ship's telegraph): W / S move it one notch, and the boat holds it without a key held.
// `sail` is the share of MAX_SPEED it drives toward. Index = throttle + 1 (throttle −1 … 3).
export const THROTTLE = [
  { name: 'Astern', sail: -0.25 },
  { name: 'Stop', sail: 0 },
  { name: 'Slow', sail: 0.3 },
  { name: 'Half', sail: 0.62 },
  { name: 'Full', sail: 1 },
];

/** Half width of the hull at local z (negative outside the hull). The bow is an elliptical curve. */
export function halfW(z) {
  const { W, BOW0, TIP, STERN } = BOAT;
  if (z < STERN || z > TIP) return -1;
  if (z <= BOW0) return W;
  const t = (z - BOW0) / (TIP - BOW0);
  return W * Math.sqrt(Math.max(0, 1 - t * t));
}

// What blocks walking on a boat's deck depends on its look (the cabin, a mast stepped on deck, props): `obs` =
// { rects: [x0, x1, z0, z1][], circles: [x, z, r][] } from layoutOf(look).obs (b.obs for a boat).
/** Can a rider stand at deck position (lx, lz) on a boat whose obstacles are `obs`? */
export function walkable(lx, lz, r = BOAT.RIDER_R, obs = layoutOf(null).obs) {
  if (lz < BOAT.STERN + 0.32 || Math.abs(lx) > halfW(lz) - 0.22 - r) return false;
  for (const [x0, x1, z0, z1] of obs.rects) if (lx > x0 - r && lx < x1 + r && lz > z0 - r && lz < z1 + r) return false;
  for (const [x, z, cr] of obs.circles) if ((lx - x) ** 2 + (lz - z) ** 2 < (cr + r) ** 2) return false;
  return true;
}
/** Is (lx, lz) over the deck at all (inside the rail)? */
export const onDeck = (lx, lz) => lz >= BOAT.STERN + 0.15 && Math.abs(lx) <= halfW(lz) - 0.12;

/** The nearest walkable deck spot to (lx, lz), searching outward a little, or null. */
export function nearestWalkable(lx, lz, obs = layoutOf(null).obs) {
  if (walkable(lx, lz, undefined, obs)) return [lx, lz];
  for (let r = 0.1; r <= 1.2; r += 0.1) {
    for (let a = 0; a < 16; a++) {
      const x = lx + Math.cos(a * Math.PI / 8) * r, z = lz + Math.sin(a * Math.PI / 8) * r;
      if (walkable(x, z, undefined, obs)) return [x, z];
    }
  }
  return null;
}

export function toLocal(b, x, z) {
  const dx = x - b.sx, dz = z - b.sz, c = Math.cos(b.syaw), s = Math.sin(b.syaw);
  return [dx * c - dz * s, dx * s + dz * c];
}
export function toWorldXZ(b, lx, lz) {
  const c = Math.cos(b.syaw), s = Math.sin(b.syaw);
  return [b.sx + lx * c + lz * s, b.sz - lx * s + lz * c];
}
/** Gentle bobbing on the waves (shared by the hull and everyone on deck). */
export const bobY = (b, t) => Math.sin(t * 1.25 + b.id % 7) * 0.045;
// `lift`: how far the boat rides up over shallow sand so its keel clears the seabed (Boats.update)
export const deckY = (b, t) => SEA + BOAT.DECK + bobY(b, t) + (b.lift ?? 0);

// points around the hull that must all be over water (bow tip, sides, stern corners)
const HULL_PTS = [[0, 3.3], [0.75, 2.6], [-0.75, 2.6], [1.2, 1.0], [-1.2, 1.0], [1.2, -1.0], [-1.2, -1.0], [1.2, -3.0], [-1.2, -3.0], [0, -3.0]];
/** Does a boat at (x, z, yaw) float clear of land? Any water will do, sandy shallows included (it rides up over them). */
export function hullClear(world, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const [lx, lz] of HULL_PTS) {
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    if (world.H(toCell(wx), toCell(wz)) >= SEA) return false;
  }
  return true;
}

// ---------- the model ----------
// Built once and shared by every boat. Fixed-colour parts merge into `base`; the paintable parts (hull band,
// cabin walls, roofs) are pale grey vertex colours tinted by a per-boat material colour (the boat's look);
// the upgrades are separate meshes shown when built (see applyLook).
const geoCache = {};
const C = {
  KEEL: 0x4a2a1c, PLANK: 0x9b8b76, PLANK2: 0x8a7a66, GRIME: 0x6a5a4a, RAIL: 0x5a3a24, CAP: 0x8a6a48, NAIL: 0x34281e,
  DECK: 0x9a6a3c, DECK2: 0x8a5c33, POST: 0x6b4024, DARK: 0x3e2818, FRAME: 0xb98a56, GLASS: 0x9fd6e6, DOOR: 0x7a4a2a,
  IRON: 0x3a3532, GOLD: 0xe0b040, BRASS: 0xd9a868, BARREL: 0x9a6336, CRATE: 0xb08048, CRATE_D: 0x7a5530, WHEEL: 0x8a5530,
  LEAF: 0x5fa83a, LEAF2: 0x3f7f2c, POT: 0xc06a44, ROPE: 0xd8c08a, RED: 0xd8433a, WHITE: 0xf4efe4, TYRE: 0x2a2a2e,
};

// colour every vertex of a geometry (a hex, or a function of the vertex position), drop uv/groups so they merge
function paint(g, color) {
  g = g.index ? g.toNonIndexed() : g;
  g.clearGroups();
  g.deleteAttribute('uv');
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const v = typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : color;
    if (typeof v === 'number' && v <= 2) col.setScalar(v); else col.setHex(v); // small numbers are grey levels (tinted parts)
    c.set([col.r, col.g, col.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// the hull outline (inset by `inset`) as a 2D shape; shape y = −local z (see extrudeY)
function outline(inset) {
  // a negative inset grows the outline outward. The ends stay inside the hull's length (out there halfW is −1,
  // which would collapse to duplicate points and break the triangulation of a ring's hole).
  const pts = [], { STERN, TIP } = BOAT, ins = Math.max(0, inset);
  const z0 = STERN + ins, z1 = TIP - ins * 1.4 - (inset < 0 ? 0.02 : 0);
  const N = 16;
  for (let i = 0; i <= N; i++) { const z = z0 + (z1 - z0) * (i / N); pts.push(new THREE.Vector2(Math.max(0.01, halfW(z) - inset), -z)); }
  for (let i = N; i >= 0; i--) { const z = z0 + (z1 - z0) * (i / N); pts.push(new THREE.Vector2(-Math.max(0.01, halfW(z) - inset), -z)); }
  return pts;
}
// extrude a shape upward from y0 by h (shape x → x, shape y → −z)
function extrudeY(shape, y0, h) {
  return new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}
const ring = (outer, inner) => { const s = new THREE.Shape(outline(outer)); s.holes.push(new THREE.Path(outline(inner))); return s; };
// collect painted pieces and merge them into one geometry
function parts(build) {
  const list = [];
  let sheerOn = false;
  const add = (g, color) => list.push(paint(sheerOn ? sheerGeo(g) : g, color));
  const sheer = (on) => { sheerOn = on; };
  const box = (w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    add(g.translate(x, y, z), color);
  };
  build({ add, box, sheer });
  const geo = mergeGeometries(list);
  for (const g of list) g.dispose();
  geo.userData.shared = true;
  return geo;
}
const D = BOAT.DECK;
const LANTERNS = [[1.12, -1.6], [-1.12, -1.6], [1.12, 0.9], [-1.12, 0.9]];
const KEEL_DEPTH = 0.62; // how far the keel reaches under the waterline
// The sheer: the hull's top line sweeps up toward the bow (and a little at the stern), like a real boat's.
// Only the hull sides, rail and what's fixed to them follow it (sheerGeo); the deck stays flat to walk on.
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const sheerAt = (z) => 0.3 * Math.pow(sstep(0.3, BOAT.TIP, z), 1.3) + 0.12 * sstep(-1.3, BOAT.STERN, z);
const sheerW = (y) => Math.min(1, Math.max(0, (y + 0.12) / (D + 0.15))); // waterline 0 → rail 1, so the planks stretch smoothly
function sheerGeo(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + sheerAt(p.getZ(i)) * sheerW(p.getY(i)));
  return g;
}
// a stable 0..1 number per board, so every plank gets its own weathered tone
const hrand = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const tone = (n, lo = 0.82, hi = 1.04) => lo + hrand(n) * (hi - lo);
// clinker-built strakes: [bottom, top] heights of each plank band, lower bands tucked in under the ones above
const LOW_STRAKES = [[-0.42, -0.27], [-0.27, -0.12], [-0.12, 0.02], [0.02, 0.16]];
const BAND_STRAKES = [[0.14, 0.25], [0.25, 0.36], [0.36, D + 0.03]];

// ---------- swappable parts and deck props (chosen in the boat panel; the look's `p` and `d`) ----------
export const CABINS = [
  { name: 'Plank cabin', x: -0.35, z: -0.5, w: 1.3, d: 1.8, h: 1.0 },
  { name: 'Small cabin', x: -0.35, z: -0.85, w: 1.3, d: 1.1, h: 0.9 }, // leaves the foredeck open
  { name: 'No cabin' }, // an open deck
];
export const ROOFS = ['Shingles', 'Roof deck', 'Canvas'];
export const TOPS = ['Wheelhouse', 'Lookout', 'None'];
export const MASTS = ['Pennant', 'Sail', 'None'];
// r: how much of the deck a prop takes up (riders walk around it); 0 = you can walk over it
export const PROPS = [
  { name: 'Nothing', r: 0 }, { name: 'Crates', r: 0.3 }, { name: 'Barrel', r: 0.22 }, { name: 'Chest', r: 0.26 },
  { name: 'Rope coil', r: 0 }, { name: 'Potted plant', r: 0.2 }, { name: 'Lantern', r: 0.1 },
];
// spots on deck that can hold a prop, chosen so no combination cuts the deck in two (checked by a flood fill).
// maxR: the biggest prop a spot takes; the stern spots flank the helm, and big props in both boxed the helmsman in.
export const DECK_SLOTS = [
  { name: 'Port foredeck', x: -0.6, z: 1.5, maxR: 0.3 }, { name: 'Port bow', x: -0.42, z: 2.15, maxR: 0.3 }, { name: 'Starboard bow', x: 0.42, z: 2.55, maxR: 0.3 },
  { name: 'Bow tip', x: 0, z: 2.95, maxR: 0.3 }, { name: 'Port stern', x: -0.65, z: -2.3, maxR: 0.26 }, { name: 'Starboard stern', x: 0.6, z: -2.55, maxR: 0.1 },
];
/** The prop actually on spot i (one too big for the spot counts as nothing). */
export const propAt = (look, i) => (PROPS[look.d[i]].r <= DECK_SLOTS[i].maxR ? look.d[i] : 0);
const WHEEL_POST = [-0.14, 0.14, -2.12, -1.92];

/**
 * Where everything goes for a look: the cabin (or null), which roof, top and mast actually show (nothing stands on
 * a canvas roof, and roof and top need a cabin), the wheelhouse spot, the mast, and what blocks walking on deck.
 */
const layoutCache = new Map();
export function layoutOf(look) {
  const L = look ?? defaultLook();
  const key = `${L.p.join()}|${L.d.join()}`;
  let lay = layoutCache.get(key);
  if (lay) return lay;
  const cab = CABINS[L.p[0]].w ? CABINS[L.p[0]] : null;
  const roof = cab ? L.p[1] : -1;
  const top = cab && roof !== 2 ? L.p[2] : 2;
  const wh = cab ? { x: cab.x - 0.15, z: cab.z - cab.d * 0.25, y: D + cab.h + 0.15 } : null;
  const mastV = L.p[3];
  let mast = null;
  if (mastV !== 2) {
    if (cab && top === 0) mast = { x: wh.x, z: wh.z, y0: wh.y + 0.64, y1: wh.y + 2.2 }; // up through the wheelhouse roof
    else if (cab) mast = { x: wh.x, z: wh.z, y0: wh.y - 0.05, y1: wh.y + 1.7 }; // from the cabin roof
    else mast = { x: -0.55, z: -0.6, y0: D, y1: D + 2.7 }; // stepped on the open deck
  }
  const rects = [WHEEL_POST], circles = [];
  if (cab) rects.push([cab.x - cab.w / 2 - 0.02, cab.x + cab.w / 2 + 0.02, cab.z - cab.d / 2 - 0.02, cab.z + cab.d / 2 + 0.02]);
  if (mast && !cab) circles.push([mast.x, mast.z, 0.08]);
  L.d.forEach((_, i) => { const r = PROPS[propAt(L, i)].r; if (r) circles.push([DECK_SLOTS[i].x, DECK_SLOTS[i].z, r]); });
  lay = { key, cab, roof, top, wh, mast, mastV, obs: { rects, circles } };
  layoutCache.set(key, lay);
  return lay;
}

// everything on every boat with fixed colours: hull, deck, rail, portholes, bowsprit, anchor, wheel, lantern posts
const baseGeometry = () => parts(({ add, box, sheer }) => {
  // hull: a dark keel, weathered clinker planks with grime at the waterline (the tinted band goes on top, see hullPaint)
  add(extrudeY(new THREE.Shape(outline(0.3)), -0.62, 0.22), C.KEEL);
  const WEATHER = [0x8a7a66, 0x9b8b76, 0x7f6f5c, 0x958470];
  sheer(true); // the hull sides, rail and their fittings follow the sheer line; the deck and wheel don't
  LOW_STRAKES.forEach(([y0, y1], k) => {
    const col = k === 0 ? C.GRIME : WEATHER[Math.floor(hrand(k + 40) * WEATHER.length)];
    add(extrudeY(new THREE.Shape(outline([0.17, 0.1, 0.05, 0.015][k])), y0, y1 - y0), (x, y) => (y < y0 + 0.01 ? new THREE.Color(col).multiplyScalar(0.8).getHex() : col));
  });
  for (let z = -2.75; z <= 2.6; z += 0.45) for (const sx of [-1, 1]) for (const [y0, y1] of BAND_STRAKES) box(0.025, 0.025, 0.025, C.NAIL, sx * (halfW(z) + 0.035), (y0 + y1) / 2, z);
  add(extrudeY(ring(-0.022, 0.06), 0.1, 0.05), 0xe6d8b8); // a cream stripe along the waterline
  add(extrudeY(ring(-0.045, 0.1), D - 0.06, 0.06), C.RAIL); // a proud rubbing strake under the rail
  // the stem: a curved post at the bow that rises above the rail, and a sternpost
  for (let k = 0; k < 6; k++) { const t = k / 5; box(0.09, 0.22, 0.1, C.RAIL, 0, -0.35 + t * (D + 0.75), BOAT.TIP - 0.02 + Math.sin(t * 1.4) * 0.1, 0, -0.25 * t); }
  box(0.1, D + 0.75, 0.08, C.RAIL, 0, (D + 0.35) / 2 - 0.05, BOAT.STERN - 0.02);
  sheer(false);
  // deck planks fore and aft, clipped to the hull: uneven tones, dark seams, a butt joint with nails on each
  const DECKS = [0x9a6a3c, 0x8a5c33, 0xa47446, 0x7f5530, 0x936336];
  let prevEnd = null;
  for (let x = -1.0, n = 0; x <= 1.0; x += 0.25, n++) {
    const w = 0.24;
    let zEnd = BOAT.STERN + 0.1;
    for (let z = BOAT.STERN + 0.1; z < BOAT.TIP; z += 0.02) { if (halfW(z) - 0.1 >= Math.abs(x) + w / 2) zEnd = z; else if (z > 0) break; }
    const z0 = BOAT.STERN + 0.12;
    if (zEnd - z0 > 0.1) {
      box(w, 0.04, zEnd - z0, DECKS[Math.floor(hrand(n + 7) * DECKS.length)], x, D + 0.005, (z0 + zEnd) / 2);
      const jz = z0 + 0.4 + hrand(n + 21) * (zEnd - z0 - 0.8);
      box(w, 0.01, 0.014, C.DARK, x, D + 0.028, jz);
      for (const dz of [-0.03, 0.03]) box(0.022, 0.01, 0.022, C.NAIL, x, D + 0.029, jz + dz);
      if (prevEnd !== null) { const se = Math.min(prevEnd, zEnd); box(0.016, 0.01, se - z0, C.DARK, x - 0.125, D + 0.028, (z0 + se) / 2); }
    }
    prevEnd = zEnd - z0 > 0.1 ? zEnd : null;
  }
  // rail with a weathered cap, and wooden posts along it
  sheer(true);
  add(extrudeY(ring(0, 0.13), D, 0.16), C.RAIL);
  add(extrudeY(ring(0, 0.13), D + 0.16, 0.04), C.CAP);
  for (let z = -2.7; z <= 2.5; z += 0.55) for (const sx of [-1, 1]) box(0.07, 0.25, 0.07, C.POST, sx * (halfW(z) - 0.065), D + 0.12, z);
  for (const z of [-2.0, -0.6, 0.8]) for (const sx of [-1, 1]) { // brass portholes
    box(0.03, 0.13, 0.13, C.BRASS, sx * (halfW(z) + 0.0), 0.07, z);
    box(0.035, 0.08, 0.08, 0x2a4a5a, sx * (halfW(z) + 0.005), 0.07, z);
  }
  // bowsprit, and an anchor hanging on the port bow
  box(0.08, 0.08, 0.8, C.RAIL, 0, D + 0.32, BOAT.TIP + 0.15, 0, -0.3);
  const ax = -(halfW(2.0) + 0.04), az = 2.0;
  box(0.035, 0.34, 0.035, C.IRON, ax, 0.02, az);
  box(0.035, 0.035, 0.2, C.IRON, ax, 0.16, az);
  box(0.035, 0.035, 0.16, C.IRON, ax, -0.15, az - 0.06, 0, 0.6);
  box(0.035, 0.035, 0.16, C.IRON, ax, -0.15, az + 0.06, 0, -0.6);
  add(new THREE.TorusGeometry(0.04, 0.012, 4, 8).rotateY(Math.PI / 2).translate(ax, 0.22, az), C.IRON);
  sheer(false);
  // the ship's wheel on a post at the stern
  box(0.12, 0.55, 0.12, C.RAIL, 0, D + 0.28, -2.02);
  add(new THREE.TorusGeometry(0.26, 0.035, 4, 12).translate(0, D + 0.66, -1.95), C.WHEEL);
  for (let a = 0; a < 4; a++) box(0.62, 0.035, 0.035, C.WHEEL, 0, D + 0.66, -1.95, 0, 0, a * Math.PI / 4);
  box(0.08, 0.08, 0.08, C.GOLD, 0, D + 0.66, -1.93);
  // lantern posts on the rail (their glowing panes are a separate mesh)
  sheer(true);
  for (const [x, z] of LANTERNS) {
    box(0.05, 0.4, 0.05, C.IRON, x, D + 0.4, z);
    box(0.14, 0.04, 0.14, C.IRON, x, D + 0.62, z);
    box(0.14, 0.04, 0.14, C.IRON, x, D + 0.8, z);
  }
  sheer(false);
});

// the tinted band along the top of the hull: three clinker strakes of uneven tone, each with a shaded lower edge
const hullPaintGeometry = () => parts(({ add, sheer }) => {
  sheer(true);
  BAND_STRAKES.forEach(([y0, y1], k) => {
    const t = tone(k + 3, 0.84, 1.04);
    add(extrudeY(ring(-0.012 - k * 0.008, 0.1), y0, y1 - y0), (x, y) => (y < y0 + 0.01 ? t * 0.76 : y > D ? t * 1.12 : t));
  });
});

// ---- the cabin (CABINS), with fixed-colour trim and tinted board walls ----
const cabinTrimGeometry = (cab) => parts(({ add, box }) => {
  const zs = [cab.z - cab.d * 0.28, cab.z + cab.d * 0.28]; // window rows along both sides
  box(cab.w + 0.06, 0.1, cab.d + 0.06, C.DARK, cab.x, D + 0.05, cab.z); // dark base
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.08, cab.h, 0.08, C.POST, cab.x + sx * cab.w / 2, D + cab.h / 2, cab.z + sz * cab.d / 2);
  box(cab.w + 0.34, 0.04, cab.d + 0.34, C.DARK, cab.x, D + cab.h, cab.z); // eaves
  for (const sx of [-1, 1]) box(0.02, cab.h, 0.06, C.POST, cab.x + sx * (cab.w / 2 + 0.01), D + cab.h / 2, cab.z); // battens
  box(0.06, cab.h, 0.02, C.POST, cab.x - 0.04, D + cab.h / 2, cab.z + cab.d / 2 + 0.01);
  box(0.06, cab.h, 0.02, C.POST, cab.x, D + cab.h / 2, cab.z - cab.d / 2 - 0.01);
  for (const z of zs) {
    for (const sx of [1, -1]) { // wood-framed windows on both sides
      const wx = cab.x + sx * (cab.w / 2 + 0.012);
      box(0.03, 0.36, 0.4, C.FRAME, wx, D + cab.h * 0.62, z);
      box(0.035, 0.27, 0.31, C.GLASS, wx + sx * 0.003, D + cab.h * 0.62, z);
      box(0.036, 0.27, 0.03, C.FRAME, wx + sx * 0.004, D + cab.h * 0.62, z);
    }
    const fx = cab.x + cab.w / 2 + 0.06; // a flower box below the starboard windows (the walkway side)
    box(0.1, 0.09, 0.42, C.DOOR, fx, D + cab.h * 0.4, z);
    for (let k = 0; k < 5; k++) {
      box(0.05, 0.06, 0.05, C.LEAF2, fx, D + cab.h * 0.4 + 0.07, z - 0.16 + k * 0.08);
      box(0.045, 0.045, 0.045, [0xff6f91, 0xffd04a, 0xf0584e, 0xffffff, 0xb07ae8][k], fx + 0.01, D + cab.h * 0.4 + 0.12 + (k % 2) * 0.02, z - 0.16 + k * 0.08);
    }
  }
  const fz = cab.z + cab.d / 2 + 0.012; // the door at the front with a round window, and a front window
  box(0.42, 0.74, 0.03, C.FRAME, cab.x + 0.25, D + 0.39, fz);
  box(0.34, 0.68, 0.04, C.DOOR, cab.x + 0.25, D + 0.36, fz + 0.004);
  add(new THREE.TorusGeometry(0.075, 0.018, 4, 10).translate(cab.x + 0.25, D + 0.52, fz + 0.03), C.BRASS);
  box(0.1, 0.1, 0.02, C.GLASS, cab.x + 0.25, D + 0.52, fz + 0.025);
  box(0.05, 0.05, 0.06, C.GOLD, cab.x + 0.37, D + 0.33, fz + 0.04);
  box(0.4, 0.3, 0.03, C.FRAME, cab.x - 0.32, D + cab.h * 0.62, fz);
  box(0.3, 0.21, 0.04, C.GLASS, cab.x - 0.32, D + cab.h * 0.62, fz + 0.004);
});
const cabinWallsGeometry = (cab) => parts(({ box }) => {
  const n = Math.round(cab.h / 0.125), bh = cab.h / n;
  for (let i = 0; i < n; i++) box(cab.w - (i % 2) * 0.01, bh, cab.d - (i % 2) * 0.01, tone(i + 60, 0.78, 1.02), cab.x, D + bh / 2 + i * bh, cab.z);
});

// ---- roofs (ROOFS): shingles and the roof deck are tinted by the roof colour, the canvas roof by the canvas colour ----
// shallow gables of shingles: a flat deck under courses stepping down from the ridge, each shingle its own tone
function shingles(box, cx, cz, w, d, y, courses, tiles, seed) {
  box(w, 0.06, d, 0.7, cx, y + 0.03, cz);
  const cw = w / 2 / courses, tl = d / tiles;
  for (const side of [-1, 1]) for (let k = 0; k < courses; k++) {
    const x = cx + side * (w / 2 - (k + 0.5) * cw), top = y + 0.1 + k * 0.04;
    for (let j = 0; j < tiles; j++) {
      const off = (k % 2) * tl * 0.5, z = cz - d / 2 + (j + 0.5) * tl + off;
      if (z + tl / 2 > cz + d / 2 + 0.001 + off) continue;
      box(cw + 0.02, 0.05, tl - 0.015, tone(seed + side * 31 + k * 7 + j, 0.74, 1.06), x, top - 0.025, z);
    }
  }
}
const roofGeometry = (cab, v) => parts(({ box }) => {
  const w = cab.w + 0.3, d = cab.d + 0.3, y = D + cab.h + 0.04;
  if (v === 0) shingles(box, cab.x, cab.z, w, d, y, 5, Math.max(3, Math.round(d / 0.35)), 100);
  else if (v === 1) { // a flat roof deck of planks with a low railing all round
    for (let i = 0; i < 6; i++) box(w / 6 - 0.012, 0.07, d, tone(i + 150, 0.8, 1.04), cab.x - w / 2 + (i + 0.5) * (w / 6), y + 0.035, cab.z);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) box(0.05, 0.26, 0.05, 0.7, cab.x + x * (w / 2 - 0.04), y + 0.2, cab.z + z * (d / 2 - 0.04));
    for (const sx of [-1, 1]) box(0.05, 0.05, d - 0.04, 0.95, cab.x + sx * (w / 2 - 0.04), y + 0.32, cab.z);
    for (const sz of [-1, 1]) box(w - 0.04, 0.05, 0.05, 0.95, cab.x, y + 0.32, cab.z + sz * (d / 2 - 0.04));
  } else { // an arched canvas roof over hoops: strips around a half-circle, folds alternating
    const r = w / 2, N = 8;
    for (let k = 0; k < N; k++) {
      const a = Math.PI * (k + 0.5) / N, ax = Math.cos(a) * r, ay = Math.sin(a) * r * 0.55;
      box(Math.PI * r / N + 0.03, 0.035, d, k % 2 ? 0.88 : 1.0, cab.x + ax, y + ay, cab.z, 0, 0, a - Math.PI / 2);
    }
  }
});

// ---- what stands on the cabin roof (TOPS) ----
const topWallsGeometry = (wh) => parts(({ box }) => { // the wheelhouse's board walls (cabin colour)
  for (let i = 0; i < 4; i++) box(0.8 - (i % 2) * 0.01, 0.1375, 0.8 - (i % 2) * 0.01, tone(i + 80, 0.78, 1.02), wh.x, wh.y + 0.069 + i * 0.1375, wh.z);
});
const topRoofGeometry = (wh) => parts(({ box }) => shingles(box, wh.x, wh.z, 1.0, 1.0, wh.y + 0.55, 3, 3, 200)); // roof colour
const topTrimGeometry = (wh, v) => parts(({ box }) => {
  if (v === 0) { // the wheelhouse window
    box(0.4, 0.26, 0.03, C.FRAME, wh.x, wh.y + 0.32, wh.z + 0.41);
    box(0.3, 0.18, 0.04, C.GLASS, wh.x, wh.y + 0.32, wh.z + 0.415);
  } else { // a lookout: a planked platform with posts and a rail, and a short ladder up to it
    for (let i = 0; i < 4; i++) box(0.24, 0.05, 0.96, tone(i + 170), wh.x - 0.36 + i * 0.24, wh.y + 0.35, wh.z);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.06, 0.7, 0.06, C.POST, wh.x + x * 0.44, wh.y + 0.2, wh.z + z * 0.44);
    for (const s of [-1, 1]) { box(0.94, 0.05, 0.05, C.POST, wh.x, wh.y + 0.62, wh.z + s * 0.44); box(0.05, 0.05, 0.94, C.POST, wh.x + s * 0.44, wh.y + 0.62, wh.z); }
    for (let k = 0; k < 3; k++) box(0.3, 0.03, 0.03, C.CAP, wh.x, wh.y + 0.08 + k * 0.1, wh.z + 0.5);
  }
});

// ---- the mast (MASTS): a pole with a yard and a brass cap; the sail is tinted by the canvas colour ----
const mastGeometry = (m, sail) => parts(({ add, box }) => {
  box(0.07, m.y1 - m.y0, 0.07, C.POST, m.x, (m.y0 + m.y1) / 2, m.z);
  box(sail ? 1.3 : 0.62, 0.05, 0.05, C.POST, m.x, m.y1 - (sail ? 0.15 : 0.45), m.z);
  if (sail) box(1.2, 0.045, 0.045, C.POST, m.x, m.y1 - 0.15 - sailDrop(m), m.z + 0.06);
  box(0.13, 0.08, 0.13, C.GOLD, m.x, m.y1 + 0.02, m.z);
  // standing rigging: a forestay to the bowsprit and two backstays to the stern quarters
  const top = new THREE.Vector3(m.x, m.y1 - 0.06, m.z);
  for (const [x, y, z] of [BOWSPRIT_END, [halfW(-2.7) - 0.07, D + 0.2 + sheerAt(-2.7), -2.7], [-(halfW(-2.7) - 0.07), D + 0.2 + sheerAt(-2.7), -2.7]]) {
    const e = new THREE.Vector3(x, y, z), len = top.distanceTo(e);
    add(new THREE.BoxGeometry(0.018, 0.018, len).lookAt(e.clone().sub(top)).translate((top.x + e.x) / 2, (top.y + e.y) / 2, (top.z + e.z) / 2), C.ROPE);
  }
});
const sailDrop = (m) => Math.min(1.15, m.y1 - m.y0 - 0.55);
const sailGeometry = (m) => parts(({ box }) => { // a square sail in four cloths, bellying forward in the middle
  const h = sailDrop(m), top = m.y1 - 0.18;
  for (let k = 0; k < 4; k++) {
    const belly = [0.05, 0.11, 0.11, 0.05][k];
    box(0.3, h, 0.025, k % 2 ? 0.9 : 1.0, m.x - 0.45 + k * 0.3, top - h / 2, m.z + 0.04 + belly);
  }
});

// ---- deck props (PROPS), each built around its own spot ----
const PROP_BUILD = [
  null,
  () => parts(({ box }) => { // crates, roped, with a small one on top
    box(0.46, 0.42, 0.46, C.CRATE, 0, D + 0.21, 0, 0.15);
    box(0.48, 0.05, 0.1, C.ROPE, 0, D + 0.3, 0, 0.15);
    box(0.1, 0.43, 0.48, C.ROPE, 0, D + 0.215, 0, 0.15);
    box(0.3, 0.26, 0.3, C.CRATE_D, 0.02, D + 0.55, -0.02, -0.3);
  }),
  () => parts(({ add }) => { // a barrel with iron hoops
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8).translate(0, D + 0.21, 0), C.BARREL);
    for (const y of [0.08, 0.34]) add(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 8).translate(0, D + y, 0), C.IRON);
  }),
  () => parts(({ box }) => { // a sea chest with a brass band and a little plant on it
    box(0.42, 0.3, 0.32, C.CRATE_D, 0, D + 0.15, 0);
    box(0.43, 0.05, 0.33, C.GOLD, 0, D + 0.22, 0);
    box(0.14, 0.12, 0.14, C.POT, 0, D + 0.36, 0);
    for (const [x, y, z] of [[0, 0.47, 0], [0.05, 0.5, 0.03], [-0.05, 0.49, -0.02], [0.01, 0.55, -0.04]]) box(0.09, 0.09, 0.09, x ? C.LEAF : C.LEAF2, x, D + y, z);
  }),
  () => parts(({ add }) => add(new THREE.TorusGeometry(0.17, 0.045, 4, 12).rotateX(Math.PI / 2).translate(0, D + 0.04, 0), C.ROPE)), // a coil of rope
  () => parts(({ box }) => { // a big potted plant
    box(0.26, 0.24, 0.26, C.POT, 0, D + 0.12, 0);
    box(0.28, 0.04, 0.28, 0xa8553a, 0, D + 0.25, 0);
    for (const [x, y, z, s] of [[0, 0.42, 0, 0.2], [0.09, 0.36, 0.05, 0.14], [-0.08, 0.38, -0.06, 0.14], [0.03, 0.55, -0.02, 0.12], [-0.06, 0.32, 0.08, 0.1]]) box(s, s, s, y > 0.4 ? C.LEAF : C.LEAF2, x, D + y, z);
  }),
  () => parts(({ box }) => { // a standing lantern on a post (its pane glows, see propGlow)
    box(0.18, 0.05, 0.18, C.DARK, 0, D + 0.025, 0);
    box(0.05, 0.62, 0.05, C.IRON, 0, D + 0.33, 0);
    box(0.16, 0.04, 0.16, C.IRON, 0, D + 0.64, 0);
    box(0.16, 0.04, 0.16, C.IRON, 0, D + 0.84, 0);
    box(0.06, 0.05, 0.06, C.IRON, 0, D + 0.89, 0);
  }),
];
const propGeometry = (t) => (PROP_BUILD[t] ? shared(`prop${t}`, PROP_BUILD[t]) : null);
const propGlowGeometry = () => shared('propGlow', () => { const g = new THREE.BoxGeometry(0.12, 0.16, 0.12).translate(0, D + 0.74, 0); g.deleteAttribute('uv'); g.userData.shared = true; return g; });

// ---- upgrades ----
// canvas awning over the foredeck: wooden poles (base colours) and a gabled canvas in folds (tinted by the canvas colour)
const awningPolesGeometry = () => parts(({ box }) => {
  for (const [x, z] of [[1.0, 0.75], [-1.0, 0.75], [0.86, 2.0], [-0.86, 2.0]]) box(0.06, 1.28, 0.06, C.POST, x, D + 0.64, z);
  box(0.06, 0.06, 1.4, C.POST, 0, D + 1.52, 1.38);
});
const awningCanvasGeometry = () => parts(({ box }) => {
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) { // four folds per side, from the ridge down to the eave
      const t = (k + 0.5) / 4, x = side * t * 1.02, y = D + 1.52 - t * 0.28;
      box(0.27, 0.03, 1.46, k % 2 ? 0.86 : 1.0, x, y, 1.38, 0, 0, side * -0.27);
    }
    for (let k = 0; k < 4; k++) box(0.22, 0.1, 0.02, k % 2 ? 0.86 : 1.0, side * (0.14 + k * 0.25), D + 1.3 - k * 0.07, 0.66); // scalloped back edge
  }
});
// string lights: a sagging wire around the deck on the lantern posts, with warm bulbs (a glowing mesh)
const BOWSPRIT_END = [0, D + 0.44 + sheerAt(BOAT.TIP), BOAT.TIP + 0.52]; // where the bowsprit ends
const LIGHT_RUN = (() => {
  const pts = [];
  const lp = [[1.12, -2.6], [1.12, -1.6], [1.12, -0.35], [1.12, 0.9], [0.85, 2.15], [0, BOAT.TIP + 0.4], [-0.85, 2.15], [-1.12, 0.9], [-1.12, -0.35], [-1.12, -1.6], [-1.12, -2.6]];
  for (let i = 0; i < lp.length - 1; i++) {
    const [ax, az] = lp[i], [bx, bz] = lp[i + 1];
    for (let k = 0; k < 4; k++) { const t = k / 4; pts.push([ax + (bx - ax) * t, D + 0.86 - Math.sin(t * Math.PI) * 0.16, az + (bz - az) * t]); }
  }
  pts.push([lp[lp.length - 1][0], D + 0.86, lp[lp.length - 1][1]]);
  return pts;
})();
const lightsWireGeometry = () => parts(({ add }) => {
  for (let i = 0; i < LIGHT_RUN.length - 1; i++) {
    const a = new THREE.Vector3(...LIGHT_RUN[i]), b = new THREE.Vector3(...LIGHT_RUN[i + 1]), len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.015, 0.015, len).lookAt(b.clone().sub(a)).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(g, C.IRON);
  }
});
const lightsBulbGeometry = () => {
  const g = mergeGeometries(LIGHT_RUN.filter((_, i) => i % 2).map(([x, y, z]) => { const b = new THREE.BoxGeometry(0.06, 0.07, 0.06).translate(x, y - 0.05, z); b.deleteAttribute('uv'); return b; }));
  g.userData.shared = true;
  return g;
};
// bunting: lines from the masthead (wherever the mast is) to the bowsprit and to the stern, hung with pennants
const buntingPoints = (top) => {
  const lines = [[top, BOWSPRIT_END], [top, [0, D + 1.05, BOAT.STERN + 0.15]]];
  const pts = [];
  for (const [a, b] of lines) for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.35, a[2] + (b[2] - a[2]) * t, k]); }
  return pts;
};
const buntingLineGeometry = (top) => parts(({ add }) => {
  const P = buntingPoints(top);
  for (let i = 0; i < P.length - 1; i++) {
    if (P[i + 1][3] === 0) continue;
    const a = new THREE.Vector3(...P[i].slice(0, 3)), b = new THREE.Vector3(...P[i + 1].slice(0, 3));
    add(new THREE.BoxGeometry(0.012, 0.012, a.distanceTo(b)).lookAt(b.clone().sub(a)).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), C.ROPE);
  }
});
const pennants = (top, odd, color) => parts(({ add }) => {
  buntingPoints(top).forEach(([x, y, z, k]) => {
    if (k === 0 || k === 12 || k % 2 !== odd) return;
    add(new THREE.ConeGeometry(0.07, 0.15, 3).rotateX(Math.PI).translate(x, y - 0.08, z), color);
  });
});
// life rings and tyre fenders (and a boarding ladder) on the hull
const trimGeometry = () => parts(({ add, box, sheer }) => {
  sheer(true);
  const lifeRing = (g) => add(g, (x, y, z) => (Math.floor((Math.atan2(y - g.userData.cy, (g.userData.ax ? z : x) - g.userData.cx) + Math.PI) / (Math.PI / 4)) % 2 ? C.RED : C.WHITE));
  const r1 = new THREE.TorusGeometry(0.14, 0.04, 4, 12).rotateY(Math.PI / 2).translate(BOAT.W + 0.07, 0.3, -1.05); // on the starboard side, between fenders
  r1.userData = { cy: 0.3, cx: -1.05, ax: true }; lifeRing(r1);
  const r2 = new THREE.TorusGeometry(0.14, 0.04, 4, 12).translate(0.55, D + 0.12, BOAT.STERN - 0.02);
  r2.userData = { cy: D + 0.12, cx: 0.55, ax: false }; lifeRing(r2);
  for (const sx of [-1, 1]) for (const z of [-1.8, -0.3, 1.0]) {
    const x = sx * (BOAT.W + 0.05);
    add(new THREE.TorusGeometry(0.09, 0.045, 4, 10).rotateY(Math.PI / 2).translate(x, 0.12, z), C.TYRE);
    box(0.015, 0.32, 0.015, C.ROPE, x, 0.36, z);
  }
  const lx = -(BOAT.W + 0.04); // ladder over the port quarter
  for (const dz of [-0.13, 0.13]) box(0.035, 0.75, 0.035, C.POST, lx, 0.25, -2.5 + dz);
  for (let k = 0; k < 4; k++) box(0.03, 0.03, 0.26, C.CAP, lx, -0.05 + k * 0.17, -2.5);
});
// fishing gear: a rod over the starboard quarter, a net drying on the rail, a bucket with a catch
const gearGeometry = () => parts(({ add, box }) => {
  const rod = new THREE.BoxGeometry(0.025, 0.025, 1.7).translate(0, 0, 0.85).rotateX(-0.75).rotateY(2.3).translate(1.0, D + 0.25, -2.55);
  add(rod, C.POST);
  box(0.06, 0.06, 0.06, C.IRON, 1.05, D + 0.35, -2.6);
  box(0.008, 1.2, 0.008, C.WHITE, 2.05, D + 0.25, -3.4); // the line, down to the water
  for (let i = 0; i < 6; i++) box(0.02, 0.5, 0.012, C.ROPE, 1.1 + 0.02, D + 0.0, 1.0 + i * 0.1); // a net hanging over the rail
  for (let j = 0; j < 4; j++) box(0.02, 0.012, 0.55, C.ROPE, 1.1 + 0.02, D - 0.2 + j * 0.13, 1.25);
  box(0.06, 0.07, 0.62, C.ROPE, 1.06, D + 0.24, 1.25);
  add(new THREE.CylinderGeometry(0.11, 0.09, 0.18, 8).translate(0.86, D + 0.09, 1.55), 0x5a7a8a); // bucket
  box(0.05, 0.12, 0.16, 0xf08a3c, 0.84, D + 0.21, 1.55, 0.4, 0, 0.5);
  box(0.05, 0.1, 0.14, 0xa9bccd, 0.9, D + 0.21, 1.52, -0.3, 0, -0.4);
});
// the engine's stove-pipe chimney on the cabin roof (front right), taller with each level
const chimneyGeometry = (lvl, cab) => parts(({ add, box }) => {
  const h = 0.16 + lvl * 0.14, x = cab.x + 0.4, z = cab.z + cab.d / 2 - 0.4, y = D + cab.h + 0.15;
  add(new THREE.CylinderGeometry(0.065, 0.075, h, 8).translate(x, y + h / 2, z), C.IRON);
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8).translate(x, y + h * 0.6, z), C.BRASS);
  add(new THREE.CylinderGeometry(0.1, 0.07, 0.05, 8).translate(x, y + h + 0.02, z), C.IRON);
  if (lvl >= 3) box(0.16, 0.03, 0.16, C.BRASS, x, y + h + 0.06, z);
});

const shared = (key, build) => (geoCache[key] ??= build());
/**
 * The shapes that make up one variant of a part, for drawing its icon: [{ geo, tint, pos? }], tint = which look colour
 * tints it (null = fixed colours). kind: 'hull', 'cabin', 'roof', 'top', 'mast' or 'prop'; `look` gives the context
 * (the cabin a roof sits on, where the mast stands).
 */
export function partPieces(kind, v, look) {
  const L = look ?? defaultLook();
  if (kind === 'hull') return [{ geo: shared('base', baseGeometry) }, { geo: shared('hullPaint', hullPaintGeometry), tint: 'hull' }];
  if (kind === 'prop') { const g = propGeometry(v); return g ? [{ geo: g }, ...(v === 6 ? [{ geo: propGlowGeometry(), glow: true }] : [])] : []; }
  const ci = kind === 'cabin' ? v : L.p[0] === 2 ? 0 : L.p[0], cab = CABINS[ci];
  if (!cab.w) return [];
  const lay = layoutOf({ ...L, p: kind === 'cabin' ? [ci, 0, 2, 2] : kind === 'roof' ? [ci, v, 2, 2] : kind === 'top' ? [ci, L.p[1] === 2 ? 0 : L.p[1], v, 2] : [L.p[0], L.p[1], L.p[2], v] });
  const body = [{ geo: shared(`cabTrim${ci}`, () => cabinTrimGeometry(cab)) }, { geo: shared(`cabWalls${ci}`, () => cabinWallsGeometry(cab)), tint: 'cabin' }];
  if (kind === 'cabin') return [...body, { geo: shared(`roof${ci}.0`, () => roofGeometry(cab, 0)), tint: 'roof' }];
  if (kind === 'roof') return [...body, { geo: shared(`roof${ci}.${v}`, () => roofGeometry(cab, v)), tint: v === 2 ? 'canvas' : 'roof' }];
  if (kind === 'top') {
    const wh = lay.wh;
    if (v === 2) return [];
    return v === 0 ? [{ geo: shared(`topWalls${ci}`, () => topWallsGeometry(wh)), tint: 'cabin' }, { geo: shared(`topRoof${ci}`, () => topRoofGeometry(wh)), tint: 'roof' }, { geo: shared(`topTrim${ci}.0`, () => topTrimGeometry(wh, 0)) }]
      : [{ geo: shared(`topTrim${ci}.1`, () => topTrimGeometry(wh, 1)) }];
  }
  if (kind === 'mast') {
    const mast = lay.mast;
    if (!mast) return [];
    const mk = `${mast.x},${mast.y0},${mast.y1},${mast.z}`;
    return [{ geo: shared(`mast${mk}.${v}`, () => mastGeometry(mast, v === 1)) },
      v === 1 ? { geo: shared(`sail${mk}`, () => sailGeometry(mast)), tint: 'canvas' } : { geo: flagGeometry(), tint: 'canvas', pos: [mast.x, mast.y1 - 0.25, mast.z], flag: true }];
  }
  return [];
}
/** The boat's hull as one geometry (shared): the hover highlight's outline. */
export function boatGeometry() {
  return shared('outline', () => {
    const g = mergeGeometries([shared('base', baseGeometry), shared('hullPaint', hullPaintGeometry)]);
    g.userData.shared = true;
    return g;
  });
}
function glowGeometry() {
  return shared('glow', () => {
    const g = mergeGeometries(LANTERNS.map(([x, z]) => { const b = new THREE.BoxGeometry(0.11, 0.14, 0.11).translate(x, D + 0.71, z); b.deleteAttribute('uv'); return b; }));
    g.userData.shared = true;
    return g;
  });
}
function flagGeometry() {
  // a little pennant: hoist at x = 0, flying toward +x, two segments so it can ripple (tinted by the canvas colour)
  return shared('flag', () => { const g = paint(new THREE.BoxGeometry(0.62, 0.34, 0.02, 4, 1, 1).translate(0.31, 0, 0), (x, y) => (y > 0.1 ? 1.1 : 0.95)); g.userData.shared = true; return g; });
}

// the name plate: the boat's name on a brass plate, drawn into a small texture
function nameTexture(name) {
  const cv = document.createElement('canvas');
  cv.width = 160; cv.height = 36;
  const g = cv.getContext('2d');
  g.fillStyle = '#4a2c18'; g.fillRect(0, 0, 160, 36);
  g.fillStyle = '#e0b040'; g.fillRect(3, 3, 154, 30);
  g.fillStyle = '#f6d47a'; g.fillRect(3, 3, 154, 4);
  g.fillStyle = '#b08028'; g.fillRect(3, 29, 154, 4);
  g.fillStyle = '#3a2414';
  g.font = `bold ${name.length > 11 ? 16 : 20}px "Pixelify Sans", monospace`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name.toUpperCase(), 80, 19);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- the wake: foam left on the water ----------
// Pooled flat squares on the surface (additive, so they fade by darkening). A moving boat sheds a V of
// foam from both sides of the bow that spreads outward, and a churned trail from the stern that lingers.
const NET_DELAY = 0.12; // other players' boats are drawn this far behind the driver (s), to interpolate between updates
const WAKE_MAX = 520;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
class Wake {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, WAKE_MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7; // after the water
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < WAKE_MAX; i++) { this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); this.mesh.setColorAt(i, _c.setRGB(0, 0, 0)); }
    this.parts = Array.from({ length: WAKE_MAX }, () => ({ life: 1, dur: 1 }));
    this.next = 0;
    scene.add(this.mesh);
  }
  spawn(x, z, vx, vz, size, grow, dur, bright, yaw) {
    const p = this.parts[this.next];
    Object.assign(p, { x, z, vx, vz, size, grow, dur, bright, yaw, life: 0 });
    this.next = (this.next + 1) % WAKE_MAX;
  }
  /** Shed foam from a boat moving at its shown speed (b.vis). */
  emit(b, dt) {
    const v = b.vis ?? 0;
    if (v < 0.25) return;
    const sn = Math.sin(b.syaw), cs = Math.cos(b.syaw);
    const at = (lx, lz) => [b.sx + lx * cs + lz * sn, b.sz - lx * sn + lz * cs];
    const dir = Math.sign(b.visFwd ?? 1) || 1;
    b.wakeAcc = (b.wakeAcc ?? 0) + v * dt * 8; // foam per tile travelled
    while (b.wakeAcc >= 1) {
      b.wakeAcc -= 1;
      const k = Math.min(1, v / BOAT.MAX_SPEED);
      // bow waves: from both sides of the bow, pushed outward and falling behind
      for (const side of [-1, 1]) {
        const [x, z] = at(side * (0.75 + Math.random() * 0.2), dir > 0 ? 1.9 + Math.random() * 0.5 : -2.8);
        const out = 0.5 + 1.1 * k;
        this.spawn(x, z, (side * cs) * out - sn * v * 0.15 * dir, (-side * sn) * out - cs * v * 0.15 * dir, 0.08 + Math.random() * 0.07, 0.22, 1.3 + Math.random() * 0.6, 0.22 + 0.2 * k, b.syaw + (Math.random() - 0.5) * 0.6);
      }
      // stern trail: churned water left behind, spreading slowly
      const [x, z] = at((Math.random() - 0.5) * 1.1, dir > 0 ? BOAT.STERN - 0.15 : BOAT.TIP);
      this.spawn(x, z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.1, 0.3, 2 + Math.random() * 1.2, 0.18 + 0.22 * k, b.syaw + (Math.random() - 0.5) * 0.8);
    }
  }
  update(dt, t) {
    const m = this.mesh, y = SEA + 0.05 + Math.sin(t * 0.8) * 0.03; // ride on the water plane's gentle swell
    let any = false;
    this.parts.forEach((p, i) => {
      if (p.life >= p.dur) return;
      any = true;
      p.life = Math.min(p.dur, p.life + dt);
      const drag = Math.exp(-dt * 1.6);
      p.vx *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.z += p.vz * dt;
      const k = p.life / p.dur, done = p.life >= p.dur;
      const s = done ? 0 : p.size + p.grow * k;
      const fade = done ? 0 : p.bright * (k < 0.1 ? k / 0.1 : (1 - k) ** 1.6);
      // snap to a 1/8 grid so the foam stays crisp and pixel-like as it drifts
      m.setMatrixAt(i, _m.compose(_p.set(Math.round(p.x * 8) / 8, y, Math.round(p.z * 8) / 8), _q.setFromEuler(_e.set(0, p.yaw, 0)), _s.set(s, 1, s)));
      m.setColorAt(i, _c.setRGB(fade * 0.9, fade * 0.97, fade));
    });
    if (any) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}

// ---------- boats in a scene ----------
const MAT = {};
// the cabin, roof and cargo open up around you (like tree canopies) when they'd hide you; the deck and rail never do
const SEE = { minY: SEA + BOAT.DECK + 0.32 };
const materials = () => {
  MAT.base ??= seeThroughMaterial({ vertexColors: true }, SEE);
  MAT.glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.05, 0.32) });
  MAT.bulb ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.7) });
  MAT.flagTime ??= { value: 0 };
  return MAT;
};
// a waving flag in a colour: the canvas colour of one boat
function flagMaterial(color) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, color });
  m.onBeforeCompile = (sh) => { // ripple: more toward the free end
    sh.uniforms.uTime = materials().flagTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(uTime * 6.0 - transformed.x * 9.0) * 0.07 * transformed.x;');
  };
  m.customProgramCacheKey = () => 'boatFlag';
  return m;
}

/** What each upgrade does and costs (levels 1..max). Effects: see engineFactor / rudderFactor and applyLook. */
export const UPGRADES = [
  { key: 'engine', name: 'Engine', desc: 'Top speed +15% per level, and a taller chimney', cost: [{ wood: 6, stone: 4 }, { wood: 10, log: 4, stone: 8 }, { wood: 16, log: 8, stone: 14 }] },
  { key: 'rudder', name: 'Rudder', desc: 'Turns 20% quicker per level', cost: [{ wood: 4, pebble: 4 }, { wood: 8, stone: 4 }] },
  { key: 'awning', name: 'Canvas awning', desc: 'Shade over the foredeck, in your canvas colour', cost: [{ stick: 6, leaves: 12 }] },
  { key: 'lights', name: 'String lights', desc: 'Warm little lights strung around the deck', cost: [{ stick: 6, wood: 2, berries: 4 }] },
  { key: 'bunting', name: 'Bunting', desc: 'Pennants from the masthead to bow and stern', cost: [{ stick: 4, leaves: 8, berries: 4 }] },
  { key: 'trim', name: 'Life rings & fenders', desc: 'Life rings, tyre fenders and a boarding ladder', cost: [{ wood: 4, log: 2 }] },
  { key: 'gear', name: 'Fishing gear', desc: 'A rod, a net drying on the rail, a bucket of fish', cost: [{ stick: 8, pebble: 2, leaves: 4 }] },
];
export const engineFactor = (b) => 1 + 0.15 * (b?.look?.u[0] ?? 0);
export const rudderFactor = (b) => 1 + 0.2 * (b?.look?.u[1] ?? 0);

/**
 * All boats in a world. Each boat is { id, x, z, yaw } (where it's going: set by the driver or the
 * network) plus { sx, sz, syaw } (where it's shown: eased toward the target, or equal for the local
 * driver), its speed, its look (name, paint, upgrades) and a group in the scene.
 */
export class Boats {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world; // to see how deep the water is under each boat
    this.list = new Map();
    this.wake = new Wake(scene);
  }
  /** Add a boat or move one (and give it a look). `instant` jumps there (the local driver, or a new boat). */
  set(id, x, z, yaw, instant = false, look = undefined) {
    let b = this.list.get(id);
    if (!b) {
      const m = materials();
      const group = new THREE.Group();
      const mesh = (geo, mat, shadows = true) => { const o = new THREE.Mesh(geo ?? undefined, mat); o.visible = !!geo; o.castShadow = shadows; o.receiveShadow = true; group.add(o); return o; };
      // per-boat tinted materials: hull band, cabin, roof, canvas
      const tint = { hull: seeThroughMaterial({ vertexColors: true }, SEE), cabin: seeThroughMaterial({ vertexColors: true }, SEE), roof: seeThroughMaterial({ vertexColors: true }, SEE), canvas: seeThroughMaterial({ vertexColors: true, side: THREE.DoubleSide }, SEE), flag: flagMaterial(0xffffff) };
      const hullM = mesh(shared('base', baseGeometry), m.base);
      const paintM = mesh(shared('hullPaint', hullPaintGeometry), tint.hull);
      // parts swapped by the look (setLook): cabin trim and walls, roof, what's on the roof, mast and sail
      const sw = {
        cabinTrim: mesh(null, m.base), cabinWalls: mesh(null, tint.cabin), roof: mesh(null, tint.roof),
        topWalls: mesh(null, tint.cabin), topRoof: mesh(null, tint.roof), topTrim: mesh(null, m.base),
        mast: mesh(null, m.base), sail: mesh(null, tint.canvas), chimney: mesh(null, m.base),
        buntLine: mesh(null, m.base, false), buntA: mesh(null, tint.canvas, false), buntB: mesh(null, m.base, false),
      };
      mesh(glowGeometry(), m.glow, false);
      const flag = mesh(flagGeometry(), tint.flag);
      const parts = {
        awning: [mesh(shared('awningPoles', awningPolesGeometry), m.base), mesh(shared('awningCanvas', awningCanvasGeometry), tint.canvas)],
        lights: [mesh(shared('lightsWire', lightsWireGeometry), m.base, false), mesh(shared('lightsBulb', lightsBulbGeometry), m.bulb, false)],
        trim: [mesh(shared('trim', trimGeometry), m.base)],
        gear: [mesh(shared('gear', gearGeometry), m.base)],
      };
      // a prop (and a lantern's glowing pane) on each deck spot
      const props = DECK_SLOTS.map((sl) => {
        const o = mesh(null, m.base), g = mesh(null, m.glow, false);
        o.position.set(sl.x, 0, sl.z); g.position.set(sl.x, 0, sl.z);
        return [o, g];
      });
      // edit mode: a faint ring on each empty deck spot, so you can click it to put something there
      const ringGeo = shared('spotRing', () => { const g = new THREE.RingGeometry(0.16, 0.24, 12).rotateX(-Math.PI / 2); g.userData.shared = true; return g; });
      m.ring ??= new THREE.MeshBasicMaterial({ color: 0xfff4d2, transparent: true, opacity: 0.55, depthWrite: false });
      const markers = DECK_SLOTS.map((sl) => { const o = mesh(ringGeo, m.ring, false); o.position.set(sl.x, D + 0.04, sl.z); o.visible = false; o.receiveShadow = false; return o; });
      // which part of the boat each mesh is (edit mode picks parts by clicking them)
      const tag = (o, part, slot) => { o.userData.part = part; if (slot !== undefined) o.userData.slot = slot; };
      tag(hullM, 'hull'); tag(paintM, 'hull');
      tag(sw.cabinTrim, 'cabin'); tag(sw.cabinWalls, 'cabin'); tag(sw.roof, 'roof'); tag(sw.chimney, 'roof');
      tag(sw.topWalls, 'top'); tag(sw.topRoof, 'top'); tag(sw.topTrim, 'top');
      tag(sw.mast, 'mast'); tag(sw.sail, 'mast'); tag(flag, 'mast');
      props.forEach(([o, g], i) => { tag(o, 'slot', i); tag(g, 'slot', i); tag(markers[i], 'slot', i); });
      // name plates on both quarters, on the hull band
      const plateGeo = shared('plate', () => { const g = new THREE.PlaneGeometry(0.62, 0.14); g.userData.shared = true; return g; });
      const plateMat = new THREE.MeshLambertMaterial();
      const plates = [1, -1].map((sx) => {
        const p = mesh(plateGeo, plateMat, false);
        p.position.set(sx * (BOAT.W + 0.03), 0.3, -1.75);
        p.rotation.y = sx * Math.PI / 2;
        return p;
      });
      this.scene.add(group);
      b = { id, x, z, yaw, sx: x, sz: z, syaw: yaw, speed: 0, group, flag, tint, sw, parts, props, markers, hullM, plates, plateMat, look: null, obs: layoutOf(null).obs, editing: false };
      this.list.set(id, b);
      instant = true;
      if (look === undefined) look = defaultLook();
    }
    // Network updates come about 10 times a second. Estimate the boat's velocity and turn rate from them, so
    // update() can glide it along where it should be by now instead of surging toward each update and stalling.
    const now = performance.now() / 1000, gap = now - (b.netAt ?? -1);
    if (!instant && gap > 0.02 && gap < 1) {
      let dyaw = yaw - b.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const nv = [(x - b.x) / gap, (z - b.z) / gap, dyaw / gap];
      b.nv = b.nv ? b.nv.map((v, i) => v + (nv[i] - v) * 0.6) : nv; // a little smoothing against network jitter
    } else b.nv = [0, 0, 0];
    b.netAt = now;
    Object.assign(b, { x, z, yaw });
    if (instant) Object.assign(b, { sx: x, sz: z, syaw: yaw });
    if (look !== undefined) this.setLook(id, look);
    return b;
  }
  /** Apply a look (name, paint, upgrades) to a boat. */
  setLook(id, look) {
    const b = this.list.get(id);
    if (!b) return;
    const L = cleanLook(look), old = b.look;
    b.look = L;
    const col = (i) => BOAT_PALETTE[L.c[i]];
    b.tint.hull.color.setHex(col(0));
    b.tint.cabin.color.setHex(col(1));
    b.tint.roof.color.setHex(col(2));
    b.tint.canvas.color.setHex(col(3));
    b.tint.flag.color.setHex(col(3));
    UPGRADE_KEYS.forEach((key, i) => { if (b.parts[key]) for (const o of b.parts[key]) o.visible = L.u[i] > 0; });
    // the parts and props this look chooses (each shape built once, shared by every boat using it)
    const lay = layoutOf(L), { cab, wh, mast } = lay, sw = b.sw;
    const put = (o, geo) => { if (geo) o.geometry = geo; o.visible = !!geo; };
    const ci = L.p[0];
    put(sw.cabinTrim, cab && shared(`cabTrim${ci}`, () => cabinTrimGeometry(cab)));
    put(sw.cabinWalls, cab && shared(`cabWalls${ci}`, () => cabinWallsGeometry(cab)));
    put(sw.roof, cab && shared(`roof${ci}.${lay.roof}`, () => roofGeometry(cab, lay.roof)));
    sw.roof.material = lay.roof === 2 ? b.tint.canvas : b.tint.roof; // the arched roof is canvas
    put(sw.topWalls, lay.top === 0 && shared(`topWalls${ci}`, () => topWallsGeometry(wh)));
    put(sw.topRoof, lay.top === 0 && shared(`topRoof${ci}`, () => topRoofGeometry(wh)));
    put(sw.topTrim, lay.top < 2 && shared(`topTrim${ci}.${lay.top}`, () => topTrimGeometry(wh, lay.top)));
    const mk = mast && `${mast.x},${mast.y0},${mast.y1},${mast.z}`;
    put(sw.mast, mast && shared(`mast${mk}.${lay.mastV}`, () => mastGeometry(mast, lay.mastV === 1)));
    put(sw.sail, mast && lay.mastV === 1 && shared(`sail${mk}`, () => sailGeometry(mast)));
    b.flag.visible = !!mast;
    if (mast) b.flag.position.set(mast.x, mast.y1 - 0.25, mast.z);
    const top = mast && [mast.x, mast.y1 - 0.05, mast.z], showBunt = !!mast && L.u[4] > 0;
    put(sw.buntLine, showBunt && shared(`buntLine${mk}`, () => buntingLineGeometry(top)));
    put(sw.buntA, showBunt && shared(`buntA${mk}`, () => pennants(top, 1, 1.0)));
    put(sw.buntB, showBunt && shared(`buntB${mk}`, () => pennants(top, 0, C.WHITE)));
    const lvl = L.u[0]; // the engine's chimney stands on the cabin roof (not on canvas, and not without a cabin)
    put(sw.chimney, lvl > 0 && cab && lay.roof !== 2 && shared(`chimney${ci}.${lvl}`, () => chimneyGeometry(lvl, cab)));
    b.props.forEach(([o, g], i) => { const t = propAt(L, i); put(o, propGeometry(t)); put(g, t === 6 && propGlowGeometry()); b.markers[i].visible = b.editing && !t; });
    b.obs = lay.obs; // what riders walk around
    if (!old || old.n !== L.n) {
      b.plateMat.map?.dispose();
      b.plateMat.map = L.n ? nameTexture(L.n) : null;
      b.plateMat.needsUpdate = true;
      for (const p of b.plates) p.visible = !!L.n;
    }
  }
  /**
   * A timestamped pose from the boat's driver (t = the driver's clock in ms). Other players' screens replay the
   * boat's path NET_DELAY behind, interpolating between these, so it glides as smoothly as it does for the driver.
   */
  sample(id, x, z, yaw, t, h = null, l = null) {
    const b = this.list.get(id);
    if (!b) return;
    const ts = t / 1000, o = performance.now() / 1000 - ts, buf = (b.buf ??= []), last = buf[buf.length - 1];
    if (last && ts <= last.t) { if (ts < last.t - 5) buf.length = 0; else return; } // late or repeated (a restart resets)
    // clock offset: the quickest delivery seen, drifting up slowly so one lucky packet doesn't skew it for good
    // and backing off faster when samples keep arriving later than the playback delay allows (a laggy connection)
    b.off = b.off == null || o < b.off ? o : b.off + (o - b.off) * (o - b.off > NET_DELAY * 0.8 ? 0.15 : 0.02);
    let y = yaw;
    if (buf.length) { const p = buf[buf.length - 1].yaw; y = p + Math.atan2(Math.sin(yaw - p), Math.cos(yaw - p)); } // unwrapped
    buf.push({ t: ts, x, z, yaw: y, h, l }); // h, l: the driver's heel and bow lift (null from older clients)
    if (buf.length > 24) buf.shift();
  }
  // where a networked boat is at local time `now`, from its samples (null without any)
  netPose(b, now) {
    const buf = b.buf;
    if (!buf?.length) return null;
    const rt = now - b.off - NET_DELAY;
    if (rt <= buf[0].t) return buf[0];
    for (let i = buf.length - 1; i > 0; i--) {
      const a = buf[i - 1], c = buf[i];
      if (rt >= a.t && rt <= c.t) { const f = (rt - a.t) / Math.max(1e-4, c.t - a.t); return { x: a.x + (c.x - a.x) * f, z: a.z + (c.z - a.z) * f, yaw: a.yaw + (c.yaw - a.yaw) * f, h: a.h == null || c.h == null ? c.h : a.h + (c.h - a.h) * f, l: a.l == null || c.l == null ? c.l : a.l + (c.l - a.l) * f }; }
    }
    // past the newest sample (a late packet): carry on along the last motion briefly, then hold
    const c = buf[buf.length - 1], a = buf[buf.length - 2];
    if (!a) return c;
    const f = Math.min(rt - c.t, 0.25) / Math.max(1e-3, c.t - a.t);
    return { x: c.x + (c.x - a.x) * f, z: c.z + (c.z - a.z) * f, yaw: c.yaw + (c.yaw - a.yaw) * f, h: c.h, l: c.l };
  }
  /** Edit mode on a boat: shows a ring on each empty deck spot. */
  setEditing(id, on) {
    const b = this.list.get(id);
    if (!b) return;
    b.editing = on;
    b.markers.forEach((o, i) => { o.visible = on && !propAt(b.look, i); });
  }
  /** The mesh that stands for a part when it's outlined (hovered in edit mode). */
  partMesh(b, part, slot) {
    const sw = b.sw;
    if (part === 'hull') return b.hullM;
    if (part === 'cabin') return sw.cabinWalls.visible ? sw.cabinWalls : null;
    if (part === 'roof') return sw.roof.visible ? sw.roof : null;
    if (part === 'top') return sw.topWalls.visible ? sw.topWalls : sw.topTrim.visible ? sw.topTrim : null;
    if (part === 'mast') return sw.sail.visible ? sw.sail : sw.mast.visible ? sw.mast : null;
    if (part === 'slot') return b.props[slot][0].visible ? b.props[slot][0] : b.markers[slot];
    return null;
  }
  remove(id) {
    const b = this.list.get(id);
    if (!b) return;
    this.scene.remove(b.group);
    for (const m of Object.values(b.tint)) m.dispose();
    b.plateMat.map?.dispose();
    b.plateMat.dispose();
    this.list.delete(id);
  }
  /** Ease shown poses toward their targets (except `drivenId`, which the local player sets directly), and bob. */
  update(dt, t, drivenId = null) {
    materials().flagTime.value = t;
    const k = 1 - Math.exp(-dt * 8);
    for (const b of this.list.values()) {
      if (b.id === drivenId && b.buf) { b.buf = null; b.off = null; } // we're sailing it now: forget the old network path
      const np = b.id !== drivenId ? this.netPose(b, performance.now() / 1000) : null;
      if (np) {
        // replaying the driver's timestamped path: follow it closely (a little easing hides small corrections)
        const kk = 1 - Math.exp(-dt * 25);
        b.sx += (np.x - b.sx) * kk;
        b.sz += (np.z - b.sz) * kk;
        const d = Math.atan2(Math.sin(np.yaw - b.syaw), Math.cos(np.yaw - b.syaw));
        b.syaw += d * kk;
      } else if (b.id !== drivenId) {
        // aim for where it should be by now (last update + velocity × time since, for up to 0.3 s), then ease there
        // (no news for longer, e.g. the driver left: ease back to the last known spot by 0.6 s)
        const since = b.nv ? performance.now() / 1000 - b.netAt : 0, age = since < 0.3 ? since : Math.max(0, 0.6 - since), nv = b.nv ?? [0, 0, 0];
        b.sx += (b.x + nv[0] * age - b.sx) * k;
        b.sz += (b.z + nv[1] * age - b.sz) * k;
        let d = b.yaw + nv[2] * age - b.syaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        b.syaw += d * k;
      }
      // how it's moving on screen (works for every boat, driven here or over the network)
      const idt = 1 / Math.max(dt, 1e-3);
      // a jump of more than a couple of tiles in one frame is a teleport (or a late join): no speed, no wake
      if (Math.hypot(b.sx - (b.px ?? b.sx), b.sz - (b.pz ?? b.sz)) > 2.5) { b.px = b.sx; b.pz = b.sz; b.vis = 0; }
      const vx = ((b.sx - (b.px ?? b.sx)) * idt), vz = ((b.sz - (b.pz ?? b.sz)) * idt);
      let dy = b.syaw - (b.pyaw ?? b.syaw);
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const ease = 1 - Math.exp(-dt * 4);
      const fwd = vx * Math.sin(b.syaw) + vz * Math.cos(b.syaw);
      b.vis = (b.vis ?? 0) + (Math.hypot(vx, vz) - (b.vis ?? 0)) * ease;
      b.visTurn = (b.visTurn ?? 0) + (dy * idt - (b.visTurn ?? 0)) * ease;
      b.visAcc = (b.visAcc ?? 0) + ((fwd - (b.visFwd ?? fwd)) * idt - (b.visAcc ?? 0)) * (1 - Math.exp(-dt * 1.5));
      b.visFwd = fwd;
      b.px = b.sx; b.pz = b.sz; b.pyaw = b.syaw;
      // bob on the waves, lean out of turns, lift the bow when picking up speed and ride a little bow-up
      const g = b.group;
      // over shallow sand the boat rides up so its keel (0.62 under the waterline) clears the seabed under its bow,
      // middle and stern; it eases back down in deeper water. Riders follow through deckY.
      if (this.world) {
        const sn = Math.sin(b.syaw), cs = Math.cos(b.syaw);
        let bed = -Infinity;
        for (const lz of [2.6, 0, -2.6]) bed = Math.max(bed, this.world.H(toCell(b.sx + lz * sn), toCell(b.sz + lz * cs)));
        const want = Math.min(KEEL_DEPTH, Math.max(0, bed + KEEL_DEPTH + 0.04 - SEA));
        b.lift = (b.lift ?? want) + (want - (b.lift ?? want)) * (1 - Math.exp(-dt * 3));
      }
      g.position.set(b.sx, SEA + bobY(b, t) + (b.lift ?? 0), b.sz);
      // Heel out of turns and lift the bow with speed. Worked out from how the boat moves on this screen, which is
      // smooth for its driver; everyone else uses the driver's values from the network (np.h / np.l), because
      // deriving them from a replayed path (a derivative of a derivative) twitched.
      let heel = THREE.MathUtils.clamp(b.visTurn * Math.abs(b.visFwd) * 0.035, -0.12, 0.12);
      let lean = THREE.MathUtils.clamp(b.visAcc * 0.03 + b.vis * 0.006, -0.09, 0.09);
      if (np && np.h != null) { heel = np.h; lean = np.l ?? lean; }
      b.heel = heel; b.lean = lean; // sent with the driver's boat updates
      const roll = Math.sin(t * 1.1 + b.id % 3) * 0.028 * (1 + b.vis * 0.15) - heel;
      const pitch = Math.sin(t * 0.9 + b.id % 5) * 0.018 - lean;
      g.rotation.set(pitch, b.syaw, roll, 'YXZ');
      this.wake.emit(b, dt);
      // the flag streams away from where the boat is heading, a little to the wind side
      b.flag.rotation.y = Math.PI / 2 + Math.sin(t * 0.7 + b.id) * 0.25;
    }
    this.wake.update(dt, t);
  }
  /** The boat whose deck covers world (x, z), or null. */
  at(x, z) {
    for (const b of this.list.values()) { const [lx, lz] = toLocal(b, x, z); if (onDeck(lx, lz)) return b; }
    return null;
  }
  /** [[id, x, z, yaw, look]...] rounded, for saves. */
  listOut() { return [...this.list.values()].map((b) => [b.id, +b.x.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(3), b.look]); }
}
