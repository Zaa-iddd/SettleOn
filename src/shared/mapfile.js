// Map files: a compact, JSON-safe form of a world "base" (see finishWorld in world.js).
// Only the hand-editable parts are stored: terrain heights and ground kinds per column, the
// campfire cell, ruin cells, and trees/rocks per cell. Everything else (flowers, grass, ferns,
// fireflies...) is regenerated from the map's seed, so maps stay small (~35 KB).
//
// { v: 1, name, seed,
//   h: string, one char per column (row-major): '0' + height level (height = level × STEP)
//   k: string, one digit per column: ground kind (K)
//   camp: [ix, iz], ruins: [[ix, iz]...],
//   trees: [[ix, iz, type, s×100]...]  (type: 0 leafy, 1 pine, 2 redwood),
//   rocks: [[ix, iz, s×100]...] }
//
// Endless worlds (endless.js) are generated from the seed alone, so their file is tiny:
// { v: 1, type: 'endless', name, seed, edits?: [[ix, iz, level, kind]...] }  (edits = player digging)

import { WORLD, STEP, SEA, K, MAX_KIND, MAX_FURNITURE, MIN_LEVEL, WORLD_LIMIT, CHEST_SLOTS, inWorld } from './world.js';
import { cleanLook } from './boatlook.js';

export const MAP_VERSION = 1;
export const MAX_LEVEL = 40; // 20 units high
export const MAX_RUINS = 8;
const TREE_TYPES = ['leafy', 'pine', 'redwood', 'palm'];
const N = WORLD * WORLD;

export function encodeMap(base, name = 'My island') {
  let h = '', k = '';
  for (let i = 0; i < N; i++) {
    h += String.fromCharCode(48 + Math.max(0, Math.min(MAX_LEVEL, Math.round(base.heights[i] / STEP))));
    k += String(base.kinds[i]);
  }
  return {
    v: MAP_VERSION,
    name: String(name).slice(0, 40),
    seed: base.seed >>> 0,
    h, k,
    camp: [base.camp.ix, base.camp.iz],
    ruins: base.ruins.map((r) => [r.ix, r.iz]),
    trees: base.trees.map((t) => [t.ix, t.iz, Math.max(0, TREE_TYPES.indexOf(t.type)), Math.round(t.s * 100)]),
    rocks: base.rocks.map((r) => [r.ix, r.iz, Math.round(r.s * 100)]),
  };
}

const int = (v) => (Number.isInteger(v) ? v : NaN);
const cellOk = (ix, iz) => Number.isInteger(ix) && Number.isInteger(iz) && inWorld(ix, iz);

/** A saved endless world. */
export const MAX_EDITS = 20000;
export const endlessMap = (name, seed, edits = [], chops = [], benches = [], picks = [], piles = [], boats = [], chests = []) => ({
  v: MAP_VERSION, type: 'endless', name: String(name ?? 'Endless world').slice(0, 40), seed: seed >>> 0,
  ...(edits.length ? { edits: edits.slice(-MAX_EDITS) } : {}),
  ...(chops.length ? { chops: chops.slice(-MAX_EDITS) } : {}),
  ...(benches.length ? { benches: benches.slice(-MAX_EDITS) } : {}),
  ...(picks.length ? { picks: picks.slice(-MAX_EDITS) } : {}),
  ...(piles.length ? { piles: piles.slice(-MAX_EDITS) } : {}),
  ...(boats.length ? { boats: boats.slice(-MAX_BOATS) } : {}),
  ...(chests.length ? { chests: chests.slice(-MAX_CHESTS) } : {}),
});
/**
 * A chest's contents on the wire and in saves: CHEST_SLOTS entries, each [item id, count] or 0. Item ids are only
 * checked for their shape here (the client drops ids it doesn't know); counts are 1..64. Returns null if it's bad.
 */
export function cleanChestSlots(s) {
  if (!Array.isArray(s) || s.length > CHEST_SLOTS) return null;
  const out = [];
  for (let i = 0; i < CHEST_SLOTS; i++) {
    const e = s[i];
    if (!e) { out.push(0); continue; }
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || !/^[a-z_]{1,32}$/.test(e[0]) || !Number.isInteger(e[1]) || e[1] < 1 || e[1] > 64) return null;
    out.push([e[0], e[1]]);
  }
  return out;
}
/** Validate a list of chests [[ix, iz, slots]...]; bad entries are dropped. */
export const MAX_CHESTS = 5000;
export function cleanChests(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD, out = [];
  for (const e of list.slice(-MAX_CHESTS)) {
    if (!Array.isArray(e) || e.length !== 3 || !Number.isInteger(e[0]) || !Number.isInteger(e[1]) || Math.abs(e[0]) > lim || Math.abs(e[1]) > lim) continue;
    const s = cleanChestSlots(e[2]);
    if (s) out.push([e[0], e[1], s]);
  }
  return out;
}
/** Validate a list of boats [[id, x, z, yaw, look?]...] (look: see boatlook.js) (id a positive integer, x/z world units); bad entries are dropped. */
export const MAX_BOATS = 200;
export function cleanBoats(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD;
  return list.slice(-MAX_BOATS).filter((e) => Array.isArray(e) && (e.length === 4 || e.length === 5) && Number.isInteger(e[0]) && e[0] > 0 && e[0] < 2 ** 31
    && e.slice(1, 4).every(Number.isFinite) && Math.abs(e[1]) <= lim && Math.abs(e[2]) <= lim && Math.abs(e[3]) <= 100)
    .map(([id, x, z, yaw, look]) => [id, x, z, yaw, cleanLook(look)]); // older saves (no look) get the default look
}
/** Validate a list of log piles [[ix, iz, r 0..1, n 1..6]...]; bad entries are dropped. */
export function cleanPiles(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD;
  return list.slice(-MAX_EDITS).filter((e) => Array.isArray(e) && e.length === 4 && e.every(Number.isInteger) && Math.abs(e[0]) <= lim && Math.abs(e[1]) <= lim && (e[2] === 0 || e[2] === 1) && e[3] >= 1 && e[3] <= 6);
}
/** Validate a list of picks [[ix, iz, t 0..5]...] (see PICK in world.js); bad entries are dropped. */
export function cleanPicks(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD;
  return list.slice(-MAX_EDITS).filter((e) => Array.isArray(e) && e.length === 3 && e.every(Number.isInteger) && Math.abs(e[0]) <= lim && Math.abs(e[1]) <= lim && e[2] >= 0 && e[2] <= 5);
}
/** Validate a list of placed furniture [[ix, iz, rot 0..3, type?]...] (no type = a workbench); bad entries are dropped. */
export function cleanBenches(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD;
  return list.slice(-MAX_EDITS).filter((e) => Array.isArray(e) && (e.length === 3 || e.length === 4) && e.every(Number.isInteger) && Math.abs(e[0]) <= lim && Math.abs(e[1]) <= lim && e[2] >= 0 && e[2] <= 3 && (e[3] ?? 0) >= 0 && (e[3] ?? 0) <= MAX_FURNITURE)
    .map(([ix, iz, r, t = 0]) => [ix, iz, r, t]);
}
/** Validate a list of chopped trees [[ix, iz]...] (the tree's own cell); bad entries are dropped. */
export function cleanChops(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD;
  return list.slice(-MAX_EDITS).filter((e) => Array.isArray(e) && e.length === 2 && e.every(Number.isInteger) && Math.abs(e[0]) <= lim && Math.abs(e[1]) <= lim);
}
/** Validate a list of digging edits [[ix, iz, level, kind]...]; bad entries are dropped. */
export function cleanEdits(list) {
  if (!Array.isArray(list)) return [];
  const lim = WORLD_LIMIT + WORLD;
  // [ix, iz, level, kind] or [ix, iz, level, kind, underLevel, underKind] (the ground under placed blocks)
  return list.slice(-MAX_EDITS).filter((e) => Array.isArray(e) && (e.length === 4 || e.length === 6) && e.every(Number.isInteger)
    && Math.abs(e[0]) <= lim && Math.abs(e[1]) <= lim && e[2] >= MIN_LEVEL && e[2] <= 48 && e[3] >= 0 && e[3] <= MAX_KIND
    && (e.length === 4 || (e[4] >= 0 && e[4] <= 48 && e[5] >= 0 && e[5] <= MAX_KIND)));
}
export const isEndlessMap = (m) => !!m && typeof m === 'object' && m.type === 'endless';
/** Validate an endless world file; returns a clean copy. Throws on bad input. */
export function decodeEndless(m) {
  if (!isEndlessMap(m)) throw new Error('not an endless world');
  if (m.v !== MAP_VERSION) throw new Error(`unsupported map version ${m.v}`);
  if (!Number.isFinite(m.seed)) throw new Error('endless world has no seed');
  return endlessMap(m.name, m.seed, cleanEdits(m.edits), cleanChops(m.chops), cleanBenches(m.benches), cleanPicks(m.picks), cleanPiles(m.piles), cleanBoats(m.boats), cleanChests(m.chests));
}

/** Parse and validate an island map object (from a file, storage or the network). Throws on bad input. */
export function decodeMap(m) {
  if (!m || typeof m !== 'object') throw new Error('not a map');
  if (isEndlessMap(m)) throw new Error("endless worlds can't be opened in the map editor");
  if (m.v !== MAP_VERSION) throw new Error(`unsupported map version ${m.v}`);
  if (typeof m.h !== 'string' || typeof m.k !== 'string' || m.h.length !== N || m.k.length !== N) throw new Error('map has the wrong size');
  const heights = new Float32Array(N), kinds = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const lvl = m.h.charCodeAt(i) - 48, kd = m.k.charCodeAt(i) - 48;
    if (!(lvl >= 0 && lvl <= MAX_LEVEL) || !(kd >= 0 && kd <= MAX_KIND)) throw new Error('map has bad terrain data');
    heights[i] = lvl * STEP;
    kinds[i] = heights[i] < SEA ? K.SEABED : kd === K.SEABED ? K.SAND : kd;
  }
  const list = (a, max) => (Array.isArray(a) ? a.slice(0, max) : []);
  const camp = Array.isArray(m.camp) && cellOk(int(m.camp[0]), int(m.camp[1])) ? { ix: m.camp[0], iz: m.camp[1] } : { ix: WORLD / 2, iz: WORLD / 2 };
  return {
    name: String(m.name ?? 'Untitled').slice(0, 40),
    seed: Number.isFinite(m.seed) ? m.seed >>> 0 : 1,
    heights, kinds, camp,
    ruins: list(m.ruins, MAX_RUINS).filter((r) => Array.isArray(r) && cellOk(r[0], r[1])).map(([ix, iz]) => ({ ix, iz })),
    trees: list(m.trees, 6000).filter((t) => Array.isArray(t) && cellOk(t[0], t[1]) && TREE_TYPES[t[2]] && t[3] > 0)
      .map(([ix, iz, ty, s]) => ({ ix, iz, type: TREE_TYPES[ty], s: Math.min(4, s / 100) })),
    rocks: list(m.rocks, 6000).filter((r) => Array.isArray(r) && cellOk(r[0], r[1]) && r[2] > 0)
      .map(([ix, iz, s]) => ({ ix, iz, s: Math.min(2, s / 100) })),
  };
}

/** Deep copy of a base (so edits don't touch the world being played). */
export function cloneBase(b) {
  return {
    name: b.name, seed: b.seed,
    heights: Float32Array.from(b.heights), kinds: Uint8Array.from(b.kinds),
    camp: { ix: b.camp.ix, iz: b.camp.iz },
    ruins: b.ruins.map((r) => ({ ix: r.ix, iz: r.iz })),
    trees: b.trees.map((t) => ({ ix: t.ix, iz: t.iz, type: t.type, s: t.s })),
    rocks: b.rocks.map((r) => ({ ix: r.ix, iz: r.iz, s: r.s })),
  };
}

/** A fresh, empty island to start editing from: a round grassy plateau with a beach ring. */
export function blankBase(seed = Math.floor(Math.random() * 2 ** 31)) {
  const heights = new Float32Array(N), kinds = new Uint8Array(N);
  for (let iz = 0; iz < WORLD; iz++) {
    for (let ix = 0; ix < WORLD; ix++) {
      const i = iz * WORLD + ix, d = Math.hypot(ix + 0.5 - WORLD / 2, iz + 0.5 - WORLD / 2);
      const h = d < 30 ? 2.5 : d < 33 ? 2.0 : d < 36 ? 1.0 : 0.5;
      heights[i] = h;
      kinds[i] = h < SEA ? K.SEABED : h <= SEA + 0.3 ? K.SAND : K.GRASS;
    }
  }
  return { name: 'New island', seed, heights, kinds, camp: { ix: WORLD / 2, iz: WORLD / 2 }, ruins: [], trees: [], rocks: [] };
}
