// Small procedural pixel-art textures (32×32) for village buildings and props, drawn on a
// canvas at load time. Use with `worldUV()` so they tile at 16 texels per world unit,
// matching the terrain shader's texel density.

import * as THREE from 'three';
import { rng } from '../shared/world.js';

const SIZE = 32;

function canvasTexture(draw, seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  draw(ctx, rng(seed));
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const px = (ctx, x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

// Grey fieldstone wall: staggered stones with dark mortar, a highlight on top/left, a shade
// on the bottom/right, and the odd mossy pixel.
export const stoneTexture = () => canvasTexture((ctx, r) => {
  px(ctx, 0, 0, SIZE, SIZE, '#55524c');
  let y = 0;
  while (y < SIZE) {
    const h = 6 + Math.floor(r() * 3);
    let x = -Math.floor(r() * 8);
    while (x < SIZE) {
      const w = 7 + Math.floor(r() * 6);
      const shade = ['#a29d93', '#b0aba0', '#97928a', '#aca79b'][Math.floor(r() * 4)];
      px(ctx, x + 1, y + 1, w - 1, h - 1, shade);
      px(ctx, x + 1, y + 1, w - 1, 1, '#c6c1b4');
      px(ctx, x + 1, y + 1, 1, h - 1, '#bdb8ab');
      px(ctx, x + 1, y + h - 1, w - 1, 1, '#7d7870');
      if (r() < 0.25) px(ctx, x + 2 + Math.floor(r() * (w - 3)), y + h - 2, 2, 1, '#6f8f45');
      x += w;
    }
    y += h;
  }
}, 11);

// Terracotta roof tiles: staggered rows of rounded tiles with a dark lower lip.
export const roofTexture = () => canvasTexture((ctx) => {
  px(ctx, 0, 0, SIZE, SIZE, '#7d3420');
  for (let row = 0; row < 4; row++) {
    const y = row * 8, off = row % 2 ? 4 : 0;
    for (let col = -1; col < 5; col++) {
      const x = col * 8 + off;
      px(ctx, x + 1, y, 7, 7, '#c9653d');
      px(ctx, x + 1, y, 2, 6, '#df865a');           // highlight
      px(ctx, x + 6, y + 1, 2, 6, '#a84c2d');       // shade
      px(ctx, x + 1, y + 6, 7, 1, '#93401f');       // lip
      px(ctx, x + 1, y + 6, 1, 1, '#7d3420');       // rounded corners
      px(ctx, x + 7, y + 6, 1, 1, '#7d3420');
    }
  }
}, 12);

// Wooden planks: vertical boards with grain and dark gaps.
export const woodTexture = () => canvasTexture((ctx, r) => {
  px(ctx, 0, 0, SIZE, SIZE, '#4c301b');
  for (let col = 0; col < 4; col++) {
    const x = col * 8;
    const base = ['#9b6b40', '#a5744a', '#90633a'][col % 3];
    px(ctx, x + 1, 0, 7, SIZE, base);
    px(ctx, x + 1, 0, 1, SIZE, '#b88555');
    for (let g = 0; g < 5; g++) px(ctx, x + 2 + Math.floor(r() * 5), Math.floor(r() * SIZE), 1, 3 + Math.floor(r() * 5), '#7a5230');
    px(ctx, x + 3, Math.floor(r() * SIZE), 2, 2, '#5e3d22'); // knot
  }
}, 13);

/**
 * Give a geometry world-unit UVs from its positions and normals (box-style projection),
 * so a texture tiles at `perUnit` repeats per unit regardless of the mesh size.
 */
export function worldUV(geo, perUnit = 0.5) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u * perUnit;
    uv[i * 2 + 1] = v * perUnit;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
