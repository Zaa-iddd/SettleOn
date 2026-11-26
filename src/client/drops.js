// Item drops: things you break pop out as little floating item icons on the ground, and you collect them by
// walking up to them (they fly into you once you're close). Client-only, like the inventory: other players
// don't see your drops.

import * as THREE from 'three';
import { iconURL } from './inventory.js';

const GRAVITY = 14;
const SIZE = 0.36; // the icon's size in world units
const HOVER = 0.2; // how high a resting drop floats above the ground (its middle)
const PICK_DELAY = 0.55; // seconds before a fresh drop can be picked up (so you see it pop out)
const MAGNET_R = 1.7; // a drop this close flies to you
const COLLECT_R = 0.4;
const LIFETIME = 300; // seconds before a drop on the ground disappears (it blinks for the last 10)
const MAX_DROPS = 200; // the oldest go first past this

const mats = new Map(); // one sprite material per item, sharing the icon texture
function materialFor(id) {
  if (mats.has(id)) return mats.get(id);
  const tex = new THREE.TextureLoader().load(iconURL(id));
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, transparent: false });
  mats.set(id, m);
  return m;
}

export class Drops {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.fullAt = -99; // when we last said the inventory is full
  }

  /**
   * Drop n of item `id` from (x, y, z): up to 4 separate icons, each thrown out in a little arc.
   * `spread` widens the arc (a felled tree throws its logs further than a dug block).
   */
  spawn(id, n, x, y, z, spread = 1) {
    if (!(n > 0)) return;
    const pieces = Math.min(4, n);
    for (let i = 0; i < pieces; i++) {
      const count = Math.floor(n / pieces) + (i < n % pieces ? 1 : 0);
      const sprite = new THREE.Sprite(materialFor(id));
      sprite.scale.set(SIZE, SIZE, SIZE);
      const a = Math.random() * Math.PI * 2, sp = (0.7 + Math.random() * 0.9) * spread;
      const d = {
        id, count, sprite, x, y, z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 1.5, vz: Math.sin(a) * sp,
        age: 0, landed: false, phase: Math.random() * 6, magnet: false,
      };
      sprite.position.set(x, y, z);
      this.group.add(sprite);
      this.list.push(d);
    }
    while (this.list.length > MAX_DROPS) this.remove(this.list[0]);
  }

  remove(d) {
    d.sprite.removeFromParent();
    const i = this.list.indexOf(d);
    if (i >= 0) this.list.splice(i, 1);
  }

  clear() {
    for (const d of [...this.list]) this.remove(d);
    this.group.removeFromParent();
  }

  /**
   * ctx: { floor(x, z) → ground height, player {x, y, z} (null = can't pick up, e.g. in the menu),
   * add(id, n) → how many didn't fit, onFull(), night (0..1, darkens the icons) }
   */
  update(dt, t, ctx) {
    const shade = 1 - 0.65 * (ctx.night ?? 0);
    for (const m of mats.values()) m.color.setRGB(shade, shade, shade);
    const p = ctx.player;
    for (const d of [...this.list]) {
      d.age += dt;
      if (d.age > LIFETIME) { this.remove(d); continue; }
      const dist = p ? Math.hypot(p.x - d.x, p.y + 0.45 - d.y, p.z - d.z) : Infinity;
      if (p && d.age > PICK_DELAY && dist < MAGNET_R && !(t < d.noMagnetUntil)) d.magnet = true;
      if (d.magnet) { // fly to the player, quicker the closer it gets
        const k = Math.min(1, dt * (8 + 10 / Math.max(0.2, dist)));
        d.x += (p.x - d.x) * k; d.y += (p.y + 0.45 - d.y) * k; d.z += (p.z - d.z) * k;
        if (dist < COLLECT_R) {
          const left = ctx.add(d.id, d.count);
          if (left <= 0) { this.remove(d); continue; }
          if (left < d.count) d.count = left;
          // didn't fit: drop it back and leave it alone for a while
          d.magnet = false; d.landed = false; d.noMagnetUntil = t + 3;
          d.vx = (Math.random() - 0.5) * 2; d.vy = 2.5; d.vz = (Math.random() - 0.5) * 2;
          if (t - this.fullAt > 3) { this.fullAt = t; ctx.onFull(); }
        }
        if (dist > MAGNET_R * 1.6) d.magnet = false; // walked away mid-flight
      } else if (!d.landed) { // thrown out: an arc with gravity until it lands
        d.vy -= GRAVITY * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        const g = ctx.floor(d.x, d.z) + HOVER;
        if (d.y <= g && d.vy < 0) {
          if (d.vy < -2.5) { d.y = g; d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; } // a little bounce
          else { d.y = g; d.landed = true; d.base = g; }
        }
      } else { // resting: bob gently (and follow the ground if it changes under it)
        d.base += (ctx.floor(d.x, d.z) + HOVER - d.base) * Math.min(1, dt * 6);
        d.y = d.base + Math.sin(t * 2.6 + d.phase) * 0.05;
      }
      d.sprite.position.set(d.x, d.y, d.z);
      d.sprite.visible = d.age < LIFETIME - 10 || Math.floor(t * 6) % 2 === 0;
    }
  }
}
