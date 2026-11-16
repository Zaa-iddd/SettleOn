// Ambient life: butterflies, dragonflies and drifting leaves.
// Purely client-side decoration (not synced between players). Butterflies and dragonflies
// live at homes picked from the world seed; leaves spawn around the player. In an endless world
// the flower/reed/tree lists are what's loaded (WorldScene.live), and butterflies and dragonflies
// move to new homes near the player when theirs fall behind.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { groundAt, rng, SEA, K, toCell } from '../shared/world.js';
import { LEAFY_LIFT } from './trees3d.js';

export const WIND = new THREE.Vector3(1, 0, 0.35).normalize(); // matches cloud drift

const BUTTERFLY_COLORS = [0xffd84a, 0xffffff, 0xff9ad5, 0x8fd3ff, 0xffa64a, 0xc59bff];
const LEAF_COLORS = [0x7fbf3f, 0x5fa83a, 0xd9c64a, 0xe89a3a, 0xb8d94f];
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();

function instancedMesh(geo, mat, count) {
  const m = new THREE.InstancedMesh(geo, mat, count);
  m.frustumCulled = false; // instances move around; skip bounds updates
  return m;
}

const BUTTERFLIES = 30; // was 80
const ROAM_R = 30; // endless worlds: new homes are picked within this distance of the player
const FROGS = 20;
const FROG_HOP = 0.45; // seconds per hop
const FROG_REACH = 2.8; // farthest pad a frog hops to
const FROG_SIZE = 1.5; // model scale (the model is about 0.2 long)
const FROG_RESPAWN = 15; // seconds after you catch a frog before a new one shows up on a nearby pond
const SWARMS = 14, FLIES_PER_SWARM = 7; // little fly swarms buzzing over waterside reeds and lily pads
const STRIDERS = 16; // water striders gliding on the surface
// Birds: small flocks crossing the sky near the player in loose V formations
// Fish: small schools swimming just under the surface near the player, sometimes leaping out
const SCHOOLS = 6, SCHOOL_SIZE = 3, FISH_SIZE = 2;
const FISH_COLORS = [0xf08a3c, 0xa9bccd, 0xf2c14e, 0x7d9a52]; // koi orange, silver, gold, olive
const FISH_RANGE = 24; // schools live within this distance of the player (re-homed when they fall behind)
// Swimming fish are drawn as soft, water-tinted, semi-transparent silhouettes lying just on the surface
// (after the water), so they read as "under the water" at any depth; deep water is nearly opaque and
// would hide real underwater fish. A leaping fish is drawn solid (separate meshes).
const FISH_TINT = 0x2f72b0, FISH_TINT_MIX = 0.35, FISH_OPACITY = 0.62;
const FLOCKS = 4, FLOCK_MAX = 7;
const BIRD_COLORS = [0xf3f0e8, 0x3a3944, 0x8a6a4a]; // gulls, swifts, sparrows
const BIRD_SIZE = 1.8; // model scale (the model is a small, readable silhouette at this size)
const BIRD_RANGE = 46; // a flock leaves and later re-enters once it's this far from the player
// height above the ground: low over open land so they cross the view up close (the camera looks down),
// above the treetops over woods, and above the canopy over redwood forest
const BIRD_ALT = 3.8, BIRD_ALT_WOODS = 6, BIRD_ALT_DEEP = 14;

// water strider: a thin dark body with four long splayed legs, flat on the water. Faces +z.
function striderGeometry() {
  const parts = [new THREE.BoxGeometry(0.025, 0.018, 0.09)];
  for (const [x, z, a] of [[0.06, 0.035, 0.5], [-0.06, 0.035, -0.5], [0.07, -0.04, -0.45], [-0.07, -0.04, 0.45]]) {
    parts.push(new THREE.BoxGeometry(0.11, 0.006, 0.008).rotateY(a).translate(x, -0.006, z));
  }
  return mergeGeometries(parts);
}

// A chunky little frog (about 0.2 long), built from vertex-coloured boxes. Faces +z.
function frogGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z, hex) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const c = new THREE.Color(hex), col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  const GREEN = 0x5fae3e, DARK = 0x3f7f2c, BELLY = 0xd9e7a0;
  box(0.15, 0.07, 0.15, 0, 0.05, 0, GREEN); // body
  box(0.12, 0.02, 0.12, 0, 0.015, 0.005, BELLY); // belly
  box(0.13, 0.06, 0.07, 0, 0.075, 0.085, GREEN); // head
  box(0.1, 0.012, 0.01, 0, 0.06, 0.12, DARK); // mouth line
  for (const sx of [-1, 1]) {
    box(0.045, 0.045, 0.045, sx * 0.045, 0.115, 0.095, 0xffffff); // eyes
    box(0.022, 0.03, 0.012, sx * 0.045, 0.118, 0.118, 0x1a1a22); // pupils
    box(0.05, 0.05, 0.11, sx * 0.085, 0.03, -0.035, DARK); // folded back legs
    box(0.03, 0.04, 0.03, sx * 0.055, 0.02, 0.07, DARK); // front legs
    box(0.04, 0.012, 0.03, sx * 0.04, 0.085, -0.02, DARK); // back spots
  }
  return mergeGeometries(parts);
}

export class Ambient {
  /** @param src lists of flowers, reeds and trees to live around (the island world, or WorldScene.live) */
  constructor(world, scene, src = world) {
    this.world = world;
    this.src = src;
    this.roam = !!world.endless;
    this.rehome = 0;
    const rand = rng(world.seed + 4242);

    // ---------- butterflies: around a subset of flowers ----------
    const flowers = src.flowers;
    this.butterflies = [];
    for (let i = 0; i < (this.roam || flowers.length ? BUTTERFLIES : 0); i++) {
      const f = flowers.length ? flowers[Math.floor(rand() * flowers.length)] : null;
      this.butterflies.push({ x: f?.x ?? 0, z: f?.z ?? 0, y: f?.y ?? 0, home: !!f, ph: rand() * 100, sp: 0.6 + rand() * 0.5, r: 0.8 + rand() * 1.4 });
    }
    const wingGeo = new THREE.PlaneGeometry(0.13, 0.11).translate(0.065, 0, 0).rotateX(-Math.PI / 2);
    const wingMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.bWingL = instancedMesh(wingGeo, wingMat, this.butterflies.length);
    this.bWingR = instancedMesh(wingGeo, wingMat, this.butterflies.length);
    const c = new THREE.Color();
    this.butterflies.forEach((b, i) => {
      c.setHex(BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]);
      this.bWingL.setColorAt(i, c);
      this.bWingR.setColorAt(i, c);
    });
    scene.add(this.bWingL, this.bWingR);

    // ---------- dragonflies: over water near reeds ----------
    const reeds = src.reeds;
    this.dragonflies = [];
    for (let i = 0; i < (this.roam || reeds.length ? 16 : 0); i++) {
      const r = reeds.length ? reeds[Math.floor(rand() * reeds.length)] : null;
      this.dragonflies.push({ x: r?.x ?? 0, z: r?.z ?? 0, y: r?.y ?? 0, home: !!r, ph: rand() * 100 });
    }
    const dfBody = new THREE.BoxGeometry(0.03, 0.03, 0.22);
    this.dfBodies = instancedMesh(dfBody, new THREE.MeshLambertMaterial({ color: 0x2f7fd8, emissive: 0x0a2a55 }), this.dragonflies.length);
    const dfWingGeo = new THREE.PlaneGeometry(0.2, 0.05).rotateX(-Math.PI / 2);
    this.dfWings = instancedMesh(dfWingGeo, new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }), this.dragonflies.length * 2);
    scene.add(this.dfBodies, this.dfWings);

    // ---------- leaves drifting down from trees near the player ----------
    this.leaves = Array.from({ length: 60 }, () => ({ state: 'idle', t: Math.random() * 6 }));
    this.leafMesh = instancedMesh(new THREE.PlaneGeometry(0.09, 0.06), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), this.leaves.length);
    this.leaves.forEach((l, i) => this.leafMesh.setColorAt(i, c.setHex(LEAF_COLORS[i % LEAF_COLORS.length])));
    scene.add(this.leafMesh);

    // ---------- frogs: sitting on lily pads, hopping between nearby pads ----------
    const lilies = src.lilies ?? [];
    this.frogs = [];
    for (let i = 0; i < (this.roam || lilies.length ? FROGS : 0); i++) {
      const l = lilies.length ? lilies[Math.floor(rand() * lilies.length)] : null;
      this.frogs.push({ x: l?.x ?? 0, z: l?.z ?? 0, home: !!l, mode: 'pad', ry: rand() * 6.28, wait: 1 + rand() * 5, hop: null, ph: rand() * 10, land: 0 });
    }
    this.frogMesh = instancedMesh(frogGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), Math.max(1, this.frogs.length));
    this.frogMesh.count = this.frogs.length;
    this.frogs.forEach((f, i) => this.frogMesh.setColorAt(i, c.setRGB(1, 1, 1).multiplyScalar(0.85 + rand() * 0.25)));
    this.frogMesh.castShadow = true;
    scene.add(this.frogMesh);

    // ---------- insects: fly swarms over reeds/lily pads, water striders on the surface ----------
    const wet = () => [...(src.reeds ?? []), ...(src.lilies ?? [])];
    const spots = wet();
    const pick = () => (spots.length ? spots[Math.floor(rand() * spots.length)] : null);
    this.swarms = [];
    for (let i = 0; i < (this.roam || spots.length ? SWARMS : 0); i++) {
      const h = pick();
      this.swarms.push({ x: h?.x ?? 0, y: Math.max(h?.y ?? 0, SEA), z: h?.z ?? 0, home: !!h, ph: rand() * 100 });
    }
    this.flyMesh = instancedMesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x1c1a16 }), Math.max(1, this.swarms.length * FLIES_PER_SWARM));
    this.flyMesh.count = this.swarms.length * FLIES_PER_SWARM;
    scene.add(this.flyMesh);
    const ponds = src.lilies ?? [];
    this.striders = [];
    for (let i = 0; i < (this.roam || ponds.length ? STRIDERS : 0); i++) {
      const h = ponds.length ? ponds[Math.floor(rand() * ponds.length)] : null;
      this.striders.push({ hx: h?.x ?? 0, hz: h?.z ?? 0, home: !!h, ph: rand() * 100 });
    }
    this.striderMesh = instancedMesh(striderGeometry(), new THREE.MeshLambertMaterial({ color: 0x2b2620 }), Math.max(1, this.striders.length));
    this.striderMesh.count = this.striders.length;
    scene.add(this.striderMesh);

    // ---------- birds: flocks that fly across, flapping and gliding, casting small shadows ----------
    this.flocks = Array.from({ length: FLOCKS }, (_, i) => ({
      n: 3 + Math.floor(rand() * (FLOCK_MAX - 2)), color: BIRD_COLORS[i % BIRD_COLORS.length],
      active: false, wait: 1 + i * 2.5 + rand() * 3, x: 0, z: 0, y: 0, hx: 1, hz: 0, speed: 4, ph: rand() * 100,
    }));
    const n = FLOCKS * FLOCK_MAX;
    const body = mergeGeometries([
      new THREE.BoxGeometry(0.07, 0.06, 0.2),
      new THREE.BoxGeometry(0.06, 0.06, 0.06).translate(0, 0.02, 0.12), // head
      new THREE.BoxGeometry(0.08, 0.015, 0.07).translate(0, 0, -0.12), // tail
    ]);
    const wing = new THREE.BoxGeometry(0.26, 0.012, 0.09).translate(0.13, 0, 0); // hinged at the body
    const birdMat = new THREE.MeshLambertMaterial();
    this.birdBody = instancedMesh(body, birdMat, n);
    this.birdWingL = instancedMesh(wing, birdMat, n);
    this.birdWingR = instancedMesh(wing, birdMat, n);
    for (const m of [this.birdBody, this.birdWingL, this.birdWingR]) {
      m.castShadow = true;
      this.flocks.forEach((f, fi) => { for (let k = 0; k < FLOCK_MAX; k++) m.setColorAt(fi * FLOCK_MAX + k, c.setHex(f.color).multiplyScalar(0.92 + ((k * 37) % 10) / 60)); });
      scene.add(m);
    }

    // ---------- fish: schools under the surface; a body plus a wagging tail ----------
    this.fish = [];
    for (let s = 0; s < SCHOOLS; s++) {
      for (let k = 0; k < SCHOOL_SIZE; k++) {
        this.fish.push({ school: s, home: false, x: 0, z: 0, hx: 1, hz: 0, speed: 0.8, ph: rand() * 100, dart: 0, jump: null, color: FISH_COLORS[s % FISH_COLORS.length] });
      }
    }
    const fishBody = mergeGeometries([
      new THREE.BoxGeometry(0.07, 0.06, 0.17),
      new THREE.BoxGeometry(0.05, 0.045, 0.05).translate(0, -0.003, 0.1), // snout
      new THREE.BoxGeometry(0.012, 0.04, 0.06).translate(0, 0.045, -0.01), // back fin
    ]);
    const fishTail = new THREE.BoxGeometry(0.014, 0.075, 0.07).translate(0, 0, -0.035); // hinged at the body
    const swimMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: FISH_OPACITY, depthWrite: false });
    const jumpMat = new THREE.MeshLambertMaterial();
    this.fishBody = instancedMesh(fishBody, swimMat, this.fish.length);
    this.fishTail = instancedMesh(fishTail, swimMat, this.fish.length);
    this.jumpBody = instancedMesh(fishBody, jumpMat, this.fish.length);
    this.jumpTail = instancedMesh(fishTail, jumpMat, this.fish.length);
    this.fishBody.renderOrder = this.fishTail.renderOrder = 6; // after the water
    const tint = new THREE.Color(FISH_TINT);
    this.fish.forEach((f, i) => {
      c.setHex(f.color).multiplyScalar(0.9 + (i % 3) * 0.07);
      this.jumpBody.setColorAt(i, c);
      this.jumpTail.setColorAt(i, c.clone().multiplyScalar(0.85));
      c.lerp(tint, FISH_TINT_MIX);
      this.fishBody.setColorAt(i, c);
      this.fishTail.setColorAt(i, c.multiplyScalar(0.85));
    });
    this.jumpBody.castShadow = this.jumpTail.castShadow = true;
    scene.add(this.fishBody, this.fishTail, this.jumpBody, this.jumpTail);
  }

  // is (x, z) water deep enough to swim in?
  fishWater(x, z) { return groundAt(this.world, x, z) < SEA - 0.3; }

  // move a whole school to a random patch of water near the player (or hide it if there's none)
  homeSchool(s, focus) {
    let spot = null;
    for (let tries = 0; tries < 40 && !spot; tries++) {
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * (FISH_RANGE - 6);
      const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
      if (this.fishWater(x, z)) spot = { x, z };
    }
    const a = Math.random() * Math.PI * 2;
    for (const f of this.fish) {
      if (f.school !== s) continue;
      f.home = !!spot;
      f.jump = null;
      if (!spot) continue;
      f.x = spot.x + (Math.random() - 0.5) * 0.8; f.z = spot.z + (Math.random() - 0.5) * 0.8;
      f.hx = Math.sin(a); f.hz = Math.cos(a); f.speed = 0.6 + Math.random() * 0.5;
    }
  }

  updateFish(t, dt, focus) {
    const zero = tmpS.set(0, 0, 0);
    // re-home one school at a time when it has fallen behind (or never found water)
    const s = Math.floor(t * 2) % SCHOOLS, lead = this.fish.find((f) => f.school === s);
    if (!lead.home || Math.hypot(lead.x - focus.x, lead.z - focus.z) > FISH_RANGE + 8) this.homeSchool(s, focus);
    const surface = SEA + Math.sin(t * 0.8) * 0.03;
    this.fish.forEach((f, i) => {
      tmpM.compose(tmpP.set(0, -100, 0), tmpQ.identity(), zero);
      for (const m of [this.fishBody, this.fishTail, this.jumpBody, this.jumpTail]) m.setMatrixAt(i, tmpM);
      if (!f.home) return;
      let y = surface + 0.006, pitch = 0;
      if (f.jump) { // a leap: an arc out of the water, nose up then down, splashing in and out
        const j = f.jump;
        j.t = Math.min(1, j.t + dt / j.dur);
        f.x = j.fx + f.hx * j.len * j.t; f.z = j.fz + f.hz * j.len * j.t;
        y = surface - 0.05 + j.h * 4 * j.t * (1 - j.t);
        pitch = (0.5 - j.t) * 1.6;
        if (j.t >= 1) { f.jump = null; this.effects?.impact(f.x, surface, f.z, 1.1, 'water'); }
      } else {
        // wander: a slow weave, the odd quick dart, follow the school, and turn back before the shore
        const mate = this.fish.find((q) => q.school === f.school && q !== f && q.home);
        let turn = Math.sin(t * 0.7 + f.ph) * 0.9 * dt;
        if (mate && Math.hypot(mate.x - f.x, mate.z - f.z) > 0.9) { // drift back toward the school
          const want = Math.atan2(mate.x - f.x, mate.z - f.z), now = Math.atan2(f.hx, f.hz);
          turn += Math.atan2(Math.sin(want - now), Math.cos(want - now)) * 1.5 * dt;
        }
        if (!this.fishWater(f.x + f.hx * 0.9, f.z + f.hz * 0.9)) turn += 3.5 * dt * (Math.sin(f.ph) > 0 ? 1 : -1); // shore ahead
        const cs = Math.cos(-turn), sn = Math.sin(-turn);
        [f.hx, f.hz] = [f.hx * cs - f.hz * sn, f.hx * sn + f.hz * cs];
        if (f.dart <= 0 && Math.random() < dt * 0.15) f.dart = 0.5;
        f.dart = Math.max(0, f.dart - dt);
        const sp = f.speed * (f.dart > 0 ? 3 : 1);
        const nx = f.x + f.hx * sp * dt, nz = f.z + f.hz * sp * dt;
        if (this.fishWater(nx, nz)) { f.x = nx; f.z = nz; }
        // now and then a leap, if there's water to land in
        if (Math.random() < dt * 0.04 && this.fishWater(f.x + f.hx * 1.4, f.z + f.hz * 1.4)) {
          f.jump = { fx: f.x, fz: f.z, t: 0, dur: 0.75, len: 1.4, h: 0.55 + Math.random() * 0.25 };
          this.effects?.impact(f.x, surface, f.z, 1.1, 'water');
        }
      }
      const yaw = Math.atan2(f.hx, f.hz), air = !!f.jump;
      const body = air ? this.jumpBody : this.fishBody, tail = air ? this.jumpTail : this.fishTail;
      const sy = air ? FISH_SIZE : FISH_SIZE * 0.3; // swimming: a flat silhouette on the surface
      tmpQ.setFromEuler(tmpE.set(-pitch, yaw + Math.sin(t * 9 + f.ph) * 0.12, 0, 'YXZ'));
      tmpM.compose(tmpP.set(f.x, y, f.z), tmpQ, tmpS.set(FISH_SIZE, sy, FISH_SIZE));
      body.setMatrixAt(i, tmpM);
      // tail: hinged just behind the body, wagging (faster when darting)
      const wag = Math.sin(t * (f.dart > 0 ? 26 : 12) + f.ph) * 0.6;
      const back = 0.085 * FISH_SIZE;
      tmpQ.setFromEuler(tmpE.set(-pitch, yaw + wag, 0, 'YXZ'));
      tmpM.compose(tmpP.set(f.x - f.hx * back, y + Math.sin(pitch) * back, f.z - f.hz * back), tmpQ, tmpS.set(FISH_SIZE, sy, FISH_SIZE));
      tail.setMatrixAt(i, tmpM);
    });
    for (const m of [this.fishBody, this.fishTail, this.jumpBody, this.jumpTail]) m.instanceMatrix.needsUpdate = true;
  }

  // a flock enters from the edge of the range and heads across, passing near the player
  spawnFlock(f, focus) {
    const a = Math.random() * Math.PI * 2, side = (Math.random() - 0.5) * 24;
    f.hx = Math.cos(a); f.hz = Math.sin(a);
    f.x = focus.x - f.hx * BIRD_RANGE * 0.9 - f.hz * side;
    f.z = focus.z - f.hz * BIRD_RANGE * 0.9 + f.hx * side;
    f.speed = 3.6 + Math.random() * 2;
    f.y = this.birdAltitude(f.x, f.z);
    f.active = true;
  }

  birdAltitude(x, z) {
    const k = this.world.kind(toCell(x), toCell(z));
    return Math.max(groundAt(this.world, x, z), SEA) + (k === K.DEEP ? BIRD_ALT_DEEP : k === K.FOREST ? BIRD_ALT_WOODS : BIRD_ALT);
  }

  updateBirds(t, dt, focus) {
    const zero = tmpS.set(0, 0, 0);
    this.flocks.forEach((f, fi) => {
      if (!f.active) {
        f.wait -= dt;
        if (f.wait <= 0) this.spawnFlock(f, focus);
      } else {
        // drift along a gently wandering heading, rising over hills and forests (smoothly)
        const turn = Math.sin(t * 0.3 + f.ph) * 0.12 * dt;
        [f.hx, f.hz] = [f.hx * Math.cos(turn) - f.hz * Math.sin(turn), f.hx * Math.sin(turn) + f.hz * Math.cos(turn)];
        f.x += f.hx * f.speed * dt;
        f.z += f.hz * f.speed * dt;
        // look ahead so they climb before reaching a rise, then sink slowly
        const want = Math.max(this.birdAltitude(f.x, f.z), this.birdAltitude(f.x + f.hx * 4, f.z + f.hz * 4), this.birdAltitude(f.x + f.hx * 8, f.z + f.hz * 8));
        f.y += (want - f.y) * (1 - Math.exp(-dt * (want > f.y ? 3 : 0.5)));
        // gone past the player and out of range: rest a while, then another flock comes by
        const dx = f.x - focus.x, dz = f.z - focus.z;
        if (Math.hypot(dx, dz) > BIRD_RANGE && dx * f.hx + dz * f.hz > 0) { f.active = false; f.wait = 6 + Math.random() * 14; }
      }
      const yaw = Math.atan2(f.hx, f.hz);
      for (let k = 0; k < FLOCK_MAX; k++) {
        const i = fi * FLOCK_MAX + k;
        if (!f.active || k >= f.n) {
          tmpM.compose(tmpP.set(0, -100, 0), tmpQ.identity(), zero);
          this.birdBody.setMatrixAt(i, tmpM); this.birdWingL.setMatrixAt(i, tmpM); this.birdWingR.setMatrixAt(i, tmpM);
          continue;
        }
        // loose V: the leader first, then pairs further back on each side
        const row = Math.ceil(k / 2), sideK = k === 0 ? 0 : k % 2 ? 1 : -1, q = f.ph + k * 1.9;
        const back = row * 1.2 + Math.sin(t * 0.7 + q) * 0.12, out = sideK * row * 1.05 + Math.sin(t * 0.5 + q * 2) * 0.1;
        const x = f.x - f.hx * back + f.hz * out, z = f.z - f.hz * back - f.hx * out;
        const y = f.y + Math.sin(t * 1.3 + q) * 0.12 - row * 0.05;
        // flap, with glides now and then
        const gliding = Math.sin(t * 0.45 + q) < -0.35;
        const flap = gliding ? 0.12 : Math.sin(t * (13 + (k % 3)) + q) * 0.85;
        tmpQ.setFromEuler(tmpE.set(gliding ? 0 : -flap * 0.08, yaw, 0, 'YXZ'));
        tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(BIRD_SIZE, BIRD_SIZE, BIRD_SIZE));
        this.birdBody.setMatrixAt(i, tmpM);
        for (const [mesh, sign] of [[this.birdWingL, -1], [this.birdWingR, 1]]) {
          const wingQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sign < 0 ? Math.PI : 0, flap * -sign));
          tmpQ.setFromEuler(tmpE.set(0, yaw, 0, 'YXZ')).multiply(wingQ);
          tmpM.compose(tmpP.set(x, y + 0.01, z), tmpQ, tmpS.set(BIRD_SIZE, BIRD_SIZE, BIRD_SIZE));
          mesh.setMatrixAt(i, tmpM);
        }
      }
    });
    this.birdBody.instanceMatrix.needsUpdate = this.birdWingL.instanceMatrix.needsUpdate = this.birdWingR.instanceMatrix.needsUpdate = true;
  }

  // a random item of `list` within `reach` of (x, z)
  nearItem(list, x, z, reach) {
    for (let tries = 0; tries < 16 && list.length; tries++) {
      const p = list[Math.floor(Math.random() * list.length)];
      if (Math.hypot(p.x - x, p.z - z) < reach) return p;
    }
    return null;
  }

  updateInsects(t, focus) {
    const roamNow = (i, n) => this.roam && (i + Math.floor(t * 4)) % n === 0;
    // fly swarms: each fly buzzes on its own quick, jittery loop around the swarm's centre
    this.swarms.forEach((sw, i) => {
      if (roamNow(i, SWARMS) && (!sw.home || Math.hypot(sw.x - focus.x, sw.z - focus.z) > ROAM_R + 6)) {
        const list = Math.random() < 0.5 ? this.src.reeds : this.src.lilies ?? [];
        const h = this.nearItem(list, focus.x, focus.z, 16) ?? this.nearItem(this.src.reeds, focus.x, focus.z, ROAM_R);
        sw.home = !!h;
        if (h) { sw.x = h.x; sw.y = Math.max(h.y, SEA); sw.z = h.z; }
      }
      for (let k = 0; k < FLIES_PER_SWARM; k++) {
        const q = sw.ph + k * 2.39, tt = t * (2.2 + (k % 3) * 0.5);
        const x = sw.x + Math.sin(tt * 1.3 + q) * 0.28 + Math.sin(t * 17 + q * 3) * 0.035;
        const z = sw.z + Math.cos(tt * 1.1 + q * 1.7) * 0.28 + Math.cos(t * 19 + q) * 0.035;
        const y = sw.y + 0.55 + Math.sin(tt * 1.7 + q * 2.3) * 0.16 + Math.sin(t * 23 + q) * 0.03;
        const sc = sw.home ? 1 : 0;
        tmpM.compose(tmpP.set(x, y, z), tmpQ.identity(), tmpS.set(sc, sc, sc));
        this.flyMesh.setMatrixAt(i * FLIES_PER_SWARM + k, tmpM);
      }
    });
    this.flyMesh.instanceMatrix.needsUpdate = true;
    // water striders: rest, then glide in a quick straight dash to a new point near their pad
    const bob = SEA + Math.sin(t * 0.8) * 0.03 + 0.012;
    this.striders.forEach((st, i) => {
      if (roamNow(i, STRIDERS) && (!st.home || Math.hypot(st.hx - focus.x, st.hz - focus.z) > ROAM_R + 6)) {
        const h = this.nearItem(this.src.lilies ?? [], focus.x, focus.z, 16) ?? this.nearItem(this.src.lilies ?? [], focus.x, focus.z, ROAM_R);
        st.home = !!h;
        if (h) { st.hx = h.x; st.hz = h.z; }
      }
      const cyc = (t + st.ph) / 1.9, seg = Math.floor(cyc), f = cyc - seg;
      const pt = (n) => [st.hx + Math.sin(n * 12.9 + i) * 0.55, st.hz + Math.cos(n * 7.7 + i * 3) * 0.55];
      const [ax, az] = pt(seg), [bx, bz] = pt(seg + 1);
      const m = f < 0.75 ? 0 : (f - 0.75) / 0.25, e = 1 - (1 - m) * (1 - m); // rest, then dash and slow down
      const sc = st.home ? 1.3 : 0;
      tmpQ.setFromEuler(tmpE.set(0, Math.atan2(bx - ax, bz - az), 0));
      tmpM.compose(tmpP.set(ax + (bx - ax) * e, bob, az + (bz - az) * e), tmpQ, tmpS.set(sc, sc, sc));
      this.striderMesh.setMatrixAt(i, tmpM);
    });
    this.striderMesh.instanceMatrix.needsUpdate = true;
  }

  // a random lily pad within `reach` of (x, z), other than the one at (x, z)
  nearPad(x, z, reach) {
    const list = this.src.lilies ?? [];
    for (let tries = 0; tries < 24 && list.length; tries++) {
      const p = list[Math.floor(Math.random() * list.length)];
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > 0.05 && d < reach) return p;
    }
    return null;
  }

  // ---------- frogs you can catch and throw ----------
  // Modes: 'pad' (sits on a lily pad, hops between pads), 'ground' (on land: hops toward the nearest
  // pond), 'swim' (in open water: paddles toward a pad), 'flying' (thrown), 'gone' (caught: a new
  // frog shows up on a pond near the player after FROG_RESPAWN seconds).

  /** Frogs that can be caught right now: [{ i, x, y, z }]. */
  catchableFrogs() {
    return this.frogs.map((f, i) => ({ i, f })).filter(({ f }) => f.home && (f.mode === 'pad' || f.mode === 'ground' || f.mode === 'swim') && !f.hop)
      .map(({ i, f }) => ({ i, x: f.x, y: f.y ?? SEA, z: f.z }));
  }

  /** Catch frog i (it leaves the world for a while). */
  takeFrog(i) {
    const f = this.frogs[i];
    f.mode = 'gone'; f.home = false; f.hop = null; f.wait = FROG_RESPAWN;
  }

  /** Throw a frog from `from` ({x, y, z}) to `to` ({x, z}): it flies in a spinning arc, then lands. */
  throwFrog(from, to, focus) {
    // use a frog that's away (caught) if there is one, otherwise the one farthest from the player
    let f = this.frogs.find((q) => q.mode === 'gone');
    if (!f) f = this.frogs.reduce((a, b) => (Math.hypot(b.x - focus.x, b.z - focus.z) > Math.hypot(a.x - focus.x, a.z - focus.z) ? b : a));
    const ty = Math.max(groundAt(this.world, to.x, to.z), SEA);
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    Object.assign(f, {
      mode: 'flying', home: true, hop: null, x: from.x, z: from.z, y: from.y,
      fly: { fx: from.x, fy: from.y, fz: from.z, tx: to.x, ty, tz: to.z, t: 0, dur: 0.35 + dist * 0.06, arc: 0.8 + dist * 0.18 },
      ry: Math.atan2(to.x - from.x, to.z - from.z),
    });
  }

  // where a frog should stand at (x, z): on a pad, the water surface, or the ground
  frogY(x, z, mode, t) {
    if (mode === 'pad' || mode === 'swim') return SEA + Math.sin(t * 0.8) * 0.03 + (mode === 'pad' ? 0.03 : -0.02);
    return groundAt(this.world, x, z);
  }

  // after landing or a ground/swim hop: decide what the frog is doing now
  settleFrog(f) {
    const water = groundAt(this.world, f.x, f.z) < SEA - 0.05;
    const pad = (this.src.lilies ?? []).find((p) => Math.hypot(p.x - f.x, p.z - f.z) < 0.25);
    f.mode = pad ? 'pad' : water ? 'swim' : 'ground';
    if (pad) { f.x = pad.x; f.z = pad.z; }
  }

  // nearest lily pad within `reach` (exact, used to find the way home)
  nearestPad(x, z, reach) {
    let best = null, bd = reach;
    for (const p of this.src.lilies ?? []) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  updateFrogs(t, dt, focus) {
    this.frogs.forEach((f, i) => {
      f.mode ??= 'pad';
      let show = f.home ? FROG_SIZE : 0;
      if (f.mode === 'gone') { // caught: comes back later as a new frog on a pond near the player
        show = 0;
        f.wait -= dt;
        if (f.wait <= 0) {
          f.mode = 'pad';
          const p = this.nearPad(focus.x, focus.z, ROAM_R) ?? (this.src.lilies?.length ? this.src.lilies[Math.floor(Math.random() * this.src.lilies.length)] : null);
          f.home = !!p;
          if (p) { f.x = p.x; f.z = p.z; }
        }
      }
      // endless worlds: a pad frog whose pad fell behind moves to a pad near the player (or hides)
      if (this.roam && f.mode === 'pad' && !f.hop && (!f.home || Math.hypot(f.x - focus.x, f.z - focus.z) > ROAM_R + 6) && (i + Math.floor(t * 4)) % FROGS === 0) {
        const p = this.nearPad(focus.x, focus.z, 14) ?? this.nearPad(focus.x, focus.z, ROAM_R); // prefer ponds close by
        f.home = !!p;
        if (p) { f.x = p.x; f.z = p.z; }
      }
      let y = this.frogY(f.x, f.z, f.mode, t), sy = 1 + 0.06 * Math.sin(t * 3 + f.ph), sxz = 1, spin = 0;
      if (f.mode === 'flying') {
        const fl = f.fly;
        fl.t = Math.min(1, fl.t + dt / fl.dur);
        f.x = fl.fx + (fl.tx - fl.fx) * fl.t;
        f.z = fl.fz + (fl.tz - fl.fz) * fl.t;
        y = fl.fy + (fl.ty - fl.fy) * fl.t + fl.arc * 4 * fl.t * (1 - fl.t);
        spin = fl.t * Math.PI * 4; // somersaults
        sy = 1.2; sxz = 0.9;
        if (fl.t >= 1) { f.fly = null; f.land = 0.25; this.settleFrog(f); f.wait = 0.6 + Math.random(); }
      } else if (f.hop) {
        const h = f.hop;
        h.t = Math.min(1, h.t + dt / FROG_HOP);
        f.x = h.fx + (h.tx - h.fx) * h.t;
        f.z = h.fz + (h.tz - h.fz) * h.t;
        y = h.fy + (h.ty - h.fy) * h.t + h.arc * 4 * h.t * (1 - h.t);
        sy = 1.25; sxz = 0.85; // stretched in the air
        if (h.t >= 1) { f.hop = null; f.land = 0.18; if (f.mode !== 'pad') this.settleFrog(f); }
      } else if (f.home && f.mode !== 'gone') {
        f.wait -= dt;
        if (f.wait <= 0) {
          let tx = f.x, tz = f.z, arc = 0.12;
          if (f.mode === 'pad') {
            f.wait = 2 + Math.random() * 5;
            const p = this.nearPad(f.x, f.z, FROG_REACH);
            if (p) { tx = p.x; tz = p.z; arc = 0.3; } else f.ry += (Math.random() - 0.5) * 2; // nowhere to go: a little hop in place
          } else {
            // on land or in open water: head for the nearest pad in short hops (wander if there's none)
            f.wait = f.mode === 'swim' ? 0.5 + Math.random() * 0.6 : 0.9 + Math.random() * 1.6;
            const p = this.nearestPad(f.x, f.z, 18);
            let a = p ? Math.atan2(p.x - f.x, p.z - f.z) + (Math.random() - 0.5) * 0.8 : f.ry + (Math.random() - 0.5) * 2.4;
            const d = p ? Math.min(1.3, Math.hypot(p.x - f.x, p.z - f.z)) : 0.8 + Math.random() * 0.6;
            tx = f.x + Math.sin(a) * d; tz = f.z + Math.cos(a) * d;
            // on land, don't hop up cliffs
            if (f.mode === 'ground' && groundAt(this.world, tx, tz) - groundAt(this.world, f.x, f.z) > 1.01) { a += Math.PI * (0.5 + Math.random()); tx = f.x + Math.sin(a) * 0.8; tz = f.z + Math.cos(a) * 0.8; }
            if (p && Math.hypot(p.x - tx, p.z - tz) < 0.4) { tx = p.x; tz = p.z; } // last hop: onto the pad
            arc = f.mode === 'swim' ? 0.1 : 0.32;
          }
          if (tx !== f.x || tz !== f.z) f.ry = Math.atan2(tx - f.x, tz - f.z);
          const landMode = f.mode === 'pad' && (tx !== f.x || tz !== f.z) ? 'pad' : f.mode;
          f.hop = { fx: f.x, fz: f.z, fy: y, tx, tz, ty: this.frogY(tx, tz, groundAt(this.world, tx, tz) < SEA - 0.05 && landMode !== 'pad' ? 'swim' : landMode, t), t: 0, arc };
        }
      }
      f.y = y;
      if (f.land > 0) { f.land -= dt; sy = 0.75; sxz = 1.15; } // squash on landing
      tmpQ.setFromEuler(tmpE.set(spin, f.ry, 0, 'YXZ'));
      tmpM.compose(tmpP.set(f.x, y + (f.mode === 'ground' ? 0.01 : 0), f.z), tmpQ, tmpS.set(sxz * show, sy * show, sxz * show));
      this.frogMesh.setMatrixAt(i, tmpM);
    });
    this.frogMesh.instanceMatrix.needsUpdate = true;
  }

  spawnLeaf(l, focus) {
    // pick a tree near the player and drop a leaf from its canopy
    const trees = this.src.trees;
    for (let tries = 0; tries < 12; tries++) {
      const t = trees[Math.floor(Math.random() * trees.length)];
      if (!t || Math.hypot(t.x - focus.x, t.z - focus.z) > 16) continue;
      Object.assign(l, {
        state: 'fall', x: t.x + (Math.random() - 0.5) * 0.7 * t.s, z: t.z + (Math.random() - 0.5) * 0.7 * t.s,
        y: t.y + (0.8 + Math.random() * 0.6 + (t.pine ? 0 : LEAFY_LIFT)) * t.s, vy: -(0.25 + Math.random() * 0.25),
        spin: Math.random() * 10, spinRate: 2 + Math.random() * 4, sway: Math.random() * 10, t: 0, rest: 0,
      });
      return;
    }
    // no trees nearby: occasionally a leaf just blows in from upwind
    if (Math.random() < 0.25) {
      Object.assign(l, {
        state: 'fall', x: focus.x - WIND.x * 9 + (Math.random() - 0.5) * 16, z: focus.z - WIND.z * 9 + (Math.random() - 0.5) * 16,
        vy: -0.2, spin: 0, spinRate: 3 + Math.random() * 3, sway: Math.random() * 10, t: 0, rest: 0,
      });
      l.y = groundAt(this.world, l.x, l.z) + 1.5 + Math.random() * 1.5;
    } else {
      l.t = -Math.random() * 3; // wait a bit before trying again
    }
  }

  // endless worlds: a few butterflies/dragonflies per frame whose home fell behind move near the player
  roamHomes(focus) {
    const near = (list) => {
      for (let tries = 0; tries < 10 && list.length; tries++) {
        const p = list[Math.floor(Math.random() * list.length)];
        if (Math.hypot(p.x - focus.x, p.z - focus.z) < ROAM_R) return p;
      }
      return null;
    };
    const fix = (a, list) => {
      if (a.home && Math.hypot(a.x - focus.x, a.z - focus.z) < ROAM_R + 6) return;
      const p = near(list);
      a.home = !!p;
      if (p) { a.x = p.x; a.y = p.y; a.z = p.z; }
    };
    for (let k = 0; k < 4; k++) {
      const nb = this.butterflies.length, total = nb + this.dragonflies.length;
      if (!total) break;
      this.rehome = (this.rehome + 1) % total;
      if (this.rehome < nb) fix(this.butterflies[this.rehome], this.src.flowers);
      else fix(this.dragonflies[this.rehome - nb], this.src.reeds);
    }
  }

  update(t, dt, focus) {
    if (this.roam) this.roamHomes(focus);
    // butterflies: lazy loops around their flower, flapping
    this.butterflies.forEach((b, i) => {
      const tt = t * b.sp + b.ph;
      const x = b.x + Math.sin(tt * 0.9) * b.r, z = b.z + Math.cos(tt * 0.7) * b.r * 0.8;
      const y = groundAt(this.world, x, z) + 0.45 + Math.sin(tt * 2.3) * 0.18 + Math.sin(tt * 5.1) * 0.05;
      const heading = Math.atan2(Math.cos(tt * 0.9) * 0.9 * b.r, -Math.sin(tt * 0.7) * 0.7 * b.r * 0.8);
      const flap = Math.sin(t * 22 + i) * 1.1;
      const show = b.home ? 1 : 0; // no flower nearby: hidden
      for (const [mesh, sign] of [[this.bWingL, -1], [this.bWingR, 1]]) {
        tmpE.set(0, heading, 0, 'YXZ');
        tmpQ.setFromEuler(tmpE);
        const wing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sign < 0 ? Math.PI : 0, flap * -sign));
        tmpQ.multiply(wing);
        tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(show, show, show));
        mesh.setMatrixAt(i, tmpM);
      }
    });
    this.bWingL.instanceMatrix.needsUpdate = this.bWingR.instanceMatrix.needsUpdate = true;

    // dragonflies: dart between hover points
    this.dragonflies.forEach((d, i) => {
      const seg = Math.floor((t + d.ph) / 1.6), f = ((t + d.ph) / 1.6) % 1;
      const pt = (k) => [Math.sin(k * 12.9 + i) * 1.8, Math.cos(k * 7.7 + i * 3) * 1.8];
      const [ax, az] = pt(seg), [bx, bz] = pt(seg + 1);
      const m = f < 0.7 ? 0 : (f - 0.7) / 0.3; // hover, then dart
      const e = m * m * (3 - 2 * m);
      const x = d.x + ax + (bx - ax) * e, z = d.z + az + (bz - az) * e;
      const y = Math.max(groundAt(this.world, x, z), 1.8) + 0.45 + Math.sin(t * 3 + i) * 0.05;
      const heading = Math.atan2(bx - ax, bz - az);
      const show = d.home ? 1 : 0;
      tmpQ.setFromEuler(tmpE.set(0, heading, 0));
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(show, show, show));
      this.dfBodies.setMatrixAt(i, tmpM);
      for (let w = 0; w < 2; w++) {
        const flick = Math.sin(t * 40 + w * 2 + i) * 0.35;
        tmpQ.setFromEuler(tmpE.set(0, heading, flick));
        tmpM.compose(tmpP.set(x, y + 0.02, z + (w ? 0.04 : -0.04) * Math.cos(heading)), tmpQ, tmpS.set(show, show, show));
        this.dfWings.setMatrixAt(i * 2 + w, tmpM);
      }
    });
    this.dfBodies.instanceMatrix.needsUpdate = this.dfWings.instanceMatrix.needsUpdate = true;

    // leaves: flutter down, drift with the wind, rest on the ground, then fade
    this.leaves.forEach((l, i) => {
      l.t += dt;
      let scale = 1;
      if (l.state === 'idle') {
        scale = 0;
        if (l.t > 0) this.spawnLeaf(l, focus);
      } else if (l.state === 'fall') {
        l.x += (WIND.x * 0.9 + Math.sin(l.t * 2 + l.sway) * 0.4) * dt;
        l.z += (WIND.z * 0.9 + Math.cos(l.t * 1.7 + l.sway) * 0.3) * dt;
        l.y += (l.vy + Math.sin(l.t * 3 + l.sway) * 0.15) * dt;
        l.spin += l.spinRate * dt;
        const g = groundAt(this.world, l.x, l.z);
        if (l.y <= g + 0.02 && g >= 1.8) { l.y = g + 0.02; l.state = 'rest'; l.rest = 0; }
        if (l.y < 1.4 || l.t > 14) l.state = 'idle'; // fell into water or wandered off
      } else if (l.state === 'rest') {
        l.rest += dt;
        scale = Math.max(0, 1 - Math.max(0, l.rest - 2.5) / 1.5);
        if (scale === 0) { l.state = 'idle'; l.t = -Math.random() * 2; }
      }
      const flat = l.state === 'rest';
      tmpQ.setFromEuler(tmpE.set(flat ? -Math.PI / 2 : l.spin, flat ? l.sway : l.spin * 0.7, flat ? 0 : Math.sin(l.spin) * 0.8));
      tmpM.compose(tmpP.set(l.x ?? 0, l.y ?? -50, l.z ?? 0), tmpQ, tmpS.set(scale, scale, scale));
      this.leafMesh.setMatrixAt(i, tmpM);
    });
    this.leafMesh.instanceMatrix.needsUpdate = true;
    if (this.frogs.length) this.updateFrogs(t, dt, focus);
    if (this.swarms.length || this.striders.length) this.updateInsects(t, focus);
    this.updateBirds(t, dt, focus);
    this.updateFish(t, dt, focus);
  }
}
