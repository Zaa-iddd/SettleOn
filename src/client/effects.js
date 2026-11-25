// One-shot particle effects. Client-only decoration (not synced; each client spawns its own).
// Impact: a puff ring of dust plus a few ground chips, when a character lands from a big drop.
// Splash (water): droplets thrown up in a crown that fall back into the water (each leaving a fleck of foam where it
// lands), and a ring of foam spreading out on the surface. Boats also throw droplets as bow spray (`drop`).

import * as THREE from 'three';
import { K, SEA } from '../shared/world.js';

const MAX_PUFFS = 96, MAX_CHIPS = 48, MAX_DROPS = 320, MAX_FOAM = 200;
const GRAVITY = 11;
// dust and chip colours per ground kind
// 'water' is a splash (fish leaping), not a ground kind
const DUST = { water: 0xd6f0ff, [K.SAND]: 0xf1e2b0, [K.ROCK]: 0xc9c4ba, [K.SNOW]: 0xffffff, [K.PATH]: 0xe2dacb, [K.TRAIL]: 0xdcc69c, [K.DIRT]: 0xcdb38c, [K.SOIL]: 0xc4a47c, [K.WOOD]: 0xd8b48a, [K.WOOD2]: 0xd8b48a, [K.WALL]: 0xd8b48a, wood: 0xd8b48a, leaves: 0x8fcf4a };
const CHIPS = { water: [0x9fd8ff, 0xe8f7ff], [K.GRASS]: [0x6fb33a, 0x8fcf4a, 0x9a7a52], [K.FOREST]: [0x4f8f32, 0x6fb33a, 0x7a5c3c], [K.SAND]: [0xe0c98a, 0xcfb576], [K.ROCK]: [0x9a958c, 0x7c776f], [K.SNOW]: [0xffffff, 0xdfe8f2], [K.TRAIL]: [0xb08a5a, 0x9a7a52], [K.DIRT]: [0x8f6a44, 0x6fb33a], [K.SOIL]: [0x8f6a44, 0x6f4f32], [K.WOOD]: [0xa87444, 0x7a4f2c], [K.WOOD2]: [0xa87444, 0x7a4f2c], [K.WALL]: [0x8a5730, 0x5a3418], wood: [0xc89a64, 0x8a5a30, 0x6e4426], leaves: [0x5fae3e, 0x8fcf4a, 0x3f7f2c] };
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();

function pool(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) { m.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); m.setColorAt(i, tmpC.set(0xffffff)); }
  return m;
}

export class Effects {
  constructor(scene) {
    this.puffs = Array.from({ length: MAX_PUFFS }, () => ({ life: 1, dur: 1 }));
    this.chips = Array.from({ length: MAX_CHIPS }, () => ({ life: 1, dur: 1 }));
    this.puffMesh = pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_PUFFS);
    this.chipMesh = pool(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX_CHIPS);
    this.nextPuff = 0;
    this.nextChip = 0;
    scene.add(this.puffMesh, this.chipMesh);
    // water: unlit droplets (a few a touch over 1, so they glint in the bloom) and additive foam flecks on the surface
    this.drops = Array.from({ length: MAX_DROPS }, () => ({ life: 1, dur: 1 }));
    this.dropMesh = pool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_DROPS);
    this.foam = Array.from({ length: MAX_FOAM }, () => ({ life: 1, dur: 1 }));
    this.foamMesh = pool(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_FOAM);
    this.foamMesh.renderOrder = 7; // after the water
    for (let i = 0; i < MAX_FOAM; i++) this.foamMesh.setColorAt(i, tmpC.setRGB(0, 0, 0));
    this.nextDrop = 0;
    this.nextFoam = 0;
    this.dropsLive = this.foamLive = 0;
    scene.add(this.dropMesh, this.foamMesh);
  }

  /** One droplet of water from (x, y, z) with velocity (vx, vy, vz); it falls back to the surface at `floor`. */
  drop(x, y, z, vx, vy, vz, size = 0.06, floor = SEA) {
    const d = this.drops[this.nextDrop];
    Object.assign(d, { x, y, z, vx, vy, vz, size, floor, life: 0, dur: 2.5 });
    const w = Math.random();
    this.dropMesh.setColorAt(this.nextDrop, w < 0.12 ? tmpC.setRGB(1.25, 1.3, 1.35) : tmpC.set(w < 0.55 ? 0xf2fbff : 0xbfe6fa));
    this.dropMesh.instanceColor.needsUpdate = true;
    this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
    this.dropsLive = MAX_DROPS;
  }
  /** A fleck of foam on the water at (x, z), drifting at (vx, vz) and growing as it fades. */
  foamAt(x, z, vx, vz, size, dur, bright, y = SEA) {
    const f = this.foam[this.nextFoam];
    Object.assign(f, { x, z, y, vx, vz, size, dur, bright, rot: Math.random() * Math.PI / 2, life: 0 });
    this.nextFoam = (this.nextFoam + 1) % MAX_FOAM;
    this.foamLive = MAX_FOAM;
  }
  /**
   * A splash on the water at (x, y = surface, z). power 0..1: a fish or a bobber is small, a boat hitting
   * something is big. (dx, dz) optionally throws the spray more one way (a boat's bow ploughing into a bank).
   */
  splash(x, y, z, power = 0.5, dx = 0, dz = 0) {
    const p = Math.max(0.05, Math.min(1, power));
    const n = Math.round(8 + p * 34);
    for (let i = 0; i < n; i++) { // the crown: droplets flung up and out all round
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5, out = (0.5 + Math.random() * 1.3) * (0.5 + p * 0.9), r = 0.08 + p * 0.25;
      this.drop(x + Math.cos(a) * r, y + 0.02, z + Math.sin(a) * r, Math.cos(a) * out + dx * (1 + Math.random()), (1.6 + Math.random() * 2) * (0.55 + p * 0.75), Math.sin(a) * out + dz * (1 + Math.random()), 0.04 + Math.random() * 0.04 + p * 0.03, y);
    }
    const m = Math.round(2 + p * 8);
    for (let i = 0; i < m; i++) { // a column of bigger drops in the middle, up higher
      const a = Math.random() * Math.PI * 2, out = Math.random() * 0.4;
      this.drop(x + Math.cos(a) * 0.05, y + 0.05, z + Math.sin(a) * 0.05, Math.cos(a) * out + dx * 0.5, (3 + Math.random() * 1.8) * (0.6 + p * 0.6), Math.sin(a) * out + dz * 0.5, 0.07 + Math.random() * 0.04 + p * 0.04, y);
    }
    const f = Math.round(10 + p * 18);
    for (let i = 0; i < f; i++) { // a ring of foam spreading out on the surface, and churned water in the middle
      const a = (i / f) * Math.PI * 2 + Math.random() * 0.3, sp = (0.9 + Math.random() * 0.6) * (0.6 + p);
      this.foamAt(x + Math.cos(a) * 0.12, z + Math.sin(a) * 0.12, Math.cos(a) * sp, Math.sin(a) * sp, 0.1 + p * 0.08, 0.8 + Math.random() * 0.5 + p * 0.5, 0.45 + p * 0.3, y);
    }
    for (let i = 0; i < 3 + p * 4; i++) this.foamAt(x + (Math.random() - 0.5) * 0.3 * (1 + p), z + (Math.random() - 0.5) * 0.3 * (1 + p), 0, 0, 0.18 + p * 0.2, 1.4 + p, 0.5, y);
  }

  /** Landing impact at a tile-centre point. `drop` = fall height (≥ 1), `kind` = ground kind. */
  impact(x, y, z, drop, kind) {
    if (kind === 'water') return this.splash(x, y, z, Math.max(0.05, Math.min(1, drop / 2.5)));
    const power = Math.min(1, (drop - 0.5) / 2); // 0.25 at 1.0, 1 at 2.5+
    const n = 10 + Math.round(power * 8);
    const dust = DUST[kind] ?? 0xf3ead2;
    for (let i = 0; i < n; i++) {
      const p = this.puffs[this.nextPuff];
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = (1.3 + Math.random() * 0.9) * (0.8 + power * 0.6);
      Object.assign(p, {
        x: x + Math.cos(a) * 0.15, y: y + 0.05, z: z + Math.sin(a) * 0.15,
        vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 0.6, vz: Math.sin(a) * sp,
        size: 0.1 + Math.random() * 0.07 + power * 0.05, rot: Math.random() * 6, life: 0, dur: 0.45 + Math.random() * 0.3,
      });
      this.puffMesh.setColorAt(this.nextPuff, tmpC.set(dust).multiplyScalar(0.92 + Math.random() * 0.12));
      this.nextPuff = (this.nextPuff + 1) % MAX_PUFFS;
    }
    const cols = CHIPS[kind] ?? CHIPS[K.GRASS];
    const m = 5 + Math.round(power * 5);
    for (let i = 0; i < m; i++) {
      const c = this.chips[this.nextChip];
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.2;
      Object.assign(c, {
        x, y: y + 0.05, z, floor: y, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 1.6 + power, vz: Math.sin(a) * sp,
        spin: Math.random() * 6, life: 0, dur: 0.7 + Math.random() * 0.3,
      });
      this.chipMesh.setColorAt(this.nextChip, tmpC.set(cols[Math.floor(Math.random() * cols.length)]));
      this.nextChip = (this.nextChip + 1) % MAX_CHIPS;
    }
    this.puffMesh.instanceColor.needsUpdate = this.chipMesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    // dust puffs: burst outward along the ground, slow down, swell then shrink away
    this.puffs.forEach((p, i) => {
      if (p.life >= p.dur) return;
      p.life = Math.min(p.dur, p.life + dt);
      const drag = Math.exp(-dt * 6);
      p.vx *= drag; p.vz *= drag; p.vy *= Math.exp(-dt * 4);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.life / p.dur;
      const s = p.life >= p.dur ? 0 : p.size * (k < 0.25 ? 0.6 + k * 1.6 : 1 - (k - 0.25) / 0.75 * 0.95);
      tmpQ.setFromEuler(tmpE.set(0, p.rot, 0));
      this.puffMesh.setMatrixAt(i, tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ, tmpS.set(s, s, s)));
    });
    // chips: little bits of ground thrown up, falling back with gravity
    this.chips.forEach((c, i) => {
      if (c.life >= c.dur) return;
      c.life = Math.min(c.dur, c.life + dt);
      c.vy -= 14 * dt;
      c.x += c.vx * dt; c.z += c.vz * dt; c.y = Math.max(c.floor + 0.03, c.y + c.vy * dt);
      const s = c.life >= c.dur ? 0 : Math.min(1, (c.dur - c.life) * 6);
      tmpQ.setFromEuler(tmpE.set(c.life * c.spin, c.life * c.spin * 0.7, 0));
      this.chipMesh.setMatrixAt(i, tmpM.compose(tmpP.set(c.x, c.y, c.z), tmpQ, tmpS.set(s, s, s)));
    });
    this.puffMesh.instanceMatrix.needsUpdate = this.chipMesh.instanceMatrix.needsUpdate = true;
    // droplets: fly, fall with gravity (stretched along their fall), and leave a fleck of foam where they land
    if (this.dropsLive) {
      let any = false;
      this.drops.forEach((d, i) => {
        if (d.life >= d.dur) return;
        any = true;
        d.life += dt;
        d.vy -= GRAVITY * dt;
        const drag = Math.exp(-dt * 0.8);
        d.vx *= drag; d.vz *= drag;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        if (d.y < d.floor && d.vy < 0) {
          d.life = d.dur;
          if (Math.random() < 0.6) this.foamAt(d.x, d.z, d.vx * 0.15, d.vz * 0.15, d.size * 1.6, 0.5 + Math.random() * 0.4, 0.35, d.floor);
        }
        const s = d.life >= d.dur ? 0 : d.size, st = 1 + Math.min(1.4, Math.abs(d.vy) * 0.18); // a falling drop streaks
        this.dropMesh.setMatrixAt(i, tmpM.compose(tmpP.set(d.x, d.y, d.z), tmpQ.identity(), tmpS.set(s, s * st, s)));
      });
      this.dropMesh.instanceMatrix.needsUpdate = true;
      if (!any) this.dropsLive = 0;
    }
    // foam: flat flecks on the water (snapped to a 1/8 grid like the boat wake, so they stay crisp)
    if (this.foamLive) {
      let any = false;
      this.foam.forEach((f, i) => {
        if (f.life >= f.dur) return;
        any = true;
        f.life = Math.min(f.dur, f.life + dt);
        const drag = Math.exp(-dt * 3);
        f.vx *= drag; f.vz *= drag;
        f.x += f.vx * dt; f.z += f.vz * dt;
        const k = f.life / f.dur, done = f.life >= f.dur, s = done ? 0 : f.size * (1 + k * 0.8);
        const v = done ? 0 : f.bright * (k < 0.08 ? k / 0.08 : (1 - k) ** 1.4);
        tmpQ.setFromEuler(tmpE.set(0, f.rot, 0));
        this.foamMesh.setMatrixAt(i, tmpM.compose(tmpP.set(Math.round(f.x * 8) / 8, f.y + 0.06, Math.round(f.z * 8) / 8), tmpQ, tmpS.set(s, 1, s)));
        this.foamMesh.setColorAt(i, tmpC.setRGB(v * 0.92, v * 0.98, v));
      });
      this.foamMesh.instanceMatrix.needsUpdate = this.foamMesh.instanceColor.needsUpdate = true;
      if (!any) this.foamLive = 0;
    }
  }
}
