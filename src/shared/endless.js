// Endless worlds (Minecraft-style): terrain for any cell, generated from the seed in CH×CH chunks
// as players explore. Everything is a pure function of (seed, cell), so chunks always line up at
// their borders and every player in a room sees the same world without the server sending terrain.
//
// The rules mirror the island (world.js: generateWorld + finishWorld): same ground kinds, trees,
// rocks, flowers, foliage, walk-under trees, redwood groves and ruins. What differs:
//  - no island falloff: a slow "continent" noise makes oceans, coasts and continents, and a second
//    slow noise raises mountain ranges
//  - deep forest uses a fixed noise threshold (DEEP_T) instead of ranking a whole island
//  - redwood spacing and walk-under corners are decided locally (no scan order across the map)
//  - ruins: at most one per RUIN_REGION×RUIN_REGION cells, at a seeded spot
// Cells use the island's mapping (x = ix - WORLD/2 + 0.5); ix and iz may be negative.

import {
  WORLD, STEP, SEA, K, VILLAGE_RADIUS, TREE_SCALE, WORLD_LIMIT, LEAFY_NEAR, PINE_CHANCE, PINE_SCALE, PINE_NEAR, TALL_GRASS_T,
  rng, hash2, fbm, smooth, toWorld, toCell, cellKey, keyX, keyZ, isForest, isDirt, FOREST_SCALE, waterLife, bankLife, pickKey, applyPicks, pebbleChance } from './world.js';

export const CH = 16; // cells per chunk side
const DEEP_T = 0.647; // fbm value above which lowland grass/forest becomes deep forest (~16%, like the island)
const MAX_LEVEL = 48; // highest terrain level (24 units)
const PEAK_EASE = 34; // levels above this rise at 45% (rounded summits, ~20 units typical)
// Mountains: lush lower slopes, a thin rocky band, snowy tops. The snow line wobbles ±1.5 with a noise,
// and the rock band sits ROCK_BAND below it. Mountain slopes also grow more forest (MOUNTAIN_FOREST_T).
const SNOW_H = 13.5, ROCK_BAND = 1.5, MOUNTAIN_FOREST_T = 0.42;
// Hiking trails: winding bands along contour lines of two slow noises, on hills and mountains only.
// Their height follows a smooth surface (bilinear over raw heights sampled every TRAIL_GRID cells),
// so neighbouring trail cells stay within a climbable step.
const TRAIL_MIN = 4.5, TRAIL_RANGE = 0.2, TRAIL_GRID = 8, TRAIL_WIDTH = 1.3;
const VR = VILLAGE_RADIUS;
const FLOWER_COLORS = [0xf2e15c, 0xf28cc0, 0xffffff, 0x9fb8ff, 0xff7a59];
const TERRAIN_CACHE = 2500; // chunks of heights/kinds kept (cheap)
const CONTENT_CACHE = 220; // chunks of trees/foliage/paths kept (more than the scene keeps loaded)
// neighbour offsets closer than 2.1 cells (redwood spacing)
const NEAR21 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];

const isLand = (k) => k === K.GRASS || k === K.FOREST || k === K.SAND || k === K.DEEP;

// Natural terrain at a cell, before trails, the campfire clearing and deep forest.
// Returns [height (rounded to STEP), kind, smooth height (unrounded), mountain range share 0..1].
function rawCell(seed, ix, iz) {
  const c = fbm(ix / 260, iz / 260, seed + 11, 4); // continents and oceans
  const n = fbm(ix / 26, iz / 26, seed);
  const ridge = 1 - Math.abs(fbm(ix / 18, iz / 18, seed + 7) * 2 - 1); // craggy ridges
  const m = fbm(ix / 120, iz / 120, seed + 21, 3);
  const mount = 0.2 + 0.38 * smooth(0.6, 0.76, m); // where ranges rise (rarer: high thresholds)
  // tall massifs inside mountain ranges: broad ridged noise, so slopes stay hikeable
  const massif = 1 - Math.abs(fbm(ix / 44, iz / 44, seed + 71, 3) * 2 - 1);
  const range = smooth(0.63, 0.78, m); // inside a mountain range (0..1)
  let e = n * 0.8 + ridge * ridge * mount + range * massif ** 3 * 0.62 - (1 - smooth(0.35, 0.49, c)) * 0.95 - 0.08;
  e = Math.max(0, e);
  e = Math.pow(e, 1.6);
  let lv = e * 26;
  if (lv > PEAK_EASE) lv = PEAK_EASE + (lv - PEAK_EASE) * 0.45; // ease the tallest peaks instead of clipping them flat
  const hf = Math.max(STEP, Math.min(MAX_LEVEL * STEP, lv * STEP));
  const h = Math.max(1, Math.min(MAX_LEVEL, Math.round(lv))) * STEP;
  let k;
  if (h < SEA) k = K.SEABED;
  else if (h <= SEA + 0.3) k = K.SAND;
  else {
    const snowLine = SNOW_H + (fbm(ix / 11, iz / 11, seed + 81, 2) - 0.5) * 3;
    if (h >= snowLine) k = K.SNOW;
    else if (h >= snowLine - ROCK_BAND) k = K.ROCK;
    else if (range > 0.3 && h >= 5) k = fbm(ix / FOREST_SCALE, iz / FOREST_SCALE, seed + 33, 3) > MOUNTAIN_FOREST_T ? K.FOREST : K.GRASS; // lush slopes
    else k = isForest(ix, iz, seed) ? K.FOREST : K.GRASS;
    if (k === K.GRASS && isDirt(ix, iz, seed)) k = K.DIRT;
  }
  return [h, k, hf, range];
}

// small LRU cache on a Map (insertion order)
function lru(max) {
  const m = new Map();
  return {
    get(key) { const v = m.get(key); if (v !== undefined) { m.delete(key); m.set(key, v); } return v; },
    set(key, v) { m.set(key, v); if (m.size > max) m.delete(m.keys().next().value); return v; },
    delete(key) { m.delete(key); },
  };
}

/** Create an endless world for a seed. The returned object is the "world" the client uses. */
export function createEndlessWorld(seed) {
  seed >>>= 0;
  const terrainCache = lru(TERRAIN_CACHE), contentCache = lru(CONTENT_CACHE);
  const editsByChunk = new Map(); // chunk cellKey -> Map(cellKey -> [ix, iz, h, k]): player digging
  const choppedByChunk = new Map(); // chunk cellKey -> Set(cellKey): trees players have chopped down
  const raw = (ix, iz) => rawCell(seed, ix, iz);

  // ---------- campfire: the flat grassy spot nearest the origin ----------
  const rawFlat = (ix, iz, r) => {
    const h = raw(ix, iz)[0];
    for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) if (Math.abs(raw(ix + x, iz + z)[0] - h) > STEP + 0.01) return false;
    return true;
  };
  let camp = null;
  const o = WORLD / 2; // cell of world origin
  for (let r = 0; r < 700 && !camp; r += r < 64 ? 1 : 3) {
    for (let z = -r; z <= r && !camp; z++) {
      for (let x = -r; x <= r && !camp; x++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
        const k = raw(o + x, o + z)[1];
        if ((k === K.GRASS || k === K.FOREST) && rawFlat(o + x, o + z, 2)) camp = { ix: o + x, iz: o + z };
      }
    }
  }
  camp ??= { ix: o, iz: o };
  camp.y = Math.max(raw(camp.ix, camp.iz)[0], SEA + 0.5);
  camp.x = toWorld(camp.ix);
  camp.z = toWorld(camp.iz);
  const campDist = (ix, iz) => Math.hypot(ix - camp.ix, iz - camp.iz);

  // ---------- hiking trails ----------
  const trailNoise = (ix, iz, s, sc) => fbm(ix / sc, iz / sc, seed + s, 2);
  // on a contour band of a noise, about 2·TRAIL_WIDTH cells wide wherever the noise is
  const onBand = (ix, iz, s, sc) => {
    const n = trailNoise(ix, iz, s, sc);
    const gx = trailNoise(ix + 1, iz, s, sc) - trailNoise(ix - 1, iz, s, sc);
    const gz = trailNoise(ix, iz + 1, s, sc) - trailNoise(ix, iz - 1, s, sc);
    return Math.abs(n - 0.5) < TRAIL_WIDTH * 0.5 * Math.hypot(gx, gz);
  };
  const gridMemo = new Map();
  const gridH = (gx, gz) => {
    const key = cellKey(gx, gz);
    let v = gridMemo.get(key);
    if (v === undefined) { v = raw(gx * TRAIL_GRID, gz * TRAIL_GRID)[2]; if (gridMemo.size > 20000) gridMemo.clear(); gridMemo.set(key, v); }
    return v;
  };
  /** Height of the trail on a cell, or null when no trail passes there. */
  function trailAt(ix, iz, h, k, range) {
    if (h < TRAIL_MIN || range < TRAIL_RANGE || k === K.SEABED || k === K.SAND || campDist(ix, iz) < VR + 3) return null;
    if (!onBand(ix, iz, 500, 38) && !onBand(ix, iz, 600, 53)) return null;
    const gx = Math.floor(ix / TRAIL_GRID), gz = Math.floor(iz / TRAIL_GRID);
    const fx = ix / TRAIL_GRID - gx, fz = iz / TRAIL_GRID - gz;
    const top = gridH(gx, gz) + (gridH(gx + 1, gz) - gridH(gx, gz)) * fx;
    const bot = gridH(gx, gz + 1) + (gridH(gx + 1, gz + 1) - gridH(gx, gz + 1)) * fx;
    return Math.max(SEA + 0.5, Math.round((top + (bot - top) * fz) / STEP) * STEP);
  }

  // natural terrain plus trails and the flattened meadow around the campfire (pure per cell)
  function cell(ix, iz) {
    let [h, k, , range] = raw(ix, iz);
    const th = trailAt(ix, iz, h, k, range);
    if (th !== null) { h = th; k = K.TRAIL; }
    const d = campDist(ix, iz);
    if (d <= VR) { h = camp.y; k = K.GRASS; }
    else if (d <= VR + 2) {
      h = Math.round((camp.y + (h - camp.y) * ((d - VR) / 2)) / STEP) * STEP;
      if (h >= SEA && k === K.SEABED) k = K.GRASS;
    }
    return [h, k];
  }

  // ---------- terrain chunks: heights and kinds, deep forest included ----------
  function terrain(cx, cz) {
    const key = cellKey(cx, cz);
    const hit = terrainCache.get(key);
    if (hit) return hit;
    // work on a 2-cell margin so the deep forest smoothing matches across chunk borders
    const S = CH + 4, x0 = cx * CH - 2, z0 = cz * CH - 2;
    const hs = new Float32Array(S * S), ks = new Uint8Array(S * S);
    const cand = new Uint8Array(S * S), deep = new Uint8Array(S * S), ever = new Uint8Array(S * S);
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const ix = x0 + x, iz = z0 + z, i = z * S + x;
        const [h, k] = cell(ix, iz);
        hs[i] = h; ks[i] = k;
        if ((k === K.GRASS || k === K.FOREST) && h <= 6 && campDist(ix, iz) >= VR + 6) {
          cand[i] = 1;
          if (fbm(ix / 13, iz / 13, seed + 333, 3) >= DEEP_T) deep[i] = ever[i] = 1;
        }
      }
    }
    // two smoothing passes, like the island: lone deep cells revert to forest, enclosed ones join
    for (let pass = 0; pass < 2; pass++) {
      const inset = pass + 1, next = deep.slice();
      for (let z = inset; z < S - inset; z++) {
        for (let x = inset; x < S - inset; x++) {
          const i = z * S + x;
          if (!cand[i]) continue;
          let n = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && deep[i + dz * S + dx]) n++;
          if (deep[i] && n < 3) next[i] = 0;
          else if (!deep[i] && n >= 6) next[i] = ever[i] = 1;
        }
      }
      deep.set(next);
    }
    const heights = new Float32Array(CH * CH), kinds = new Uint8Array(CH * CH);
    for (let z = 0; z < CH; z++) {
      for (let x = 0; x < CH; x++) {
        const i = (z + 2) * S + x + 2;
        heights[z * CH + x] = hs[i];
        kinds[z * CH + x] = deep[i] ? K.DEEP : ever[i] ? K.FOREST : ks[i];
      }
    }
    return terrainCache.set(key, { heights, kinds, edits: editsByChunk.get(key) ?? null });
  }

  let lastT = null, lastTK = NaN;
  const tchunk = (ix, iz) => {
    const cx = Math.floor(ix / CH), cz = Math.floor(iz / CH), key = cellKey(cx, cz);
    if (key !== lastTK) { lastT = terrain(cx, cz); lastTK = key; }
    return lastT;
  };
  const lidx = (ix, iz) => (iz - Math.floor(iz / CH) * CH) * CH + (ix - Math.floor(ix / CH) * CH);
  // As generated (objects and plants are placed from these, so digging never makes things pop up)
  const HG = (ix, iz) => tchunk(ix, iz).heights[lidx(ix, iz)];
  const kindG = (ix, iz) => tchunk(ix, iz).kinds[lidx(ix, iz)];
  // With players' digging applied (what you see and walk on)
  const editAt = (ix, iz) => tchunk(ix, iz).edits?.get(cellKey(ix, iz));
  const H = (ix, iz) => { const t = tchunk(ix, iz); const e = t.edits?.get(cellKey(ix, iz)); return e ? e[2] : t.heights[lidx(ix, iz)]; };
  const kind = (ix, iz) => { const t = tchunk(ix, iz); const e = t.edits?.get(cellKey(ix, iz)); return e ? e[3] : t.kinds[lidx(ix, iz)]; };
  const heightAt = H;
  /** The ground under placed blocks on a cell: [height, kind], or null. */
  const under = (ix, iz) => { const e = editAt(ix, iz); return e && e[4] >= 0 ? [e[4], e[5]] : null; };

  // ---------- player digging ----------
  /** Set a cell's height and kind (a dig). Returns the chunk whose content must be rebuilt. */
  // uh/uk: the ground under placed blocks (height and kind), or uh = -1 when nothing was placed
  function setEdit(ix, iz, h, k, uh = -1, uk = 0) {
    const cx = Math.floor(ix / CH), cz = Math.floor(iz / CH), ck = cellKey(cx, cz);
    let m = editsByChunk.get(ck);
    if (!m) { m = new Map(); editsByChunk.set(ck, m); }
    m.set(cellKey(ix, iz), [ix, iz, h, k, uh, uk]);
    const t = terrainCache.get(ck);
    if (t) t.edits = m;
    contentCache.delete(ck); // its path tables and plants change; other chunks only read generated terrain
    return [cx, cz];
  }
  /** Chop down the tree growing from cell (ix, iz). Returns the chunk whose content must be rebuilt. */
  function removeTree(ix, iz) {
    const cx = Math.floor(ix / CH), cz = Math.floor(iz / CH), ck = cellKey(cx, cz);
    if (!choppedByChunk.has(ck)) choppedByChunk.set(ck, new Set());
    choppedByChunk.get(ck).add(cellKey(ix, iz));
    contentCache.delete(ck);
    return [cx, cz];
  }
  // Picks (see PICK in world.js): broken bushes, picked berries, picked-up pebbles, per chunk.
  const picksByChunk = new Map(); // chunk cellKey -> Map(pickKey -> [ix, iz, t])
  function setPick(ix, iz, t) {
    const ck = cellKey(Math.floor(ix / CH), Math.floor(iz / CH));
    if (!picksByChunk.has(ck)) picksByChunk.set(ck, new Map());
    picksByChunk.get(ck).set(pickKey(ix, iz, t), [ix, iz, t]);
    contentCache.delete(ck);
    return [];
  }
  const pickList = () => {
    const out = [];
    for (const m of picksByChunk.values()) out.push(...m.values());
    return out;
  };
  const choppedList = () => {
    const out = [];
    for (const set of choppedByChunk.values()) for (const k of set) out.push([keyX(k), keyZ(k)]);
    return out;
  };
  const editsList = () => {
    const out = [];
    for (const m of editsByChunk.values()) {
      for (const [ix, iz, h, k, uh, uk] of m.values()) out.push(uh >= 0 ? [ix, iz, Math.round(h / STEP), k, Math.round(uh / STEP), uk] : [ix, iz, Math.round(h / STEP), k]);
    }
    return out;
  };

  // No ruins (removed at the user's request); kept as empty lookups so callers stay simple.
  const ruinsIn = () => [];
  const ruinsNear = () => [];

  // ---------- content chunks: trees, rocks, flowers, foliage, obstacles, path tables ----------
  function content(cx, cz) {
    const key = cellKey(cx, cz);
    const hit = contentCache.get(key);
    if (hit) return hit;
    // decisions use the generated terrain; dug cells just lose their plants (they never hold objects)
    const H = HG, kind = kindG;
    const edited = (ix, iz) => !!editAt(ix, iz);
    const choppedHere = choppedByChunk.get(key);
    const x0 = cx * CH, z0 = cz * CH, x1 = x0 + CH, z1 = z0 + CH;
    const inChunk = (ix, iz) => ix >= x0 && ix < x1 && iz >= z0 && iz < z1;
    const nearRuins = ruinsIn(x0 - 8, z0 - 8, x1 + 8, z1 + 8);
    const clear = (ix, iz) => campDist(ix, iz) > VR + 1 && nearRuins.every((p) => Math.hypot(p.ix - ix, p.iz - iz) > 4);

    // Redwoods, ≥ 2.1 cells apart, decided locally in two rounds (like a parallel greedy pick):
    // round 1 keeps candidates whose priority is lowest among their close candidates; round 2 does the
    // same among the candidates left that aren't next to a round-1 tree. Dense like the island's groves.
    const pri = (ix, iz) => hash2(ix, iz, seed + 913);
    const memo1 = new Map(), memo2 = new Map();
    const redCand = (ix, iz) => kind(ix, iz) === K.DEEP && clear(ix, iz) && hash2(ix, iz, seed + 900) <= 0.96;
    const lowest = (ix, iz, ok) => NEAR21.every(([dx, dz]) => !ok(ix + dx, iz + dz) || pri(ix + dx, iz + dz) > pri(ix, iz));
    const red1 = (ix, iz) => {
      const ck = cellKey(ix, iz);
      if (!memo1.has(ck)) memo1.set(ck, redCand(ix, iz) && lowest(ix, iz, redCand));
      return memo1.get(ck);
    };
    const left2 = (ix, iz) => {
      const ck = cellKey(ix, iz);
      if (!memo2.has(ck)) memo2.set(ck, redCand(ix, iz) && !red1(ix, iz) && NEAR21.every(([dx, dz]) => !red1(ix + dx, iz + dz)));
      return memo2.get(ck);
    };
    const isRedwood = (ix, iz) => red1(ix, iz) || (left2(ix, iz) && lowest(ix, iz, left2));
    // leafy trees keep LEAFY_SPACING apart (same rule as generateWorld)
    const leafyCand = (ix, iz) => {
      if (!clear(ix, iz)) return false;
      const k = kind(ix, iz), r = hash2(ix, iz, seed + 900);
      return (k === K.FOREST && r < 0.5 && hash2(ix, iz, seed + 904) >= 0.7) || (k === K.GRASS && r < 0.05);
    };
    const leafyKeep = (ix, iz) => LEAFY_NEAR.every(([dx, dz]) => !leafyCand(ix + dx, iz + dz) || hash2(ix + dx, iz + dz, seed + 914) > hash2(ix, iz, seed + 914));
    // pines keep PINE_SPACING apart (same rule as generateWorld)
    const pineCand = (ix, iz) => {
      if (!clear(ix, iz) || edited(ix, iz)) return false;
      const k = kind(ix, iz), r = hash2(ix, iz, seed + 900);
      return (k === K.FOREST && r < PINE_CHANCE && hash2(ix, iz, seed + 904) < 0.7) || (k === K.ROCK && r < 0.03 && H(ix, iz) < 8);
    };
    const pineKeep = (ix, iz) => PINE_NEAR.every(([dx, dz]) => !pineCand(ix + dx, iz + dz) || hash2(ix + dx, iz + dz, seed + 915) > hash2(ix, iz, seed + 915));
    // which object (if any) grows on a cell: same odds as generateWorld
    const objMemo = new Map();
    function objAt(ix, iz) {
      const ck = cellKey(ix, iz);
      if (objMemo.has(ck)) return objMemo.get(ck);
      let ob = null;
      const k = edited(ix, iz) ? -1 : kind(ix, iz);
      if ((isLand(k) || k === K.ROCK) && clear(ix, iz)) {
        const r = hash2(ix, iz, seed + 900);
        const y = H(ix, iz);
        const ts = (0.8 + hash2(ix, iz, seed + 903) * 0.6) * TREE_SCALE;
        const rockS = 0.25 + hash2(ix, iz, seed + 905) * 0.3;
        if (k === K.DEEP) {
          if (isRedwood(ix, iz)) {
            ob = { type: 'redwood', s: 0.82 + hash2(ix, iz, seed + 912) * 0.24 };
          } else if (r > 0.96) ob = { type: 'rock', s: rockS };
        } else if (k === K.FOREST && r < 0.5) {
          if (hash2(ix, iz, seed + 904) < 0.7) { if (r < PINE_CHANCE && pineKeep(ix, iz)) ob = { type: 'pine', s: ts * PINE_SCALE }; }
          else if (leafyKeep(ix, iz)) ob = { type: 'leafy', s: ts };
        } else if (k === K.GRASS && r < 0.05) { if (leafyKeep(ix, iz)) ob = { type: 'leafy', s: ts }; }
        else if (k === K.ROCK && r < 0.03 && y < 8) { if (pineKeep(ix, iz)) ob = { type: 'pine', s: ts * 0.8 * PINE_SCALE }; }
        else if ((k === K.ROCK && r < 0.14) || (k === K.GRASS && r < 0.07) || (k === K.SAND && r < 0.07)) ob = { type: 'rock', s: rockS };
      }
      objMemo.set(ck, ob);
      return ob;
    }
    const isTree = (ob) => ob && (ob.type === 'leafy' || ob.type === 'pine');
    // the grid vertex a tree at (ix, iz) tries to move its trunk onto
    const cornerOf = (ix, iz) => [ix + (hash2(ix, iz, seed + 920) < 0.5 ? 0 : 1), iz + (hash2(ix, iz, seed + 921) < 0.5 ? 0 : 1)];

    const trees = [], redwoods = [], rocks = [], flowers = [], corners = new Set();
    const tufts = [], tallGrass = [], bushes = [], ferns = [], mushrooms = [], reeds = [], motes = [], pebbles = [];
    const pond = { lilies: [], seaweed: [], seaRocks: [] };
    const cairns = [];
    const lush = { reeds, tallGrass, ferns, bushes, ...pond }; // lists waterLife / bankLife add to
    const obstacles = new Map(); // cell key -> circles
    const addObs = (x, z, r) => {
      const ix = toCell(x), iz = toCell(z);
      if (!inChunk(ix, iz)) return;
      const k = cellKey(ix, iz);
      if (!obstacles.has(k)) obstacles.set(k, []);
      obstacles.get(k).push({ x, z, r });
    };

    for (let iz = z0; iz < z1; iz++) {
      for (let ix = x0; ix < x1; ix++) {
        const ob = objAt(ix, iz);
        if (!ob) continue;
        // a chopped tree is simply left out (decisions above still see it, so its neighbours don't move)
        if (ob.type !== 'rock' && choppedHere?.has(cellKey(ix, iz))) continue;
        const y = H(ix, iz);
        if (ob.type === 'redwood') {
          const t = { ix, iz, x: toWorld(ix) + (hash2(ix, iz, seed + 910) - 0.5) * 0.2, z: toWorld(iz) + (hash2(ix, iz, seed + 911) - 0.5) * 0.2, y, s: ob.s };
          redwoods.push(t);
          addObs(t.x, t.z, 0.42 * t.s);
        } else if (ob.type === 'rock') {
          const r = { x: toWorld(ix) + (hash2(ix, iz, seed + 901) - 0.5) * 0.5, z: toWorld(iz) + (hash2(ix, iz, seed + 902) - 0.5) * 0.5, y, s: ob.s };
          rocks.push(r);
          addObs(r.x, r.z, r.s * 0.9);
        } else {
          const t = { ix, iz, x: toWorld(ix) + (hash2(ix, iz, seed + 901) - 0.5) * 0.5, z: toWorld(iz) + (hash2(ix, iz, seed + 902) - 0.5) * 0.5, y, s: ob.s, pine: ob.type === 'pine' };
          // walk-under: trunk onto a tile corner when the 4 tiles around it are dry, rock-free and
          // nearly level, and no earlier tree (row-major, as on the island) already took that corner
          const [vx, vz] = cornerOf(ix, iz);
          const cells = [[vx - 1, vz - 1], [vx, vz - 1], [vx - 1, vz], [vx, vz]];
          const hs = cells.map(([x, z]) => H(x, z));
          const ok = Math.max(...hs) - Math.min(...hs) <= 2 * STEP + 0.01 && Math.min(...hs) >= SEA
            && cells.every(([x, z]) => objAt(x, z)?.type !== 'rock')
            && Math.hypot(camp.ix + 0.5 - vx, camp.iz + 0.5 - vz) > VR + 1
            && !cells.some(([x, z]) => (z < iz || (z === iz && x < ix)) && isTree(objAt(x, z)) && cornerOf(x, z)[0] === vx && cornerOf(x, z)[1] === vz);
          if (ok) {
            t.corner = true;
            t.x = toWorld(vx) - 0.5 + (hash2(ix, iz, seed + 922) - 0.5) * 0.12;
            t.z = toWorld(vz) - 0.5 + (hash2(ix, iz, seed + 923) - 0.5) * 0.12;
            t.y = Math.min(...hs);
            corners.add(cellKey(vx, vz));
          } else addObs(t.x, t.z, 0.18 * t.s);
          trees.push(t);
        }
      }
    }

    // flowers, foliage and fireflies, per cell (same odds as finishWorld)
    const nearWater = (ix, iz) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => kind(ix + dx, iz + dz) === K.SEABED);
    const nearCamp = (ix, iz) => campDist(ix, iz) < 1.5;
    const spot = (ix, iz, n, spread = 0.8) => ({
      x: toWorld(ix) + (hash2(ix * 7 + n, iz, seed + 1200) - 0.5) * spread,
      z: toWorld(iz) + (hash2(ix, iz * 7 + n, seed + 1300) - 0.5) * spread,
      y: H(ix, iz),
      r: hash2(ix + n, iz - n, seed + 1400),
    });
    for (let iz = z0; iz < z1; iz++) {
      for (let ix = x0; ix < x1; ix++) {
        if (edited(ix, iz)) continue; // dug: bare
        const k = kind(ix, iz), y = H(ix, iz);
        // flowers on open meadow cells
        if (k === K.GRASS && !objAt(ix, iz) && clear(ix, iz)) {
          const r = hash2(ix, iz, seed + 900);
          if (r >= 0.07 && r < 0.42) {
            const n = 1 + Math.floor(hash2(ix, iz, seed + 906) * 3);
            for (let f = 0; f < n; f++) {
              flowers.push({
                x: toWorld(ix) + (hash2(ix * 3 + f, iz, seed + 907) - 0.5) * 0.85,
                z: toWorld(iz) + (hash2(ix, iz * 3 + f, seed + 908) - 0.5) * 0.85,
                y, c: FLOWER_COLORS[Math.floor(hash2(ix, iz, seed + 909 + f) * FLOWER_COLORS.length)],
              });
            }
          }
        }
        // flower beds in the campfire clearing
        if (campDist(ix, iz) <= VR && k === K.GRASS && !nearCamp(ix, iz) && hash2(ix, iz, seed + 2100) <= 0.22) {
          for (let f = 0; f < 3; f++) {
            flowers.push({
              x: toWorld(ix) + (hash2(ix * 5 + f, iz, seed + 2101) - 0.5) * 0.8,
              z: toWorld(iz) + (hash2(ix, iz * 5 + f, seed + 2102) - 0.5) * 0.8,
              y, c: FLOWER_COLORS[Math.floor(hash2(ix + f, iz, seed + 2103) * FLOWER_COLORS.length)],
            });
          }
        }
        if (nearCamp(ix, iz)) continue;
        const roll = (n) => hash2(ix * 13 + n, iz * 17 - n, seed + 1500);
        if (k === K.GRASS || k === K.FOREST) {
          const n = k === K.GRASS ? 1 + Math.floor(roll(0) * 3) : 2 + Math.floor(roll(0) * 3);
          for (let t = 0; t < n; t++) tufts.push(spot(ix, iz, t, 0.9));
          if (k === K.GRASS && fbm(ix / 7, iz / 7, seed + 77, 2) > TALL_GRASS_T) {
            const tn = 2 + Math.floor(roll(9) * 2);
            for (let t = 0; t < tn; t++) tallGrass.push(spot(ix, iz, 60 + t, 0.9));
          }
          if (roll(11) < (k === K.FOREST ? 0.05 : 0.025)) motes.push({ ...spot(ix, iz, 70, 0.6), y: y + 0.4 + roll(12) * 0.8 });
          if (roll(1) < (k === K.FOREST ? 0.08 : 0.035)) bushes.push({ ...spot(ix, iz, 10, 0.5), berries: roll(2) < 0.35 });
          if (k === K.FOREST && roll(3) < 0.35) ferns.push(spot(ix, iz, 20, 0.7));
          if (k === K.FOREST && roll(4) < 0.07) {
            const c = 1 + Math.floor(roll(5) * 3);
            for (let m = 0; m < c; m++) mushrooms.push(spot(ix, iz, 30 + m));
          }
        }
        if (k === K.DEEP) {
          const n = 1 + Math.floor(roll(0) * 2);
          for (let t = 0; t < n; t++) tufts.push(spot(ix, iz, t, 0.9));
          if (roll(3) < 0.7) ferns.push(spot(ix, iz, 20, 0.7));
          if (roll(13) < 0.3) ferns.push(spot(ix, iz, 21, 0.8));
          if (roll(4) < 0.18) {
            const c = 1 + Math.floor(roll(5) * 3);
            for (let m = 0; m < c; m++) mushrooms.push(spot(ix, iz, 30 + m));
          }
          if (roll(1) < 0.04) bushes.push({ ...spot(ix, iz, 10, 0.5), berries: roll(2) < 0.2 });
          if (roll(11) < 0.09) motes.push({ ...spot(ix, iz, 70, 0.6), y: y + 0.4 + roll(12) * 0.9 });
        }
        if ((k === K.SAND || k === K.GRASS) && nearWater(ix, iz) && roll(6) < 0.55) reeds.push({ ...spot(ix, iz, 40, 0.6), cattail: roll(7) < 0.5 });
        if (roll(45) < pebbleChance(k)) pebbles.push(spot(ix, iz, 140, 0.6));
        if (k === K.ROCK && roll(8) < 0.3) tufts.push(spot(ix, iz, 50));
        if (k === K.DIRT && roll(0) < 0.5) tufts.push(spot(ix, iz, 0, 0.9)); // a stray tuft at a dirt patch's grassy edge
        // trail markers: a stone cairn now and then on the ground beside a trail
        if (k !== K.TRAIL && k !== K.SEABED && roll(40) < 0.035 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => kind(ix + dx, iz + dz) === K.TRAIL)) cairns.push(spot(ix, iz, 130, 0.4));
        if (k === K.SEABED) waterLife(ix, iz, H, kind, spot, roll, lush);
        else bankLife(ix, iz, k, kind, spot, roll, lush);
        if (k === K.SAND && !nearWater(ix, iz) && roll(10) < 0.35) tufts.push(spot(ix, iz, 55));
      }
    }

    // ruins centred in this chunk; pillars and altars of any nearby ruin block the cells they stand on
    const ruins = nearRuins.filter((ru) => inChunk(ru.ix, ru.iz));
    for (const ru of nearRuins) {
      ru.pillars.forEach((p) => addObs(p.x, p.z, 0.32));
      addObs(ru.x, ru.z, 0.55);
    }
    const hasCamp = inChunk(camp.ix, camp.iz);
    if (hasCamp) addObs(camp.x, camp.z, 0.45);

    // path tables for the PathFinder (see pathfind.js): standing height, water, blocked
    const SWIM_FLOOR = SEA - 0.55;
    const floor = new Float32Array(CH * CH), water = new Uint8Array(CH * CH), blocked = new Uint8Array(CH * CH);
    for (let iz = z0; iz < z1; iz++) {
      for (let ix = x0; ix < x1; ix++) {
        const i = (iz - z0) * CH + (ix - x0), h = heightAt(ix, iz);
        floor[i] = Math.max(h, SWIM_FLOOR);
        water[i] = h < SWIM_FLOOR ? 1 : 0;
        const list = obstacles.get(cellKey(ix, iz));
        if (list?.some((ob) => Math.hypot(ob.x - toWorld(ix), ob.z - toWorld(iz)) < ob.r + 0.3)) blocked[i] = 1;
        if (Math.abs(ix - o) > WORLD_LIMIT || Math.abs(iz - o) > WORLD_LIMIT) blocked[i] = 1; // world border
      }
    }

    // what players took: generated above as usual, then left out (so nothing else shifts)
    const picksHere = picksByChunk.get(key);
    if (picksHere) applyPicks((k) => picksHere.has(k), bushes, pebbles);

    return contentCache.set(key, {
      cx, cz, pebbles, trees, redwoods, rocks, flowers, tufts, tallGrass, bushes, ferns, mushrooms, reeds, motes, ...pond, cairns,
      ruins, corners, floor, water, blocked, hasCamp,
    });
  }

  return {
    endless: true, seed, camp, base: null, benches: new Map(), piles: new Map(), setPick, pickList, setEdit, under, editsList, removeTree, choppedList,
    H, kind, terrain, content, ruinsNear,
    // island-only lists stay empty; the scene keeps live lists of what's loaded (WorldScene.live)
    ruins: [], trees: [], flowers: [], reeds: [],
  };
}
