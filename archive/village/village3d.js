// 3D models for the village around the campfire (layout comes from world.village):
// stone cottages with terracotta roofs, wooden fences, a well, props and lantern posts.
// All original low-poly models, textured with the small pixel-art textures in textures.js.

import * as THREE from 'three';
import { stoneTexture, roofTexture, woodTexture, worldUV } from './textures.js';

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const tex = (t) => new THREE.MeshLambertMaterial({ map: t });
  MATS = {
    stone: tex(stoneTexture()),
    roof: tex(roofTexture()),
    wood: tex(woodTexture()),
    darkWood: new THREE.MeshLambertMaterial({ color: 0x5e3d22 }),
    glass: new THREE.MeshLambertMaterial({ color: 0x3f5f86, emissive: 0x1a2a40 }),
    clay: new THREE.MeshLambertMaterial({ color: 0xb8653c }),
    stumpTop: new THREE.MeshLambertMaterial({ color: 0xd9b98a }),
    bark: new THREE.MeshLambertMaterial({ color: 0x7a5232 }),
    ivy: new THREE.MeshLambertMaterial({ color: 0x3f8a32 }),
    leaf: new THREE.MeshLambertMaterial({ color: 0x4f9a3c }),
    water: new THREE.MeshLambertMaterial({ color: 0x2f5f8a, emissive: 0x0d2238 }),
    gold: new THREE.MeshLambertMaterial({ color: 0xe0b44a }),
    lantern: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.8) }), // HDR so it blooms
    flowers: [0xe0334a, 0xf28cc0, 0xffd84a, 0xffffff].map((c) => new THREE.MeshLambertMaterial({ color: c })),
  };
  return MATS;
}

// textured box helper: geometry gets world-unit UVs so textures tile evenly
function tbox(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d)), mat);
  m.position.set(x, y, z);
  return m;
}

function cottage(c, y) {
  const M = mats();
  const g = new THREE.Group();
  g.position.set(c.x, y, c.z);
  const W = c.w - 0.2, D = c.d - 0.2, H = 1.6;
  g.add(tbox(W, H, D, M.stone, 0, H / 2, 0));

  // gable roof: two tiled slabs meeting at a ridge along x, with overhang
  const pitch = 0.62, half = D / 2 + 0.35;
  const slope = half / Math.cos(pitch), ridge = H + half * Math.tan(pitch);
  for (const s of [1, -1]) {
    const slab = tbox(W + 0.5, 0.16, slope + 0.05, M.roof, 0, H + (half / 2) * Math.tan(pitch) + 0.08, (s * half) / 2);
    slab.rotation.x = s * pitch;
    g.add(slab);
  }
  // gable ends (stone triangles)
  const tri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, ridge - H - 0.05)]);
  for (const s of [1, -1]) {
    const gable = new THREE.Mesh(worldUV(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }).rotateY(Math.PI / 2)), M.stone);
    gable.position.set(s * (W / 2) - 0.05, H, 0);
    g.add(gable);
  }
  // chimney
  g.add(tbox(0.45, 1.1, 0.45, M.stone, W / 2 - 0.55, ridge - 0.2, -0.35));

  // front (south, +z): arched door with stone frame, step, window with flower box
  const front = D / 2;
  const doorX = -0.45;
  g.add(tbox(0.66, 1.05, 0.06, M.wood, doorX, 0.53, front + 0.02));
  g.add(tbox(0.14, 1.2, 0.16, M.stone, doorX - 0.42, 0.6, front + 0.04));
  g.add(tbox(0.14, 1.2, 0.16, M.stone, doorX + 0.42, 0.6, front + 0.04));
  g.add(tbox(0.98, 0.18, 0.18, M.stone, doorX, 1.25, front + 0.05));
  g.add(tbox(0.4, 0.12, 0.12, M.stone, doorX, 1.38, front + 0.05)); // keystone
  g.add(tbox(0.06, 0.06, 0.04, M.gold, doorX + 0.2, 0.55, front + 0.07));
  g.add(tbox(1.0, 0.12, 0.45, M.stone, doorX, 0.06, front + 0.25));
  const winX = 0.65;
  g.add(tbox(0.5, 0.45, 0.04, M.glass, winX, 0.95, front + 0.02));
  g.add(tbox(0.6, 0.06, 0.08, M.wood, winX, 1.2, front + 0.04));
  g.add(tbox(0.6, 0.06, 0.08, M.wood, winX, 0.7, front + 0.04));
  g.add(tbox(0.04, 0.45, 0.06, M.wood, winX, 0.95, front + 0.04));
  g.add(tbox(0.66, 0.14, 0.18, M.wood, winX, 0.62, front + 0.1));
  for (let k = 0; k < 4; k++) g.add(tbox(0.1, 0.1, 0.1, M.flowers[k % 4], winX - 0.24 + k * 0.16, 0.73, front + 0.12));
  // ivy creeping up the front corners
  for (const [x, h] of [[-W / 2 + 0.05, 1.3], [W / 2 - 0.05, 0.9]]) {
    g.add(tbox(0.14, h, 0.1, M.ivy, x, h / 2, front + 0.03));
    g.add(tbox(0.24, 0.16, 0.1, M.ivy, x + (x < 0 ? 0.1 : -0.1), h * 0.6, front + 0.04));
  }
  return g;
}

function fence(points, y) {
  const M = mats();
  const g = new THREE.Group();
  points.forEach((p, i) => {
    g.add(tbox(0.13, 0.75, 0.13, M.wood, p.x, y + 0.37, p.z));
    g.add(tbox(0.17, 0.06, 0.17, M.darkWood, p.x, y + 0.77, p.z));
    const q = points[i + 1];
    if (!q) return;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    for (const ry of [0.32, 0.6]) {
      const rail = tbox(len, 0.08, 0.06, M.wood, (p.x + q.x) / 2, y + ry, (p.z + q.z) / 2);
      rail.rotation.y = -Math.atan2(q.z - p.z, q.x - p.x);
      g.add(rail);
    }
  });
  return g;
}

function well(w, y) {
  const M = mats();
  const g = new THREE.Group();
  g.position.set(w.x, y, w.z);
  g.add(new THREE.Mesh(worldUV(new THREE.CylinderGeometry(0.42, 0.46, 0.55, 10).translate(0, 0.275, 0)), M.stone));
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.33, 10).rotateX(-Math.PI / 2), M.water);
  water.position.y = 0.5;
  g.add(water);
  for (const s of [1, -1]) g.add(tbox(0.1, 1.2, 0.1, M.wood, s * 0.38, 0.6, 0));
  g.add(tbox(0.9, 0.08, 0.08, M.darkWood, 0, 0.95, 0)); // crank bar
  for (const s of [1, -1]) {
    const slab = tbox(1.05, 0.08, 0.5, M.roof, 0, 1.28, s * 0.18);
    slab.rotation.x = s * 0.6;
    g.add(slab);
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.14, 7).translate(0.15, 0.75, 0), M.darkWood)); // bucket
  return g;
}

function prop(p, y) {
  const M = mats();
  const g = new THREE.Group();
  g.position.set(p.x, y, p.z);
  if (p.type === 'pot') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.12, 0.26, 8).translate(0, 0.13, 0), M.clay));
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0).translate(0, 0.33, 0), M.leaf));
    g.add(tbox(0.07, 0.07, 0.07, M.flowers[0], 0.08, 0.45, 0.06));
    g.add(tbox(0.07, 0.07, 0.07, M.flowers[2], -0.07, 0.42, -0.05));
  } else if (p.type === 'crate') {
    g.add(tbox(0.55, 0.5, 0.55, M.wood, 0, 0.25, 0));
    g.add(tbox(0.58, 0.06, 0.58, M.darkWood, 0, 0.5, 0));
  } else if (p.type === 'barrel') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.6, 10).translate(0, 0.3, 0), M.bark));
    for (const by of [0.12, 0.48]) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.255, 0.255, 0.05, 10).translate(0, by, 0), M.darkWood));
  } else if (p.type === 'stump') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.32, 9).translate(0, 0.16, 0), M.bark));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 9).translate(0, 0.33, 0), M.stumpTop));
  } else if (p.type === 'bush') {
    for (const [x, yy, z, r] of [[0, 0.32, 0, 0.36], [0.25, 0.25, 0.1, 0.26], [-0.24, 0.24, -0.06, 0.27]]) {
      g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1).translate(x, yy, z), M.leaf));
    }
    for (let k = 0; k < 5; k++) g.add(tbox(0.07, 0.07, 0.07, M.flowers[0], Math.cos(k * 1.3) * 0.3, 0.3 + (k % 3) * 0.1, Math.sin(k * 1.3) * 0.3));
  }
  return g;
}

function lanternPost(l, y) {
  const M = mats();
  const g = new THREE.Group();
  g.position.set(l.x, y, l.z);
  g.add(tbox(0.1, 1.3, 0.1, M.wood, 0, 0.65, 0));
  g.add(tbox(0.4, 0.06, 0.06, M.darkWood, 0.15, 1.25, 0));
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), M.lantern);
  glow.position.set(0.3, 1.08, 0);
  g.add(glow);
  g.add(tbox(0.22, 0.05, 0.22, M.darkWood, 0.3, 1.2, 0));
  const light = new THREE.PointLight(0xffb060, 1.6, 4, 1.6);
  light.position.set(0.3, 1.0, 0);
  g.add(light);
  g.userData.light = light;
  return g;
}

/** Build the whole village. Returns { group, lights } (lights flicker gently). */
export function buildVillage(world) {
  const v = world.village;
  const group = new THREE.Group();
  const y = v.y;
  v.cottages.forEach((c) => group.add(cottage(c, y)));
  v.fences.forEach((f) => group.add(fence(f, y)));
  if (v.well) group.add(well(v.well, y));
  v.props.forEach((p) => group.add(prop(p, y)));
  const lights = [];
  v.lanterns.forEach((l) => {
    const post = lanternPost(l, y);
    lights.push(post.userData.light);
    group.add(post);
  });
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group, lights };
}
