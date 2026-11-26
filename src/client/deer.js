// Deer: little herds that graze, wander, look around and bound away when you come close.
// Client-only decoration (not synced), like the rest of the ambient life.
//
// Performance: every deer is one instance of a single merged, vertex-coloured mesh (one draw call,
// plus one for the shadow). Legs, neck, head, ears and tail bend in the vertex shader from two
// per-instance vec4s, so animating a deer costs one matrix and eight floats a frame. Antlers and
// fawn spots are collapsed in the shader when a deer doesn't have them (`aKind`).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { K, SEA, WORLD, toCell, cellKey, groundAt } from '../shared/world.js';
import { CH } from '../shared/endless.js';

export const HERDS = 4, HERD_MAX = 4;
const SPAWN_MIN = 15, SPAWN_MAX = 30; // a herd turns up this far from the player...
const LEAVE_R = 48; // ...and moves on (to turn up elsewhere) once the player is this far away
const FLEE_R = 4.2; // come closer than this and the herd bounds away
const ALERT_R = 8; // closer than this, grazing deer look up at you now and then
const WALK = 0.95, RUN = 4.4; // units per second
const SIZE = { doe: 0.92, stag: 1.05, fawn: 0.62 };
// ground deer walk on (no water, bare rock or snow)
const OK = new Set([K.GRASS, K.FOREST, K.DIRT, K.SOIL, K.DEEP, K.TRAIL, K.SAND]);

// joints (model units, deer faces +z, hooves at y 0, about 1.25 tall to the antler tips)
const NECK = [0, 0.56, 0.2], HEAD = [0, 0.8, 0.27], EAR = [0.11, 0.95, 0.3], TAIL = [0, 0.62, -0.24];
const HIP_Y = 0.42, KNEE_Y = 0.215, LEG_X = 0.085, LEG_ZF = 0.16, LEG_ZB = -0.16;
// aPart: 0 body, 1 neck, 2 head, 3 ears, 5 antlers, 6 fawn spots, 7-10 upper legs (FL, FR, BL, BR), 11 tail,
// 12-15 lower legs (the same leg + 5: they fold at the knee)
const P = { BODY: 0, NECK: 1, HEAD: 2, EAR: 3, ANTLER: 5, SPOTS: 6, FL: 7, FR: 8, BL: 9, BR: 10, TAIL: 11, LOWER: 5 };

function deerGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z, hex, part, shape = null) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    g.deleteAttribute('uv');
    const pos = g.attributes.position, n = pos.count;
    if (shape) for (let i = 0; i < n; i++) { const p = shape(pos.getX(i), pos.getY(i), pos.getZ(i)); pos.setXYZ(i, p[0], p[1], p[2]); }
    const c = new THREE.Color(hex), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    g.computeVertexNormals();
    parts.push(g);
  };
  const BODY = 0xb8693a, BACK = 0xc97c48, LEG = 0x6e3e24, HOOF = 0x2e1f18, CREAM = 0xf1e4cc;
  const SNOUT = 0xd8945e, NOSE = 0x2a1814, EYE = 0x16121c, EAR_IN = 0xeaa0a0, ANTLER = 0x8a7a6c, TIP = 0xbcae9c;

  // body: a stubby barrel, lighter along the back, cream belly
  box(0.26, 0.24, 0.5, 0, 0.52, 0, BODY, P.BODY);
  box(0.2, 0.02, 0.4, 0, 0.645, -0.01, BACK, P.BODY);
  box(0.2, 0.03, 0.36, 0, 0.4, 0, CREAM, P.BODY);
  // fawn spots on the back (collapsed unless a fawn)
  for (const [x, z] of [[-0.06, 0.12], [0.07, 0.04], [-0.05, -0.05], [0.06, -0.14], [-0.08, -0.17], [0.0, 0.18]]) box(0.04, 0.014, 0.04, x, 0.654, z, CREAM, P.SPOTS);
  // legs: a thigh in body colour and an upper shin swing from the hip; the lower shin and hoof fold at the knee
  for (const [part, x, z] of [[P.FL, -LEG_X, LEG_ZF], [P.FR, LEG_X, LEG_ZF], [P.BL, -LEG_X, LEG_ZB], [P.BR, LEG_X, LEG_ZB]]) {
    box(0.09, 0.14, 0.1, x, 0.37, z, BODY, part);
    box(0.066, 0.15, 0.066, x, 0.27, z, LEG, part);
    box(0.062, 0.21, 0.062, x, 0.125, z, LEG, part + P.LOWER);
    box(0.076, 0.05, 0.082, x, 0.025, z + 0.005, HOOF, part + P.LOWER);
  }
  // neck with a cream bib
  box(0.13, 0.3, 0.13, 0, 0.68, 0.24, BODY, P.NECK);
  box(0.1, 0.24, 0.02, 0, 0.64, 0.31, CREAM, P.NECK);
  // head: big and round-ish (cartoon), snout, nose, big shiny eyes and a little blush
  box(0.25, 0.22, 0.24, 0, 0.9, 0.32, BODY, P.HEAD);
  box(0.15, 0.11, 0.12, 0, 0.83, 0.48, SNOUT, P.HEAD);
  box(0.09, 0.055, 0.03, 0, 0.86, 0.545, NOSE, P.HEAD);
  for (const s of [-1, 1]) {
    box(0.056, 0.078, 0.05, s * 0.1, 0.915, 0.42, EYE, P.HEAD);
    box(0.022, 0.022, 0.01, s * 0.11, 0.935, 0.447, 0xffffff, P.HEAD);
    box(0.034, 0.018, 0.01, s * 0.1, 0.86, 0.443, 0xe88a7a, P.HEAD);
    // big ears, tilted up and out, pink inside
    const tilt = (x, y, z) => [x, y + (Math.abs(x) - 0.11) * 0.18, z];
    box(0.19, 0.06, 0.12, s * 0.205, 0.94, 0.3, BODY, P.EAR, tilt);
    box(0.13, 0.036, 0.012, s * 0.215, 0.94, 0.361, EAR_IN, P.EAR, tilt);
    // antlers (stags only): a beam, a branch out with a tine up, a brow tine forward
    box(0.038, 0.22, 0.038, s * 0.075, 1.11, 0.29, ANTLER, P.ANTLER);
    box(0.11, 0.035, 0.035, s * 0.13, 1.14, 0.29, ANTLER, P.ANTLER);
    box(0.035, 0.12, 0.035, s * 0.168, 1.21, 0.29, TIP, P.ANTLER);
    box(0.034, 0.09, 0.034, s * 0.08, 1.26, 0.27, TIP, P.ANTLER);
    box(0.03, 0.03, 0.08, s * 0.075, 1.06, 0.345, ANTLER, P.ANTLER);
  }
  // tail: a little brown flag with a white underside (shown when it's raised in alarm)
  box(0.09, 0.12, 0.07, 0, 0.57, -0.27, BODY, P.TAIL);
  box(0.07, 0.085, 0.02, 0, 0.55, -0.305, CREAM, P.TAIL);
  return mergeGeometries(parts);
}

const v3 = (a) => `vec3(${a.map((x) => x.toFixed(3)).join(', ')})`;
// The pose, shared by the deer material and its shadow depth material.
const DEER_GLSL = `
  attribute float aPart;
  attribute vec4 aMisc;  // kind (0 doe, 1 stag: antlers, 2 fawn: spots), leg tuck (hops), -, -
  attribute vec4 aPose;  // stride phase, leg swing, gait (0 walk, 1 bound), tail lift
  attribute vec4 aHead;  // neck pitch (+ = down), head yaw, left ear, right ear
  vec3 dRotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
  vec3 dRotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
  vec3 dRotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
  vec3 deerPose(vec3 v, bool isPoint) {
    float p = aPart;
    if (p < 0.5) return v;
    float kind = aMisc.x, tuck = aMisc.y;
    if (p > 5.5 && p < 6.5) { if (isPoint) v = mix(vec3(0.0, 0.6, 0.0), v, step(1.5, kind)); return v; }
    if ((p > 6.5 && p < 10.5) || p > 11.5) {
      bool lower = p > 11.5;
      float i = lower ? p - 12.0 : p - 7.0;
      bool front = i < 1.5;
      // walk/trot: diagonal pairs together; bound: the hind pair pushes off, then the front pair
      // reaches forward through the leap (a touch apart within each pair, so it ripples)
      float trot = (i > 0.5 && i < 2.5) ? 3.1416 : 0.0;
      float bound = i < 0.5 ? 3.1416 : i < 1.5 ? 3.49 : i < 2.5 ? 0.0 : 0.35;
      float th = aPose.x + mix(trot, bound, aPose.z);
      float hipA = aPose.y * sin(th);
      // the foot travels forward while the hip angle falls: lift it by folding the knee, eased in and out
      float rec = max(0.0, -cos(th));
      rec = rec * rec * (3.0 - 2.0 * rec);
      float kneeA = rec * (0.15 + 1.6 * aPose.y);
      // hops: front legs fold forward and up, hind legs back, knees tucked in
      hipA += tuck * (front ? -0.55 : 0.5);
      kneeA += tuck * 1.5;
      float side = position.x < 0.0 ? -${LEG_X.toFixed(3)} : ${LEG_X.toFixed(3)};
      float lz = front ? ${LEG_ZF.toFixed(3)} : ${LEG_ZB.toFixed(3)};
      if (lower) {
        // front knees fold the hoof back, hind hocks bring it forward
        vec3 knee = isPoint ? vec3(side, ${KNEE_Y.toFixed(3)}, lz) : vec3(0.0);
        v = dRotX(v - knee, front ? kneeA : -0.85 * kneeA) + knee;
      }
      vec3 hip = isPoint ? vec3(side, ${HIP_Y.toFixed(3)}, lz) : vec3(0.0);
      return dRotX(v - hip, hipA) + hip;
    }
    if (p > 10.5 && p < 11.5) { vec3 j = isPoint ? ${v3(TAIL)} : vec3(0.0); return dRotX(v - j, aPose.w) + j; }
    if (p > 1.5) {
      if (p > 4.5 && isPoint) v = mix(vec3(0.0, 1.0, 0.29), v, step(0.5, kind) * step(kind, 1.5));
      if (p > 2.5 && p < 3.5) {
        float side = position.x < 0.0 ? -1.0 : 1.0;
        vec3 e = isPoint ? ${v3(EAR)} : vec3(0.0);
        v.x *= side;
        v = dRotZ(v - e, side < 0.0 ? aHead.z : aHead.w) + e;
        v.x *= side;
      }
      vec3 h = isPoint ? ${v3(HEAD)} : vec3(0.0);
      v = dRotY(v - h, aHead.y) + h;
      v = dRotX(v - h, -0.55 * aHead.x) + h; // the head stays level-ish as the neck dips
    }
    vec3 n = isPoint ? ${v3(NECK)} : vec3(0.0);
    return dRotX(v - n, aHead.x) + n;
  }
`;
function poseDeer(sh) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>\n${DEER_GLSL}`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = deerPose(transformed, true);');
  if (sh.vertexShader.includes('#include <beginnormal_vertex>')) {
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = deerPose(objectNormal, false);');
  }
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const ease = (v, to, rate, dt) => v + (to - v) * (1 - Math.exp(-rate * dt));

export class Deer {
  constructor(world, scene) {
    this.world = world;
    const n = HERDS * HERD_MAX;
    const geo = deerGeometry();
    this.pose = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.head = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.misc = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPose', this.pose);
    geo.setAttribute('aHead', this.head);
    geo.setAttribute('aMisc', this.misc);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = poseDeer;
    mat.customProgramCacheKey = () => 'deer';
    const depth = new THREE.MeshDepthMaterial();
    depth.onBeforeCompile = poseDeer;
    depth.customProgramCacheKey = () => 'deer-depth';
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, c.setScalar(0.9 + Math.random() * 0.16));
    }
    scene.add(this.mesh);
    this.herds = Array.from({ length: HERDS }, (_, i) => ({ active: false, wait: 0.5 + i * 1.5, first: true, deer: [] }));
  }

  // ---------- where deer can stand ----------
  cellOk(ix, iz) {
    const w = this.world;
    if (w.H(ix, iz) < SEA) return false;
    if (!OK.has(w.kind(ix, iz))) return false;
    const key = cellKey(ix, iz);
    if (w.benches?.has(key) || w.piles?.has(key)) return false;
    if (w.endless) {
      const cx = Math.floor(ix / CH), cz = Math.floor(iz / CH);
      return !w.content(cx, cz).blocked[(iz - cz * CH) * CH + (ix - cx * CH)];
    }
    if (ix < 0 || iz < 0 || ix >= WORLD || iz >= WORLD) return false;
    return !w.obstacles?.get(iz * WORLD + ix)?.length;
  }

  /** Can a deer step to (x, z) from ground height `from`, climbing at most `up`? */
  canStep(x, z, from, up) {
    const ix = toCell(x), iz = toCell(z);
    if (!this.cellOk(ix, iz)) return false;
    const h = this.world.H(ix, iz);
    return h - from <= up && from - h <= 1.6;
  }

  spawnHerd(h, focus) {
    const near = h.first ? 9 : SPAWN_MIN;
    for (let tries = 0; tries < 24; tries++) {
      const a = Math.random() * Math.PI * 2, r = near + Math.random() * (SPAWN_MAX - near);
      const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
      const ix = toCell(x), iz = toCell(z);
      if (!this.cellOk(ix, iz) || !this.cellOk(ix + 1, iz) || !this.cellOk(ix - 1, iz) || !this.cellOk(ix, iz + 1) || !this.cellOk(ix, iz - 1)) continue;
      const g = this.world.H(ix, iz);
      const count = 2 + Math.floor(Math.random() * (HERD_MAX - 1));
      h.deer = [];
      for (let k = 0; k < count; k++) {
        const kind = k === 0 ? (Math.random() < 0.65 ? 'stag' : 'doe') : k === count - 1 && count > 2 && Math.random() < 0.6 ? 'fawn' : 'doe';
        let dx = 0, dz = 0;
        for (let j = 0; j < 6 && k > 0; j++) {
          const tx = (Math.random() - 0.5) * 3, tz = (Math.random() - 0.5) * 3;
          if (this.canStep(x + tx, z + tz, g, 0.6)) { dx = tx; dz = tz; break; }
        }
        h.deer.push({
          kind, size: SIZE[kind], x: x + dx, z: z + dz, y: groundAt(this.world, x + dx, z + dz), yaw: Math.random() * Math.PI * 2, yawV: 0,
          state: 'graze', timer: 1 + Math.random() * 4, ph: Math.random() * 100, phase: 0, speed: 0, swing: 0, gait: 0, tx: 0, tz: 0,
          neck: 1.2, neckV: 0, hy: 0, ears: [0, 0], earF: [0, 0], earT: [9, 9], tail: 0.15, flick: 9, show: 0,
          // springs: body lift, squash, pitch, and a floppy follow-through for ears, neck and tail
          ly: 0, lyV: 0, sq: 0, sqV: 0, pitch: 0, pitchV: 0, flop: 0, flopV: 0, leap: 0,
          // hops: hopT -1 = not hopping, else time since it started; a little physics in the air
          hopT: -1, hopY: 0, hopV: 0, tuck: 0,
        });
      }
      h.active = true;
      h.first = false;
      return true;
    }
    return false;
  }

  /** Start the whole herd bounding away from (fx, fz). */
  alarm(h, fx, fz) {
    for (const d of h.deer) {
      d.state = 'flee';
      d.timer = 2.2 + Math.random() * 1.2;
      d.fleeYaw = Math.atan2(d.x - fx, d.z - fz) + (Math.random() - 0.5) * 0.7;
      d.hopT = -1; d.hopY = 0; d.hopV = 0;
      d.neckV -= 6; // the head snaps up...
      d.sqV -= 2.5; // ...and it flinches down before springing off
      d.flopV += 4;
    }
  }

  pick(d, focus, near) {
    const r = Math.random();
    if (near && r < 0.5) { d.state = 'look'; d.timer = 1.5 + Math.random() * 2; return; }
    if (r < 0.42) {
      // wander a few steps, staying roughly with the herd
      d.state = 'walk';
      d.timer = 6;
      const a = Math.random() * Math.PI * 2, dist = 1.5 + Math.random() * 3.5;
      d.tx = d.x + Math.cos(a) * dist; d.tz = d.z + Math.sin(a) * dist;
    } else if (r < 0.78) { d.state = 'graze'; d.timer = 3 + Math.random() * 5; }
    else if (r < 0.93) { d.state = 'look'; d.timer = 1.5 + Math.random() * 2.5; }
    else { d.state = 'hop'; d.hopT = 0; d.hopY = 0; d.hopV = 0; } // a happy little spring on the spot
  }

  update(t, dt, focus) {
    dt = Math.min(dt, 0.05); // keeps the springs stable on slow frames
    const pose = this.pose.array, head = this.head.array, misc = this.misc.array;
    this.herds.forEach((h, hi) => {
      if (!h.active) {
        h.wait -= dt;
        if (h.wait <= 0 && !this.spawnHerd(h, focus)) h.wait = 2;
      } else {
        // left behind: move on, and turn up somewhere near the player later
        let cx = 0, cz = 0;
        for (const d of h.deer) { cx += d.x; cz += d.z; }
        cx /= h.deer.length; cz /= h.deer.length;
        if (Math.hypot(cx - focus.x, cz - focus.z) > LEAVE_R) { h.active = false; h.wait = 3 + Math.random() * 6; }
        else if (!h.deer.some((d) => d.state === 'flee') && h.deer.some((d) => Math.hypot(d.x - focus.x, d.z - focus.z) < FLEE_R)) this.alarm(h, focus.x, focus.z);
      }
      for (let k = 0; k < HERD_MAX; k++) {
        const i = hi * HERD_MAX + k, d = h.deer[k];
        if (!h.active || !d) { this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
        this.step(d, t, dt, focus);
        misc[i * 4] = d.kind === 'stag' ? 1 : d.kind === 'fawn' ? 2 : 0;
        misc[i * 4 + 1] = d.tuck;
        this.draw(d, i, t, pose, head);
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pose.needsUpdate = this.head.needsUpdate = this.misc.needsUpdate = true;
  }

  step(d, t, dt, focus) {
    const pdx = focus.x - d.x, pdz = focus.z - d.z, near = Math.hypot(pdx, pdz) < ALERT_R;
    d.show = Math.min(1, d.show + dt * 1.6);
    d.timer -= dt;
    let speedTo = 0, neckTo = 1.45, hyTo = 0, earTo = -0.05, tailTo = 0.12, steering = false;
    const g = groundAt(this.world, d.x, d.z);
    if (d.state === 'graze') {
      neckTo = 1.45 + 0.08 * Math.max(0, Math.sin(t * 7 + d.ph)) * (Math.sin(t * 0.9 + d.ph) > 0 ? 1 : 0); // nibbling
      hyTo = Math.sin(t * 0.4 + d.ph) * 0.15;
      if (near && Math.random() < dt * 0.9) { d.state = 'look'; d.timer = 1.6 + Math.random() * 1.6; }
      else if (d.timer <= 0) this.pick(d, focus, near);
    } else if (d.state === 'look') {
      neckTo = -0.12; earTo = 0.18; // alert: ears perk up a little
      // look around, or at you if you're close
      hyTo = near ? THREE.MathUtils.clamp(angDiff(Math.atan2(pdx, pdz), d.yaw), -0.95, 0.95) : Math.sin(t * 0.8 + d.ph) * 0.7;
      if (d.timer <= 0) this.pick(d, focus, false);
    } else if (d.state === 'hop') {
      neckTo = -0.05; earTo = 0.15; tailTo = 0.6;
      this.hop(d, dt);
    } else if (d.state === 'walk') {
      neckTo = 0.3; speedTo = WALK; steering = true;
      const dx = d.tx - d.x, dz = d.tz - d.z;
      if (Math.hypot(dx, dz) < 0.3 || d.timer <= 0) { d.state = 'graze'; d.timer = 2 + Math.random() * 4; }
      else this.steer(d, Math.atan2(dx, dz), 14, 2.5, dt);
    } else if (d.state === 'flee') {
      neckTo = -0.3; earTo = -0.4; tailTo = 1.5; speedTo = RUN; steering = true; // ears laid back, white tail up
      // keep heading away, swerving around whatever's in the way
      this.steer(d, d.fleeYaw, 40, 5, dt);
      if (d.timer <= 0) { d.state = 'look'; d.timer = 2 + Math.random() * 1.5; }
    }
    if (!steering) { d.yawV *= Math.exp(-8 * dt); d.yaw += d.yawV * dt; }
    // move along the facing
    const before = d.speed;
    d.speed = ease(d.speed, speedTo, speedTo > d.speed ? (d.state === 'flee' ? 4 : 3) : 2.5, dt);
    const accel = (d.speed - before) / dt;
    if (d.speed > 0.02) {
      const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw), v = d.speed * dt;
      const up = d.state === 'flee' ? 1.05 : 0.55;
      // both where it steps to and a body length ahead (so a diagonal can't clip a tile's corner)
      if (this.canStep(d.x + fx * v, d.z + fz * v, g, up) && this.canStep(d.x + fx * (v + 0.3), d.z + fz * (v + 0.3), g, up)) { d.x += fx * v; d.z += fz * v; }
      else if (d.state === 'flee') { d.fleeYaw += (Math.random() < 0.5 ? -1 : 1) * 0.9; d.speed *= 0.85; } // swerve
      else { d.state = 'graze'; d.timer = 1.5 + Math.random() * 3; }
    }
    // stride phase: quicker steps walking, long leaps bounding
    d.phase += dt * (d.speed < 2 ? d.speed * 6.4 : 8 + d.speed * 1.5);
    d.y = ease(d.y, groundAt(this.world, d.x, d.z), 10, dt);

    // ---- body springs: everything eases in and overshoots a little, so nothing snaps ----
    const walkK = Math.min(1, d.speed / WALK);
    const gait = THREE.MathUtils.smoothstep(d.speed, 1.6, 3.4); // 0 walking, 1 bounding
    d.gait = gait;
    d.swing = ease(d.swing, (1 - gait) * 0.5 * walkK + gait * 0.85, 6, dt);
    // bounding: an arcing leap each stride, through a spring so take-off and landing round off
    const leap = Math.sin(d.phase - 0.3);
    const liftTo = gait * 0.36 * Math.pow(Math.max(0, leap), 0.75) + (1 - gait) * walkK * 0.022 * Math.abs(Math.sin(d.phase));
    d.lyV += ((liftTo - d.ly) * 320 - d.lyV * 22) * dt;
    d.ly += d.lyV * dt;
    // landing: a squash, and the head and ears carry on down, then bounce back
    if (d.leap > 0 && leap <= 0 && gait > 0.25) { d.sqV -= 3.2 * gait; d.flopV -= 3.5 * gait; }
    d.leap = leap;
    // squash and stretch spring (wobbles back after each kick)
    d.sqV += (-d.sq * 260 - d.sqV * 13) * dt;
    d.sq += d.sqV * dt;
    // pitch: nose up on take-off, down on landing; leans back braking, forward speeding up
    const vy = d.lyV + d.hopV;
    const pitchTo = -gait * 0.2 * Math.cos(d.phase - 0.3) - THREE.MathUtils.clamp(accel * 0.03, -0.15, 0.15)
      + (d.state === 'graze' ? 0.05 : 0) - THREE.MathUtils.clamp(d.hopV * 0.06, -0.2, 0.2);
    d.pitchV += ((pitchTo - d.pitch) * 140 - d.pitchV * 15) * dt;
    d.pitch += d.pitchV * dt;
    // floppy follow-through: ears, neck and tail trail the body's vertical motion
    d.flopV += ((THREE.MathUtils.clamp(-vy * 0.18, -0.5, 0.5) - d.flop) * 90 - d.flopV * 7) * dt;
    d.flop += d.flopV * dt;
    if (d.hopT < 0) d.tuck = ease(d.tuck, 0, 10, dt);

    // a springy neck: snaps up in alarm, overshoots a little going down to graze
    d.neckV += ((neckTo - d.neck) * 70 - d.neckV * 9) * dt;
    d.neck += d.neckV * dt;
    d.hy = ease(d.hy, hyTo, 5, dt);
    d.tail = ease(d.tail, tailTo, 9, dt);
    // ear flicks every few seconds (one ear at a time), on top of the mood's ear set
    for (let e = 0; e < 2; e++) {
      d.earT[e] += dt;
      if (d.earT[e] > 2 + ((d.ph * (e + 3)) % 4) && Math.random() < dt * 2) d.earT[e] = 0;
      const ft = d.earT[e];
      d.ears[e] = ease(d.ears[e], earTo, 8, dt);
      d.earF[e] = ft < 0.5 ? 0.7 * Math.sin(ft * 30) * Math.exp(-ft * 7) : 0;
    }
    // the odd tail flick when calm
    d.flick += dt;
    if (d.state !== 'flee' && d.flick > 3 && Math.random() < dt * 0.5) d.flick = 0;
  }

  // A happy hop: crouch (anticipation), spring up and tuck the legs in the air, land with a squash.
  hop(d, dt) {
    const CROUCH = 0.16;
    const was = d.hopT;
    d.hopT += dt;
    if (d.hopT < CROUCH) {
      d.sq = ease(d.sq, -0.16, 18, dt); d.sqV = 0; // sink down
      d.tuck = ease(d.tuck, 0.12, 18, dt);
      return;
    }
    if (was < CROUCH) { d.hopV = 2.7; d.sqV += 5; d.flopV -= 3; } // spring off, stretching
    d.hopV -= 13 * dt;
    d.hopY += d.hopV * dt;
    d.tuck = ease(d.tuck, d.hopV > -1.2 ? 1 : 0.2, 14, dt); // legs tuck up, then reach down for the landing
    if (d.hopY <= 0) {
      d.hopY = 0; d.hopV = 0; d.hopT = -1;
      d.sqV -= 4.5; d.flopV -= 4; d.neckV += 2.5; // land with a squash; head and ears bounce
      d.state = 'look'; d.timer = 1 + Math.random() * 1.5;
    }
  }

  // turn toward `want` with a springy turn rate, easing in and out of turns instead of snapping
  steer(d, want, k, maxRate, dt) {
    const diff = angDiff(want, d.yaw);
    d.yawV += (diff * k - d.yawV * 2 * Math.sqrt(k)) * dt;
    d.yawV = THREE.MathUtils.clamp(d.yawV, -maxRate, maxRate);
    d.yaw += d.yawV * dt;
    if (Math.abs(diff) > 1.4) d.speed *= 1 - Math.min(1, dt * 3); // a sharp turn slows it first
  }

  draw(d, i, t, pose, head) {
    const walkK = Math.min(1, d.speed / WALK);
    const vy = d.lyV + d.hopV;
    // squash and stretch, keeping the volume: the spring, a stretch with vertical speed, breathing when still
    const st = Math.max(0.7, 1 + d.sq + THREE.MathUtils.clamp(vy * 0.05, -0.06, 0.1) + Math.sin(t * 2.2 + d.ph) * 0.015 * (1 - walkK));
    const sq = 1 / Math.sqrt(st);
    const tailFlick = d.flick < 0.6 ? 0.5 * Math.abs(Math.sin(d.flick * 16)) * (1 - d.flick / 0.6) : 0;
    pose[i * 4] = d.phase;
    pose[i * 4 + 1] = d.swing;
    pose[i * 4 + 2] = d.gait;
    pose[i * 4 + 3] = d.tail + tailFlick - d.flop * 0.8;
    head[i * 4] = d.neck + d.flop * 0.35;
    head[i * 4 + 1] = d.hy;
    head[i * 4 + 2] = d.ears[0] + d.earF[0] - d.flop * 1.1;
    head[i * 4 + 3] = d.ears[1] + d.earF[1] - d.flop * 1.1;
    const s = d.size * d.show * d.show;
    const roll = -d.yawV * Math.min(1, d.speed / 2) * 0.07; // lean into turns, more at speed
    tmpQ.setFromEuler(tmpE.set(d.pitch, d.yaw, roll, 'YXZ'));
    tmpM.compose(tmpP.set(d.x, d.y + (d.ly + d.hopY) * d.size, d.z), tmpQ, tmpS.set(s * sq, s * st, s * sq));
    this.mesh.setMatrixAt(i, tmpM);
  }
}
