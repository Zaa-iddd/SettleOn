// One-shot particle effects. Client-only decoration (not synced; each client spawns its own).
// Impact: a puff ring of dust plus a few ground chips, when a character lands from a big drop.

import * as THREE from 'three';
import { K } from '../shared/world.js';

const MAX_PUFFS = 96, MAX_CHIPS = 48;
// dust and chip colours per ground kind
// 'water' is a splash (fish leaping), not a ground kind
const DUST = { water: 0xd6f0ff, [K.SAND]: 0xf1e2b0, [K.ROCK]: 0xc9c4ba, [K.SNOW]: 0xffffff, [K.PATH]: 0xe2dacb, [K.TRAIL]: 0xdcc69c, [K.DIRT]: 0xcdb38c, [K.SOIL]: 0xc4a47c, [K.WOOD]: 0xd8b48a, [K.WOOD2]: 0xd8b48a, wood: 0xd8b48a, leaves: 0x8fcf4a };
const CHIPS = { water: [0x9fd8ff, 0xe8f7ff], [K.GRASS]: [0x6fb33a, 0x8fcf4a, 0x9a7a52], [K.FOREST]: [0x4f8f32, 0x6fb33a, 0x7a5c3c], [K.SAND]: [0xe0c98a, 0xcfb576], [K.ROCK]: [0x9a958c, 0x7c776f], [K.SNOW]: [0xffffff, 0xdfe8f2], [K.TRAIL]: [0xb08a5a, 0x9a7a52], [K.DIRT]: [0x8f6a44, 0x6fb33a], [K.SOIL]: [0x8f6a44, 0x6f4f32], [K.WOOD]: [0xa87444, 0x7a4f2c], [K.WOOD2]: [0xa87444, 0x7a4f2c], wood: [0xc89a64, 0x8a5a30, 0x6e4426], leaves: [0x5fae3e, 0x8fcf4a, 0x3f7f2c] };
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
  }

  /** Landing impact at a tile-centre point. `drop` = fall height (≥ 1), `kind` = ground kind. */
  impact(x, y, z, drop, kind) {
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
  }
}
