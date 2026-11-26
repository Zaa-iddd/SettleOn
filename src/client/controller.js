// Grid player movement in half-tile steps. The character rests on a tile's centre or on its edge
// (or corner), and moves half a tile at a time (8 directions, no corner cutting). On an edge it
// stands on the highest tile it touches, so you can walk right up to the edge of a block and look
// over it, but you can only reach an edge from the high side (see PathFinder.halfStepOk).
// Small height changes are smooth; bigger ledges and drops get a little hop arc.
// Deep water is swum through at the water surface.
//
// Positions are kept in half tiles (qx, qz): odd = a tile's centre, even = an edge between tiles.
// `ix, iz` is the tile the character stands on (the highest one it touches), which the rest of the
// game uses for digging, placing and routes.

import { STEP, toWorld, cellKey, keyX, keyZ, WORLD } from '../shared/world.js';
import { ANIM } from './character.js';

const WALK = 3.2; // tiles per second
const RUN = 5.6;
const SWIM = 1.8;
const HOP_SECS = 0.45; // standing jump (Space)
const RUN_AFTER = 10; // walking a route runs when more than this many half steps remain
export const IMPACT_DROP = 2 * STEP; // landing from this far down (2 blocks) kicks up an impact

const halfToWorld = (q) => q / 2 - WORLD / 2; // world x (or z) of a half-tile position

export class GridController {
  /** @param {import('./pathfind.js').PathFinder} paths */
  constructor(paths, ix, iz) {
    this.paths = paths;
    this.qx = 2 * ix + 1;
    this.qz = 2 * iz + 1;
    this.ix = ix;
    this.iz = iz;
    this.pos = { x: toWorld(ix), y: paths.floorAt(ix, iz), z: toWorld(iz) };
    this.ry = 0;
    this.speed = 0;
    this.anim = ANIM.IDLE;
    this.swimming = paths.waterAt(ix, iz);
    this.step = null; // { from, to, toQx, toQz, toIx, toIz, t, dur, arc, speed, run }
    this.queue = []; // remaining [qx, qz] half positions of a route
    this.hop = 0; // time left in a standing jump
    this.onLand = null; // (drop) callback after a big drop onto dry ground
  }

  get cell() { return cellKey(this.ix, this.iz); }
  get moving() { return !!this.step || this.queue.length > 0; }
  /** Is the character on the centre of its tile (not on an edge)? */
  get centred() { return (this.qx & 1) === 1 && (this.qz & 1) === 1; }
  /** The tiles the character touches right now (one at a tile's centre, two on an edge, four on a corner). */
  touching() { return this.paths.halfTiles(this.qx, this.qz); }

  // the tile a half position stands on: the highest one it touches (keeping `prefer` on a tie)
  homeOf(qx, qz, prefer) {
    let best = null, bf = -Infinity;
    for (const [x, z] of this.paths.halfTiles(qx, qz)) {
      const f = this.paths.floorAt(x, z) + (prefer && x === prefer[0] && z === prefer[1] ? 1e-6 : 0) - (this.paths.passable(x, z) ? 0 : 1e-3); // not furniture's tile
      if (f > bf) { bf = f; best = [x, z]; }
    }
    return best;
  }

  /**
   * Follow a list of cellKey()s (from PathFinder.route): to the centre of the tile we're on first
   * if we're on an edge, then centre to centre in half steps. The current step finishes first.
   */
  setPath(cells) {
    const end = this.step ? [this.step.toQx, this.step.toQz] : [this.qx, this.qz];
    const home = this.step ? [this.step.toIx, this.step.toIz] : [this.ix, this.iz];
    const q = [];
    let px = 2 * home[0] + 1, pz = 2 * home[1] + 1;
    if (end[0] !== px || end[1] !== pz) q.push([px, pz]);
    for (const k of cells) {
      const nx = 2 * keyX(k) + 1, nz = 2 * keyZ(k) + 1;
      q.push([(px + nx) / 2, (pz + nz) / 2], [nx, nz]);
      px = nx; pz = nz;
    }
    this.queue = q;
  }
  clearPath() { this.queue = []; }

  /** Start a half step by (dx, dz). Returns false if it's blocked. */
  tryStep(dx, dz, run) {
    if (!this.paths.halfStepOk(this.qx, this.qz, dx, dz)) {
      this.ry = Math.atan2(dx, dz); // at least turn to face that way
      return false;
    }
    const nqx = this.qx + dx, nqz = this.qz + dz;
    const water = this.paths.halfWater(nqx, nqz) || this.paths.halfWater(this.qx, this.qz);
    const from = { x: this.pos.x, y: this.paths.halfFloor(this.qx, this.qz), z: this.pos.z };
    const to = { x: halfToWorld(nqx), y: this.paths.halfFloor(nqx, nqz), z: halfToWorld(nqz) };
    const dist = Math.hypot(dx, dz) / 2; // in tiles
    const dh = to.y - from.y;
    const speed = water ? SWIM : run ? RUN : WALK;
    const bigStep = Math.abs(dh) > STEP + 0.05;
    const [toIx, toIz] = this.homeOf(nqx, nqz, [this.ix, this.iz]);
    this.step = {
      from, to, toQx: nqx, toQz: nqz, toIx, toIz, t: 0,
      dur: (dist / speed) * (bigStep ? 1.6 : 1), // a hop takes a bit longer than a plain half step
      arc: bigStep ? 0.3 + Math.max(0, dh) * 0.6 : 0, // hop height over the ledge
      speed,
      run,
    };
    this.ry = Math.atan2(dx, dz);
    return true;
  }

  /**
   * @param {number} dt seconds
   * @param {{x:number, z:number, run:boolean, jump:boolean}} keys  x = right, z = up (screen)
   */
  update(dt, keys) {
    dt = Math.min(dt, 0.05);
    const keyDir = keys.x || keys.z;
    if (keyDir) this.queue = []; // keyboard takes over from a route

    // standing jump
    if (keys.jump && !this.step && this.hop <= 0 && !this.swimming) this.hop = HOP_SECS;

    // advance the current step
    if (this.step) {
      const s = this.step;
      s.t = Math.min(1, s.t + dt / s.dur);
      const smooth = s.t * s.t * (3 - 2 * s.t);
      this.pos.x = s.from.x + (s.to.x - s.from.x) * s.t;
      this.pos.z = s.from.z + (s.to.z - s.from.z) * s.t;
      this.pos.y = s.from.y + (s.to.y - s.from.y) * (s.arc ? s.t : smooth) + s.arc * 4 * s.t * (1 - s.t);
      if (s.t >= 1) {
        this.qx = s.toQx;
        this.qz = s.toQz;
        this.ix = s.toIx;
        this.iz = s.toIz;
        Object.assign(this.pos, s.to);
        this.step = null;
        const drop = s.from.y - s.to.y;
        if (drop >= IMPACT_DROP - 0.01 && !this.paths.halfWater(this.qx, this.qz)) this.onLand?.(drop);
      }
    }

    // pick the next step
    if (!this.step) {
      if (keyDir) {
        // screen up (W) is north (-z); diagonal if two keys are held
        const dx = Math.sign(keys.x), dz = -Math.sign(keys.z);
        if (!this.tryStep(dx, dz, keys.run) && dx && dz) {
          // diagonal blocked: try the two straight directions instead
          if (!this.tryStep(dx, 0, keys.run)) this.tryStep(0, dz, keys.run);
        }
      } else if (this.queue.length) {
        const [nx, nz] = this.queue[0];
        const dx = nx - this.qx, dz = nz - this.qz;
        if (!dx && !dz) this.queue.shift(); // already there
        else if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1 && this.tryStep(dx, dz, keys.run || this.queue.length > RUN_AFTER)) this.queue.shift();
        else this.queue = []; // path no longer valid; stop here
      }
    }

    // standing hop
    let hopY = 0;
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt);
      const t = 1 - this.hop / HOP_SECS;
      hopY = 0.55 * 4 * t * (1 - t);
    }
    if (!this.step) {
      // the ground may change under us (digging, logs taken off): follow it, and re-pick the tile we stand on
      [this.ix, this.iz] = this.homeOf(this.qx, this.qz, [this.ix, this.iz]);
      this.pos.y = this.paths.halfFloor(this.qx, this.qz) + hopY;
    }

    // state for animation + network
    const [hx, hz] = this.step && this.step.t >= 0.5 ? [this.step.toQx, this.step.toQz] : [this.qx, this.qz];
    this.swimming = this.paths.halfWater(hx, hz) && !this.step?.arc;
    this.speed = this.step ? this.step.speed : 0;
    this.anim = this.swimming ? ANIM.SWIM
      : (this.step?.arc || this.hop > 0) ? ANIM.AIR
      : this.step ? (this.step.run ? ANIM.RUN : ANIM.WALK)
      : ANIM.IDLE;
  }
}
