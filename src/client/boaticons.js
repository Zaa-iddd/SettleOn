// Little pictures of boat parts for the edit menu: each variant (cabin, roof, top, mast, deck prop, hull) is
// rendered once, in the boat's own colours, into a small transparent image with a dark pixel outline.

import * as THREE from 'three';
import { partPieces } from './boat.js';
import { BOAT_PALETTE } from '../shared/boatlook.js';

const SIZE = 48;
const cache = new Map();
let rt = null, scene = null, cam = null;
const mats = new Map();
const matFor = (hex, glow) => {
  const key = `${hex}:${glow ? 1 : 0}`;
  if (!mats.has(key)) mats.set(key, glow ? new THREE.MeshBasicMaterial({ color: 0xffd060 }) : new THREE.MeshLambertMaterial({ vertexColors: true, color: hex }));
  return mats.get(key);
};

// an empty square with a cross, for "none" / "nothing"
function noneIcon() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 24;
  const g = cv.getContext('2d');
  g.fillStyle = '#7a6a58';
  for (let i = 4; i < 20; i += 2) { g.fillRect(i, 4, 1, 1); g.fillRect(i, 19, 1, 1); g.fillRect(4, i, 1, 1); g.fillRect(19, i, 1, 1); }
  g.fillStyle = '#c8644a';
  for (let i = 8; i < 16; i++) { g.fillRect(i, i, 2, 2); g.fillRect(23 - i - 1, i, 2, 2); }
  return cv.toDataURL();
}

/**
 * A data URL picture of variant `v` of a part `kind` ('hull', 'cabin', 'roof', 'top', 'mast', 'prop', or 'upgrade':
 * v = the upgrade's index, at level `lvl`) on a boat with look `look`.
 */
export function partIcon(renderer, kind, v, look, lvl = 1) {
  const key = `${kind}:${v}:${look.p.join()}:${look.c.join()}:${look.t}:${lvl}`;
  if (cache.has(key)) return cache.get(key);
  const pieces = partPieces(kind, v, look, lvl);
  if (!pieces.length) { const u = noneIcon(); cache.set(key, u); return u; }
  if (!scene) {
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6a5a4a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.8);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    cam = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
    rt = new THREE.WebGLRenderTarget(SIZE, SIZE);
  }
  const tintHex = { hull: BOAT_PALETTE[look.c[0]], cabin: BOAT_PALETTE[look.c[1]], roof: BOAT_PALETTE[look.c[2]], canvas: BOAT_PALETTE[look.c[3]] };
  const group = new THREE.Group();
  for (const pc of pieces) {
    const m = new THREE.Mesh(pc.geo, matFor(pc.tint ? tintHex[pc.tint] : 0xffffff, pc.glow));
    if (pc.pos) m.position.set(...pc.pos);
    if (pc.flag) m.rotation.y = Math.PI / 2;
    group.add(m);
  }
  scene.add(group);
  // frame it from the front-right, a little above, like the game camera
  const box = new THREE.Box3().setFromObject(group), sphere = box.getBoundingSphere(new THREE.Sphere());
  const dir = new THREE.Vector3(0.85, 0.7, 1.15).normalize();
  cam.position.copy(sphere.center).addScaledVector(dir, sphere.radius / Math.sin((cam.fov * Math.PI) / 360) * 1.02);
  cam.lookAt(sphere.center);
  const prevTarget = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, buf);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  scene.remove(group);
  // to an image: flip upside down, linear → sRGB, and a dark outline around the shape
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d'), img = g.createImageData(SIZE, SIZE);
  const a = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? 0 : buf[((SIZE - 1 - y) * SIZE + x) * 4 + 3]);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = ((SIZE - 1 - y) * SIZE + x) * 4, o = (y * SIZE + x) * 4;
    if (buf[i + 3] > 40) {
      for (let k = 0; k < 3; k++) img.data[o + k] = Math.round(255 * Math.pow(buf[i + k] / 255, 1 / 2.2));
      img.data[o + 3] = 255;
    } else if (a(x + 1, y) > 40 || a(x - 1, y) > 40 || a(x, y + 1) > 40 || a(x, y - 1) > 40) {
      img.data.set([30, 22, 18, 255], o);
    }
  }
  g.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}
