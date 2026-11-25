// Cozy atmosphere. Client-only decoration (not synced):
//  - campfire embers: tiny glowing sparks that rise, wobble and fade (HDR, so they bloom)
//  - campfire smoke: soft translucent puffs that swell and drift off with the wind
//  - pollen: warm specks floating in the daylight around the player (fireflies take over at night)

import * as THREE from 'three';
import { groundAt, SEA } from '../shared/world.js';
import { WIND } from './ambient.js';

export const EMBERS = 22, SMOKE = 12, POLLEN = 70;
const POLLEN_RANGE = 9; // pollen stays within this many units of the player (wraps around)
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

function pool(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) m.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
  return m;
}

export class Atmosphere {
  constructor(world, scene) {
    this.world = world;
    this.camp = world.camp;
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.emberMesh = pool(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.25, 0.35) }), EMBERS);
    // unlit (the fire's own light would blow the puffs out into a white bloom); tinted by daylight in update()
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });
    this.smokeMesh = pool(box, this.smokeMat, SMOKE);
    this.smokeMesh.renderOrder = 7; // after the water
    this.pollenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.4, 1.0), transparent: true, opacity: 0.9, depthWrite: false });
    this.pollenMesh = pool(box, this.pollenMat, POLLEN);
    this.pollenMesh.renderOrder = 7;
    // staggered starts, so the fire is already going on the first frame
    this.embers = Array.from({ length: EMBERS }, (_, i) => this.newEmber({}, (i / EMBERS) * 2));
    this.smoke = Array.from({ length: SMOKE }, (_, i) => this.newSmoke({}, (i / SMOKE) * 4.2));
    this.pollen = null; // placed around the player on the first update
    scene.add(this.emberMesh, this.smokeMesh, this.pollenMesh);
  }

  newEmber(e, age = 0) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.12;
    return Object.assign(e, {
      x: Math.cos(a) * r, z: Math.sin(a) * r, y: 0.25 + Math.random() * 0.15 + age * 0.6,
      vy: 0.55 + Math.random() * 0.7, ph: Math.random() * 6.28, wob: 0.05 + Math.random() * 0.09,
      size: 0.022 + Math.random() * 0.02, life: age, dur: 1.2 + Math.random() * 1.3,
    });
  }

  newSmoke(s, age = 0) {
    return Object.assign(s, {
      x: (Math.random() - 0.5) * 0.12 + WIND.x * 0.035 * age * age, z: (Math.random() - 0.5) * 0.12 + WIND.z * 0.035 * age * age, y: 0.75 + age * 0.5,
      vy: 0.42 + Math.random() * 0.2, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.8,
      size: 0.11 + Math.random() * 0.07, life: age, dur: 3.6 + Math.random() * 1.4,
    });
  }

  placePollen(p, focus, anywhere) {
    // new specks come in on the upwind side, except the very first batch
    const R = POLLEN_RANGE;
    p.x = focus.x + (Math.random() * 2 - 1) * R;
    p.z = focus.z + (Math.random() * 2 - 1) * R;
    if (!anywhere) { p.x -= WIND.x * R * 0.6; p.z -= WIND.z * R * 0.6; }
    p.base = Math.max(groundAt(this.world, p.x, p.z), SEA) + 0.35 + Math.random() * 1.7;
    p.ph = Math.random() * 6.28;
    p.sp = 0.16 + Math.random() * 0.22;
    p.size = 0.03 + Math.random() * 0.022;
    p.fade = anywhere ? 1 : 0;
    return p;
  }

  /** `night` 0..1 (time of day, or deep forest): pollen fades out as it gets dark. */
  update(t, dt, focus, night = 0) {
    const c = this.camp;
    this.smokeMat.color.setScalar(0.1 + 0.42 * Math.max(0, 1 - night)); // pale grey by day, a faint dark wisp at night
    // embers: rise fast, slow down, wobble sideways, and shrink away
    this.embers.forEach((e, i) => {
      e.life += dt;
      if (e.life >= e.dur) this.newEmber(e);
      const k = e.life / e.dur;
      e.y += e.vy * (1 - k * 0.6) * dt;
      e.x += WIND.x * 0.12 * k * dt; e.z += WIND.z * 0.12 * k * dt;
      const wx = Math.sin(t * 5.3 + e.ph) * e.wob * k, wz = Math.cos(t * 4.1 + e.ph * 1.7) * e.wob * k;
      const s = e.size * (k < 0.1 ? k * 10 : 1 - (k - 0.1) / 0.9) * (0.75 + 0.25 * Math.sin(t * 17 + e.ph)); // flicker
      this.emberMesh.setMatrixAt(i, tmpM.makeScale(s, s, s).setPosition(c.x + e.x + wx, c.y + e.y, c.z + e.z + wz));
    });
    // smoke: slow puffs that swell as they rise, lean with the wind, then thin out
    this.smoke.forEach((s, i) => {
      s.life += dt;
      if (s.life >= s.dur) this.newSmoke(s);
      const k = s.life / s.dur;
      s.y += s.vy * dt;
      s.x += WIND.x * 0.3 * k * dt; s.z += WIND.z * 0.3 * k * dt;
      const sz = s.size * (0.5 + k * 1.5) * Math.min(1, k * 6) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1);
      tmpQ.setFromEuler(tmpE.set(0, s.rot + s.spin * s.life, 0));
      this.smokeMesh.setMatrixAt(i, tmpM.compose(tmpP.set(c.x + s.x, c.y + s.y, c.z + s.z), tmpQ, tmpS.set(sz, sz, sz)));
    });
    this.emberMesh.instanceMatrix.needsUpdate = this.smokeMesh.instanceMatrix.needsUpdate = true;

    // pollen: only by day
    const day = Math.max(0, 1 - night * 1.6);
    this.pollenMesh.visible = day > 0.01;
    if (!this.pollenMesh.visible) return;
    this.pollenMat.opacity = 0.9 * day;
    this.pollen ??= Array.from({ length: POLLEN }, () => this.placePollen({}, focus, true));
    const R = POLLEN_RANGE;
    this.pollen.forEach((p, i) => {
      p.x += WIND.x * p.sp * dt; p.z += WIND.z * p.sp * dt;
      if (Math.abs(p.x - focus.x) > R * 1.3 || Math.abs(p.z - focus.z) > R * 1.3) this.placePollen(p, focus, false);
      p.fade = Math.min(1, p.fade + dt * 0.8);
      const y = p.base + Math.sin(t * 0.5 + p.ph) * 0.22;
      const x = p.x + Math.sin(t * 0.37 + p.ph * 2.1) * 0.25, z = p.z + Math.cos(t * 0.29 + p.ph) * 0.25;
      const s = p.size * p.fade * (0.55 + 0.45 * Math.sin(t * 1.3 + p.ph * 3)); // slow twinkle as it turns in the light
      this.pollenMesh.setMatrixAt(i, tmpM.makeScale(s, s, s).setPosition(x, y, z));
    });
    this.pollenMesh.instanceMatrix.needsUpdate = true;
  }
}
