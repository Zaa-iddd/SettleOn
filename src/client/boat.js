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
import { waveAt, waveEnv, waveClock } from './waves.js';
import { furnitureGeometry, furnitureGlowGeometry } from './world3d.js'; // (a circular import, used only lazily)
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

// The kinds of boat (look.t; boatlook.js HULL_ITEMS has the item that launches each). Each has its own outline
// (half width W, bow curve from BOW0 to TIP, flat stern at STERN), deck height, where the helmsman stands and the
// wheel or oars are, and handling: top speed, turn rate, how fast it picks up speed and how long it glides.
// The cabin boat (0) is the original and keeps every swappable part and upgrade; the others are fixed models.
export const HULLS = [
  { key: 'cabin', name: 'Cabin boat', W: BOAT.W, BOW0: BOAT.BOW0, TIP: BOAT.TIP, STERN: BOAT.STERN, DECK: BOAT.DECK, HELM: BOAT.HELM, WHEEL: [0, -1.95, 0.66],
    MAX_SPEED: BOAT.MAX_SPEED, TURN: BOAT.TURN, ACCEL: BOAT.ACCEL, GLIDE: BOAT.GLIDE, KEEL_DEPTH: 0.62 },
  // small and cheap: you stand at the oars in the middle; slow, but it spins on the spot
  { key: 'rowboat', name: 'Rowboat', W: 0.52, BOW0: 0.15, TIP: 1.3, STERN: -1.1, DECK: 0.18, HELM: [0, -0.12], WHEEL: [0, 0.14, 0.28],
    MAX_SPEED: 3.4, TURN: 1.5, ACCEL: 1.4, GLIDE: 0.8, KEEL_DEPTH: 0.3,
    obs: { rects: [], circles: [] } },
  // big and fast under full canvas, slow to turn and to get going, and it carries its way a long time. The wheel stands
  // on top of the raised stern castle (the quarterdeck), up a flight of stairs; two masts, a hatch grating and a few
  // barrels on the main deck. WHEEL's height is above the main deck (so it includes the castle).
  { key: 'pirate', name: 'Pirate ship', W: 1.45, BOW0: 1.3, TIP: 4.7, STERN: -3.6, DECK: 0.6, HELM: [0, -2.85], WHEEL: [0, -2.42, 0.92 + 0.68],
    MAX_SPEED: 7.4, TURN: 0.42, ACCEL: 0.6, GLIDE: 0.3, KEEL_DEPTH: 0.85 },
];
// The pirate ship's layout (HULLS 2): the stern castle (from the stern to CASTLE, CASTLE_H tall; its top deck TOP above the
// main deck), the stairs up to it (starboard, STAIR_X0..STAIR_X1 across, rising from CASTLE + STAIR_LEN aft to CASTLE),
// the gunports along both sides, the masts ([bottom, top, width] of each square sail above the deck; nest = the crow's
// nest) and barrels.
const PIRATE = { CASTLE: -2.2, CASTLE_H: 0.85, TOP: 0.92, STAIR_X0: 0.55, STAIR_X1: 1.32, STAIR_LEN: 1.0, STEPS: 5, PORTS: [-1.2, -0.2, 0.8],
  // courses wider than the hull (as on a real square-rigger), topsails, and topgallants up top
  // Each sail is [bottom, top, width at the foot, width at the head (default: the same)]. On the main and fore masts
  // the course and topsail are one big sail (at the user's request), narrowing a little toward the head, with the
  // topgallant above it.
  MASTS: [{ z: -0.25, top: 6.2, sails: [[1.15, 4.25, 3.5, 2.85], [4.45, 5.35, 2.0]], nest: 5.65 },
    { z: 2.1, top: 5.4, sails: [[1.15, 3.85, 3.05, 2.5], [4.05, 4.85, 1.8]], pennant: 0x2c4a9a },
    // the mizzen, stepped on the quarterdeck behind the helm (base: its foot above the main deck), after the user's
    // galleon references: a big triangular lateen sail on a long slanting yard that reaches out past the stern, a
    // fighting top (topAt) and a small square topsail above it. lateen: [height above the main deck, z from the mast]
    // of its tack (forward, low, clear of the helmsman's head and the wheel), peak (aft, high) and clew (aft, low, just
    // past the taffrail); x: how far to starboard of the mast it hangs
    { z: -3.32, base: 0.92, top: 5.0, topAt: 3.45, sails: [[3.65, 4.45, 1.3, 1.1]], pennant: 0xb0463a,
      lateen: { tack: [2.05, 0.95], peak: [3.95, -1.25], clew: [2.15, -0.45], x: 0.12 } }],
  TAFF: 0.42 }; // TAFF: the taffrail's height above the quarterdeck (its middle rises 0.22 more)
HULLS[2].obs = {
  rects: [[-0.14, 0.14, -2.6, -2.4]], // the wheel post (on the quarterdeck)
  circles: PIRATE.MASTS.map((m) => [0, m.z, 0.12]),
};
// The pirate ship's deck spots for props (look.d, the same props as the cabin boat's, PROPS), on the main deck, clear of
// the stairs and the hatch, so the deck stays connected with the biggest prop in every spot (checked by a flood fill).
export const PIRATE_SLOTS = [
  { name: 'Port quarter', x: -0.8, z: -1.5, maxR: 0.3 }, { name: 'Port waist', x: -0.85, z: 0.95, maxR: 0.3 }, { name: 'Starboard waist', x: 0.85, z: 1.05, maxR: 0.3 },
  { name: 'Starboard bow', x: 0.7, z: 2.75, maxR: 0.3 }, { name: 'Port bow', x: -0.62, z: 3.05, maxR: 0.3 }, { name: 'Bow tip', x: 0, z: 3.75, maxR: 0.26 },
];
/** The deck spots of a look's kind of boat (the cabin boat's or the pirate ship's). */
export const slotsOf = (look) => (look?.t === 2 ? PIRATE_SLOTS : DECK_SLOTS);
// The pirate ship's swappable parts (look.p: figurehead, sail pattern, flag, stern lanterns), chosen in edit mode
export const PIRATE_PARTS = { figure: ['Gold scroll', 'Lion', 'None'], sails: ['Plain', 'Striped', 'Skull emblem'], flag: ['Skull & bones', 'Crossed cutlasses', 'Red flag'], lanterns: ['Three lanterns', 'One big lantern', 'None'] };
export const PIRATE_PART_INDEX = { figure: 0, mast: 1, flag: 2, lanterns: 3 }; // edit mode's part → look.p index
// Deck levels: how far above the main deck the floor is at (lx, lz). The quarterdeck is TOP up; the stairs ramp up to it.
// A hull with a floor() has more than one level: riders can only walk where it changes gently (canStep), so the castle's
// front wall blocks and the stairs are the way up. deckY adds it.
HULLS[2].floor = (lx, lz) => {
  const P = PIRATE;
  if (lz <= P.CASTLE) return P.TOP;
  if (lx >= P.STAIR_X0 && lz < P.CASTLE + P.STAIR_LEN) return P.TOP * (1 - (lz - P.CASTLE) / P.STAIR_LEN);
  return 0;
};
/**
 * Can a rider walk from (ox, oz) to (nx, nz) on hull hl's levels? The floor there (and a body's width further on, so you
 * stop at a wall instead of leaning into it) must be within a step of the floor you're on.
 */
export function canStep(hl, ox, oz, nx, nz) {
  if (!hl.floor) return true;
  const f0 = hl.floor(ox, oz), d = Math.hypot(nx - ox, nz - oz) || 1;
  const ax = nx + (nx - ox) / d * BOAT.RIDER_R, az = nz + (nz - oz) / d * BOAT.RIDER_R;
  return Math.abs(hl.floor(nx, nz) - f0) < 0.3 && Math.abs(hl.floor(ax, az) - f0) < 0.3;
}
/** Half width of the hull at local z (negative outside the hull). The bow is an elliptical curve. */
export function halfW(z, hl = HULLS[0]) {
  const { W, BOW0, TIP, STERN } = hl;
  if (z < STERN || z > TIP) return -1;
  if (z <= BOW0) return W;
  const t = (z - BOW0) / (TIP - BOW0);
  return W * Math.sqrt(Math.max(0, 1 - t * t));
}

// What blocks walking on a boat's deck depends on its look (the cabin, a mast stepped on deck, props): `obs` =
// { rects: [x0, x1, z0, z1][], circles: [x, z, r][] } from layoutOf(look).obs (b.obs for a boat).
/** Can a rider stand at deck position (lx, lz) on a boat whose obstacles are `obs`? */
export function walkable(lx, lz, r = BOAT.RIDER_R, obs = layoutOf(null).obs, hl = HULLS[0]) {
  if (lz < hl.STERN + 0.32 || Math.abs(lx) > halfW(lz, hl) - 0.22 - r) return false;
  for (const [x0, x1, z0, z1] of obs.rects) if (lx > x0 - r && lx < x1 + r && lz > z0 - r && lz < z1 + r) return false;
  for (const [x, z, cr] of obs.circles) if ((lx - x) ** 2 + (lz - z) ** 2 < (cr + r) ** 2) return false;
  return true;
}
/** Is (lx, lz) over the deck at all (inside the rail)? */
export const onDeck = (lx, lz, hl = HULLS[0]) => lz >= hl.STERN + 0.15 && Math.abs(lx) <= halfW(lz, hl) - 0.12;

/** The nearest walkable deck spot to (lx, lz), searching outward a little, or null. */
export function nearestWalkable(lx, lz, obs = layoutOf(null).obs, hl = HULLS[0]) {
  if (walkable(lx, lz, undefined, obs, hl)) return [lx, lz];
  for (let r = 0.1; r <= 1.2; r += 0.1) {
    for (let a = 0; a < 16; a++) {
      const x = lx + Math.cos(a * Math.PI / 8) * r, z = lz + Math.sin(a * Math.PI / 8) * r;
      if (walkable(x, z, undefined, obs, hl)) return [x, z];
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
// `lift`: how far the boat rides up over shallow sand so its keel clears the seabed (Boats.update); `wH`: how far
// the swell lifts it (waves.js). (lx, lz): a spot on deck, which rises and falls as the boat pitches and rolls
// (`dyx`, `dyz`: height change per unit across and along the deck, set in Boats.update).
export const deckY = (b, t, lx = 0, lz = 0) => SEA + (b.hull ?? HULLS[0]).DECK + (b.hull?.floor?.(lx, lz) ?? 0) + bobY(b, t) + (b.lift ?? 0) + (b.wH ?? 0) + lx * (b.dyx ?? 0) + lz * (b.dyz ?? 0);

// points around the hull that must all be over water (bow tip, sides, stern corners)
HULLS[0].pts = [[0, 3.3], [0.75, 2.6], [-0.75, 2.6], [1.2, 1.0], [-1.2, 1.0], [1.2, -1.0], [-1.2, -1.0], [1.2, -3.0], [-1.2, -3.0], [0, -3.0]];
// Boats against boats: each hull is circles along its keel ([local z, radius]), narrower toward the bow and stern
HULLS[0].circles = [[-2.2, 1.1], [-0.75, 1.2], [0.75, 1.2], [2.2, 0.95]];
// the other hulls get theirs from their outline: points every ≤ 2 tiles down both sides plus the bow and stern,
// and overlapping circles along the keel
for (const hl of HULLS.slice(1)) {
  const { W, BOW0, TIP, STERN } = hl, pts = [[0, TIP], [0, STERN]];
  const zb = BOW0 + (TIP - BOW0) * 0.7;
  pts.push([halfW(zb, hl), zb], [-halfW(zb, hl), zb]);
  const n = Math.max(1, Math.ceil((BOW0 - STERN) / 2));
  for (let i = 0; i <= n; i++) { const z = STERN + (BOW0 - STERN) * (i / n); pts.push([W, z], [-W, z]); }
  hl.pts = pts;
  const m = Math.max(2, Math.ceil((TIP - STERN) / (1.3 * W))), circles = [];
  for (let i = 0; i < m; i++) { const z = STERN + W * 0.8 + (TIP - STERN - W * 1.55) * (i / (m - 1)); circles.push([z, Math.max(halfW(z, hl), W * 0.7)]); }
  hl.circles = circles;
}
for (const hl of HULLS) hl.reach = Math.max(hl.TIP, -hl.STERN) + hl.W; // nothing of the boat is further than this from its middle
// ---------- the cabin boat's size (look.s: length and height levels, set in edit mode) ----------
// A longer boat grows at the bow: everything forward of SPLIT (the foredeck, the bow, its props) moves forward by
// SIZE_LEN, and the hull, rail and deck stretch across the gap (the hull is straight there). A taller boat has
// higher sides: everything above the deck rises by SIZE_H, and the hull's upper planks stretch to meet it.
export const SIZE_LEN = [0, 0.75, 1.5, 2.25, 3]; // extra length (tiles)
export const SIZE_H = [0, 0.2, 0.4, 0.6]; // extra freeboard (deck height)
export const SPLIT = 0.62; // just forward of the plank cabin, behind the awning and the foredeck lanterns
export const sizeOf = (look) => (look && !look.t && look.s ? { E: SIZE_LEN[look.s[0]] ?? 0, H: SIZE_H[look.s[1]] ?? 0 } : { E: 0, H: 0 });
export const zAt = (z, E) => (z > SPLIT ? z + E : z); // a deck position on the original boat → on one E longer
const sizedHulls = new Map();
/** The hull for a look: its kind of boat, at its size (the cabin boat only). */
export function hullOf(look) {
  const base = HULLS[look?.t ?? 0] ?? HULLS[0], { E, H } = sizeOf(look);
  if (!E && !H) return base;
  const key = `${E},${H}`;
  let hl = sizedHulls.get(key);
  if (hl) return hl;
  hl = { ...base, BOW0: base.BOW0 + E, TIP: base.TIP + E, DECK: base.DECK + H, E, H,
    // a longer hull is a little faster (more waterline) and slower to turn
    MAX_SPEED: base.MAX_SPEED * (1 + 0.035 * E), TURN: base.TURN * Math.sqrt(6.3 / (6.3 + E)) };
  hl.pts = base.pts.map(([x, z]) => [x, zAt(z, E)]);
  for (let z = -1.0 + 2; z < 1.0 + E; z += 2) hl.pts.push([hl.W, z], [-hl.W, z]); // the long straight sides, every ≤ 2 tiles
  const n = Math.ceil(E / 1.5); // more keel circles across the gap between the middle two (−0.75 and 0.75 + E)
  hl.circles = [...base.circles.map(([z, r]) => [zAt(z, E), r]), ...Array.from({ length: n }, (_, i) => [-0.75 + (1.5 + E) * (i + 1) / (n + 1), 1.2])];
  hl.reach = Math.max(hl.TIP, -hl.STERN) + hl.W;
  sizedHulls.set(key, hl);
  return hl;
}
// Furniture and decorations placed on a deck (look.f): drawn at DECO_SCALE of their land size; riders walk around
// each one's footprint (decoFoot).
export const DECO_SCALE = 0.6;
// A placed piece's footprint on the deck: its model's real extent at DECO_SCALE, turned r quarter turns, as an
// axis-aligned rectangle [x0, x1, z0, z1] around its spot (so a long thin bench is long and thin, not a big circle)
const footCache = new Map();
export function decoFoot(t, r, lx, lz) {
  const key = t * 4 + (r & 3);
  let f = footCache.get(key);
  if (!f) {
    const g = furnitureGeometry(t);
    if (!g.boundingBox) g.computeBoundingBox();
    const { min, max } = g.boundingBox, a = (r & 3) * Math.PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a));
    const xs = [], zs = [];
    for (const x of [min.x, max.x]) for (const z of [min.z, max.z]) { xs.push((x * c + z * s) * DECO_SCALE); zs.push((-x * s + z * c) * DECO_SCALE); }
    f = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    footCache.set(key, f);
  }
  return [lx + f[0], lx + f[1], lz + f[2], lz + f[3]];
}
/**
 * Is there room for piece t, turned r, at deck (lx, lz)? Its footprint inside the rail, clear of the cabin, the
 * wheel post, props and other pieces (touching is fine). Riders then walk around it (it joins b.obs.rects).
 */
export function decoFits(t, r, lx, lz, obs, hl = HULLS[0]) {
  const [x0, x1, z0, z1] = decoFoot(t, r, lx, lz);
  for (const x of [x0, x1]) for (const z of [z0, z1]) if (z < hl.STERN + 0.12 || Math.abs(x) > halfW(z, hl) - 0.12 || (hl.floor && hl.floor(x, z) !== 0)) return false; // (main deck only)
  for (const [a0, a1, b0, b1] of obs.rects) if (x0 < a1 - 0.01 && x1 > a0 + 0.01 && z0 < b1 - 0.01 && z1 > b0 + 0.01) return false;
  for (const [cx, cz, cr] of obs.circles) { const dx = Math.max(x0 - cx, 0, cx - x1), dz = Math.max(z0 - cz, 0, cz - z1); if (dx * dx + dz * dz < (cr - 0.02) ** 2) return false; }
  return true;
}
const withDeco = (obs, L) => (L.f?.length ? { rects: [...obs.rects, ...L.f.map(([t, x, z, r]) => decoFoot(t, r, x / 100, z / 100))], circles: obs.circles } : obs);
/**
 * The look at length level li and height level hi (the cabin boat): furniture forward of SPLIT moves with the bow.
 * null when a placed piece would no longer fit (a shorter boat with things on its foredeck).
 */
export function resizeLook(look, li, hi) {
  const dE = Math.round((SIZE_LEN[li] - sizeOf(look).E) * 100);
  const nl = { ...look, s: [li, hi], f: look.f.map(([t, x, z, r]) => [t, x, z > SPLIT * 100 ? z + dE : z, r]) };
  const hl = hullOf(nl), obs = layoutOf(nl).obs;
  const ok = nl.f.every(([t, x, z, r], i) => decoFits(t, r, x / 100, z / 100, withDeco(obs, { f: nl.f.filter((_, j) => j !== i) }), hl));
  return ok ? nl : null;
}
/** How many deck spots (on a 0.1 grid) a rider can reach from the helm, given what blocks walking. */
export function deckReach(obs, hl) {
  const G = 0.1, seen = new Set(), q = [[Math.round(hl.HELM[0] / G), Math.round(hl.HELM[1] / G)]];
  const ok = (i, j) => walkable(i * G, j * G, undefined, obs, hl);
  if (!ok(...q[0])) return 0;
  seen.add(q[0].join());
  while (q.length) {
    const [i, j] = q.pop();
    for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { const k = a + ',' + c; if (!seen.has(k) && ok(a, c)) { seen.add(k); q.push([a, c]); } }
  }
  return seen.size;
}
/** Does a boat at (x, z, yaw) float clear of land? Any water will do, sandy shallows included (it rides up over them). */
export function hullClear(world, x, z, yaw, hl = HULLS[0]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const [lx, lz] of hl.pts) {
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    if (world.H(toCell(wx), toCell(wz)) >= SEA) return false;
  }
  return true;
}

/** Where a boat at (x, z, yaw) touches land: the average of its hull points over land, or null (for splashes). */
export function hullContact(world, x, z, yaw, hl = HULLS[0]) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let n = 0, sx = 0, sz = 0;
  for (const [lx, lz] of hl.pts) {
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    if (world.H(toCell(wx), toCell(wz)) >= SEA) { n++; sx += wx; sz += wz; }
  }
  return n ? [sx / n, sz / n] : null;
}

/**
 * The deepest overlap between a boat at (x, z, yaw) and any other boat in `boats` (their drawn poses), or null.
 * Returns { nx, nz } pointing from the other boat toward this one, `depth` (how far they overlap), the contact
 * point (cx, cz) and the other boat.
 */
export function boatHit(boats, selfId, x, z, yaw, hl = HULLS[0]) {
  let best = null;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  for (const o of boats.list.values()) {
    const oh = o.hull ?? HULLS[0];
    if (o.id === selfId || Math.hypot(o.sx - x, o.sz - z) > hl.reach + oh.reach) continue;
    const os = Math.sin(o.syaw), oc = Math.cos(o.syaw);
    for (const [az, ar] of hl.circles) {
      const ax = x + az * s, azz = z + az * c;
      for (const [bz, br] of oh.circles) {
        const bx = o.sx + bz * os, bzz = o.sz + bz * oc;
        const dx = ax - bx, dz = azz - bzz, d = Math.hypot(dx, dz), depth = ar + br - d;
        if (depth > 0 && (!best || depth > best.depth)) {
          const nx = d > 1e-4 ? dx / d : s, nz = d > 1e-4 ? dz / d : c;
          best = { nx, nz, depth, cx: bx + nx * br, cz: bzz + nz * br, other: o };
        }
      }
    }
  }
  return best;
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
function outline(inset, hl = HULLS[0]) {
  // a negative inset grows the outline outward. The ends stay inside the hull's length (out there halfW is −1,
  // which would collapse to duplicate points and break the triangulation of a ring's hole).
  const pts = [], { STERN, TIP } = hl, ins = Math.max(0, inset);
  const z0 = STERN + ins, z1 = TIP - ins * 1.4 - (inset < 0 ? 0.02 : 0);
  const N = 16;
  for (let i = 0; i <= N; i++) { const z = z0 + (z1 - z0) * (i / N); pts.push(new THREE.Vector2(Math.max(0.01, halfW(z, hl) - inset), -z)); }
  for (let i = N; i >= 0; i--) { const z = z0 + (z1 - z0) * (i / N); pts.push(new THREE.Vector2(-Math.max(0.01, halfW(z, hl) - inset), -z)); }
  return pts;
}
// extrude a shape upward from y0 by h (shape x → x, shape y → −z)
function extrudeY(shape, y0, h) {
  return new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
}
const ring = (outer, inner, hl = HULLS[0]) => { const s = new THREE.Shape(outline(outer, hl)); s.holes.push(new THREE.Path(outline(inner, hl))); return s; };
// collect painted pieces and merge them into one geometry
// Pieces are built for the original boat and then fitted to the size being built (DIM, see sizeGeo); pieces
// added after fixed(true) are already placed for that size.
function parts(build) {
  const list = [];
  let sheerOn = false, fixedOn = false;
  const add = (g, color) => { if (!fixedOn) { if (sheerOn) sheerGeo(g); if (DIM.key) sizeGeo(g); } list.push(paint(g, color)); };
  const sheer = (on) => { sheerOn = on; };
  const fixed = (on) => { fixedOn = on; };
  const box = (w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    add(g.translate(x, y, z), color);
  };
  build({ add, box, sheer, fixed });
  const geo = mergeGeometries(list);
  for (const g of list) g.dispose();
  geo.userData.shared = true;
  return geo;
}
const D = BOAT.DECK;
// The size whose geometry is being built (useDims), and where a point of the original boat ends up on it: forward of
// SPLIT it moves E toward the bow; heights rise by H above the deck, stretching over the hull's upper planks.
let DIM = { E: 0, H: 0, key: '' };
function useDims(look) {
  const { E, H } = sizeOf(look);
  DIM = { E, H, key: E || H ? `@${E},${H}` : '' };
}
const RAMP0 = 0.14, RAMP1 = D - 0.06; // the band of the hull sides that stretches (above it everything rises by H)
const mapZ = (z) => zAt(z, DIM.E);
const mapY = (y) => y + DIM.H * Math.min(1, Math.max(0, (y - RAMP0) / (RAMP1 - RAMP0)));
// Fit one piece to the size: a small piece moves as a whole (so nails, posts, windows and shingles keep their shape);
// one reaching across the gap (planks, the rail, the hull) stretches vertex by vertex. userData.rigid: always whole.
function sizeGeo(g) {
  const p = g.attributes.position;
  let z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), z = p.getZ(i); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  // (only pieces reaching well across SPLIT stretch: a roof shingle just poking past it stays whole)
  const rz = g.userData.rigid || !(z0 < SPLIT - 0.15 && z1 > SPLIT + 0.15), ry = g.userData.rigid || y1 - y0 < 0.12;
  const cz = (z0 + z1) / 2, cy = (y0 + y1) / 2, dz = mapZ(cz) - cz, dy = mapY(cy) - cy;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, p.getX(i), ry ? y + dy : mapY(y), rz ? z + dz : mapZ(z));
  }
  return g;
}
const LANTERNS = [[1.12, -1.6], [-1.12, -1.6], [1.12, 0.9], [-1.12, 0.9]];
const KEEL_DEPTH = 0.62; // how far the keel reaches under the waterline
// The sheer: the hull's top line sweeps up toward the bow (and a little at the stern), like a real boat's.
// Only the hull sides, rail and what's fixed to them follow it (sheerGeo); the deck stays flat to walk on.
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let SH = HULLS[0]; // the hull whose geometry is being built (the sheer scales with it)
export const sheerAt = (z, hl = SH) => (hl.W / BOAT.W) * (0.3 * Math.pow(sstep(hl.BOW0 * 0.3, hl.TIP, z), 1.3) + 0.12 * sstep(hl.STERN * 0.43, hl.STERN, z));
const sheerW = (y) => Math.min(1, Math.max(0, (y + 0.12) / (SH.DECK + 0.15))); // waterline 0 → rail 1, so the planks stretch smoothly
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
  { name: 'Rope coil', r: 0 }, { name: 'Potted plant', r: 0.2 }, { name: 'Lantern', r: 0.1 }, { name: 'Cannon', r: 0.28 },
];
// spots on deck that can hold a prop, chosen so no combination cuts the deck in two (checked by a flood fill).
// maxR: the biggest prop a spot takes; the stern spots flank the helm, and big props in both boxed the helmsman in.
export const DECK_SLOTS = [
  { name: 'Port foredeck', x: -0.6, z: 1.5, maxR: 0.3 }, { name: 'Port bow', x: -0.42, z: 2.15, maxR: 0.3 }, { name: 'Starboard bow', x: 0.42, z: 2.55, maxR: 0.3 },
  { name: 'Bow tip', x: 0, z: 2.95, maxR: 0.3 }, { name: 'Port stern', x: -0.65, z: -2.3, maxR: 0.26 }, { name: 'Starboard stern', x: 0.6, z: -2.55, maxR: 0.1 },
];
/** The prop actually on spot i (one too big for the spot counts as nothing). */
export const propAt = (look, i) => (PROPS[look.d[i]].r <= slotsOf(look)[i].maxR ? look.d[i] : 0);
const WHEEL_POST = [-0.14, 0.14, -2.12, -1.92];

/**
 * Where everything goes for a look (cab, wh and mast on the original boat, for building its parts; `obs` at the
 * boat's size, since it's what riders walk around): the cabin (or null), which roof, top and mast actually show (nothing stands on
 * a canvas roof, and roof and top need a cabin), the wheelhouse spot, the mast, and what blocks walking on deck.
 */
const layoutCache = new Map();
export function layoutOf(look) {
  const L = look ?? defaultLook();
  if (L.t === 2) { // the pirate ship: its masts and wheel post, the props on its deck spots, and the treasure chests
    const key = `t2|${L.d.join()}|${L.u[6] ? 1 : 0}`;
    let lay = layoutCache.get(key);
    if (lay) return lay;
    const obs = { rects: [...HULLS[2].obs.rects], circles: [...HULLS[2].obs.circles] };
    L.d.forEach((_, i) => { const r = PROPS[propAt(L, i)].r; if (r) obs.circles.push([PIRATE_SLOTS[i].x, PIRATE_SLOTS[i].z, r]); });
    if (L.u[6]) for (const sx of [-1, 1]) obs.rects.push([sx * 0.62 - 0.22, sx * 0.62 + 0.22, -3.62, -3.3]);
    lay = { key, cab: null, roof: -1, top: 2, wh: null, mast: null, mastV: 2, obs };
    layoutCache.set(key, lay);
    return lay;
  }
  if (L.t) return { key: 't' + L.t, cab: null, roof: -1, top: 2, wh: null, mast: null, mastV: 2, obs: HULLS[L.t].obs }; // fixed models
  const { E } = sizeOf(L);
  const key = `${L.p.join()}|${L.d.join()}|${E}`;
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
  L.d.forEach((_, i) => { const r = PROPS[propAt(L, i)].r; if (r) circles.push([DECK_SLOTS[i].x, zAt(DECK_SLOTS[i].z, E), r]); });
  lay = { key, cab, roof, top, wh, mast, mastV, obs: { rects, circles } };
  layoutCache.set(key, lay);
  return lay;
}

// everything on every boat with fixed colours: hull, deck, rail, portholes, bowsprit, anchor, wheel, lantern posts
// More of something spaced along the straight sides, in the gap a longer boat opens between z0 and z1 + E (already
// placed for the size): fills evenly about `step` apart. `put(z)` adds one at z.
function fillGap(fixed, z0, z1, step, put) {
  if (!DIM.E) return;
  const n = Math.round((z1 + DIM.E - z0) / step) - 1;
  fixed(true);
  for (let i = 1; i <= n; i++) put(z0 + (z1 + DIM.E - z0) * i / (n + 1));
  fixed(false);
}
const baseGeometry = () => parts(({ add, box, sheer, fixed }) => {
  // hull: a dark keel, weathered clinker planks with grime at the waterline (the tinted band goes on top, see hullPaint)
  add(extrudeY(new THREE.Shape(outline(0.3)), -0.62, 0.22), C.KEEL);
  const WEATHER = [0x8a7a66, 0x9b8b76, 0x7f6f5c, 0x958470];
  sheer(true); // the hull sides, rail and their fittings follow the sheer line; the deck and wheel don't
  LOW_STRAKES.forEach(([y0, y1], k) => {
    const col = k === 0 ? C.GRIME : WEATHER[Math.floor(hrand(k + 40) * WEATHER.length)];
    add(extrudeY(new THREE.Shape(outline([0.17, 0.1, 0.05, 0.015][k])), y0, y1 - y0), (x, y) => (y < y0 + 0.01 ? new THREE.Color(col).multiplyScalar(0.8).getHex() : col));
  });
  for (let z = -2.75; z <= 2.6; z += 0.45) for (const sx of [-1, 1]) for (const [y0, y1] of BAND_STRAKES) box(0.025, 0.025, 0.025, C.NAIL, sx * (halfW(z) + 0.035), (y0 + y1) / 2, z);
  fillGap(fixed, 0.4, 0.85, 0.45, (z) => { for (const sx of [-1, 1]) for (const [y0, y1] of BAND_STRAKES) box(0.025, 0.025, 0.025, C.NAIL, sx * (BOAT.W + 0.035), mapY((y0 + y1) / 2), z); });
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
  fillGap(fixed, 0.6, 1.15, 0.55, (z) => { for (const sx of [-1, 1]) box(0.07, 0.25, 0.07, C.POST, sx * (BOAT.W - 0.065), mapY(D + 0.12) + sheerAt(SPLIT), z); });
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
PROP_BUILD.push(() => parts(({ add, box }) => { // a deck cannon on its wooden carriage, its muzzle outboard (+x; turned for port spots)
  box(0.36, 0.12, 0.3, C.CRATE_D, 0, D + 0.1, 0);
  box(0.12, 0.1, 0.3, C.CRATE_D, -0.1, D + 0.2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 8).rotateX(Math.PI / 2).translate(sx * 0.12, D + 0.075, sz * 0.165), C.DARK);
  add(new THREE.CylinderGeometry(0.06, 0.09, 0.56, 10).rotateZ(-Math.PI / 2).translate(0.12, D + 0.27, 0), C.IRON);
  add(new THREE.TorusGeometry(0.068, 0.02, 4, 10).rotateY(Math.PI / 2).translate(0.39, D + 0.27, 0), C.IRON);
  add(new THREE.SphereGeometry(0.045, 6, 4).translate(-0.18, D + 0.27, 0), C.IRON);
  for (const [x, z, y] of [[-0.06, -0.24, 0.05], [0.04, -0.24, 0.05], [-0.01, -0.24, 0.12]]) add(new THREE.SphereGeometry(0.05, 6, 4).translate(x, D + y, z), C.IRON); // a few cannonballs
}));
const propGeometry = (t) => (PROP_BUILD[t] ? shared(`prop${t}`, PROP_BUILD[t]) : null);
const CANNON = 7; // (its index in PROPS)
const propGlowGeometry = () => shared('propGlow', () => { const g = new THREE.BoxGeometry(0.12, 0.16, 0.12).translate(0, mapY(D + 0.74), 0); g.deleteAttribute('uv'); g.userData.shared = true; return g; });

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
// (placed for the boat's size: the posts it hangs from move with the bow, and the wire sags between them)
const lightRun = () => {
  const pts = [], y = mapY(D + 0.86);
  const lp = [[1.12, -2.6], [1.12, -1.6], [1.12, -0.35], [1.12, 0.9], [0.85, 2.15], [0, BOAT.TIP + 0.4], [-0.85, 2.15], [-1.12, 0.9], [-1.12, -0.35], [-1.12, -1.6], [-1.12, -2.6]].map(([x, z]) => [x, mapZ(z)]);
  for (let i = 0; i < lp.length - 1; i++) {
    const [ax, az] = lp[i], [bx, bz] = lp[i + 1];
    for (let k = 0; k < 4; k++) { const t = k / 4; pts.push([ax + (bx - ax) * t, y - Math.sin(t * Math.PI) * 0.16, az + (bz - az) * t]); }
  }
  pts.push([lp[lp.length - 1][0], y, lp[lp.length - 1][1]]);
  return pts;
};
const lightsWireGeometry = () => parts(({ add, fixed }) => {
  const LIGHT_RUN = lightRun();
  fixed(true);
  for (let i = 0; i < LIGHT_RUN.length - 1; i++) {
    const a = new THREE.Vector3(...LIGHT_RUN[i]), b = new THREE.Vector3(...LIGHT_RUN[i + 1]), len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.015, 0.015, len).lookAt(b.clone().sub(a)).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add(g, C.IRON);
  }
});
const lightsBulbGeometry = () => {
  const g = mergeGeometries(lightRun().filter((_, i) => i % 2).map(([x, y, z]) => { const b = new THREE.BoxGeometry(0.06, 0.07, 0.06).translate(x, y - 0.05, z); b.deleteAttribute('uv'); return b; }));
  g.userData.shared = true;
  return g;
};
// bunting: lines from the masthead (wherever the mast is) to the bowsprit and to the stern, hung with pennants
// (placed for the boat's size: `top` is on the original boat, like the mast)
const buntingPoints = (top) => {
  const fit = ([x, y, z]) => [x, mapY(y), mapZ(z)], t0 = fit(top);
  const lines = [[t0, fit(BOWSPRIT_END)], [t0, fit([0, D + 1.05, BOAT.STERN + 0.15])]];
  const pts = [];
  for (const [a, b] of lines) for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.35, a[2] + (b[2] - a[2]) * t, k]); }
  return pts;
};
const buntingLineGeometry = (top) => parts(({ add, fixed }) => {
  const P = buntingPoints(top);
  fixed(true);
  for (let i = 0; i < P.length - 1; i++) {
    if (P[i + 1][3] === 0) continue;
    const a = new THREE.Vector3(...P[i].slice(0, 3)), b = new THREE.Vector3(...P[i + 1].slice(0, 3));
    add(new THREE.BoxGeometry(0.012, 0.012, a.distanceTo(b)).lookAt(b.clone().sub(a)).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), C.ROPE);
  }
});
const pennants = (top, odd, color) => parts(({ add, fixed }) => {
  fixed(true);
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
  r1.userData = { cy: mapY(0.3), cx: -1.05, ax: true, rigid: true }; lifeRing(r1);
  const r2 = new THREE.TorusGeometry(0.14, 0.04, 4, 12).translate(0.55, D + 0.12, BOAT.STERN - 0.02);
  r2.userData = { cy: mapY(D + 0.12), cx: 0.55, ax: false, rigid: true }; lifeRing(r2);
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

// ---- the other kinds of boat (HULLS 1: the rowboat): fixed models, painted with the hull colour ----
// A clinker hull for any outline: keel, lower planks tapering in, a waterline stripe, a rail with a cap and posts,
// a stem and sternpost, and a flat plank deck. The tinted band of planks along the top is built by hullBand.
function hullShell(hl, { add, box, sheer }) {
  const dk = hl.DECK, kd = hl.KEEL_DEPTH, s = hl.W / BOAT.W;
  add(extrudeY(new THREE.Shape(outline(0.3 * s, hl)), -kd, 0.2), C.KEEL);
  sheer(true);
  const lowTop = dk - 0.24, bands = 3, WEATHER = [0x8a7a66, 0x9b8b76, 0x7f6f5c];
  for (let k = 0; k < bands; k++) {
    const y0 = -kd + 0.18 + (lowTop + kd - 0.18) * (k / bands), y1 = -kd + 0.18 + (lowTop + kd - 0.18) * ((k + 1) / bands) + 0.02;
    const col = k === 0 ? C.GRIME : WEATHER[k];
    add(extrudeY(new THREE.Shape(outline([0.14, 0.06, 0.015][k] * s, hl)), y0, y1 - y0), (x, y) => (y < y0 + 0.01 ? new THREE.Color(col).multiplyScalar(0.8).getHex() : col));
  }
  add(extrudeY(ring(-0.02, 0.05, hl), lowTop - 0.04, 0.04), 0xe6d8b8); // cream waterline stripe
  add(extrudeY(ring(0, 0.1, hl), dk, 0.12), C.RAIL);
  add(extrudeY(ring(0, 0.1, hl), dk + 0.12, 0.035), C.CAP);
  const step = hl.W < 0.8 ? 0.5 : 0.55;
  for (let z = hl.STERN + 0.3; z <= hl.TIP - 0.4; z += step) for (const sx of [-1, 1]) box(0.06, 0.2, 0.06, C.POST, sx * (halfW(z, hl) - 0.05), dk + 0.08, z);
  for (let k = 0; k < 5; k++) { const t = k / 4; box(0.08, 0.18, 0.09, C.RAIL, 0, -kd * 0.6 + t * (dk + 0.45 + kd * 0.6), hl.TIP - 0.02 + Math.sin(t * 1.4) * 0.08, 0, -0.25 * t); } // stem
  box(0.09, dk + kd * 0.5 + 0.3, 0.07, C.RAIL, 0, (dk + 0.3 - kd * 0.5) / 2, hl.STERN - 0.02); // sternpost
  sheer(false);
  // deck planks, clipped to the hull
  const DECKS = [0x9a6a3c, 0x8a5c33, 0xa47446, 0x7f5530, 0x936336], pw = hl.W < 0.8 ? 0.2 : 0.24;
  for (let x = -(hl.W - 0.2), n = 0; x <= hl.W - 0.2 + 1e-6; x += pw + 0.01, n++) {
    let zEnd = hl.STERN + 0.1;
    for (let z = hl.STERN + 0.1; z < hl.TIP; z += 0.02) { if (halfW(z, hl) - 0.08 >= Math.abs(x) + pw / 2) zEnd = z; else if (z > 0) break; }
    const z0 = hl.STERN + 0.1;
    if (zEnd - z0 > 0.1) box(pw, 0.04, zEnd - z0, DECKS[Math.floor(hrand(n + 7 + hl.W * 10) * DECKS.length)], x, dk + 0.005, (z0 + zEnd) / 2);
  }
}
// the tinted band of planks along the top of the hull (hull colour)
const hullBand = (hl) => parts(({ add, sheer }) => {
  SH = hl;
  sheer(true);
  const dk = hl.DECK, y0 = dk - 0.22;
  [[y0, dk - 0.1], [dk - 0.1, dk + 0.03]].forEach(([a, b], k) => add(extrudeY(ring(-0.012 - k * 0.008, 0.08, hl), a, b - a), (x, y) => (y < a + 0.01 ? 0.78 : y > dk ? 1.1 : tone(k + 11, 0.86, 1.02))));
  SH = HULLS[0];
});
const TYPE_BUILD = {
  // Rowboat: two thwarts, oars in their rowlocks resting out over the water, a coiled bow line and a little crate
  1: (hl) => ({
    base: parts((p) => {
      SH = hl; hullShell(hl, p); SH = HULLS[0];
      const { add, box } = p, dk = hl.DECK;
      for (const z of [0.5, -0.58]) box(2 * halfW(z, hl) - 0.14, 0.05, 0.22, C.CAP, 0, dk + 0.18, z); // thwarts (you walk over them)
      for (const z of [0.5, -0.58]) for (const sx of [-1, 1]) box(0.045, 0.16, 0.045, C.POST, sx * (halfW(z, hl) - 0.17), dk + 0.09, z);
      for (const sx of [-1, 1]) { // oars from the rowlocks, blades in the water
        box(0.035, 0.07, 0.035, C.IRON, sx * (hl.W - 0.02), dk + 0.19, 0.15); // rowlocks (the oars are animated: OAR)
      }
      add(new THREE.TorusGeometry(0.09, 0.025, 4, 10).rotateX(Math.PI / 2).translate(-0.1, dk + 0.035, 0.85), C.ROPE);
      box(0.16, 0.14, 0.13, C.CRATE, 0.12, dk + 0.07, -0.85);
    }),
    paint: hullBand(hl),
  }),
  // Pirate ship (after the user's galleon reference; original model): tall bulwarks, gold mouldings and a scroll vine
  // along the hull band, gunports with red lids and cannon muzzles, a raised stern castle (cabin colour walls, roof colour
  // top deck) with a gallery of gold-framed stern windows, a balustrade and two lanterns, two masts with square courses and
  // topsails and a jib to the bowsprit (canvas colour), a crow's nest, rigging, a gold figurehead and a black flag.
  2: (hl) => {
    const P = PIRATE, dk = hl.DECK, W = hl.W, ST = hl.STERN, CZ = P.CASTLE, CH = P.CASTLE_H;
    const cw = W - 0.03, zm = (CZ + ST) / 2, cd = CZ - ST, RIG = 0x4a3a2a, RED = 0x8a2a22;
    const TAFF = P.TAFF;
    const main = P.MASTS[0], BOOM_END = [0, dk + 1.18, hl.TIP + 1.85];
    const nearPort = (z) => P.PORTS.some((p) => Math.abs(z - p) < 0.22) || Math.abs(z - ST * 0.55) < 0.4; // (and the name plate)
    const cyl = (add, r0, r1, h, n, x, y, z, col) => add(new THREE.CylinderGeometry(r0, r1, h, n).translate(x, y, z), col);
    const base = parts((p) => {
      const { add, box, sheer } = p;
      SH = hl;
      hullShell(hl, p);
      sheer(true);
      add(extrudeY(ring(0, 0.08, hl), dk + 0.15, 0.17), C.PLANK2); // tall bulwarks above the rail
      add(extrudeY(ring(0.005, 0.1, hl), dk + 0.32, 0.04), C.CAP);
      add(extrudeY(ring(-0.035, 0.02, hl), dk - 0.36, 0.11), RED); // a red wale under the band, along the gunports
      add(extrudeY(ring(-0.04, 0.02, hl), dk - 0.385, 0.025), C.GOLD);
      add(extrudeY(ring(-0.03, 0.02, hl), dk - 0.25, 0.03), C.GOLD); // gold mouldings above and below the hull band
      add(extrudeY(ring(-0.03, 0.02, hl), dk + 0.03, 0.025), C.GOLD);
      for (let z = ST + 0.25; z < hl.BOW0; z += 0.17) { // a carved gold scroll vine along the band
        if (nearPort(z)) continue;
        for (const sx of [-1, 1]) box(0.014, 0.03, 0.15, C.GOLD, sx * (W + 0.024), dk - 0.1 + 0.035 * Math.sin(z * 11), z, 0, 0.5 * Math.cos(z * 11));
      }
      for (const z of P.PORTS) for (const sx of [-1, 1]) { // gunports: a gold frame, the dark port, a cannon muzzle and the lid propped open
        const y = dk - 0.1;
        box(0.02, 0.21, 0.25, C.GOLD, sx * (W + 0.03), y, z);
        box(0.02, 0.15, 0.19, C.DARK, sx * (W + 0.04), y, z);
        add(new THREE.CylinderGeometry(0.045, 0.055, 0.22, 8).rotateZ(Math.PI / 2).translate(sx * (W + 0.1), y - 0.01, z), C.IRON);
        add(new THREE.TorusGeometry(0.05, 0.016, 4, 8).rotateY(Math.PI / 2).translate(sx * (W + 0.2), y - 0.01, z), C.IRON);
        const a = sx * 1.1;
        box(0.025, 0.18, 0.24, RED, sx * (W + 0.04) + 0.09 * Math.sin(a), y + 0.11 - 0.09 * Math.cos(a), z, 0, 0, a);
      }
      sheer(false);
      SH = HULLS[0];
      // the ship's wheel on its post, up on the quarterdeck (the castle's top)
      const WZ = hl.WHEEL[1], wy = dk + hl.WHEEL[2], qd = dk + P.TOP;
      box(0.12, wy - qd, 0.12, C.RAIL, 0, (qd + wy) / 2, WZ - 0.08);
      box(0.2, 0.06, 0.2, C.DARK, 0, qd + 0.03, WZ - 0.08);
      add(new THREE.TorusGeometry(0.3, 0.035, 4, 12).translate(0, wy, WZ), C.WHEEL);
      for (let a = 0; a < 4; a++) box(0.74, 0.035, 0.035, C.WHEEL, 0, wy, WZ, 0, 0, a * Math.PI / 4);
      box(0.08, 0.08, 0.08, C.GOLD, 0, wy, WZ + 0.02);
      // the hatch grating amidships (you walk over it)
      box(0.86, 0.06, 0.8, C.DARK, 0, dk + 0.03, 0.95);
      for (let k = 0; k < 5; k++) { box(0.76, 0.03, 0.04, C.CAP, 0, dk + 0.075, 0.63 + k * 0.16); box(0.04, 0.03, 0.72, C.CAP, -0.32 + k * 0.16, dk + 0.075, 0.95); }
      // masts: poles, yards, a round fighting top between course and topsail, shrouds with ratlines down to the
      // channels on the hull's sides, a crow's nest, and a long pennant streaming from the fore and mizzen trucks
      for (const m of P.MASTS) {
        const b0 = dk + (m.base ?? 0), mh = dk + m.top - b0;
        cyl(add, 0.06, 0.095, mh, 8, 0, b0 + mh / 2, m.z, C.POST);
        box(0.16, 0.1, 0.16, C.GOLD, 0, dk + m.top + 0.03, m.z);
        box(0.26, 0.12, 0.26, C.DARK, 0, b0 + 0.06, m.z);
        for (const [, y1] of m.sails.slice(1)) box(0.13, 0.12, 0.13, C.DARK, 0, dk + y1 + 0.1, m.z); // the caps where the masts join
        const t0 = m.topAt ?? m.sails[0][1], r0 = m.base ? 0.3 : 0.4;
        cyl(add, r0, r0 - 0.03, 0.07, 12, 0, dk + t0 + 0.12, m.z, C.DARK); // the fighting top
        add(new THREE.TorusGeometry(r0 - 0.02, 0.018, 4, 14).rotateX(Math.PI / 2).translate(0, dk + t0 + 0.26, m.z), C.RAIL); // its rail
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + 0.5; box(0.025, 0.12, 0.025, C.RAIL, Math.cos(a) * (r0 - 0.02), dk + t0 + 0.2, m.z + Math.sin(a) * (r0 - 0.02)); }
        // shrouds from under the top to the channels (or the quarterdeck's rail), with ratlines across them
        const foot = (sx, dz) => m.base ? [sx * (cw - 0.04), b0 + 0.22, m.z + dz * 0.5] : [sx * (halfW(m.z + dz, hl) + 0.05), dk + 0.3 + sheerAt(m.z + dz, hl), m.z + dz];
        for (const sx of [-1, 1]) {
          const top = [sx * r0 * 0.68, dk + t0 + 0.1, m.z], DZ = [-0.42, -0.2, 0.02];
          for (const dz of DZ) { line3(add, top, foot(sx, dz), 0.018, RIG); const f = foot(sx, dz); box(0.05, 0.06, 0.05, C.DARK, f[0], f[1] + 0.03, f[2]); } // (deadeyes)
          const A = foot(sx, DZ[0]), B = foot(sx, DZ[2]), len = top[1] - A[1];
          for (let y = 0.2; y < len - 0.25; y += 0.2) { const f = y / len, P0 = A.map((v, k) => v + (top[k] - v) * f), P1 = B.map((v, k) => v + (top[k] - v) * f); line3(add, P0, P1, 0.012, RIG); }
          if (!m.base) box(0.07, 0.035, 0.64, C.RAIL, sx * (halfW(m.z - 0.2, hl) + 0.05), dk + 0.27 + sheerAt(m.z - 0.2, hl), m.z - 0.2); // the channel
        }
        if (m.pennant) for (let k = 0; k < 5; k++) box(0.012, 0.11 * (1 - k * 0.18), 0.2, m.pennant, 0, dk + m.top + 0.12 - k * 0.025 - 0.04 * Math.sin(k), m.z - 0.12 - k * 0.19); // the pennant
        if (m.nest) { cyl(add, 0.22, 0.17, 0.24, 10, 0, dk + m.nest, m.z, C.BARREL); cyl(add, 0.235, 0.235, 0.04, 10, 0, dk + m.nest + 0.12, m.z, C.IRON); }
      }
      box(0.03, 0.6, 0.03, C.POST, 0, dk + main.top + 0.3, main.z); // the flagpole on the main topmast
      // bowsprit and jib boom, a gold figurehead under them, and the stays
      line3(add, [0, dk + 0.3, hl.TIP - 0.4], [0, dk + 1.0, hl.TIP + 1.35], 0.11, C.POST);
      line3(add, [0, dk + 1.0, hl.TIP + 1.35], BOOM_END, 0.06, C.POST);
      const fore = P.MASTS[1];
      line3(add, [0, dk + fore.top - 0.05, fore.z], BOOM_END, 0.018, RIG);
      line3(add, [0, dk + main.top - 0.05, main.z], [0, dk + fore.sails[1][1] + 0.05, fore.z], 0.018, RIG);
      for (const sx of [-1, 1]) line3(add, [0, dk + main.top - 0.15, main.z], [sx * (cw - 0.08), dk + CH + 0.28, ST + 0.2], 0.018, RIG);
      // the stern castle's fixed trim: corner posts, gold-framed windows, the door, the stairs, a balustrade and lanterns
      for (const sx of [-1, 1]) for (const z of [CZ - 0.03, ST + 0.03]) box(0.1, CH + 0.04, 0.1, C.RAIL, sx * cw, dk + CH / 2, z);
      // arched windows and doors (after the user's galleon reference): a rectangle with a half-round head, in a gold frame
      const half = (r, d) => new THREE.CylinderGeometry(r, r, d, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2); // the upper half of a disc, facing ±z
      const arch = (x, y, z, w, h, nz, col, fr = C.GOLD) => {
        box(w + 0.07, h, 0.03, fr, x, y, z + nz * 0.012);
        add(half((w + 0.07) / 2, 0.03).translate(x, y + h / 2, z + nz * 0.012), fr);
        box(w, h, 0.03, col, x, y, z + nz * 0.022);
        add(half(w / 2, 0.03).translate(x, y + h / 2, z + nz * 0.022), col);
        if (col === C.GLASS) { box(0.018, h + w / 2, 0.035, C.FRAME, x, y + w / 4, z + nz * 0.028); box(w, 0.018, 0.035, C.FRAME, x, y + 0.02, z + nz * 0.028); }
      };
      const pilaster = (x, z, nz, y0, y1) => { box(0.07, y1 - y0, 0.04, C.RAIL, x, (y0 + y1) / 2, z + nz * 0.02); box(0.1, 0.04, 0.05, C.GOLD, x, y1 - 0.02, z + nz * 0.025); box(0.1, 0.04, 0.05, C.GOLD, x, y0 + 0.02, z + nz * 0.025); };
      for (const x of [-1.08, 0.12]) arch(x, dk + 0.42, CZ, 0.22, 0.24, 1, C.GLASS); // (the stairs cover the starboard end)
      const DX = -0.48;
      arch(DX, dk + 0.28, CZ, 0.34, 0.56, 1, C.DOOR);
      box(0.05, 0.05, 0.03, C.GOLD, DX + 0.1, dk + 0.3, CZ + 0.045);
      for (const x of [-0.8, -0.16, 0.42]) pilaster(x, CZ, 1, dk + 0.04, dk + CH - 0.08);
      box(2 * cw, 0.07, 0.03, C.RAIL, 0, dk + CH - 0.05, CZ + 0.012); // the frieze under the quarterdeck's edge
      box(2 * cw, 0.02, 0.035, C.GOLD, 0, dk + CH - 0.09, CZ + 0.014);
      // the stairs: solid wooden steps up the starboard side to the quarterdeck, with a handrail on the open side
      const sw = P.STAIR_X1 - P.STAIR_X0, sx0 = (P.STAIR_X0 + P.STAIR_X1) / 2, run = P.STAIR_LEN / P.STEPS, rise = P.TOP / P.STEPS;
      for (let k = 0; k < P.STEPS; k++) {
        const h = (k + 1) * rise, zc = CZ + P.STAIR_LEN - (k + 0.5) * run;
        box(sw, h - 0.03, run, tone(k + 140, 0.78, 0.92) < 0.85 ? C.DECK2 : C.DECK, sx0, dk + (h - 0.03) / 2, zc);
        box(sw + 0.02, 0.035, run + 0.03, C.CAP, sx0, dk + h - 0.017, zc + 0.015); // the tread's nosing
      }
      const rx = P.STAIR_X0 - 0.03, zBot = CZ + P.STAIR_LEN - 0.06;
      for (const [z, y] of [[zBot, dk], [CZ + P.STAIR_LEN / 2, dk + P.TOP / 2], [CZ + 0.03, dk + P.TOP]]) box(0.05, 0.42, 0.05, C.RAIL, rx, y + 0.21, z);
      box(0.08, 0.06, 0.08, C.GOLD, rx, dk + 0.45, zBot);
      line3(add, [rx, dk + 0.43, zBot], [rx, dk + P.TOP + 0.43, CZ + 0.03], 0.045, C.RAIL);
      // the stern (after the user's galleon reference): the great cabin's small windows low in the transom, a balcony
      // with balusters across the stern, arched windows between carved pilasters, a frieze, and above the quarterdeck the
      // tall carved taffrail (its boards are cabin colour) carrying the lanterns and a crest
      for (const x of [-0.9, -0.3, 0.3, 0.9]) { box(0.2, 0.15, 0.03, C.GOLD, x, dk - 0.06, ST - 0.012); box(0.14, 0.1, 0.035, C.GLASS, x, dk - 0.06, ST - 0.02); }
      box(2 * cw - 0.06, 0.05, 0.26, C.DECK2, 0, dk + 0.03, ST - 0.13); // the balcony
      box(2 * cw - 0.06, 0.035, 0.04, C.RAIL, 0, dk + 0.3, ST - 0.24);
      box(2 * cw - 0.06, 0.03, 0.04, C.GOLD, 0, dk + 0.065, ST - 0.25);
      for (let x = -cw + 0.06; x <= cw - 0.06 + 1e-6; x += (2 * cw - 0.12) / 22) { box(0.025, 0.2, 0.025, C.CAP, x, dk + 0.17, ST - 0.24); box(0.04, 0.04, 0.04, C.CAP, x, dk + 0.17, ST - 0.24); }
      for (const sx of [-1, 1]) box(0.04, 0.3, 0.26, C.RAIL, sx * (cw - 0.05), dk + 0.17, ST - 0.13);
      for (const x of [-1.0, 0, 1.0]) add(new THREE.ConeGeometry(0.06, 0.18, 4).rotateX(Math.PI).translate(x, dk - 0.07, ST - 0.2), C.GOLD); // carved drops under it
      for (const x of [-0.93, -0.31, 0.31, 0.93]) arch(x, dk + 0.46, ST, 0.22, 0.26, -1, C.GLASS);
      for (const x of [-1.24, -0.62, 0, 0.62, 1.24]) pilaster(x, ST, -1, dk + 0.32, dk + CH - 0.1);
      box(2 * cw, 0.07, 0.03, C.RAIL, 0, dk + CH - 0.06, ST - 0.012);
      box(2 * cw, 0.025, 0.035, C.GOLD, 0, dk + CH - 0.1, ST - 0.016);
      for (const sx of [-1, 1]) { box(0.03, 0.22, 0.22, C.GOLD, sx * (cw + 0.015), dk + 0.5, CZ - 0.32); box(0.035, 0.16, 0.16, C.GLASS, sx * (cw + 0.02), dk + 0.5, CZ - 0.32); } // (forward of the galleries)
      const ty = dk + CH + 0.07, gap = P.STAIR_X0 - 0.05; // the front railing stops at the head of the stairs
      for (let x = -cw + 0.05; x < gap - 0.04; x += 0.11) { box(0.03, 0.16, 0.03, C.CAP, x, ty + 0.09, CZ - 0.04); box(0.05, 0.04, 0.05, C.CAP, x, ty + 0.1, CZ - 0.04); } // turned balusters
      for (let z = ST + 0.04; z <= CZ - 0.04 + 1e-6; z += (cd - 0.08) / 4) for (const sx of [-1, 1]) box(0.04, 0.18, 0.04, C.CAP, sx * (cw - 0.04), ty + 0.09, z);
      box(gap + cw, 0.04, 0.06, C.RAIL, (gap - cw) / 2, ty + 0.2, CZ - 0.04);
      box(0.07, 0.3, 0.07, C.RAIL, gap, ty + 0.13, CZ - 0.04); // a newel post with a gold cap at the stairhead
      box(0.09, 0.06, 0.09, C.GOLD, gap, ty + 0.3, CZ - 0.04);
      for (const sx of [-1, 1]) box(0.06, 0.04, cd, C.RAIL, sx * (cw - 0.04), ty + 0.2, zm);
      // the taffrail's carving: gold mouldings, pilasters and scrolls
      box(2 * cw + 0.04, 0.035, 0.09, C.GOLD, 0, ty + TAFF, ST + 0.04);
      box(0.96, 0.035, 0.09, C.GOLD, 0, ty + TAFF + 0.22, ST + 0.04);
      for (const x of [-1.2, -0.6, 0.6, 1.2]) box(0.05, TAFF - 0.06, 0.03, C.GOLD, x, ty + TAFF / 2, ST + 0.005);
      for (const x of [-0.9, 0.9]) box(0.32, 0.05, 0.03, C.GOLD, x, ty + 0.2 + 0.04 * Math.sign(x), ST + 0.005, 0, 0, 0.25 * Math.sign(x));
      // quarter galleries: little bay windows on the castle's sides near the stern, framed in gold, with a carved drop
      for (const sx of [-1, 1]) {
        const x = sx * (cw + 0.1), z = ST + 0.48;
        box(0.18, 0.5, 0.62, C.RAIL, x, dk + 0.45, z);
        box(0.24, 0.05, 0.7, C.GOLD, x, dk + 0.72, z);
        box(0.22, 0.04, 0.66, C.GOLD, x, dk + 0.19, z);
        for (const dz of [-0.17, 0.17]) { box(0.02, 0.24, 0.2, C.GOLD, x + sx * 0.09, dk + 0.46, z + dz); box(0.025, 0.18, 0.15, C.GLASS, x + sx * 0.095, dk + 0.46, z + dz); }
        add(new THREE.ConeGeometry(0.1, 0.22, 4).rotateX(Math.PI).translate(x, dk + 0.06, z), C.GOLD);
      }
      // the crest on the taffrail's raised middle
      box(0.36, 0.3, 0.05, C.GOLD, 0, ty + TAFF + 0.08, ST - 0.005);
      box(0.2, 0.16, 0.06, RED, 0, ty + TAFF + 0.08, ST - 0.01);
    });
    // the castle's board walls (cabin colour) and its top deck with a cornice (roof colour)
    const cabin = parts(({ box }) => {
      const y = dk + CH / 2;
      let n = 0;
      for (let x = -cw; x < cw - 1e-6; x += 0.24, n++) { const w = Math.min(0.24, cw - x); box(w, CH, 0.06, tone(n + 40), x + w / 2, y, CZ - 0.03); box(w, CH, 0.06, tone(n + 70), x + w / 2, y, ST + 0.03); }
      for (let z = ST; z < CZ - 1e-6; z += 0.24, n++) { const d = Math.min(0.24, CZ - z); for (const sx of [-1, 1]) box(0.06, CH, d, tone(n * 2 + sx + 90), sx * (cw - 0.03), y, z + d / 2); }
      // the taffrail: a tall carved board wall across the stern above the quarterdeck, higher in the middle
      const ty = dk + CH + 0.07;
      for (let x = -cw; x < cw - 1e-6; x += 0.24, n++) { const w = Math.min(0.24, cw - x); box(w, TAFF, 0.06, tone(n + 210), x + w / 2, ty + TAFF / 2, ST + 0.04); }
      box(0.9, 0.22, 0.06, tone(299), 0, ty + TAFF + 0.11, ST + 0.04);
    });
    const roof = parts(({ box }) => {
      box(2 * cw + 0.14, 0.07, cd + 0.12, 1.0, 0, dk + CH + 0.035, zm);
      box(2 * cw + 0.2, 0.05, cd + 0.18, 0.76, 0, dk + CH - 0.02, zm);
      for (let x = -cw + 0.24; x < cw - 0.1; x += 0.24) box(0.015, 0.006, cd + 0.1, 0.7, x, dk + CH + 0.072, zm);
    });
    const sail = pirateSailGeometry(hl);
    // the yards (and the lateen's yard and sling): their own mesh, swung about their mast with the sails (sailMaterials)
    const rig = mergeGeometries(P.MASTS.map((m) => sailAttrs(parts(({ add, box }) => {
      for (const [, y1, wb, w = wb] of m.sails) { // a yard at the head of each square sail, with iron caps on its arms
        box(w + 0.22, 0.06, 0.06, C.POST, 0, dk + y1, m.z + 0.07);
        for (const sx of [-1, 1]) box(0.05, 0.05, 0.05, C.IRON, sx * (w / 2 + 0.1), dk + y1, m.z + 0.07);
      }
      if (m.lateen) { // the lateen's long yard, slung to the mast where it crosses it
        const L = m.lateen, pt = ([y, dz]) => [L.x - 0.04, dk + y, m.z + dz], tk = pt(L.tack), pk = pt(L.peak);
        line3(add, tk, pk, 0.055, C.POST);
        const f = L.tack[1] / (L.tack[1] - L.peak[1]);
        box(0.12, 0.14, 0.12, C.DARK, 0.04, tk[1] + (pk[1] - tk[1]) * f, m.z);
      }
    }), m.z)));
    rig.userData.shared = true;
    // (the figurehead, the flag, the stern lanterns and the sails' pattern are swappable: see pirateFigure etc.)
    return { base, paint: hullBand(hl), cabin, roof, sail, rig, flagAt: [0, dk + main.top + 0.36, main.z] };
  },
};
// ---- the pirate ship's swappable parts (look.p) and its own versions of the decorative upgrades ----
const pdims = () => {
  const hl = HULLS[2], dk = hl.DECK, ty = dk + PIRATE.CASTLE_H + 0.07;
  return { hl, dk, cw: hl.W - 0.03, ST: hl.STERN, ty, LANTERN_Y: ty + PIRATE.TAFF + 0.2 };
};
// glowing panes as one geometry: [x, y, z, width?, height?] each
function glowBoxes(list) {
  const m = mergeGeometries(list.map(([x, y, z, w = 0.1, h = 0.12]) => { const b = new THREE.BoxGeometry(w, h, w).translate(x, y, z); b.deleteAttribute('uv'); return b; }));
  m.userData.shared = true;
  return m;
}
// a big ornate stern lantern: a gold-framed iron cage with a domed gold cap and a finial (its panes are the glow), size k
function ornateLantern(box, add, x, ly, z, k) {
  box(0.2 * k, 0.04, 0.2 * k, C.GOLD, x, ly - 0.15 * k, z);
  box(0.12 * k, 0.05, 0.12 * k, C.GOLD, x, ly - 0.19 * k, z);
  for (const ax of [-1, 1]) for (const az of [-1, 1]) box(0.025, 0.28 * k, 0.025, C.IRON, x + ax * 0.085 * k, ly, z + az * 0.085 * k);
  add(new THREE.ConeGeometry(0.15 * k, 0.14 * k, 4).rotateY(Math.PI / 4).translate(x, ly + 0.2 * k, z), C.GOLD);
  box(0.035, 0.08 * k, 0.035, C.GOLD, x, ly + 0.31 * k, z);
}
// p[0] the figurehead under the bowsprit: a gold scroll, a gold lion's head, or none
export const pirateFigure = (v) => (v === 2 ? null : shared('pir.fig' + v, () => parts(({ add, box }) => {
  const { hl, dk } = pdims(), T = hl.TIP;
  if (v === 0) { box(0.1, 0.24, 0.2, C.GOLD, 0, dk + 0.16, T + 0.1, 0, 0.45); box(0.12, 0.1, 0.12, C.GOLD, 0, dk + 0.32, T + 0.2); return; }
  const hy = dk + 0.32, hz = T + 0.3, MANE = 0xb07a20;
  box(0.1, 0.22, 0.18, C.GOLD, 0, dk + 0.08, T + 0.08, 0, 0.45); // the carved scroll it rises from
  add(new THREE.IcosahedronGeometry(0.17, 0).translate(0, hy, hz - 0.03), MANE); // the mane
  box(0.17, 0.16, 0.16, C.GOLD, 0, hy, hz + 0.06); // the face
  box(0.1, 0.07, 0.08, C.GOLD, 0, hy - 0.04, hz + 0.16); // the muzzle
  for (const sx of [-1, 1]) { box(0.03, 0.03, 0.02, C.DARK, sx * 0.04, hy + 0.03, hz + 0.145); box(0.05, 0.06, 0.04, MANE, sx * 0.08, hy + 0.1, hz + 0.02); } // eyes, ears
  box(0.045, 0.03, 0.02, C.DARK, 0, hy - 0.03, hz + 0.205); // the nose
})));
// p[2] the flag on the main topmast (hoist at x = 0, flying toward +x, subdivided so it ripples)
export const pirateFlag = (v) => shared('pir.flag' + v, () => parts(({ add, box }) => {
  const BLACK = 0x1e1e24;
  add(new THREE.BoxGeometry(0.72, 0.46, 0.02, 6, 1, 1).translate(0.36, 0, 0), v === 2 ? 0xb02a22 : BLACK);
  if (v === 0) { // a white skull and crossbones
    box(0.17, 0.13, 0.034, C.WHITE, 0.38, 0.06, 0);
    box(0.11, 0.05, 0.034, C.WHITE, 0.38, -0.025, 0);
    for (const x of [0.34, 0.42]) box(0.045, 0.04, 0.04, BLACK, x, 0.065, 0);
    for (const a of [-0.55, 0.55]) box(0.34, 0.04, 0.03, C.WHITE, 0.38, -0.13, 0, 0, 0, a);
  } else if (v === 1) { // crossed cutlasses: white blades with gold guards
    for (const a of [-0.65, 0.65]) {
      const c = Math.cos(a), s = Math.sin(a), hx = 0.38 - c * 0.17 * Math.sign(a), hy = -0.13;
      box(0.4, 0.045, 0.03, C.WHITE, 0.38, 0.0, 0, 0, 0, a);
      box(0.035, 0.11, 0.035, C.GOLD, hx + c * 0.0, hy + Math.abs(s) * 0.02, 0, 0, 0, a);
      box(0.08, 0.035, 0.034, 0x7a4a2a, hx - c * 0.05 * Math.sign(a), hy - Math.abs(s) * 0.04, 0, 0, 0, a);
    }
  } else { // a red flag with a black hourglass
    for (const sy of [-1, 1]) add(new THREE.ConeGeometry(0.08, 0.1, 3).rotateZ(sy > 0 ? Math.PI : 0).translate(0.4, sy * 0.06, 0), BLACK);
  }
}));
// p[3] the stern lanterns: one on each quarter and one over the middle on a gold bracket, one big one, or none
export const pirateLamps = (v) => (v === 2 ? null : shared('pir.lamp' + v, () => parts(({ add, box }) => {
  const { cw, ST, ty, LANTERN_Y } = pdims(), k = v === 1 ? 1.55 : 1.35, ly = LANTERN_Y + (v === 1 ? 0.16 : 0.12);
  if (v === 0) for (const sx of [-1, 1]) ornateLantern(box, add, sx * (cw - 0.1), LANTERN_Y, ST + 0.05, 1); // on the taffrail's corners
  box(0.06, 0.06, 0.42, C.GOLD, 0, ly - 0.21 * k - 0.03, ST - 0.16); // the bracket, reaching out over the stern
  line3(add, [0, ty + 0.2, ST + 0.01], [0, ly - 0.21 * k - 0.04, ST - 0.3], 0.04, C.GOLD);
  ornateLantern(box, add, 0, ly, ST - 0.33, k);
})));
const pirateLampGlow = (v) => (v === 2 ? null : shared('pir.glow' + v, () => {
  const { cw, ST, LANTERN_Y } = pdims();
  return glowBoxes([...(v === 0 ? [-1, 1].map((sx) => [sx * (cw - 0.1), LANTERN_Y, ST + 0.05, 0.15, 0.26]) : []), v === 1 ? [0, LANTERN_Y + 0.16, ST - 0.33, 0.23, 0.4] : [0, LANTERN_Y + 0.12, ST - 0.33, 0.2, 0.35]]);
}));
// p[1] the sails' pattern: plain canvas, broad stripes, or a dark skull and crossbones on the two big sails
export const pirateSail = (v) => (v ? shared('pir.sail' + v, () => pirateSailGeometry(HULLS[2], v)) : typeGeometry(2).sail);
const SKULL = ['...###...', '..#####..', '.##.#.##.', '.#######.', '..#.#.#..', '#..###..#', '.##...##.', '#.......#'];
// a sagging line from a to b (catenary-ish), as points
const sagLine = (a, b, sag, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t - (k === 1 ? sag * 4 * t * (1 - t) : 0)); });
// where the rigging lights and the signal flags run: from the jib boom's end up over the mastheads and down to the taffrail
function pirateRun(top) {
  const { hl, dk, ST, ty } = pdims(), M = PIRATE.MASTS, boom = [-0.14, dk + 1.18, hl.TIP + 1.85];
  const at = (m, y) => [0, dk + y, m.z];
  const stops = top
    ? [boom, at(M[1], M[1].top + 0.02), at(M[0], M[0].top + 0.02), at(M[2], M[2].top + 0.02), [0, ty + PIRATE.TAFF + 0.22, ST + 0.04]]
    : [boom, at(M[1], M[1].sails[0][1] + 0.14), at(M[0], M[0].sails[0][1] + 0.14), at(M[2], M[2].topAt + 0.14), [0, ty + PIRATE.TAFF + 0.22, ST + 0.04]];
  return stops.slice(1).map((b, i) => { const a = stops[i], len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); return sagLine(a, b, i === 0 || i === 3 ? 0.02 : 0.05 * len, Math.max(4, Math.round(len / 0.35))); });
}
// the pirate ship's versions of the decorative upgrades (look.u 3–6): [geometry per mesh] (see Boats: b.pu)
export const PIRATE_UP = {
  // rigging lights: a wire from the jib boom over the fighting tops to the taffrail, with warm bulbs (the glow)
  lights: () => [shared('pir.lightsWire', () => parts(({ add }) => { for (const seg of pirateRun(false)) seg.forEach((p, i) => { if (i) line3(add, seg[i - 1], p, 0.012, C.DARK); }); })),
    shared('pir.lightsBulb', () => glowBoxes(pirateRun(false).flatMap((seg) => seg.slice(1, -1).map(([x, y, z]) => [x, y - 0.05, z, 0.07, 0.09]))))],
  // signal flags: lines from the jib boom over the mastheads to the taffrail, flags in the canvas colour and red
  bunting: () => {
    const flags = (odd) => parts(({ add }) => pirateRun(true).forEach((seg) => seg.forEach(([x, y, z], i) => { if (i && i < seg.length - 1 && i % 2 === odd) add(new THREE.ConeGeometry(0.09, 0.22, 3).rotateX(Math.PI).translate(x, y - 0.12, z), odd ? C.RED : 1.0); })));
    return [shared('pir.buntLine', () => parts(({ add }) => { for (const seg of pirateRun(true)) seg.forEach((p, i) => { if (i) line3(add, seg[i - 1], p, 0.012, C.ROPE); }); })),
      shared('pir.buntA', () => flags(0)), shared('pir.buntB', () => flags(1))];
  },
  // a lifeboat (a little rowboat) hung across the stern from two davits, over the balcony
  trim: () => {
    const { dk, ST, ty } = pdims(), m = new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(0.8, 0.8, 0.8)).premultiply(new THREE.Matrix4().makeTranslation(0, dk + 0.55, ST - 0.72));
    const fit = (g) => { const c = g.clone().applyMatrix4(m); c.userData.shared = true; return c; };
    return [shared('pir.lifeboat', () => {
      const davits = parts(({ add }) => {
        for (const sx of [-1, 1]) {
          const x = sx * 0.72, a = [x, ty + 0.1, ST + 0.02], b = [x, dk + 1.32, ST - 0.3], c = [x, dk + 1.26, ST - 0.72];
          line3(add, a, b, 0.05, C.RAIL); line3(add, b, c, 0.045, C.RAIL);
          line3(add, c, [x, dk + 0.86, ST - 0.72], 0.014, C.ROPE);
        }
      });
      const g = mergeGeometries([fit(typeGeometry(1).base), davits]);
      g.userData.shared = true;
      return g;
    }), shared('pir.lifeboatPaint', () => fit(typeGeometry(1).paint))];
  },
  // a treasure hoard behind the wheel: two open chests heaped with gold, coins spilling over the deck, a few gems
  gear: () => [shared('pir.treasure', () => parts(({ add, box }) => {
    const { ty } = pdims(), z = -3.46;
    for (const sx of [-1, 1]) {
      const x = sx * 0.62;
      box(0.38, 0.22, 0.26, C.CRATE_D, x, ty + 0.11, z);
      for (const dx of [-0.15, 0.15]) box(0.035, 0.23, 0.27, C.IRON, x + dx, ty + 0.115, z);
      box(0.39, 0.04, 0.27, C.GOLD, x, ty + 0.2, z);
      box(0.32, 0.06, 0.2, C.GOLD, x, ty + 0.24, z);
      add(new THREE.ConeGeometry(0.13, 0.1, 6).translate(x, ty + 0.3, z), C.GOLD); // the heap
      box(0.38, 0.04, 0.26, C.CRATE_D, x, ty + 0.22 + 0.123, z - 0.13 - 0.042, 0, -1.9); // the lid, thrown back
      box(0.05, 0.05, 0.05, C.RED, x - 0.06, ty + 0.34, z + 0.02); box(0.04, 0.04, 0.04, 0x3a7ad0, x + 0.07, ty + 0.32, z - 0.03); // gems
      for (let k = 0; k < 6; k++) add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 6).translate(x + (hrand(k * 3 + sx) - 0.5) * 0.5, ty + 0.006, z + 0.16 + hrand(k * 7 + sx) * 0.12), C.GOLD); // coins on deck
    }
  }))],
};
const PIRATE_UP_MESHES = { lights: [true, false], bunting: [true, 'canvas', true], trim: [true, 'hull'], gear: [true] }; // per mesh: base material, a tint, or (false) the bulb glow
// ---- the pirate ship's sails: one curved cloth per sail, billowing and rippling in the vertex shader ----
// Each sail is a grid of triangles (flat-shaded, so the curve reads in pixel-art bands) built at full belly. Every vertex
// carries aOff (how far the wind has pushed it out from the flat sail) and aW (how free it is: 0 where it's bent to the
// yard, stay or clew, 1 in the middle of the cloth). sailMaterial() eases the belly with the boat's uFill and adds a
// travelling ripple, stronger when the sail is slack.
function pirateSailGeometry(hl, pattern = 0) {
  const P = PIRATE, dk = hl.DECK, pos = [], col = [], off = [], wgt = [], furl = [], piv = [];
  // v: { p: the flat cloth, o: the wind's push, w: how free, f: where it gathers when furled, pv: [pivot z, swings 0/1] }
  const put = (vs, shade) => { for (const v of vs) { pos.push(v.p[0] + v.o[0], v.p[1] + v.o[1], v.p[2] + v.o[2]); off.push(...v.o); wgt.push(v.w); furl.push(...v.f); piv.push(...v.pv); col.push(shade, shade, shade); } };
  // square sails: courses, topsails and topgallants, sewn from vertical cloths, bellying forward (+z), fullest low in
  // the middle. Clean canvas (the worn, holed look was taken out at the user's request).
  for (const m of P.MASTS) m.sails.forEach(([y0, y1, w, wt = w], si) => { // (w at the foot, wt at the head)
    const n = Math.round(w / 0.38), NX = n * 2, NY = Math.max(8, Math.round((y1 - y0) / 0.25)), top = dk + y1 - 0.04, bot = dk + y0 + 0.03, full = 0.1 + 0.06 * w;
    const V = (i, j) => {
      const u = i / NX, v = j / NY, W = Math.pow(Math.sin(Math.PI * u), 0.8) * (v * (1.6 - v)) / 0.64, wv = wt + (w - wt) * v;
      // furled, it gathers up along its yard; it swings with the yard about the mast
      return { p: [-wv / 2 + u * wv, top - v * (top - bot), m.z + 0.1], o: [0, 0.02 * W, full * W], w: W, f: [-wt / 2 + u * wt, top + 0.02, m.z + 0.13], pv: [m.z, 1] };
    };
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      let s = Math.floor(i / 2) % 2 ? (pattern === 1 ? 0.6 : 0.91) : 1.0; // alternate cloths (broad stripes for the striped pattern)
      if (j === NY - 1) s *= 0.88; // the foot band
      else if (j % 4 === 2) s *= 0.95; // reef bands
      if (i === 0 || i === NX - 1) s *= 0.93; // the leeches
      if (pattern === 2 && si === 0 && !m.base) { // a skull and crossbones painted dark on the big sails, cloth cell by cell
        const r = j - Math.floor((NY - SKULL.length) / 2) + 1, c = i - Math.floor((NX - SKULL[0].length) / 2);
        if (SKULL[r]?.[c] === '#') s = 0.2;
      }
      const a = V(i, j), b = V(i + 1, j), c = V(i, j + 1), d = V(i + 1, j + 1);
      put([a, c, b], s);
      put([b, c, d], s);
    }
  });
  // two headsails, bellying to starboard: a fore staysail from the fore mast to the bowsprit, and the jib from higher
  // up to the jib boom's end, ahead of it
  const fore = P.MASTS[1];
  // furled, a headsail gathers along its stay (the luff, A to T) and a lateen along its yard; pv: what it swings about
  const headsail = (A, T, K, dx, pv = [0, 0]) => {
    const AT = [0, 1, 2].map((k) => T[k] - A[k]), L2 = AT[0] ** 2 + AT[1] ** 2 + AT[2] ** 2;
    const N = 7, J = (i, j) => {
      const b = i / N, c = j / N, a = Math.max(0, 1 - b - c), W = Math.min(1, 27 * a * b * c * 1.6) ** 0.7;
      const p = [0, 1, 2].map((k) => A[k] * a + T[k] * b + K[k] * c + (k ? 0 : dx));
      const t = Math.max(0, Math.min(1, ((p[0] - dx - A[0]) * AT[0] + (p[1] - A[1]) * AT[1] + (p[2] - A[2]) * AT[2]) / L2));
      return { p, o: [0.18 * W, 0, 0], w: W, f: [0, 1, 2].map((k) => A[k] + AT[k] * t + (k ? 0 : dx)), pv };
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
      const s = Math.floor((i + j) / 2) % 2 ? (pattern === 1 ? 0.6 : 0.92) : 1.0;
      put([J(i, j), J(i + 1, j), J(i, j + 1)], s);
      if (i + j < N - 1) put([J(i + 1, j), J(i + 1, j + 1), J(i, j + 1)], s);
    }
  };
  headsail([0, dk + 3.0, fore.z + 0.12], [0, dk + 0.74, hl.TIP + 0.6], [0, dk + 0.95, fore.z + 1.0], 0);
  headsail([0, dk + 4.55, fore.z + 0.1], [0, dk + 1.16, hl.TIP + 1.75], [0, dk + 1.45, hl.TIP - 0.45], -0.07);
  // the mizzen's lateen: a triangle hanging from its yard (tack to peak) down to the clew, bellying to starboard
  for (const m of P.MASTS) if (m.lateen) {
    const L = m.lateen, pt = ([y, dz]) => [0, dk + y - 0.04, m.z + dz];
    headsail(pt(L.tack), pt(L.peak), pt(L.clew), L.x, [m.z, 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(wgt, 1));
  g.setAttribute('aFurl', new THREE.Float32BufferAttribute(furl, 3));
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(piv, 2));
  g.computeVertexNormals(); // non-indexed: one normal per triangle
  g.userData.shared = true;
  return g;
}
// The same geometry without the animation attributes, so it merges with plain geometry (the launch blueprint)
const plainOf = (g, key) => shared(key, () => { const p = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'color']) p.setAttribute(k, g.attributes[k]); p.userData.shared = true; return p; });
// Animation attributes for rigid rigging (the yards): never pushed by the wind or furled, swung about the mast at z pz
function sailAttrs(g, pz) {
  const n = g.attributes.position.count;
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aFurl', g.attributes.position.clone());
  g.setAttribute('aPivot', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 1 : pz)), 2));
  return g;
}
// The sails' animation (per boat: uFill, uFurl, uBrace; Boats.update eases them from the throttle and the rudder):
// - uFill: how full the wind blows them, 1 = the built belly, below 0 taken aback (bellying backward, going astern);
// - a ripple travelling over the cloth, stronger when the sail is slack;
// - uFurl: 1 = furled: every vertex gathers to its furl point (aFurl: up along the yard, or along the stay), bunched;
// - uBrace: the yards swing about their mast (aPivot: [mast z, 1]; headsails 0) as the ship turns.
const SAIL_GLSL = /* glsl */ `
uniform float uTime, uFill, uFurl, uBrace;
attribute vec3 aOff, aFurl;
attribute float aW;
attribute vec2 aPivot;
float sailPhase(vec3 p) { return uTime * 4.2 + p.y * 3.1 - p.x * 1.7 + p.z * 0.6; }
float sailFlap(vec3 p) { float ph = sailPhase(p); return (sin(ph) * 0.6 + sin(ph * 1.9 + 1.3) * 0.4) * aW * (0.022 + 0.07 * (1.0 - clamp(abs(uFill), 0.0, 1.0))) * (1.0 - uFurl); }
vec3 sailDir() { return dot(aOff, aOff) > 1e-8 ? normalize(aOff) : vec3(0.0); }
vec3 sailBrace(vec3 p, float pz) { float a = uBrace * aPivot.y, c = cos(a), s = sin(a); float dz = p.z - pz; return vec3(p.x * c + dz * s, p.y, -p.x * s + dz * c + pz); }
vec3 sailPos(vec3 p0) {
  vec3 p = p0 + aOff * (uFill - 1.0) + sailDir() * sailFlap(p0);
  // furled: gathered to the yard or stay in soft bunches (folds every few cloths), a little proud of it
  vec3 bundle = aFurl + sailDir() * (0.05 + 0.03 * sin(p0.x * 14.0 + p0.z * 9.0)) * aW - vec3(0.0, 0.035 * aW, 0.0);
  p = mix(p, bundle, uFurl);
  return sailBrace(p, aPivot.x);
}
`;
// patch a material's vertex shader with the sails' animation (positions, and normals for the smooth-shaded yards)
function sailPatch(m, uni) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = materials().flagTime;
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SAIL_GLSL)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = sailPos(position);');
    if (sh.vertexShader.includes('#include <beginnormal_vertex>')) sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = sailBrace(objectNormal, 0.0);');
  };
  m.customProgramCacheKey = () => 'pirateSail' + m.type + (m.flatShading ? 'f' : '');
  return m;
}
/** A boat's sail materials: the canvas (tinted, flat-shaded), the yards (fixed colours) and their shadow, sharing one set of uniforms. */
function sailMaterials() {
  const uni = { uFill: { value: 0.45 }, uFurl: { value: 1 }, uBrace: { value: 0 } };
  return {
    uni,
    sail: sailPatch(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), uni),
    rig: sailPatch(new THREE.MeshLambertMaterial({ vertexColors: true }), uni),
    depth: sailPatch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), uni),
  };
}
// A rowboat oar, pivoting at its rowlock (the origin): the handle inboard (−x), the loom out along +x, and the blade.
// Boats.update sweeps it fore and aft and dips the blade through a stroke (b.rowPhase).
const OAR = { PIVOT_Z: 0.15, PIVOT_Y: 0.19, SWEEP: 0.55, DIP: 0.42, LIFT: 0.18 };
const oarGeometry = () => shared('oar', () => parts(({ box }) => {
  box(1.2, 0.04, 0.04, C.CAP, 0.4, 0, 0); // the loom, from the handle to the blade
  box(0.13, 0.05, 0.05, C.POST, -0.33, 0, 0); // the grip
  box(0.3, 0.12, 0.022, C.POST, 1.12, 0, 0); // the blade
  box(0.05, 0.06, 0.06, C.DARK, 0.02, 0, 0); // the collar at the rowlock
}));

// The rowboat's Sail upgrade (its slot 0, the cabin boat's Engine): a mast stepped through the forward thwart with a
// square sail across the boat, bellying forward over the bow, so it never hides the rower (who faces the stern).
// Each level makes it bigger: [sail width, sail height, cloths].
export const ROW_SAIL = [null, [0.7, 0.55, 3], [0.95, 0.8, 4], [1.25, 1.05, 5]];
const ROW_MAST_Z = 0.5, ROW_SAIL_Y = 0.62; // the mast's spot and the boom's height above the deck
const rowMastGeometry = (lvl) => parts(({ add, box }) => {
  const hl = HULLS[1], dk = hl.DECK, [w, h] = ROW_SAIL[lvl], y0 = dk + ROW_SAIL_Y, top = y0 + h, Z = ROW_MAST_Z;
  add(new THREE.CylinderGeometry(0.028, 0.04, top + 0.14 - dk, 6).translate(0, (dk + top + 0.14) / 2, Z), C.POST);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 6).translate(0, top + 0.16, Z), C.BRASS); // the truck
  box(0.08, 0.08, 0.08, C.DARK, 0, dk + 0.205, Z); // the partner on the thwart
  box(w + 0.12, 0.035, 0.035, C.CAP, 0, top, Z + 0.035); // the yard
  box(w + 0.04, 0.03, 0.03, C.CAP, 0, y0, Z + 0.035); // the boom
  const line = (a, b) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); add(new THREE.BoxGeometry(0.012, 0.012, A.distanceTo(B)).lookAt(B.clone().sub(A)).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2), C.ROPE); };
  line([0, top + 0.1, Z], [0, dk + 0.32, hl.TIP - 0.05]); // forestay to the stem
  for (const sx of [-1, 1]) line([0, top + 0.08, Z], [sx * (halfW(Z, hl) - 0.04), dk + 0.15, Z - 0.12]); // shrouds
  for (const sx of [-1, 1]) line([sx * (w / 2 + 0.04), y0, Z + 0.035], [sx * (halfW(-0.3, hl) - 0.05), dk + 0.15, -0.3]); // sheets aft
});
const rowSailGeometry = (lvl) => parts(({ box }) => {
  const dk = HULLS[1].DECK, [w, h, n] = ROW_SAIL[lvl], y0 = dk + ROW_SAIL_Y, cw = w / n;
  for (let k = 0; k < n; k++) {
    const belly = (0.05 + 0.03 * lvl) * Math.sin(Math.PI * (k + 0.5) / n); // fuller in the middle
    box(cw + 0.004, h - 0.03, 0.022, k % 2 ? 0.9 : 1.0, -w / 2 + cw * (k + 0.5), y0 + h / 2, ROW_MAST_Z + 0.06 + belly);
    box(cw * 0.9, 0.03, 0.03, 0.74, -w / 2 + cw * (k + 0.5), y0 + 0.025, ROW_MAST_Z + 0.065 + belly); // the bolt rope along the foot
  }
});
export const rowSailParts = (lvl) => (lvl > 0 ? { mast: shared(`rowMast${lvl}`, () => rowMastGeometry(lvl)), sail: shared(`rowSail${lvl}`, () => rowSailGeometry(lvl)) } : null);

/** The geometries of a fixed-model boat kind (the rowboat): { base, paint, cabin?, roof?, glow? }, built once. */
function typeGeometry(t) {
  return (geoCache['type' + t] ??= (() => {
    const g = TYPE_BUILD[t](HULLS[t]);
    if (g.glow) g.glow = glowBoxes(g.glow);
    return g;
  })());
}

const shared = (key, build) => (geoCache[key + DIM.key] ??= build()); // one per size (see useDims)
// Compact models drawn only as the upgrades' pictures in the boat panel (the real pieces are spread over the whole
// boat and would be specks at 48 px). Built around the origin; the icon camera frames whatever it's given.
const line3 = (add, a, b, r, col) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); add(new THREE.BoxGeometry(r, r, A.distanceTo(B)).lookAt(B.clone().sub(A)).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2), col); };
const ICON_BUILD = {
  // a little steam engine: an iron block on a bed, a brass flywheel, and a stove pipe taller each level
  engine: (lvl) => parts(({ add, box }) => {
    box(0.9, 0.12, 0.6, C.DARK, 0, 0.06, 0);
    box(0.6, 0.45, 0.45, C.IRON, -0.05, 0.34, 0);
    box(0.64, 0.06, 0.49, C.BRASS, -0.05, 0.5, 0);
    add(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 12).rotateX(Math.PI / 2).translate(0.1, 0.36, 0.28), C.BRASS);
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8).rotateX(Math.PI / 2).translate(0.1, 0.36, 0.3), C.IRON);
    const h = 0.3 + 0.25 * lvl;
    add(new THREE.CylinderGeometry(0.08, 0.09, h, 8).translate(-0.22, 0.56 + h / 2, -0.08), C.IRON);
    add(new THREE.CylinderGeometry(0.13, 0.09, 0.07, 8).translate(-0.22, 0.58 + h, -0.08), C.IRON);
  }),
  // a rudder hung off a bit of transom, with its tiller; a bigger blade each level
  rudder: (lvl) => parts(({ box }) => {
    const d = 0.36 + 0.12 * lvl;
    box(0.7, 0.5, 0.08, C.PLANK2, 0, 0.35, -0.1); // the transom (behind it, from the icon's camera)
    box(0.06, 0.95, 0.08, C.POST, 0, 0.1, 0); // the stock
    box(0.05, 0.55, d, C.CAP, 0, -0.1, d / 2 - 0.02); // the blade
    box(0.055, 0.04, d, C.IRON, 0, 0.17, d / 2 - 0.02);
    for (const y of [-0.2, 0.3]) box(0.1, 0.05, 0.1, C.IRON, 0, y, -0.05); // the gudgeons
    box(0.05, 0.05, 0.6, C.RAIL, 0, 0.6, -0.3, 0, 0.12); // the tiller, over the deck
  }),
  // a sagging wire between two posts (the bulbs are the glow part)
  lights: () => parts(({ add, box }) => {
    for (const x of [-0.7, 0.7]) box(0.07, 0.8, 0.07, C.POST, x, 0.4, 0);
    const P = ICON_BULBS.map(([x, y]) => [x, y + 0.05, 0]);
    [[-0.7, 0.78, 0], ...P, [0.7, 0.78, 0]].forEach((a, i, all) => { if (i) line3(add, all[i - 1], a, 0.02, C.IRON); });
  }),
  // a line of pennants, canvas colour and white
  buntLine: () => parts(({ add, box }) => {
    for (const x of [-0.75, 0.75]) box(0.06, 0.9, 0.06, C.POST, x, 0.45, 0);
    const pts = ICON_PENNANTS.map(([x, y]) => [x, y, 0]);
    [[-0.75, 0.86, 0], ...pts, [0.75, 0.86, 0]].forEach((a, i, all) => { if (i) line3(add, all[i - 1], a, 0.02, C.ROPE); });
  }),
  buntA: () => parts(({ add }) => ICON_PENNANTS.forEach(([x, y], k) => { if (k % 2 === 0) add(new THREE.ConeGeometry(0.1, 0.24, 3).rotateX(Math.PI).translate(x, y - 0.13, 0), 1.0); })),
  buntB: () => parts(({ add }) => ICON_PENNANTS.forEach(([x, y], k) => { if (k % 2) add(new THREE.ConeGeometry(0.1, 0.24, 3).rotateX(Math.PI).translate(x, y - 0.13, 0), C.WHITE); })),
  // a life ring leaning on a tyre fender, with its rope
  trim: () => parts(({ add, box }) => {
    const g = new THREE.TorusGeometry(0.3, 0.09, 6, 16).rotateX(-0.25);
    add(g.translate(0, 0.42, 0), (x, y) => (Math.floor((Math.atan2(y - 0.42, x) + Math.PI) / (Math.PI / 4)) % 2 ? C.RED : C.WHITE));
    add(new THREE.TorusGeometry(0.15, 0.08, 6, 12).rotateY(Math.PI / 2).translate(0.48, 0.2, 0.1), C.TYRE);
    box(0.03, 0.5, 0.03, C.ROPE, 0.48, 0.6, 0.1);
  }),
  // a rod with its line, and a bucket with fish in it
  gear: () => parts(({ add, box }) => {
    add(new THREE.CylinderGeometry(0.2, 0.15, 0.32, 10).translate(0.15, 0.16, 0), 0x5a7a8a);
    add(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 10).translate(0.15, 0.3, 0), C.IRON);
    box(0.08, 0.22, 0.28, 0xf08a3c, 0.1, 0.38, 0, 0.4, 0, 0.5);
    box(0.08, 0.18, 0.24, 0xa9bccd, 0.22, 0.38, -0.03, -0.3, 0, -0.4);
    line3(add, [-0.35, 0.05, 0.05], [-0.1, 1.1, -0.05], 0.04, C.POST);
    box(0.09, 0.09, 0.09, C.IRON, -0.3, 0.25, 0.04);
    line3(add, [-0.1, 1.1, -0.05], [-0.3, 0.6, 0.05], 0.012, C.WHITE);
  }),
};
const ICON_BULBS = [-0.45, -0.2, 0.05, 0.3, 0.55].map((x) => [x, 0.78 - 0.22 * Math.sin(Math.PI * (x + 0.7) / 1.4)]);
const ICON_PENNANTS = [-0.5, -0.25, 0, 0.25, 0.5].map((x) => [x, 0.86 - 0.24 * Math.sin(Math.PI * (x + 0.75) / 1.5)]);
const iconGeo = (k, lvl = 0) => shared(`icon.${k}.${lvl}`, () => ICON_BUILD[k](lvl));
const iconBulbs = () => shared('icon.bulbs', () => {
  const g = mergeGeometries(ICON_BULBS.map(([x, y]) => { const b = new THREE.BoxGeometry(0.1, 0.12, 0.1).translate(x, y - 0.06, 0); b.deleteAttribute('uv'); return b; }));
  g.userData.shared = true;
  return g;
});
/** The picture of upgrade i at level lvl on a boat with look L. */
function upgradePieces(i, L, lvl) {
  const key = UPGRADE_KEYS[i];
  // the rowboat's Sail and the pirate ship's Rigging: a mast and sail
  if (key === 'engine' && (L.t === 1 || L.t === 2)) { const rs = rowSailParts(Math.min(lvl, 3)); return [{ geo: rs.mast }, { geo: rs.sail, tint: 'canvas' }]; }
  if (key === 'engine' || key === 'rudder') return [{ geo: iconGeo(key, lvl) }];
  if (L.t === 2 && key === 'trim') { const [g, p] = PIRATE_UP.trim(); return [{ geo: g }, { geo: p, tint: 'hull' }]; }
  if (L.t === 2 && key === 'gear') return [{ geo: PIRATE_UP.gear()[0] }];
  if (key === 'awning') return [{ geo: shared('awningPoles', awningPolesGeometry) }, { geo: shared('awningCanvas', awningCanvasGeometry), tint: 'canvas' }];
  if (key === 'lights') return [{ geo: iconGeo('lights') }, { geo: iconBulbs(), glow: true }];
  if (key === 'bunting') return [{ geo: iconGeo('buntLine') }, { geo: iconGeo('buntA'), tint: 'canvas' }, { geo: iconGeo('buntB') }];
  if (key === 'trim' || key === 'gear') return [{ geo: iconGeo(key) }];
  return [];
}
/**
 * The shapes that make up one variant of a part, for drawing its icon: [{ geo, tint, pos? }], tint = which look colour
 * tints it (null = fixed colours). kind: 'hull', 'cabin', 'roof', 'top', 'mast' or 'prop'; `look` gives the context
 * (the cabin a roof sits on, where the mast stands).
 */
export function partPieces(kind, v, look, lvl = 1) {
  const L = look ?? defaultLook();
  useDims(null); // icons show the parts on a boat of the original size
  if (kind === 'hull') return [{ geo: shared('base', baseGeometry) }, { geo: shared('hullPaint', hullPaintGeometry), tint: 'hull' }];
  if (kind === 'prop') { const g = propGeometry(v); return g ? [{ geo: g }, ...(v === 6 ? [{ geo: propGlowGeometry(), glow: true }] : [])] : []; }
  if (kind === 'upgrade') return upgradePieces(v, L, Math.max(1, lvl));
  // the pirate ship's parts
  if (kind === 'figure') { const g = pirateFigure(v); return g ? [{ geo: g }] : []; }
  if (kind === 'sails') return [{ geo: plainOf(pirateSail(v), 'plainSail.' + v), tint: 'canvas' }, { geo: plainOf(typeGeometry(2).rig, 'plainRig') }];
  if (kind === 'flag') return [{ geo: pirateFlag(v) }];
  if (kind === 'lanterns') { const g = pirateLamps(v); return g ? [{ geo: g }, { geo: pirateLampGlow(v), glow: true }] : []; }
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
export function boatGeometry(b = null) {
  const t = b?.look?.t ?? 0;
  useDims(b?.look);
  if (t) return shared('outline' + t, () => { const tg = typeGeometry(t), g = mergeGeometries([tg.base, tg.paint]); g.userData.shared = true; return g; });
  return shared('outline', () => {
    const g = mergeGeometries([shared('base', baseGeometry), shared('hullPaint', hullPaintGeometry)]);
    g.userData.shared = true;
    return g;
  });
}
/**
 * The whole boat as one geometry (shared per look's kind, size and parts): the hull, cabin, roofs, what's on top and
 * the mast, for the launch blueprint (main.js) to draw see-through before the boat goes in the water.
 */
export function blueprintGeometry(look) {
  const L = cleanLook(look);
  useDims(L);
  if (L.t) {
    const rs = L.t === 1 ? rowSailParts(L.u[0]) : null, pir = L.t === 2;
    return shared(`bp${L.t}.${rs ? L.u[0] : 0}.${pir ? L.p.join() : ''}`, () => {
      const tg = typeGeometry(L.t);
      const list = [tg.base, tg.paint, tg.cabin, tg.roof, tg.rig && plainOf(tg.rig, 'plainRig'), rs?.mast, rs?.sail];
      if (pir) list.push(plainOf(pirateSail(L.p[1]), 'plainSail.' + L.p[1]), pirateFigure(L.p[0]), pirateLamps(L.p[3]));
      const g = mergeGeometries(list.filter(Boolean));
      g.userData.shared = true;
      return g;
    });
  }
  const lay = layoutOf(L), { cab, wh, mast } = lay, ci = L.p[0];
  return shared(`bp0|${lay.key}|${lay.roof}|${lay.top}`, () => {
    const list = [shared('base', baseGeometry), shared('hullPaint', hullPaintGeometry)];
    if (cab) list.push(shared(`cabTrim${ci}`, () => cabinTrimGeometry(cab)), shared(`cabWalls${ci}`, () => cabinWallsGeometry(cab)), shared(`roof${ci}.${lay.roof}`, () => roofGeometry(cab, lay.roof)));
    if (lay.top === 0) list.push(shared(`topWalls${ci}`, () => topWallsGeometry(wh)), shared(`topRoof${ci}`, () => topRoofGeometry(wh)));
    if (lay.top < 2) list.push(shared(`topTrim${ci}.${lay.top}`, () => topTrimGeometry(wh, lay.top)));
    if (mast) { const mk = `${mast.x},${mast.y0},${mast.y1},${mast.z}`; list.push(shared(`mast${mk}.${lay.mastV}`, () => mastGeometry(mast, lay.mastV === 1))); }
    const g = mergeGeometries(list);
    g.userData.shared = true;
    return g;
  });
}
/**
 * The blueprint's lines (shared per look): the hull at the waterline and along the rail, ribs down its sides, and
 * boxes for the cabin and the wheelhouse, a line for the mast. A few clean lines read better than every plank's edges.
 */
export function blueprintLines(look) {
  const L = cleanLook(look), hl = hullOf(L), { H } = sizeOf(L);
  useDims(L);
  return shared(`bpl${L.t}|${L.p.join()}`, () => {
    const v = [], seg = (a, b) => v.push(...a, ...b);
    const N = 24, zs = Array.from({ length: N + 1 }, (_, i) => hl.STERN + (hl.TIP - hl.STERN) * (i / N));
    const rail = (z) => hl.DECK + 0.2 + sheerAt(z, hl);
    for (const sx of [-1, 1]) for (let i = 0; i < N; i++) {
      const [z0, z1] = [zs[i], zs[i + 1]], w0 = Math.max(0, halfW(z0, hl)), w1 = Math.max(0, halfW(z1 - 1e-4, hl));
      seg([sx * w0, 0.05, z0], [sx * w1, 0.05, z1]); // the waterline
      seg([sx * w0, rail(z0), z0], [sx * w1, rail(z1), z1]); // the rail
    }
    for (const y of [0.05, rail(hl.STERN)]) seg([-hl.W, y, hl.STERN], [hl.W, y, hl.STERN]); // the transom
    const ribs = Math.max(2, Math.round((hl.BOW0 - hl.STERN) / 1.1));
    for (let i = 0; i <= ribs; i++) { const z = hl.STERN + (hl.BOW0 - hl.STERN) * (i / ribs); for (const sx of [-1, 1]) seg([sx * hl.W, 0.05, z], [sx * hl.W, rail(z), z]); }
    seg([0, 0.05, hl.TIP], [0, rail(hl.TIP), hl.TIP]); // the stem
    const box = (x0, x1, y0, y1, z0, z1) => {
      for (const y of [y0, y1]) { seg([x0, y, z0], [x1, y, z0]); seg([x1, y, z0], [x1, y, z1]); seg([x1, y, z1], [x0, y, z1]); seg([x0, y, z1], [x0, y, z0]); }
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) seg([x, y0, z], [x, y1, z]);
    };
    if (!L.t) {
      const lay = layoutOf(L), { cab, wh, mast } = lay;
      if (cab) box(cab.x - cab.w / 2, cab.x + cab.w / 2, D + H, D + H + cab.h, cab.z - cab.d / 2, cab.z + cab.d / 2);
      if (wh && lay.top === 0) box(wh.x - 0.4, wh.x + 0.4, wh.y + H, wh.y + H + 0.55, wh.z - 0.4, wh.z + 0.4);
      if (mast) seg([mast.x, mast.y0 + H, mast.z], [mast.x, mast.y1 + H, mast.z]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.userData.shared = true;
    return g;
  });
}
function glowGeometry() {
  return shared('glow', () => {
    const g = mergeGeometries(LANTERNS.map(([x, z]) => { const b = new THREE.BoxGeometry(0.11, 0.14, 0.11).translate(x, mapY(D + 0.71), mapZ(z)); b.deleteAttribute('uv'); return b; }));
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
// The pirate ship's sails at each throttle setting (Astern, Stop, Slow, Half, Full): [how furled, how full of wind]
const SAIL_SET = [[0.25, -0.55], [1, 0.3], [0.45, 0.55], [0.12, 0.85], [0, 1.05]];
const SAIL_BRACE = 0.42; // how far the yards swing about their masts with the rudder hard over (rad)
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
    Object.assign(p, { x, z, vx, vz, size, grow, dur, bright, yaw, life: 0, env: this.world ? waveEnv(this.world, x, z) : 0 });
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
      const hl = b.hull ?? HULLS[0], k = Math.min(1, v / hl.MAX_SPEED), bowZ = hl.BOW0 + (hl.TIP - hl.BOW0) * 0.35;
      // bow waves: from both sides of the bow, pushed outward and falling behind
      for (const side of [-1, 1]) {
        const [x, z] = at(side * (hl.W * 0.62 + Math.random() * 0.2), dir > 0 ? bowZ + Math.random() * 0.5 : hl.STERN + 0.2);
        const out = 0.5 + 1.1 * k;
        this.spawn(x, z, (side * cs) * out - sn * v * 0.15 * dir, (-side * sn) * out - cs * v * 0.15 * dir, 0.08 + Math.random() * 0.07, 0.22, 1.3 + Math.random() * 0.6, 0.22 + 0.2 * k, b.syaw + (Math.random() - 0.5) * 0.6);
      }
      // stern trail: churned water left behind, spreading slowly
      const [x, z] = at((Math.random() - 0.5) * hl.W * 0.9, dir > 0 ? hl.STERN - 0.15 : hl.TIP);
      this.spawn(x, z, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.1, 0.3, 2 + Math.random() * 1.2, 0.18 + 0.22 * k, b.syaw + (Math.random() - 0.5) * 0.8);
    }
  }
  update(dt, t) {
    const m = this.mesh, y = SEA + 0.05 + Math.sin(t * 0.8) * 0.03; // ride on the water plane's gentle swell
    const T = waveClock(), w = this.world;
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
      m.setMatrixAt(i, _m.compose(_p.set(Math.round(p.x * 8) / 8, y + (w && p.env > 0 ? waveAt(w, p.x, p.z, T, p.env) : 0), Math.round(p.z * 8) / 8), _q.setFromEuler(_e.set(0, p.yaw, 0)), _s.set(s, 1, s)));
      m.setColorAt(i, _c.setRGB(fade * 0.9, fade * 0.97, fade));
    });
    if (any) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}

// ---------- boats in a scene ----------
const MAT = {};
// boats don't open up around you (removed at the user's request): when the cabin hides you, the
// character's silhouette shows through instead. Materials are still kept per deck height (H).
const lambert = (p) => new THREE.MeshLambertMaterial(p);
const baseMat = (H) => (MAT['base' + H] ??= H ? lambert({ vertexColors: true }) : materials().base);
const tintMats = (H) => ({ hull: lambert({ vertexColors: true }), cabin: lambert({ vertexColors: true }), roof: lambert({ vertexColors: true }), canvas: lambert({ vertexColors: true, side: THREE.DoubleSide }) });
const materials = () => {
  MAT.base ??= lambert({ vertexColors: true });
  MAT.glow ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 1.05, 0.32) });
  MAT.bulb ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 0.7) });
  MAT.flagTime ??= { value: 0 };
  MAT.jolly ??= flagMaterial(0xffffff); // the pirate flag keeps its own colours
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
  { key: 'engine', all: true, name: 'Engine', desc: 'Top speed +15% per level, and a taller chimney', cost: [{ wood: 6, stone: 4 }, { wood: 10, log: 4, stone: 8 }, { wood: 16, log: 8, stone: 14 }],
    // on the rowboat the same slot is a sail (same speed bonus), bigger with each level (ROW_SAIL)
    row: { name: 'Sail', desc: 'Top speed +15% per level, and a bigger sail', cost: [{ stick: 4, leaves: 10, wood: 2 }, { stick: 6, leaves: 16, wood: 4 }, { stick: 8, leaves: 24, wood: 6, log: 2 }] },
    // on the pirate ship it's the rigging: the same speed bonus, paid in rope (sticks and leaves) and timber
    ship: { name: 'Rigging', desc: 'Top speed +15% per level: taut rigging and well-trimmed sails', cost: [{ stick: 8, leaves: 12, wood: 4 }, { stick: 12, leaves: 20, wood: 8, log: 2 }, { stick: 16, leaves: 30, wood: 12, log: 4 }] } },
  { key: 'rudder', all: true, name: 'Rudder', desc: 'Turns 20% quicker per level', cost: [{ wood: 4, pebble: 4 }, { wood: 8, stone: 4 }] },
  { key: 'awning', name: 'Canvas awning', desc: 'Shade over the foredeck, in your canvas colour', cost: [{ stick: 6, leaves: 12 }] },
  // (ship: the pirate ship's own version of a decorative upgrade, PIRATE_UP)
  { key: 'lights', name: 'String lights', desc: 'Warm little lights strung around the deck', cost: [{ stick: 6, wood: 2, berries: 4 }],
    ship: { name: 'Rigging lights', desc: 'Warm little lights strung through the rigging, from the bowsprit to the stern', cost: [{ stick: 8, wood: 2, berries: 6 }] } },
  { key: 'bunting', name: 'Bunting', desc: 'Pennants from the masthead to bow and stern', cost: [{ stick: 4, leaves: 8, berries: 4 }],
    ship: { name: 'Signal flags', desc: 'Lines of flags from the bowsprit over every masthead to the stern', cost: [{ stick: 6, leaves: 12, berries: 6 }] } },
  { key: 'trim', name: 'Life rings & fenders', desc: 'Life rings, tyre fenders and a boarding ladder', cost: [{ wood: 4, log: 2 }],
    ship: { name: 'Lifeboat', desc: 'A little rowboat hung from davits across the stern', cost: [{ wood: 6, stick: 4 }] } },
  { key: 'gear', name: 'Fishing gear', desc: 'A rod, a net drying on the rail, a bucket of fish', cost: [{ stick: 8, pebble: 2, leaves: 4 }],
    ship: { name: 'Treasure hoard', desc: 'Open chests of gold and gems behind the wheel', cost: [{ stone: 6, pebble: 10, wood: 4 }] } },
];
// the upgrades' shapes: [shared key, builder] per mesh
const UPGRADE_GEO = {
  awning: [['awningPoles', awningPolesGeometry], ['awningCanvas', awningCanvasGeometry]],
  lights: [['lightsWire', lightsWireGeometry], ['lightsBulb', lightsBulbGeometry]],
  trim: [['trim', trimGeometry]],
  gear: [['gear', gearGeometry]],
};
/** Upgrade i as it applies to a boat of kind t (the rowboat's Engine is its Sail). */
/** Is upgrade i offered on a boat of kind t? (Every upgrade on the cabin boat; Engine and Rudder everywhere; the pirate ship's own versions on it.) */
export const upgradeOffered = (i, t) => !t || UPGRADES[i].all || (t === 2 && !!UPGRADES[i].ship);
export const upgradeFor = (i, t) => (t === 1 && UPGRADES[i].row ? { ...UPGRADES[i], ...UPGRADES[i].row } : t === 2 && UPGRADES[i].ship ? { ...UPGRADES[i], ...UPGRADES[i].ship } : UPGRADES[i]);
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
    this.wake.world = world; // the foam rides the swell
  }
  /** Add a boat or move one (and give it a look). `instant` jumps there (the local driver, or a new boat). */
  set(id, x, z, yaw, instant = false, look = undefined) {
    let b = this.list.get(id);
    if (!b) {
      const m = materials();
      useDims(null);
      const group = new THREE.Group();
      const mesh = (geo, mat, shadows = true) => { const o = new THREE.Mesh(geo ?? undefined, mat); o.visible = !!geo; o.castShadow = shadows; o.receiveShadow = true; group.add(o); return o; };
      // per-boat tinted materials: hull band, cabin, roof, canvas
      const tint = { ...tintMats(0), flag: flagMaterial(0xffffff) };
      const hullM = mesh(shared('base', baseGeometry), m.base);
      const paintM = mesh(shared('hullPaint', hullPaintGeometry), tint.hull);
      // parts swapped by the look (setLook): cabin trim and walls, roof, what's on the roof, mast and sail
      const sw = {
        cabinTrim: mesh(null, m.base), cabinWalls: mesh(null, tint.cabin), roof: mesh(null, tint.roof),
        topWalls: mesh(null, tint.cabin), topRoof: mesh(null, tint.roof), topTrim: mesh(null, m.base),
        mast: mesh(null, m.base), sail: mesh(null, tint.canvas), chimney: mesh(null, m.base),
        buntLine: mesh(null, m.base, false), buntA: mesh(null, tint.canvas, false), buntB: mesh(null, m.base, false),
      };
      const sloopGlow = mesh(glowGeometry(), m.glow, false);
      const flag = mesh(flagGeometry(), tint.flag);
      const pm = { awning: [m.base, tint.canvas], lights: [[m.base, false], [m.bulb, false]], trim: [m.base], gear: [m.base] };
      const parts = Object.fromEntries(Object.entries(UPGRADE_GEO).map(([key, list]) => [key, list.map(([k, build], i) => {
        const [mat, sh = true] = Array.isArray(pm[key][i]) ? pm[key][i] : [pm[key][i]];
        return mesh(shared(k, build), mat, sh);
      })]));
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
        p.rotation.y = sx * Math.PI / 2;
        return p;
      });
      // the fixed-model kinds of boat (HULLS 1: the rowboat): their geometry is chosen in setLook
      const tm = { base: mesh(null, m.base), paint: mesh(null, tint.hull), cabin: mesh(null, tint.cabin), roof: mesh(null, tint.roof), glow: mesh(null, m.glow, false),
        sail: null, rig: null, flag: mesh(null, m.jolly) }; // (the pirate ship's animated sails and yards, and black flag)
      tm.figure = mesh(null, m.base); tm.lamp = mesh(null, m.base); // the pirate ship's figurehead and stern lanterns
      // the pirate ship's decorative upgrades (PIRATE_UP): base material, a tint, or the bulbs' glow
      const pu = Object.fromEntries(Object.entries(PIRATE_UP_MESHES).map(([k, list]) => [k, list.map((mt) => mesh(null, mt === true ? m.base : mt === false ? m.bulb : tint[mt], mt === true))]));
      const sailM = sailMaterials();
      tm.sail = mesh(null, sailM.sail); tm.rig = mesh(null, sailM.rig);
      tm.sail.customDepthMaterial = tm.rig.customDepthMaterial = sailM.depth;
      // a rowboat's oars: each on a pivot at its rowlock (sx +1 = starboard), posed every frame in update()
      const oars = [1, -1].map((sx) => {
        const pivot = new THREE.Group(), o = new THREE.Mesh(oarGeometry(), m.base);
        o.castShadow = true; o.receiveShadow = true; o.userData.part = 'hull';
        pivot.add(o); pivot.visible = false; group.add(pivot);
        return { pivot, o, sx };
      });
      tag(tm.base, 'hull'); tag(tm.paint, 'hull'); tag(tm.cabin, 'cabin'); tag(tm.roof, 'roof'); tag(tm.sail, 'mast'); tag(tm.rig, 'mast'); tag(tm.flag, 'flag'); tag(tm.figure, 'figure'); tag(tm.lamp, 'lanterns'); tag(tm.glow, 'lanterns');
      for (const list of Object.values(pu)) for (const o of list) tag(o, 'hull');
      // the rowboat's sail upgrade: mast and rigging, and the sail in the canvas colour
      const rowSail = { mast: mesh(null, m.base), sail: mesh(null, tint.canvas) };
      tag(rowSail.mast, 'hull'); tag(rowSail.sail, 'hull');
      // everything that belongs to the cabin boat only (hidden on the other kinds)
      const sloopMeshes = [hullM, paintM, sloopGlow, flag, ...Object.values(sw), ...Object.values(parts).flat(), ...props.flat(), ...markers];
      this.scene.add(group);
      b = { id, x, z, yaw, sx: x, sz: z, syaw: yaw, speed: 0, group, flag, tint, sw, parts, props, markers, hullM, paintM, sloopGlow, sloopMeshes, tm, sailM, pu, rowSail, oars, plates, plateMat, look: null, hull: HULLS[0], obs: layoutOf(null).obs, editing: false, seeH: 0, baseM: m.base };
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
    useDims(L); // every shape below is built (once, shared) for this boat's size
    const { E, H } = DIM;
    if (b.seeH !== H) { // the cutaway keeps everything up to a taller boat's deck solid: materials for its deck height
      const nb = baseMat(H), nt = tintMats(H);
      b.group.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === b.baseM) o.material = nb;
        else for (const k of Object.keys(nt)) if (o.material === b.tint[k]) o.material = nt[k];
      });
      for (const k of Object.keys(nt)) b.tint[k].dispose();
      Object.assign(b.tint, nt);
      b.baseM = nb; b.seeH = H;
    }
    const col = (i) => BOAT_PALETTE[L.c[i]];
    b.tint.hull.color.setHex(col(0));
    b.tint.cabin.color.setHex(col(1));
    b.tint.roof.color.setHex(col(2));
    b.tint.canvas.color.setHex(col(3));
    b.tint.flag.color.setHex(col(3));
    const sm = b.sailM.sail; // the pirate ship's sails: canvas colour, with a little light through the cloth
    sm.color.setHex(col(3));
    sm.emissive.setHex(col(3)).multiplyScalar(0.18);
    const hl = (b.hull = hullOf(L)), tg = L.t ? typeGeometry(L.t) : null;
    for (const [k, o] of Object.entries(b.tm)) { const g = tg?.[k]; if (g) o.geometry = g; o.visible = !!g; }
    if (tg?.flagAt) b.tm.flag.position.set(...tg.flagAt);
    const rs = L.t === 1 ? rowSailParts(L.u[0]) : null;
    for (const [k, o] of Object.entries(b.rowSail)) { if (rs) o.geometry = rs[k]; o.visible = !!rs; }
    for (const oar of b.oars) { oar.pivot.visible = L.t === 1; oar.pivot.position.set(oar.sx * (hl.W - 0.02), hl.DECK + OAR.PIVOT_Y, OAR.PIVOT_Z); }
    // name plates on both quarters, on the hull band
    b.plates.forEach((p, i) => { const sx = i ? -1 : 1; p.position.set(sx * (hl.W + 0.03), L.t ? hl.DECK - 0.11 : mapY(0.3), L.t ? hl.STERN * 0.55 : -1.75); p.scale.setScalar(L.t === 1 ? 0.6 : 1); });
    if (!old || old.n !== L.n) {
      b.plateMat.map?.dispose();
      b.plateMat.map = L.n ? nameTexture(L.n) : null;
      b.plateMat.needsUpdate = true;
      for (const p of b.plates) p.visible = !!L.n;
    }
    // what's been placed on the deck (rebuilt when it changes)
    const fKey = JSON.stringify(L.f) + L.t + DIM.key;
    if (b.decoKey !== fKey) {
      b.decoKey = fKey;
      for (const o of b.deco ?? []) b.group.remove(o);
      b.deco = [];
      for (const [t, x, z, r] of L.f) {
        for (const [geo, mat, shadows] of [[furnitureGeometry(t), b.baseM, true], [furnitureGlowGeometry(t), materials().glow, false]]) {
          if (!geo) continue;
          const o = new THREE.Mesh(geo, mat);
          o.scale.setScalar(DECO_SCALE);
          o.position.set(x / 100, hl.DECK + 0.025, z / 100);
          o.rotation.y = r * Math.PI / 2;
          o.castShadow = shadows; o.receiveShadow = true;
          o.userData.deco = [t, x, z, r];
          b.group.add(o); b.deco.push(o);
        }
      }
    }
    for (const list of Object.values(b.pu)) for (const o of list) o.visible = false;
    if (L.t) { // a fixed model: none of the cabin boat's parts or decorations (the pirate ship has its own)
      for (const o of b.sloopMeshes) o.visible = false;
      if (L.t === 2) this.pirateLook(b, L, hl);
      b.obs = withDeco(layoutOf(L).obs, L);
      return;
    }
    b.hullM.visible = b.paintM.visible = b.sloopGlow.visible = true;
    // the hull, lanterns and upgrades at this size
    b.hullM.geometry = shared('base', baseGeometry);
    b.paintM.geometry = shared('hullPaint', hullPaintGeometry);
    b.sloopGlow.geometry = glowGeometry();
    for (const [key, list] of Object.entries(UPGRADE_GEO)) list.forEach(([k, build], i) => { b.parts[key][i].geometry = shared(k, build); });
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
    if (mast) b.flag.position.set(mast.x, mapY(mast.y1 - 0.25), mapZ(mast.z));
    const top = mast && [mast.x, mast.y1 - 0.05, mast.z], showBunt = !!mast && L.u[4] > 0;
    put(sw.buntLine, showBunt && shared(`buntLine${mk}`, () => buntingLineGeometry(top)));
    put(sw.buntA, showBunt && shared(`buntA${mk}`, () => pennants(top, 1, 1.0)));
    put(sw.buntB, showBunt && shared(`buntB${mk}`, () => pennants(top, 0, C.WHITE)));
    const lvl = L.u[0]; // the engine's chimney stands on the cabin roof (not on canvas, and not without a cabin)
    put(sw.chimney, lvl > 0 && cab && lay.roof !== 2 && shared(`chimney${ci}.${lvl}`, () => chimneyGeometry(lvl, cab)));
    b.props.forEach(([o, g], i) => {
      const t = propAt(L, i), sl = DECK_SLOTS[i];
      put(o, propGeometry(t)); put(g, t === 6 && propGlowGeometry());
      o.position.set(sl.x, 0, zAt(sl.z, E)); g.position.copy(o.position);
      o.rotation.y = t === CANNON && sl.x < 0 ? Math.PI : 0; // a cannon points out over its own rail
      b.markers[i].position.set(sl.x, D + H + 0.04, zAt(sl.z, E));
      b.markers[i].visible = b.editing && !t;
    });
    b.obs = withDeco(lay.obs, L); // what riders walk around
  }
  /** The pirate ship's chosen parts (look.p), its deck props (look.d on PIRATE_SLOTS) and its decorative upgrades. */
  pirateLook(b, L, hl) {
    const put = (o, geo) => { if (geo) o.geometry = geo; o.visible = !!geo; };
    put(b.tm.figure, pirateFigure(L.p[0]));
    put(b.tm.sail, pirateSail(L.p[1]));
    put(b.tm.flag, pirateFlag(L.p[2]));
    put(b.tm.lamp, pirateLamps(L.p[3]));
    put(b.tm.glow, pirateLampGlow(L.p[3]));
    b.props.forEach(([o, g], i) => {
      const t = propAt(L, i), sl = PIRATE_SLOTS[i];
      put(o, propGeometry(t)); put(g, t === 6 && propGlowGeometry());
      o.position.set(sl.x, hl.DECK - D, sl.z); g.position.copy(o.position); // (props are built for the cabin boat's deck height)
      o.rotation.y = t === CANNON && sl.x < 0 ? Math.PI : 0;
      b.markers[i].position.set(sl.x, hl.DECK + 0.04, sl.z);
      b.markers[i].visible = b.editing && !t;
    });
    for (const [key, list] of Object.entries(b.pu)) {
      const on = L.u[UPGRADE_KEYS.indexOf(key)] > 0, geos = on ? PIRATE_UP[key]() : [];
      list.forEach((o, k) => put(o, on && geos[k]));
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
    b.markers.forEach((o, i) => { o.visible = on && b.look.t !== 1 && !propAt(b.look, i); }); // (the cabin boat and the pirate ship have deck spots)
  }
  /** The mesh that stands for a part when it's outlined (hovered in edit mode). */
  partMesh(b, part, slot) {
    const sw = b.sw;
    if (b.look?.t) {
      const o = { hull: b.tm.base, cabin: b.tm.cabin, roof: b.tm.roof, mast: b.tm.sail, figure: b.tm.figure, flag: b.tm.flag, lanterns: b.tm.lamp }[part]
        ?? (part === 'slot' && b.look.t === 2 ? (b.props[slot][0].visible ? b.props[slot][0] : b.markers[slot]) : null);
      return o?.visible ? o : null;
    }
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
    for (const k of ['sail', 'rig', 'depth']) b.sailM[k].dispose();
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
        const hl = b.hull ?? HULLS[0], kd = hl.KEEL_DEPTH;
        for (const lz of [hl.TIP * 0.8, 0, hl.STERN * 0.85]) bed = Math.max(bed, this.world.H(toCell(b.sx + lz * sn), toCell(b.sz + lz * cs)));
        const want = Math.min(kd, Math.max(0, bed + kd + 0.04 - SEA));
        b.lift = (b.lift ?? want) + (want - (b.lift ?? want)) * (1 - Math.exp(-dt * 3));
      }
      // ride the swell (open water only, waves.js): sample it at the bow, stern and both sides; the hull's
      // inertia smooths it, so a short wave rocks it less than a long one
      let wh = 0, wp = 0, wr = 0, env = 0, bowRise = 0;
      if (this.world) {
        const hl = b.hull ?? HULLS[0], T = waveClock(), zb = hl.TIP * 0.75, zs = hl.STERN * 0.85, xw = hl.W;
        env = waveEnv(this.world, b.sx, b.sz);
        const at = (lx, lz) => { const [x, z] = toWorldXZ(b, lx, lz); return waveAt(this.world, x, z, T); };
        const hb = at(0, zb), hs = at(0, zs), hp = at(-xw, 0), hr = at(xw, 0);
        wh = (hb + hs + hp + hr) / 4;
        wp = Math.atan2(hb - hs, zb - zs); // + = bow up
        wr = Math.atan2(hr - hp, 2 * xw); // + = starboard up
        bowRise = (hb - (b.hbPrev ?? hb)) / Math.max(dt, 1e-3); // the bow meeting a wave face (spray slaps)
        b.hbPrev = hb;
      }
      const kw = 1 - Math.exp(-dt * 5);
      b.wH = (b.wH ?? wh) + (wh - (b.wH ?? wh)) * kw;
      b.wP = (b.wP ?? wp) + (wp - (b.wP ?? wp)) * kw;
      b.wR = (b.wR ?? wr) + (wr - (b.wR ?? wr)) * kw;
      b.wEnv = env; b.bowRise = bowRise;
      g.position.set(b.sx, SEA + bobY(b, t) + (b.lift ?? 0) + b.wH, b.sz);
      // Heel out of turns and lift the bow with speed. Worked out from how the boat moves on this screen, which is
      // smooth for its driver; everyone else uses the driver's values from the network (np.h / np.l), because
      // deriving them from a replayed path (a derivative of a derivative) twitched.
      let heel = THREE.MathUtils.clamp(b.visTurn * Math.abs(b.visFwd) * 0.035, -0.12, 0.12);
      let lean = THREE.MathUtils.clamp(b.visAcc * 0.03 + b.vis * 0.006, -0.09, 0.09);
      if (np && np.h != null) { heel = np.h; lean = np.l ?? lean; }
      b.heel = heel; b.lean = lean; // sent with the driver's boat updates
      const roll = Math.sin(t * 1.1 + b.id % 3) * 0.028 * (1 + b.vis * 0.15) - heel + b.wR;
      const pitch = Math.sin(t * 0.9 + b.id % 5) * 0.018 - lean - b.wP;
      g.rotation.set(pitch, b.syaw, roll, 'YXZ');
      b.dyx = Math.sin(roll) * Math.cos(pitch); b.dyz = -Math.sin(pitch); // for deckY at a spot on deck
      if (b.look?.t === 1) this.row(b, dt);
      this.wake.emit(b, dt);
      this.spray(b, dt, t);
      // the flag streams away from where the boat is heading, a little to the wind side
      b.flag.rotation.y = Math.PI / 2 + Math.sin(t * 0.7 + b.id) * 0.25;
      b.tm.flag.rotation.y = b.flag.rotation.y;
      if (b.tm.sail.visible) this.sails(b, dt, t, b.id === drivenId);
    }
    this.wake.update(dt, t);
  }
  /**
   * The pirate ship's sails, from its throttle and rudder (the driver's own, or the ones sent with its updates; a boat
   * nobody sails is at Stop): furled at Stop (gathered up to the yards and stays), reefed and half full at Slow, fuller
   * at Half, full and straining at Full, taken aback (bellying backward) going Astern. They fill with a gentle gusting
   * breeze, and the yards swing about their masts as the rudder goes over. Everything eases, so it never snaps.
   */
  sails(b, dt, t, mine) {
    const thr = mine || b.netThrottle == null ? (b.throttle ?? 0) : b.netThrottle;
    const rud = mine || b.netRudder == null ? (b.rudder ?? 0) : b.netRudder;
    const [furl, fill] = SAIL_SET[thr + 1] ?? SAIL_SET[1];
    const gust = (1 - furl) * (0.05 * Math.sin(t * 0.7 + b.id % 13) + 0.03 * Math.sin(t * 1.9 + b.id % 7));
    const ease = (v, to, rate) => (v ?? to) + (to - (v ?? to)) * (1 - Math.exp(-dt * rate));
    b.sFurl = ease(b.sFurl, furl, 1.5); // the crew takes a moment (about 2 s) to set or furl them
    b.sFill = ease(b.sFill, fill + gust, 1.6);
    b.sBrace = ease(b.sBrace, -rud * SAIL_BRACE, 1.4);
    const u = b.sailM.uni;
    u.uFurl.value = b.sFurl; u.uFill.value = b.sFill; u.uBrace.value = b.sBrace;
  }
  /**
   * Rowing: a stroke clock (b.rowPhase) that runs while the boat moves or turns (backwards going astern), and the
   * oars posed from it. Catch (phase 0): blades forward and in the water; drive (0–π): they sweep aft through the
   * water; recovery (π–2π): lifted clear and swung forward again. The rower's pose (character.js ANIM.ROW) reads the
   * same clock, so they stay in step on every screen.
   */
  row(b, dt) {
    const hl = b.hull, effort = Math.min(1, (Math.abs(b.visFwd ?? 0) + Math.abs(b.visTurn ?? 0) * 1.2) / (hl.MAX_SPEED * 0.6));
    const dir = (b.visFwd ?? 0) < -0.05 ? -1 : 1;
    b.rowPhase = ((b.rowPhase ?? 0) + dt * Math.PI * 2 * (0.25 + 0.55 * effort) * dir * (effort > 0.04 ? 1 : 0) + Math.PI * 2) % (Math.PI * 2);
    const c = Math.cos(b.rowPhase), sweep = OAR.SWEEP * c;
    // the blade dips through the drive and lifts through the recovery (a smooth curve, deepest mid-drive)
    const tilt = -((OAR.DIP + OAR.LIFT) / 2 + ((OAR.DIP - OAR.LIFT) / 2) * Math.sin(b.rowPhase));
    for (const { pivot, o, sx } of b.oars) {
      pivot.rotation.y = sx > 0 ? -sweep : Math.PI + sweep; // both blades forward at the catch
      o.rotation.z = tilt;
    }
  }
  /**
   * Bow spray: droplets (Effects.drop) thrown up and out from both sides of the bow as it cuts through the water,
   * more the faster it goes, in rhythmic slaps as the bow meets the waves, and heavier on the side it heels toward;
   * at speed a little churn at the stern too. Going astern the stern throws a smaller spray.
   */
  spray(b, dt, t) {
    const fx = this.effects, v = b.vis ?? 0, hl = b.hull ?? HULLS[0];
    if (!fx || v < 1.1) return;
    const k = Math.min(1, v / hl.MAX_SPEED), s = hl.W / BOAT.W, astern = (b.visFwd ?? 0) < -0.3;
    const sn = Math.sin(b.syaw), cs = Math.cos(b.syaw), dir = astern ? -1 : 1;
    const y = SEA + 0.04 + bobY(b, t) + (b.wH ?? 0);
    // the bow meeting a wave: on open water, when the swell lifts the bow; in calm water, a gentle rhythm
    const calm = 0.45 + 1.4 * Math.max(0, Math.sin(t * 2.3 + b.id % 11)) ** 3, env = Math.min(1, b.wEnv ?? 0);
    const slap = calm * (1 - env) + env * (0.25 + 2.2 * Math.min(1, Math.max(0, (b.bowRise ?? 0) * 3)));
    const lz = astern ? hl.STERN + 0.1 : hl.BOW0 + (hl.TIP - hl.BOW0) * 0.45;
    const fwdV = (b.visFwd ?? 0) * 0.5;
    b.sprayAcc ??= [0, 0];
    [1, -1].forEach((side, i) => {
      const heel = 1 + Math.max(-0.6, Math.min(1.5, side * (b.heel ?? 0) * 12)); // more on the side it leans toward
      b.sprayAcc[i] += dt * 150 * Math.max(0, k - 0.12) ** 1.4 * slap * heel * (astern ? 0.35 : 1) * Math.sqrt(s);
      while (b.sprayAcc[i] >= 1) {
        b.sprayAcc[i] -= 1;
        const lx = side * (Math.max(0.1, halfW(lz, hl)) + 0.05), zz = lz + (Math.random() - 0.3) * 0.5 * s;
        const wx = b.sx + lx * cs + zz * sn, wz = b.sz - lx * sn + zz * cs;
        const out = (0.6 + 1.9 * k) * (0.6 + Math.random() * 0.7), back = -0.5 - Math.random() * 0.6;
        const vx = side * cs * out + sn * (fwdV + back * dir), vz = -side * sn * out + cs * (fwdV + back * dir);
        fx.drop(wx, y, wz, vx, (1.1 + 2.7 * k) * (0.55 + Math.random() * 0.65) * Math.sqrt(s), vz, (0.045 + Math.random() * 0.045) * (0.6 + 0.4 * s));
        // the white water where the bow cuts in, peeling away along the hull
        if (Math.random() < 0.5) fx.foamAt(wx, wz, vx * 0.35, vz * 0.35, (0.12 + Math.random() * 0.1) * s, 0.5 + Math.random() * 0.5, 0.4 + 0.35 * k, SEA + bobY(b, t) * 0.5 + (b.wH ?? 0));
      }
    });
    if (!astern && k > 0.35 && Math.random() < dt * 30 * (k - 0.35)) { // churned water at the stern
      const lx = (Math.random() - 0.5) * hl.W, zz = hl.STERN - 0.1;
      fx.drop(b.sx + lx * cs + zz * sn, y, b.sz - lx * sn + zz * cs, (Math.random() - 0.5) * 0.6 - sn * 0.6, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6 - cs * 0.6, 0.04 + Math.random() * 0.03);
    }
  }
  /** The boat whose deck covers world (x, z), or null. */
  at(x, z) {
    for (const b of this.list.values()) { const [lx, lz] = toLocal(b, x, z); if (onDeck(lx, lz, b.hull)) return b; }
    return null;
  }
  /** [[id, x, z, yaw, look]...] rounded, for saves. */
  listOut() { return [...this.list.values()].map((b) => [b.id, +b.x.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(3), b.look]); }
}
