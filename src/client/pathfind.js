// Grid pathfinding for tile-locked movement: 8-way A* over the terrain columns.
// Rules match what the character can do (see controller.js):
//  - step up to MAX_UP (anything above a normal step is a hop)
//  - drop down up to MAX_DOWN
//  - deep water is swimmable but slow, so it costs more
//  - a column containing a rock, pillar, campfire or tile-centred tree is blocked
//  - walk-under trees sit on tile corners: their tiles stay open, but diagonals through that corner are blocked
//  - diagonal steps may not cut corners
// Cells are global (ix, iz) and may be negative in an endless world; routes are lists of cellKey()s.
// The island keeps its tables in flat arrays; an endless world keeps them per chunk (endless.js content()).

import { WORLD, SEA, toWorld, inWorld, cellKey, keyX, keyZ, pileTop } from '../shared/world.js';
import { CH } from '../shared/endless.js';

const MAX_UP = 1.25; // two blocks and a bit (a quarter more than 1.0, at the user's request)
const MAX_DOWN = 3.0;
const FURNITURE_CLEAR = 0.17; // the character's radius, kept clear of furniture footprints
export const SWIM_FLOOR = SEA - 0.55;
const MAX_EXPANSIONS = 12000;
const WIN = 96; // routes search a (2·WIN+1)² window around the midpoint of start and goal

export { cellKey, keyX, keyZ };

export class PathFinder {
  constructor(world) {
    this.world = world;
    this.endless = !!world.endless;
    if (this.endless) {
      this._ck = NaN; this._c = null; // last chunk looked up
      return;
    }
    const N = WORLD * WORLD;
    this.floorA = new Float32Array(N); // height the player stands at
    this.waterA = new Uint8Array(N);
    this.blockedA = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      this.floorA[i] = Math.max(world.heights[i], SWIM_FLOOR);
      this.waterA[i] = world.heights[i] < SWIM_FLOOR ? 1 : 0;
    }
    for (const [key, list] of world.obstacles) {
      // a cell is blocked if an obstacle sits near its middle
      const ix = key % WORLD, iz = Math.floor(key / WORLD);
      if (list.some((o) => Math.hypot(o.x - toWorld(ix), o.z - toWorld(iz)) < o.r + 0.3)) this.blockedA[key] = 1;
    }
    // keep a 1-cell margin at the world edge
    for (let i = 0; i < WORLD; i++) {
      this.blockedA[i] = this.blockedA[(WORLD - 1) * WORLD + i] = 1;
      this.blockedA[i * WORLD] = this.blockedA[i * WORLD + WORLD - 1] = 1;
    }
  }

  /** A cell's height changed (digging): refresh what's cached for it. */
  refresh(ix, iz) {
    if (this.endless) { this._ck = NaN; this._c = null; return; } // the chunk's content was regenerated
    if (!inWorld(ix, iz)) return;
    const i = iz * WORLD + ix, h = this.world.heights[i];
    this.floorA[i] = Math.max(h, SWIM_FLOOR);
    this.waterA[i] = h < SWIM_FLOOR ? 1 : 0;
    // obstacles may have changed too (a chopped tree); the world edge stays blocked
    if (ix > 0 && iz > 0 && ix < WORLD - 1 && iz < WORLD - 1) {
      const list = this.world.obstacles.get(i);
      this.blockedA[i] = list?.some((o) => Math.hypot(o.x - toWorld(ix), o.z - toWorld(iz)) < o.r + 0.3) ? 1 : 0;
    }
  }

  // endless: the content chunk holding a cell (generated on demand, cached in endless.js)
  _chunk(ix, iz) {
    const cx = Math.floor(ix / CH), cz = Math.floor(iz / CH), k = cellKey(cx, cz);
    if (k !== this._ck) { this._c = this.world.content(cx, cz); this._ck = k; }
    return this._c;
  }
  _li(ix, iz) { return (iz - Math.floor(iz / CH) * CH) * CH + (ix - Math.floor(ix / CH) * CH); }

  /** Height the character stands at on a cell (the swim floor in deep water). */
  floorAt(ix, iz) {
    const base = this.endless ? this._chunk(ix, iz).floor[this._li(ix, iz)] : inWorld(ix, iz) ? this.floorA[iz * WORLD + ix] : SWIM_FLOOR;
    // a log pile: you stand on top of it
    const pl = this.world.piles?.size ? this.world.piles.get(cellKey(ix, iz)) : null;
    return pl ? base + pileTop(pl[3]) : base;
  }
  waterAt(ix, iz) {
    if (this.endless) return this._chunk(ix, iz).water[this._li(ix, iz)] === 1;
    return inWorld(ix, iz) && this.waterA[iz * WORLD + ix] === 1;
  }
  passable(ix, iz) {
    if (this.world.benches?.size && this.world.benches.has(cellKey(ix, iz))) return false; // a workbench stands there
    return this.groundOpen(ix, iz);
  }
  // open ground, ignoring furniture
  groundOpen(ix, iz) {
    if (this.endless) return !this._chunk(ix, iz).blocked[this._li(ix, iz)];
    return inWorld(ix, iz) && !this.blockedA[iz * WORLD + ix];
  }
  // a walk-under tree's trunk on grid vertex (vx, vz)?
  cornerBlocked(vx, vz) {
    const v = cellKey(vx, vz);
    if (!this.endless) return !!this.world.cornerBlocks?.has(v);
    // the tree owning that corner grows on one of the 4 cells around it
    for (const [x, z] of [[vx - 1, vz - 1], [vx, vz - 1], [vx - 1, vz], [vx, vz]]) if (this._chunk(x, z).corners.has(v)) return true;
    return false;
  }

  canStep(ax, az, bx, bz) {
    const dh = this.floorAt(bx, bz) - this.floorAt(ax, az);
    return dh <= MAX_UP + 0.01 && dh >= -MAX_DOWN - 0.01;
  }

  // Can the character move from cell (ix, iz) by (dx, dz), each -1..1?
  stepOk(ix, iz, dx, dz) {
    const nx = ix + dx, nz = iz + dz;
    if (!this.passable(nx, nz)) return false;
    if (!this.canStep(ix, iz, nx, nz)) return false;
    if (dx && dz) {
      // no corner cutting: both side cells must be walkable too
      if (!this.passable(nx, iz) || !this.passable(ix, nz)) return false;
      if (!this.canStep(ix, iz, nx, iz) || !this.canStep(ix, iz, ix, nz)) return false;
      // a walk-under tree's trunk sits on the shared corner
      if (this.cornerBlocked(ix + (dx > 0 ? 1 : 0), iz + (dz > 0 ? 1 : 0))) return false;
    }
    return true;
  }

  // ---------- half-tile positions (the character's own movement, see controller.js) ----------
  // A position (qx, qz) is in half tiles: odd = a tile's centre (tile (q - 1) / 2), even = the edge
  // between tiles q/2 - 1 and q/2. A centre touches one tile, an edge two, a corner four.
  /** The tiles a half-tile position touches, as [ix, iz] pairs. */
  halfTiles(qx, qz) {
    const xs = qx & 1 ? [(qx - 1) / 2] : [qx / 2 - 1, qx / 2];
    const zs = qz & 1 ? [(qz - 1) / 2] : [qz / 2 - 1, qz / 2];
    const out = [];
    for (const z of zs) for (const x of xs) out.push([x, z]);
    return out;
  }
  /** Standing height at a half position: on an edge you stand on the highest tile it touches. */
  halfFloor(qx, qz) {
    let f = -Infinity;
    for (const [x, z] of this.halfTiles(qx, qz)) f = Math.max(f, this.floorAt(x, z));
    return f;
  }
  /** Swimming there: only when every tile it touches is water. */
  halfWater(qx, qz) { return this.halfTiles(qx, qz).every(([x, z]) => this.waterAt(x, z)); }
  /** Can the character stand there? Every tile it touches must be open, and no walk-under trunk on that corner. */
  halfOpen(qx, qz) {
    if (!(qx & 1) && !(qz & 1) && this.cornerBlocked(qx / 2, qz / 2)) return false;
    return this.halfTiles(qx, qz).every(([x, z]) => this.passable(x, z) || this.besideFurniture(qx, qz, x, z));
  }
  /**
   * Furniture blocks its tile for routes and whole-tile steps, but you may stand on that tile's edge or
   * corner where the piece doesn't reach: its real footprint (`footprint(type)` → [x0, x1, z0, z1] in the
   * tile, unrotated; set by main.js from the models) grown by the character's radius.
   */
  besideFurniture(qx, qz, ix, iz) {
    if ((qx & 1) && (qz & 1)) return false; // never the middle of its tile
    const b = this.footprint && this.world.benches?.get(cellKey(ix, iz));
    if (!b || !this.groundOpen(ix, iz)) return false;
    const f = this.footprint(b[3] ?? 0);
    if (!f) return false;
    const ox = qx / 2 - ix - 0.5, oz = qz / 2 - iz - 0.5; // where we'd stand, from the tile's centre (-0.5, 0 or 0.5)
    // the footprint turned by its quarter turns (the model's rotation about y)
    const r = ((b[2] % 4) + 4) % 4, c = [1, 0, -1, 0][r], sn = [0, 1, 0, -1][r];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of [[f[0], f[2]], [f[1], f[2]], [f[0], f[3]], [f[1], f[3]]]) {
      const rx = x * c + z * sn, rz = -x * sn + z * c;
      x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); z0 = Math.min(z0, rz); z1 = Math.max(z1, rz);
    }
    const R = FURNITURE_CLEAR;
    return !(ox > x0 - R && ox < x1 + R && oz > z0 - R && oz < z1 + R);
  }
  /** A half step from (qx, qz) by (dx, dz), each -1..1: same climb and drop limits as whole tiles, no corner cutting. */
  halfStepOk(qx, qz, dx, dz) {
    const ok = (ax, az, bx, bz) => {
      if (!this.halfOpen(bx, bz)) return false;
      const dh = this.halfFloor(bx, bz) - this.halfFloor(ax, az);
      return dh <= MAX_UP + 0.01 && dh >= -MAX_DOWN - 0.01;
    };
    if (!ok(qx, qz, qx + dx, qz + dz)) return false;
    if (dx && dz && (!ok(qx, qz, qx + dx, qz) || !ok(qx, qz, qx, qz + dz))) return false;
    return true;
  }

  // nearest passable cell to (ix, iz), searching outward a little
  nearestOpen(ix, iz, maxR = 3) {
    if (this.passable(ix, iz)) return [ix, iz];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!this.passable(ix + dx, iz + dz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = [ix + dx, iz + dz]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Route between cells.
   * @returns {number[] | null} cellKey()s to walk through, excluding the start (empty if already there)
   */
  route(fromIx, fromIz, toIx, toIz) {
    const g = this.nearestOpen(toIx, toIz);
    if (!g) return null;
    if (fromIx === g[0] && fromIz === g[1]) return [];
    // search a window around the midpoint (start and goal must both fit)
    const S = 2 * WIN + 1;
    const ox = Math.round((fromIx + g[0]) / 2) - WIN, oz = Math.round((fromIz + g[1]) / 2) - WIN;
    const inWin = (x, z) => x >= ox && z >= oz && x < ox + S && z < oz + S;
    if (!inWin(fromIx, fromIz) || !inWin(g[0], g[1])) return null;
    const idx = (x, z) => (z - oz) * S + (x - ox);
    const start = idx(fromIx, fromIz), goal = idx(g[0], g[1]);

    const gScore = new Float32Array(S * S).fill(Infinity);
    const came = new Int32Array(S * S).fill(-1);
    const closed = new Uint8Array(S * S);
    const heap = new MinHeap();
    const hEst = (i) => { const dx = Math.abs((i % S) + ox - g[0]), dz = Math.abs(Math.floor(i / S) + oz - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    gScore[start] = 0;
    heap.push(start, hEst(start));
    let expansions = 0, found = false;

    while (heap.size && expansions++ < MAX_EXPANSIONS) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = (cur % S) + ox, cz = Math.floor(cur / S) + oz;
      const fCur = this.floorAt(cx, cz);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!inWin(nx, nz)) continue;
          const n = idx(nx, nz);
          if (closed[n] || !this.stepOk(cx, cz, dx, dz)) continue;
          let cost = dx && dz ? 1.414 : 1;
          if (this.waterAt(nx, nz)) cost *= 3;
          if (this.floorAt(nx, nz) - fCur > 0.6) cost += 1.5; // prefer routes that don't need hops
          const ng = gScore[cur] + cost;
          if (ng < gScore[n]) {
            gScore[n] = ng;
            came[n] = cur;
            heap.push(n, ng + hEst(n));
          }
        }
      }
    }
    if (!found) return null;

    const cells = [];
    for (let c = goal; c !== start; c = came[c]) cells.push(cellKey((c % S) + ox, Math.floor(c / S) + oz));
    return cells.reverse();
  }
}

class MinHeap {
  constructor() { this.items = []; this.pri = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const a = this.items, q = this.pri;
    a.push(item); q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= q[i]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      [q[parent], q[i]] = [q[i], q[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items, q = this.pri;
    const top = a[0];
    const lastI = a.pop(), lastP = q.pop();
    if (a.length) {
      a[0] = lastI; q[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [q[m], q[i]] = [q[i], q[m]];
        i = m;
      }
    }
    return top;
  }
}
