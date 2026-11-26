// Procedural island world, generated deterministically from a seed so every player in a
// room sees the same island. The ground is a grid of 1×1 columns whose heights come in
// steps of STEP, which gives a blocky, terraced look.

export const WORLD = 96; // columns per side
export const STEP = 0.5; // terrain height step
export const SEA = 1.8; // water surface height
export const MAX_PLAYERS = 16;
export const PLAYER_COLORS = [
  '#e8554e', '#3d8bfd', '#f2b632', '#a463f2', '#2bb5a3', '#f2795c',
  '#ec5fa8', '#e6e6e6', '#7bd389', '#5bc0eb', '#c97b3f', '#9b5de5',
];

// Ground kinds
// TRAIL: endless mountain trails only. DIRT: a meadow tile with a patch of exposed dirt (grass around it).
// SOIL: a tile a player dug with the shovel (all bare earth). WOOD: a placed wooden plank block.
// WALL: a placed log-cabin wall block (horizontal round logs).
export const K = { SEABED: 0, SAND: 1, GRASS: 2, FOREST: 3, ROCK: 4, SNOW: 5, PATH: 6, DEEP: 7, TRAIL: 8, DIRT: 9, SOIL: 10, WOOD: 11, WOOD2: 12, WALL: 13 }; // WOOD2: wood with its planks turned 90°
export const MAX_KIND = 13;
// The seabed can go below 0 (endless oceans: deep water and an abyss), down to MIN_LEVEL × STEP.
export const MIN_LEVEL = -8;
// Coral reefs grow in shallow to mid water (depth REEF_MIN..REEF_MAX) where a slow reef noise passes REEF_T.
export const REEF_T = 0.62, REEF_MIN = 0.25, REEF_MAX = 1.6;
export const CORAL_TYPES = ['branch', 'brain', 'fan', 'tube', 'anemone'];
export const isWood = (k) => k === K.WOOD || k === K.WOOD2 || k === K.WALL; // what the axe breaks

// Furniture placed by players: world.benches: Map(cellKey -> [ix, iz, rot 0..3, type]), type = index
// here (also the item id). Every piece blocks its tile. Old saves without a type are workbenches.
export const FURNITURE = ['workbench', 'chair', 'table', 'bed', 'lamp', 'shelf', 'crate', 'barrel', 'planter', 'flowerbox', 'seat', 'pennant'];
export const MAX_FURNITURE = 15; // highest type number the server and saves accept (room to grow)

// Things players took from the world, kept as "picks" [ix, iz, t] per cell:
// a bush broken (BUSH), a bush's berries picked (BERRIES), a pebble picked up (PEBBLE), a rock mined (ROCK).
// Log piles: logs placed on a tile stack up 3, then 2, then 1 (PILE_MAX), lying along x (r 0) or z (r 1).
// world.piles: Map(cellKey -> [ix, iz, r, n]).
export const PILE_MAX = 6;
// Height of a pile's top, which players stand on: one row of logs (n 1-3), two (4-5) or three (6).
// Matches the log model in world3d.js (radius 0.165, rows 0.165·√3 apart).
export const pileTop = (n) => 0.33 + (n >= 6 ? 2 : n >= 4 ? 1 : 0) * 0.165 * Math.sqrt(3);
export const PICK = { BUSH: 0, BERRIES: 1, PEBBLE: 2, ROCK: 3 };
export const pickKey = (ix, iz, t) => cellKey(ix, iz) * 4 + t;
/** Apply picks to generated lists in place: `has(pickKey)` says what was taken. */
export function applyPicks(has, bushes, pebbles) {
  for (let i = bushes.length - 1; i >= 0; i--) {
    const b = bushes[i], ix = toCell(b.x), iz = toCell(b.z);
    if (has(pickKey(ix, iz, PICK.BUSH))) bushes.splice(i, 1);
    else if (b.berries && has(pickKey(ix, iz, PICK.BERRIES))) b.berries = false;
  }
  for (let i = pebbles.length - 1; i >= 0; i--) {
    if (has(pickKey(toCell(pebbles[i].x), toCell(pebbles[i].z), PICK.PEBBLE))) pebbles.splice(i, 1);
  }
}
// Loose pebbles lie on 3% of land cells (6% on sand, rock and trails); players pick them up.
export const pebbleChance = (k) => (k === K.SAND || k === K.ROCK || k === K.TRAIL ? 0.06 : k === K.GRASS || k === K.FOREST || k === K.DEEP || k === K.DIRT ? 0.03 : 0);
export const DEEP_SHARE = 0.16; // share of lowland grass/forest that becomes deep (redwood) forest
export const VILLAGE_RADIUS = 7;
export const TREE_SCALE = 1.5; // all trees (and their trunk collision) are this much bigger than the base models
// Leafy (round) trees keep at least this far from each other (cells); pine woods stay dense.
export const LEAFY_SPACING = 3.2;
// Pine woods: a forest cell grows a pine only when its roll is below this (out of the 0.5 tree roll)
export const PINE_CHANCE = 0.28;
// Pines are this much bigger than other trees, and keep at least PINE_SPACING cells from each other
export const PINE_SCALE = 1.4, PINE_SPACING = 2.2;
export const PINE_NEAR = [];
for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) if ((x || z) && Math.hypot(x, z) < PINE_SPACING) PINE_NEAR.push([x, z]);
// offsets closer than LEAFY_SPACING
export const LEAFY_NEAR = [];
for (let z = -3; z <= 3; z++) for (let x = -3; x <= 3; x++) if ((x || z) && Math.hypot(x, z) < LEAFY_SPACING) LEAFY_NEAR.push([x, z]);

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Endless worlds: cells further than this from the origin are a world border (float precision
// on the GPU stays fine out to here).
export const WORLD_LIMIT = 30000;

// Day/night cycle: one full day (24 in-game hours) every DAY_SECONDS of real time. A clock is a
// start hour plus the real time since then, so it runs from the wall clock (no drift, and a
// background tab is right again as soon as it comes back). The server keeps one per room.
export const DAY_SECONDS = 1440; // 24 real minutes: one game hour per real minute
export const clockHour = (h0, ms) => (((h0 + (ms / 1000) * (24 / DAY_SECONDS)) % 24) + 24) % 24;

// One number per grid cell (or grid vertex), for cells anywhere in an endless world.
const KEY_SPAN = 2 ** 21, KEY_OFF = 2 ** 20;
export const cellKey = (ix, iz) => (iz + KEY_OFF) * KEY_SPAN + (ix + KEY_OFF);
export const keyX = (k) => (k % KEY_SPAN) - KEY_OFF;
export const keyZ = (k) => Math.floor(k / KEY_SPAN) - KEY_OFF;

export function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function fbm(x, z, seed, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, z * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Pine woods (FOREST ground): big patches from a broad noise; the rest of the lowland is meadow
export const FOREST_SCALE = 20, FOREST_T = 0.52;
export const isForest = (ix, iz, seed) => fbm(ix / FOREST_SCALE, iz / FOREST_SCALE, seed + 33, 3) > FOREST_T;
// Exposed dirt: meadow tiles in small clusters (where a quick noise is high) get a patch of bare earth
export const DIRT_T = 0.68;
export const isDirt = (ix, iz, seed) => fbm(ix / 6, iz / 6, seed + 404, 2) > DIRT_T && hash2(ix, iz, seed + 405) < 0.7;
// Plains grass: tall-grass meadow patches where fbm(/7) is above this
export const TALL_GRASS_T = 0.63;

// world coords: column (ix, iz) spans x ∈ [ix - WORLD/2, ix + 1 - WORLD/2)
export const toWorld = (i) => i - WORLD / 2 + 0.5;
export const toCell = (v) => Math.floor(v + WORLD / 2);
export const inWorld = (ix, iz) => ix >= 0 && iz >= 0 && ix < WORLD && iz < WORLD;

export function generateWorld(seed) {
  const W = WORLD;
  const heights = new Float32Array(W * W);
  const kinds = new Uint8Array(W * W);

  for (let iz = 0; iz < W; iz++) {
    for (let ix = 0; ix < W; ix++) {
      const dx = (ix - W / 2) / (W / 2), dz = (iz - W / 2) / (W / 2);
      const d = Math.sqrt(dx * dx + dz * dz);
      const n = fbm(ix / 26, iz / 26, seed);
      const ridge = 1 - Math.abs(fbm(ix / 18, iz / 18, seed + 7) * 2 - 1); // mountain ridges
      let e = n * 0.8 + ridge * ridge * 0.32 - smooth(0.62, 1.0, d) * 1.0 - 0.06;
      e = Math.max(0, e);
      e = Math.pow(e, 1.6);
      const level = Math.max(1, Math.round(e * 26));
      const h = level * STEP;
      heights[iz * W + ix] = h;
      let k;
      if (h < SEA) k = K.SEABED;
      else if (h <= SEA + 0.3) k = K.SAND;
      else if (h >= 8.5) k = K.SNOW;
      else if (h >= 6.5) k = K.ROCK;
      else k = isForest(ix, iz, seed) ? K.FOREST : K.GRASS;
      if (k === K.GRASS && isDirt(ix, iz, seed)) k = K.DIRT;
      kinds[iz * W + ix] = k;
    }
  }

  const H = (ix, iz) => (inWorld(ix, iz) ? heights[iz * W + ix] : 0);
  const kind = (ix, iz) => (inWorld(ix, iz) ? kinds[iz * W + ix] : K.SEABED);
  // every column within r is no more than one step away from the center height
  const flat = (ix, iz, r) => {
    const h = H(ix, iz);
    for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) if (Math.abs(H(ix + x, iz + z) - h) > STEP + 0.01) return false;
    return true;
  };
  const isLand = (k) => k === K.GRASS || k === K.FOREST || k === K.SAND || k === K.DEEP;

  // Campfire / spawn: the flat grassy spot nearest the middle of the island.
  let camp = null;
  for (let r = 0; r < W / 2 && !camp; r++) {
    for (let z = -r; z <= r && !camp; z++) {
      for (let x = -r; x <= r && !camp; x++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue;
        const ix = W / 2 + x, iz = W / 2 + z;
        if ((kind(ix, iz) === K.GRASS || kind(ix, iz) === K.FOREST) && flat(ix, iz, 2)) camp = { ix, iz };
      }
    }
  }
  camp ??= { ix: W / 2, iz: W / 2 };
  camp.x = toWorld(camp.ix);
  camp.z = toWorld(camp.iz);
  camp.y = H(camp.ix, camp.iz);

  // ---------- Clearing around the campfire ----------
  // Flatten a round meadow (with a stepped blend at the rim) around the campfire cell.
  const VR = VILLAGE_RADIUS;
  for (let dz = -VR - 2; dz <= VR + 2; dz++) {
    for (let dx = -VR - 2; dx <= VR + 2; dx++) {
      const ix = camp.ix + dx, iz = camp.iz + dz;
      if (!inWorld(ix, iz)) continue;
      const d = Math.hypot(dx, dz), i = iz * W + ix;
      if (d <= VR) {
        heights[i] = camp.y;
        kinds[i] = K.GRASS;
      } else if (d <= VR + 2) {
        const t = (d - VR) / 2;
        heights[i] = Math.round((camp.y + (heights[i] - camp.y) * t) / STEP) * STEP;
        if (heights[i] >= SEA && kinds[i] === K.SEABED) kinds[i] = K.GRASS;
      }
    }
  }
  const cx = camp.ix, cz = camp.iz;

  // ---------- Deep forest ----------
  // Big connected patches of lowland grass/forest (away from the camp) become DEEP forest: a slow
  // noise picks them, with the threshold set so about DEEP_SHARE of the eligible land qualifies
  // (so every island gets some), then lone cells are cleaned up so the patches have clean edges.
  {
    const cand = [];
    for (let iz = 2; iz < W - 2; iz++) for (let ix = 2; ix < W - 2; ix++) {
      const k = kind(ix, iz);
      if ((k !== K.GRASS && k !== K.FOREST) || H(ix, iz) > 6) continue;
      if (Math.hypot(ix - camp.ix, iz - camp.iz) < VR + 6) continue;
      cand.push([fbm(ix / 13, iz / 13, seed + 333, 3), iz * W + ix]);
    }
    if (cand.length) {
      const sorted = cand.map((c) => c[0]).sort((a, b) => b - a);
      const th = sorted[Math.floor(sorted.length * DEEP_SHARE)];
      for (const [v, i] of cand) if (v >= th) kinds[i] = K.DEEP;
      // smoothing: cells with few deep neighbours revert, nearly enclosed ones join
      for (let pass = 0; pass < 2; pass++) {
        const flip = [];
        for (const [, i] of cand) {
          const ix = i % W, iz = Math.floor(i / W);
          let n = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && kind(ix + dx, iz + dz) === K.DEEP) n++;
          if (kinds[i] === K.DEEP && n < 3) flip.push([i, K.FOREST]);
          else if (kinds[i] !== K.DEEP && n >= 6) flip.push([i, K.DEEP]);
        }
        for (const [i, k] of flip) kinds[i] = k;
      }
    }
  }

  // No generated ruins (removed at the user's request). Maps can still have ruins placed in the editor.
  const ruins = [];

  const clear = (ix, iz) => Math.hypot(camp.ix - ix, camp.iz - iz) > VR + 1 && ruins.every((p) => Math.hypot(p.ix - ix, p.iz - iz) > 4);

  // Trees and rocks: which cell gets what (finishWorld adds the exact positions)
  const trees = [], rocks = [], redwoods = [];
  // leafy trees: a candidate is kept only if no closer-than-LEAFY_SPACING candidate has a lower priority
  const leafyCand = (ix, iz) => {
    if (!inWorld(ix, iz) || !clear(ix, iz)) return false;
    const k = kind(ix, iz), r = hash2(ix, iz, seed + 900);
    return (k === K.FOREST && r < 0.5 && hash2(ix, iz, seed + 904) >= 0.7) || (k === K.GRASS && r < 0.05);
  };
  const leafyKeep = (ix, iz) => LEAFY_NEAR.every(([dx, dz]) => !leafyCand(ix + dx, iz + dz) || hash2(ix + dx, iz + dz, seed + 914) > hash2(ix, iz, seed + 914));
  // pines: the same local spacing rule, among pine candidates
  const pineCand = (ix, iz) => {
    if (!inWorld(ix, iz) || !clear(ix, iz)) return false;
    const k = kind(ix, iz), r = hash2(ix, iz, seed + 900);
    return (k === K.FOREST && r < PINE_CHANCE && hash2(ix, iz, seed + 904) < 0.7) || (k === K.ROCK && r < 0.03 && H(ix, iz) < 8);
  };
  const pineKeep = (ix, iz) => PINE_NEAR.every(([dx, dz]) => !pineCand(ix + dx, iz + dz) || hash2(ix + dx, iz + dz, seed + 915) > hash2(ix, iz, seed + 915));
  for (let iz = 1; iz < W - 1; iz++) {
    for (let ix = 1; ix < W - 1; ix++) {
      const k = kind(ix, iz);
      if (!isLand(k) && k !== K.ROCK) continue;
      if (!clear(ix, iz)) continue;
      const r = hash2(ix, iz, seed + 900);
      const y = H(ix, iz);
      const ts = (0.8 + hash2(ix, iz, seed + 903) * 0.6) * TREE_SCALE;
      const rockS = 0.25 + hash2(ix, iz, seed + 905) * 0.3;
      if (k === K.DEEP) {
        // redwoods: dense but spaced so trunks never touch (≥ 2.1 cells apart); a few mossy rocks
        if (r < 0.42 && !redwoods.some((t) => Math.hypot(t.ix - ix, t.iz - iz) < 2.1)) {
          const t = { ix, iz, type: 'redwood', s: 0.82 + hash2(ix, iz, seed + 912) * 0.24 };
          redwoods.push(t);
          trees.push(t);
        } else if (r > 0.96) rocks.push({ ix, iz, s: rockS });
        continue;
      }
      if (k === K.FOREST && r < 0.5) {
        if (hash2(ix, iz, seed + 904) < 0.7) { if (r < PINE_CHANCE && pineKeep(ix, iz)) trees.push({ ix, iz, type: 'pine', s: ts * PINE_SCALE }); }
        else if (leafyKeep(ix, iz)) trees.push({ ix, iz, type: 'leafy', s: ts });
      } else if (k === K.GRASS && r < 0.05) { if (leafyKeep(ix, iz)) trees.push({ ix, iz, type: 'leafy', s: ts }); }
      else if (k === K.ROCK && r < 0.03 && y < 8) { if (pineKeep(ix, iz)) trees.push({ ix, iz, type: 'pine', s: ts * 0.8 * PINE_SCALE }); }
      else if ((k === K.ROCK && r < 0.14) || (k === K.GRASS && r < 0.07) || (k === K.SAND && r < 0.07)) rocks.push({ ix, iz, s: rockS });
    }
  }

  return finishWorld({ seed, heights, kinds, camp: { ix: camp.ix, iz: camp.iz }, ruins, trees, rocks });
}

/**
 * Turn a "base" (what a map file stores: heights, kinds, camp cell, ruin cells, trees and
 * rocks per cell) into the full world: exact positions, ruin pillars, flowers, walk-under trees,
 * all the procedural foliage, and collision obstacles. Deterministic from base.seed, so a map
 * looks the same for everyone. Keeps base.heights/base.kinds (no copy): the editor relies on that.
 * @param {{seed:number, heights:Float32Array, kinds:Uint8Array, camp:{ix:number,iz:number},
 *   ruins:{ix:number,iz:number}[], trees:{ix:number,iz:number,type:'leafy'|'pine'|'redwood',s:number}[],
 *   rocks:{ix:number,iz:number,s:number}[]}} base
 */
export function finishWorld(base) {
  const W = WORLD;
  const { seed, heights, kinds } = base;
  const H = (ix, iz) => (inWorld(ix, iz) ? heights[iz * W + ix] : 0);
  const kind = (ix, iz) => (inWorld(ix, iz) ? kinds[iz * W + ix] : K.SEABED);
  const VR = VILLAGE_RADIUS;
  const camp = { ix: base.camp.ix, iz: base.camp.iz };
  camp.x = toWorld(camp.ix);
  camp.z = toWorld(camp.iz);
  camp.y = H(camp.ix, camp.iz);
  const cx = camp.ix, cz = camp.iz;

  // ruins: a ring of 8 pillars (one missing, some broken), deterministic per spot
  const ruins = base.ruins.map(({ ix, iz }) => {
    const rand = rng((seed ^ Math.imul(ix + 1, 73856093) ^ Math.imul(iz + 1, 19349663)) >>> 0);
    const pillars = [];
    const count = 8, gap = Math.floor(rand() * count);
    for (let p = 0; p < count; p++) {
      if (p === gap) continue;
      const a = (p / count) * Math.PI * 2;
      pillars.push({ x: toWorld(ix) + Math.cos(a) * 2.4, z: toWorld(iz) + Math.sin(a) * 2.4, h: rand() < 0.4 ? 0.4 + rand() * 0.6 : 1.6 + rand() * 0.8 });
    }
    return { ix, iz, x: toWorld(ix), z: toWorld(iz), y: H(ix, iz), pillars };
  });

  // trees and rocks: jittered positions inside their cell
  const trees = [], redwoods = [];
  for (const t of base.trees) {
    const { ix, iz } = t;
    if (!inWorld(ix, iz)) continue;
    if (t.type === 'redwood') {
      redwoods.push({ ix, iz, x: toWorld(ix) + (hash2(ix, iz, seed + 910) - 0.5) * 0.2, z: toWorld(iz) + (hash2(ix, iz, seed + 911) - 0.5) * 0.2, y: H(ix, iz), s: t.s });
    } else {
      trees.push({ ix, iz, x: toWorld(ix) + (hash2(ix, iz, seed + 901) - 0.5) * 0.5, z: toWorld(iz) + (hash2(ix, iz, seed + 902) - 0.5) * 0.5, y: H(ix, iz), s: t.s, pine: t.type === 'pine' });
    }
  }
  const rocks = base.rocks.filter((r) => inWorld(r.ix, r.iz)).map(({ ix, iz, s }) => ({
    ix, iz, x: toWorld(ix) + (hash2(ix, iz, seed + 901) - 0.5) * 0.5, z: toWorld(iz) + (hash2(ix, iz, seed + 902) - 0.5) * 0.5, y: H(ix, iz), s,
  }));

  // flowers on open meadow cells (not near the camp or ruins, not under a tree or rock)
  const taken = new Set([...base.trees, ...base.rocks].map((o) => o.iz * W + o.ix));
  const clear = (ix, iz) => Math.hypot(camp.ix - ix, camp.iz - iz) > VR + 1 && ruins.every((p) => Math.hypot(p.ix - ix, p.iz - iz) > 4);
  const flowers = [];
  const FLOWER_COLORS = [0xf2e15c, 0xf28cc0, 0xffffff, 0x9fb8ff, 0xff7a59];
  for (let iz = 1; iz < W - 1; iz++) {
    for (let ix = 1; ix < W - 1; ix++) {
      if (kind(ix, iz) !== K.GRASS || taken.has(iz * W + ix) || !clear(ix, iz)) continue;
      const r = hash2(ix, iz, seed + 900);
      if (r < 0.07 || r >= 0.42) continue;
      const y = H(ix, iz);
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

  // Walk-under trees: move each tree's trunk onto a corner of its tile when the 4 tiles around
  // that corner are dry, rock-free and nearly level (within two STEPs; the trunk base sinks into higher tiles). All 4 tiles stay walkable; only
  // diagonal steps through that corner are blocked (world.cornerBlocks, vertex key cellKey(vx, vz)).
  // Trees on uneven ground stay centred on their tile and block it.
  const cornerBlocks = new Set();
  const rockCells = new Set(rocks.map((r) => toCell(r.z) * W + toCell(r.x)));
  for (const t of trees) {
    const sx = hash2(t.ix, t.iz, seed + 920) < 0.5 ? 0 : 1, sz = hash2(t.ix, t.iz, seed + 921) < 0.5 ? 0 : 1;
    const vx = t.ix + sx, vz = t.iz + sz; // grid vertex (corner between cells vx-1..vx, vz-1..vz)
    const cells = [[vx - 1, vz - 1], [vx, vz - 1], [vx - 1, vz], [vx, vz]];
    if (!cells.every(([x, z]) => inWorld(x, z))) continue;
    const hs = cells.map(([x, z]) => H(x, z));
    const ok = Math.max(...hs) - Math.min(...hs) <= 2 * STEP + 0.01 && Math.min(...hs) >= SEA
      && cells.every(([x, z]) => !rockCells.has(z * W + x)) && !cornerBlocks.has(cellKey(vx, vz))
      && Math.hypot(camp.ix + 0.5 - vx, camp.iz + 0.5 - vz) > VR + 1;
    if (!ok) continue;
    t.corner = true;
    t.x = toWorld(vx) - 0.5 + (hash2(t.ix, t.iz, seed + 922) - 0.5) * 0.12;
    t.z = toWorld(vz) - 0.5 + (hash2(t.ix, t.iz, seed + 923) - 0.5) * 0.12;
    t.y = Math.min(...hs);
    cornerBlocks.add(cellKey(vx, vz));
  }

  // Foliage (decorative, walk-through): grass tufts, bushes, ferns, mushrooms, reeds
  const tufts = [], tallGrass = [], bushes = [], ferns = [], mushrooms = [], reeds = [], motes = [], pebbles = [];
  const water = { lilies: [], seaweed: [], seaRocks: [], corals: [], seagrass: [] };
  const lush = { reeds, tallGrass, ferns, bushes, ...water }; // lists waterLife / bankLife add to
  const nearWater = (ix, iz) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => kind(ix + dx, iz + dz) === K.SEABED);
  const nearCamp = (ix, iz) => Math.hypot(camp.ix - ix, camp.iz - iz) < 1.5;
  // a point inside cell (ix, iz), deterministic per (ix, iz, n)
  const spot = (ix, iz, n, spread = 0.8) => ({
    x: toWorld(ix) + (hash2(ix * 7 + n, iz, seed + 1200) - 0.5) * spread,
    z: toWorld(iz) + (hash2(ix, iz * 7 + n, seed + 1300) - 0.5) * spread,
    y: H(ix, iz),
    r: hash2(ix + n, iz - n, seed + 1400), // general-purpose random 0..1
  });
  for (let iz = 1; iz < W - 1; iz++) {
    for (let ix = 1; ix < W - 1; ix++) {
      const k = kind(ix, iz);
      if (nearCamp(ix, iz)) continue;
      const roll = (n) => hash2(ix * 13 + n, iz * 17 - n, seed + 1500);
      if (k === K.GRASS || k === K.FOREST) {
        // lush ground cover: 3-6 tufts on meadows, 2-4 in forests
        const n = k === K.GRASS ? 1 + Math.floor(roll(0) * 3) : 2 + Math.floor(roll(0) * 3);
        for (let t = 0; t < n; t++) tufts.push(spot(ix, iz, t, 0.9));
        // patches of tall meadow grass where a slow noise is high
        if (k === K.GRASS && fbm(ix / 7, iz / 7, seed + 77, 2) > TALL_GRASS_T) {
          const tn = 2 + Math.floor(roll(9) * 2);
          for (let t = 0; t < tn; t++) tallGrass.push(spot(ix, iz, 60 + t, 0.9));
        }
        // fireflies / light motes drifting over some cells
        if (roll(11) < (k === K.FOREST ? 0.05 : 0.025)) motes.push({ ...spot(ix, iz, 70, 0.6), y: H(ix, iz) + 0.4 + roll(12) * 0.8 });
        if (roll(1) < (k === K.FOREST ? 0.08 : 0.035)) bushes.push({ ...spot(ix, iz, 10, 0.5), berries: roll(2) < 0.35 });
        if (k === K.FOREST && roll(3) < 0.35) ferns.push(spot(ix, iz, 20, 0.7));
        if (k === K.FOREST && roll(4) < 0.07) {
          const c = 1 + Math.floor(roll(5) * 3);
          for (let m = 0; m < c; m++) mushrooms.push(spot(ix, iz, 30 + m));
        }
      }
      if (k === K.DEEP) {
        // dim forest floor: sparse grass, lots of ferns, mushrooms, fireflies even by day
        const n = 1 + Math.floor(roll(0) * 2);
        for (let t = 0; t < n; t++) tufts.push(spot(ix, iz, t, 0.9));
        if (roll(3) < 0.7) ferns.push(spot(ix, iz, 20, 0.7));
        if (roll(13) < 0.3) ferns.push(spot(ix, iz, 21, 0.8));
        if (roll(4) < 0.18) {
          const c = 1 + Math.floor(roll(5) * 3);
          for (let m = 0; m < c; m++) mushrooms.push(spot(ix, iz, 30 + m));
        }
        if (roll(1) < 0.04) bushes.push({ ...spot(ix, iz, 10, 0.5), berries: roll(2) < 0.2 });
        if (roll(11) < 0.09) motes.push({ ...spot(ix, iz, 70, 0.6), y: H(ix, iz) + 0.4 + roll(12) * 0.9 });
      }
      if ((k === K.SAND || k === K.GRASS) && nearWater(ix, iz) && roll(6) < 0.55) {
        reeds.push({ ...spot(ix, iz, 40, 0.6), cattail: roll(7) < 0.5 });
      }
      if (roll(45) < pebbleChance(k)) pebbles.push(spot(ix, iz, 140, 0.6));
      if (k === K.ROCK && roll(8) < 0.3) tufts.push(spot(ix, iz, 50));
      if (k === K.DIRT && roll(0) < 0.5) tufts.push(spot(ix, iz, 0, 0.9)); // a stray tuft at a dirt patch's grassy edge
      if (k === K.SEABED) waterLife(ix, iz, H, kind, spot, roll, lush, seed);
      else bankLife(ix, iz, k, kind, spot, roll, lush);
      if (k === K.SAND && !nearWater(ix, iz) && roll(10) < 0.35) tufts.push(spot(ix, iz, 55));
    }
  }

  // flower beds in the campfire clearing (grass cells only)
  for (let dz = -VR; dz <= VR; dz++) {
    for (let dx = -VR; dx <= VR; dx++) {
      const ix = cx + dx, iz = cz + dz;
      if (Math.hypot(dx, dz) > VR || kind(ix, iz) !== K.GRASS || nearCamp(ix, iz)) continue;
      if (hash2(ix, iz, seed + 2100) > 0.22) continue;
      for (let f = 0; f < 3; f++) {
        flowers.push({
          x: toWorld(ix) + (hash2(ix * 5 + f, iz, seed + 2101) - 0.5) * 0.8,
          z: toWorld(iz) + (hash2(ix, iz * 5 + f, seed + 2102) - 0.5) * 0.8,
          y: H(ix, iz), c: FLOWER_COLORS[Math.floor(hash2(ix + f, iz, seed + 2103) * FLOWER_COLORS.length)],
        });
      }
    }
  }

  // Obstacles for collision, bucketed by column: circles { x, z, r }
  const obstacles = new Map();
  const addObs = (x, z, r) => {
    const key = toCell(z) * W + toCell(x);
    if (!obstacles.has(key)) obstacles.set(key, []);
    obstacles.get(key).push({ x, z, r });
  };
  trees.forEach((t) => { if (!t.corner) addObs(t.x, t.z, 0.18 * t.s); }); // corner trees use cornerBlocks
  redwoods.forEach((t) => addObs(t.x, t.z, 0.42 * t.s)); // thick trunks block their tile
  rocks.forEach((r) => addObs(r.x, r.z, r.s * 0.9));
  ruins.forEach((ru) => {
    ru.pillars.forEach((p) => addObs(p.x, p.z, 0.32));
    addObs(ru.x, ru.z, 0.55); // altar
  });
  addObs(camp.x, camp.z, 0.45); // campfire

  ruins.forEach((ru) => { ru.id = `${ru.ix},${ru.iz}`; });
  // Player digging (see main.js): an edit writes straight into the base's height/kind arrays.
  const edits = new Map(); // cellKey -> [ix, iz, h, k]
  // uh/uk: the ground under placed blocks (height and kind), or uh = -1 when nothing was placed
  const setEdit = (ix, iz, h, k, uh = -1, uk = 0) => {
    if (!inWorld(ix, iz)) return;
    heights[iz * W + ix] = h;
    kinds[iz * W + ix] = k;
    edits.set(cellKey(ix, iz), [ix, iz, h, k, uh, uk]);
  };
  const under = (ix, iz) => { const e = edits.get(cellKey(ix, iz)); return e && e[4] >= 0 ? [e[4], e[5]] : null; };
  const editsList = () => [...edits.values()].map(([ix, iz, h, k, uh, uk]) => (uh >= 0 ? [ix, iz, Math.round(h / STEP), k, Math.round(uh / STEP), uk] : [ix, iz, Math.round(h / STEP), k]));
  // Chopping (see main.js): take the tree growing from cell (ix, iz) out of the world for good.
  // Returns the removed tree ({x, y, z, s, ...}) or null. The base loses it too, so saves keep it gone.
  const chopped = new Set();
  const removeTree = (ix, iz) => {
    const bi = base.trees.findIndex((t) => t.ix === ix && t.iz === iz);
    if (bi < 0) return null;
    base.trees.splice(bi, 1);
    chopped.add(cellKey(ix, iz));
    let t = null;
    for (const list of [trees, redwoods]) {
      const i = list.findIndex((q) => q.ix === ix && q.iz === iz);
      if (i >= 0) [t] = list.splice(i, 1);
    }
    if (!t) return null;
    if (t.corner) cornerBlocks.delete(cellKey(Math.round(t.x + W / 2), Math.round(t.z + W / 2)));
    const key = toCell(t.z) * W + toCell(t.x), obs = obstacles.get(key);
    if (obs) { const j = obs.findIndex((o) => Math.abs(o.x - t.x) < 1e-6 && Math.abs(o.z - t.z) < 1e-6); if (j >= 0) obs.splice(j, 1); }
    return t;
  };
  const choppedList = () => [...chopped].map((k) => [keyX(k), keyZ(k)]);
  // Picks (see PICK): returns the bushes or pebbles on that cell before the pick, for the scene to hide.
  const picks = new Map();
  const setPick = (ix, iz, t) => {
    const key = pickKey(ix, iz, t);
    if (t === PICK.ROCK) { // a mined rock leaves the world (and the base, so island saves keep it gone) with its obstacle
      picks.set(key, [ix, iz, t]);
      const i = rocks.findIndex((r) => r.ix === ix && r.iz === iz);
      if (i < 0) return [];
      const [r] = rocks.splice(i, 1);
      const bi = base.rocks.findIndex((b) => b.ix === ix && b.iz === iz);
      if (bi >= 0) base.rocks.splice(bi, 1);
      const obs = obstacles.get(iz * W + ix);
      if (obs) { const j = obs.findIndex((o) => Math.abs(o.x - r.x) < 1e-6 && Math.abs(o.z - r.z) < 1e-6); if (j >= 0) obs.splice(j, 1); }
      return [r];
    }
    const hit = (t === PICK.PEBBLE ? pebbles : bushes).filter((o) => toCell(o.x) === ix && toCell(o.z) === iz);
    picks.set(key, [ix, iz, t]);
    applyPicks((k) => k === key, bushes, pebbles);
    return hit;
  };
  const pickList = () => [...picks.values()];
  return { benches: new Map(), piles: new Map(), setPick, pickList, pebbles, setEdit, under, editsList, removeTree, choppedList, base, seed, heights, kinds, camp, ruins, trees, redwoods, cornerBlocks, rocks, flowers, tufts, tallGrass, bushes, ferns, mushrooms, reeds, motes, ...water, obstacles, H, kind };
}

/**
 * Underwater and pond life for one SEABED cell (shared by islands and endless worlds):
 * swaying seaweed and mossy rocks on the seabed, and lily pads (some flowering) floating in
 * shallow water near a shore. `spot`/`roll` are the per-cell helpers of the caller.
 */
export function waterLife(ix, iz, H, kind, spot, roll, out, seed = 0) {
  const depth = SEA - H(ix, iz);
  if (depth <= 0.05) return;
  // coral reefs: in patches (a slow noise) where the water is shallow enough for light, several corals
  // per cell; colourful, and with fewer seaweed ribbons among them
  let reef = 0;
  if (depth >= REEF_MIN && depth <= REEF_MAX) {
    reef = smooth(REEF_T, REEF_T + 0.12, fbm(ix / 15, iz / 15, seed + 515, 3));
    if (reef > 0 && roll(60) < 0.12 + reef * 0.3) {
      const n = 1 + Math.floor(roll(61) * (1 + reef));
      for (let p = 0; p < n; p++) {
        const it = spot(ix, iz, 130 + p, 0.9);
        const t = Math.floor(roll(62 + p) * (depth < 0.45 ? 4 : 5)); // no tall fans in the very shallow water
        out.corals.push({ ...it, type: t === 2 && depth < 0.6 ? 1 : t, c: Math.floor(roll(70 + p) * 6), s: Math.min(1.15, 0.55 + depth * 0.5) * (0.75 + it.r * 0.5) });
      }
    }
  }
  // starfish on the sandy bottom of the shallows
  if (depth < 0.9 && roll(66) < 0.015) out.corals.push({ ...spot(ix, iz, 150, 0.8), type: 5, c: Math.floor(roll(67) * 3), s: 0.8 + roll(68) * 0.4 });
  let shore = false;
  for (let dz = -2; dz <= 2 && !shore; dz++) for (let dx = -2; dx <= 2; dx++) if (kind(ix + dx, iz + dz) !== K.SEABED) { shore = true; break; }
  // reeds and cattails standing in the shallows, tall enough to poke out of the water
  if (shore && depth <= 0.45 && roll(26) < 0.5) {
    const n = 1 + Math.floor(roll(27) * 2);
    for (let p = 0; p < n; p++) {
      const it = spot(ix, iz, 110 + p, 0.8);
      out.reeds.push({ ...it, cattail: roll(28 + p) < 0.45, s: ((depth + 0.28) / 0.55) * (1 + it.r * 0.3) });
    }
  }
  if (shore && depth < 1.1 && roll(14) < 0.32) {
    const n = 1 + Math.floor(roll(15) * 3);
    for (let p = 0; p < n; p++) out.lilies.push({ ...spot(ix, iz, 80 + p, 0.85), y: SEA, flower: roll(16 + p) < 0.25 });
  }
  // seagrass meadows: dense patches of short swaying blades on the seabed (a slow noise), and a few stray clumps
  const meadow = depth >= 0.25 && depth <= 2.8 ? smooth(0.44, 0.56, fbm(ix / 12, iz / 12, seed + 717, 2)) * (1 - reef * 0.7) : 0;
  if (roll(80) < (meadow > 0 ? 0.45 + meadow * 0.5 : 0.08)) {
    const n = 1 + Math.floor(roll(81) * (1 + meadow * 4));
    for (let m = 0; m < n; m++) out.seagrass.push({ ...spot(ix, iz, 170 + m, 0.9), h: Math.min(depth, 1.3) });
  }
  if (roll(20) < (reef > 0 ? 0.18 : 0.42)) {
    const c = 1 + Math.floor(roll(21) * 3);
    for (let m = 0; m < c; m++) out.seaweed.push({ ...spot(ix, iz, 90 + m, 0.85), h: Math.min(depth, 2.2) });
  }
  if (roll(24) < 0.07) out.seaRocks.push({ ...spot(ix, iz, 99, 0.5), s: 0.18 + roll(25) * 0.22 });
}

/**
 * Lush banks: extra plants on dry land within 2 cells of water (shared by islands and endless worlds):
 * a second reed clump right at the edge, tall grass clumps, ferns and the odd bush on grassy banks.
 */
export function bankLife(ix, iz, k, kind, spot, roll, out) {
  if (k !== K.GRASS && k !== K.FOREST && k !== K.SAND) return;
  let edge = false, near = false;
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (kind(ix + dx, iz + dz) !== K.SEABED) continue;
      near = true;
      if (Math.abs(dx) + Math.abs(dz) === 1) edge = true;
    }
  }
  if (!near) return;
  if (edge && roll(30) < 0.45) out.reeds.push({ ...spot(ix, iz, 45, 0.7), cattail: roll(34) < 0.5 });
  if (k === K.SAND) return;
  if (roll(31) < 0.35) {
    const n = 2 + Math.floor(roll(35) * 2);
    for (let t = 0; t < n; t++) out.tallGrass.push(spot(ix, iz, 120 + t, 0.9));
  }
  if (roll(32) < 0.25) out.ferns.push(spot(ix, iz, 25, 0.7));
  if (roll(33) < 0.06) out.bushes.push({ ...spot(ix, iz, 15, 0.5), berries: roll(36) < 0.3 });
}

// Ground height under a world-space point.
export function groundAt(world, x, z) {
  return world.H(toCell(x), toCell(z));
}

// A free spawn point near the campfire (deterministic per player id).
export function spawnPoint(world, id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const a = (h % 360) * (Math.PI / 180);
  const x = world.camp.x + Math.cos(a) * 1.6, z = world.camp.z + Math.sin(a) * 1.6;
  return { x, z, y: groundAt(world, x, z) };
}
