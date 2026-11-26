// Fishing (client-only, not synced): hold the rod's cast button on the water and let go as the power meter
// swings by (more power, further out); wait for a nibble, then the bite ("!"), and click to hook it in time;
// then reel: hold to pull and keep the line's tension in the green zone while the fish fights, until the catch
// bar fills. Too slack and it slips the hook, too tight for too long and the line snaps.
// main.js calls press / release on clicks with the Fishing Rod and update() every frame.

import * as THREE from 'three';
import { SEA, toCell } from '../shared/world.js';

// The fish (original species). str = how hard it fights (0..1); where they bite is in weightAt(); cm = size range;
// food = hunger points when eaten (vitals.js).
export const FISH = [
  { id: 'minnow', name: 'Minnow', str: 0.2, cm: [5, 9], food: 2, col: ['#9fb8ac', '#e8f0ea', '#6f8a80'] },
  { id: 'perch', name: 'Sunny Perch', str: 0.4, cm: [14, 28], food: 3, col: ['#e0a83a', '#f6e8aa', '#b8602e'] },
  { id: 'koi', name: 'Spotted Koi', str: 0.5, cm: [25, 50], food: 4, col: ['#f08a3c', '#fff4e2', '#c8462a'] },
  { id: 'mackerel', name: 'Silver Mackerel', str: 0.62, cm: [24, 40], food: 5, col: ['#5a86b0', '#e2eaf2', '#2f4f70'] },
  { id: 'tang', name: 'Reef Tang', str: 0.55, cm: [15, 30], food: 3, col: ['#3a7ad8', '#ffd84a', '#1e3f8a'] },
  { id: 'carp', name: 'Golden Carp', str: 0.8, cm: [35, 70], food: 6, col: ['#f0c030', '#fff0a0', '#b8820e'] },
  { id: 'moonfish', name: 'Moonfish', str: 1.0, cm: [50, 95], food: 8, col: ['#b8c4ff', '#f0f2ff', '#7a6ad0'] },
];
// how likely each fish is to bite at a water depth (and at night, for the moonfish)
function weightAt(f, depth, night, perfect) {
  const rare = perfect ? 2 : 1; // a perfect cast tempts the rarer fish
  switch (f.id) {
    case 'minnow': return depth < 0.9 ? 5 : 1;
    case 'perch': return depth < 1.9 ? 4 : 1.5;
    case 'koi': return depth < 1.1 ? 2 : 0.3;
    case 'mackerel': return depth >= 1.3 ? 3 : 0;
    case 'tang': return depth >= 0.5 && depth <= 1.6 ? 1.6 : 0;
    case 'carp': return 0.35 * rare;
    case 'moonfish': return depth >= 2.2 ? (night > 0.4 ? 1.4 : 0.35) * rare : 0;
    default: return 0;
  }
}
// a 16×16 pixel fish facing right, for the item icons: o outline, b body, l belly, f fins and tail, w/p the eye
const FISH_SHAPE = [
  '................',
  '................',
  '................',
  '......oooo......',
  '.....offffo.....',
  '.oo.obbbbbbooo..',
  'offoobbbbbbbbbo.',
  'offfbbbbbbbbwpbo',
  'offfbbbbbbbbbbbo',
  'offolllllllllllo',
  '.oo.olllllllloo.',
  '.....offoooo....',
  '......oo........',
  '................',
  '................',
  '................',
];
/** The icon art (rows of colours) for a fish. */
export function fishArt(f) {
  const map = { o: '#1e1612', b: f.col[0], l: f.col[1], f: f.col[2], w: '#ffffff', p: '#1a1a22' };
  return FISH_SHAPE.map((row) => [...row].map((ch) => (ch === '.' ? null : map[ch])));
}

const POWER_PERIOD = 1.1; // seconds for the meter to rise from empty to full (then it falls back)
const CAST_MIN = 1.3, CAST_MAX = 7; // tiles
const BITE_WINDOW = 0.85; // seconds to click after the bite
const ZONE_C = 0.55; // the middle of the tension sweet spot
const $ = (id) => document.getElementById(id);

export class Fishing {
  constructor(scene) {
    this.scene = scene;
    this.state = 'idle';
    // the bobber: red top, white bottom; and the line from the rod tip, sagging a little
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.09), new THREE.MeshLambertMaterial({ color: 0xd8433a }));
    top.position.y = 0.05;
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), new THREE.MeshLambertMaterial({ color: 0xf4efe4 }));
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), new THREE.MeshLambertMaterial({ color: 0x2a2a2e }));
    pin.position.y = 0.11;
    g.add(top, bot, pin);
    g.visible = false;
    scene.add(g);
    this.bobber = g;
    this.lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(13 * 3), 3));
    this.line = new THREE.Line(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xf4efe4, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
    this.tip = new THREE.Vector3();
    this.bob = new THREE.Vector3(); // where the bobber is
  }
  get active() { return this.state !== 'idle'; }

  /** The cast button went down (with the rod in hand). `aim` = the ground point under the cursor, or null. */
  press(ctx, aim) {
    if (this.state === 'idle') {
      this.state = 'charge';
      this.chargeT = 0;
      this.aim = aim;
      ctx.char.rodPose = 'charge';
      $('fish-power').hidden = false;
    } else if (this.state === 'wait') this.end(ctx, 'Too early: the fish swam off'); // pulled before a bite
    else if (this.state === 'bite') this.hook(ctx);
  }
  /** The button came up: a charging cast goes out. */
  release(ctx) {
    if (this.state !== 'charge') return;
    $('fish-power').hidden = true;
    const p = this.power(), perfect = p >= 0.9;
    const pos = ctx.pos;
    let dx = 0, dz = 1;
    if (this.aim) { dx = this.aim.x - pos.x; dz = this.aim.z - pos.z; } else { dx = Math.sin(ctx.facing); dz = Math.cos(ctx.facing); }
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    ctx.faceTo(dx, dz);
    const dist = CAST_MIN + p * (CAST_MAX - CAST_MIN);
    this.target = new THREE.Vector3(pos.x + dx * dist, SEA, pos.z + dz * dist);
    this.perfect = perfect;
    this.state = 'fly';
    this.flyT = 0;
    this.from = this.tipPos(ctx).clone();
    ctx.swing();
    ctx.char.rodPose = 'hold';
    if (perfect) ctx.toast('Perfect cast!');
  }
  /** Stop fishing (moved away, switched items, left): reel the line in quietly. */
  cancel(ctx) { if (this.active) this.end(ctx, null); }

  power() { const k = (this.chargeT / POWER_PERIOD) % 2; return k < 1 ? k : 2 - k; }
  tipPos(ctx) { ctx.char.root.updateMatrixWorld(true); return ctx.char.toolGrip.localToWorld(this.tip.set(0, 0.02, 0.98)); }
  depthAt(world, x, z) { return SEA - world.H(toCell(x), toCell(z)); }

  hook(ctx) {
    $('fish-bang').hidden = true;
    // which fish took the bait, from the depth under the bobber
    const depth = Math.max(0, this.depthAt(ctx.world, this.bob.x, this.bob.z));
    const ws = FISH.map((f) => weightAt(f, depth, ctx.night, this.perfect)), total = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * total, fish = FISH[0];
    for (let i = 0; i < FISH.length; i++) { r -= ws[i]; if (r <= 0) { fish = FISH[i]; break; } }
    this.fish = fish;
    this.state = 'reel';
    this.tension = 0.45;
    this.progress = 0.3;
    this.surgeT = 0.6 + Math.random();
    this.surge = 0;
    this.snapT = 0;
    this.reelFrom = this.bob.clone();
    this.zoneHalf = 0.22 - 0.09 * fish.str;
    ctx.char.rodPose = 'reel';
    ctx.effects.impact(this.bob.x, SEA, this.bob.z, 1.6, 'water');
    $('fish-reel').hidden = false;
    $('fr-zone').style.left = `${(ZONE_C - this.zoneHalf) * 100}%`;
    $('fr-zone').style.width = `${this.zoneHalf * 200}%`;
  }
  // stop fishing: hide the bars, reel the bobber back to the rod, and say why (if there's a message)
  end(ctx, msg) {
    for (const id of ['fish-power', 'fish-reel', 'fish-bang']) $(id).hidden = true;
    if (msg) ctx.toast(msg);
    if (this.state === 'charge' || this.state === 'idle') { this.state = 'idle'; this.line.visible = this.bobber.visible = false; ctx.char.rodPose = null; return; }
    this.state = 'back';
    this.backT = 0;
    this.backFrom = this.bob.clone();
    ctx.char.rodPose = 'hold';
  }
  caught(ctx) {
    const f = this.fish, cm = Math.round(f.cm[0] + Math.random() * (f.cm[1] - f.cm[0]));
    ctx.give(f.id, 1);
    ctx.effects.impact(this.bob.x, SEA, this.bob.z, 2.2, 'water');
    const el = $('fish-get');
    el.querySelector('img').src = ctx.icon(f.id);
    el.querySelector('.fg-name').textContent = `${f.name} · ${cm} cm`;
    el.hidden = false;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    clearTimeout(this.getTimer);
    this.getTimer = setTimeout(() => { el.hidden = true; }, 2400);
    this.end(ctx, null);
  }

  /**
   * Every frame. ctx: { world, pos (feet), facing, char, effects, toast, give, icon, night, swing, faceTo,
   * project (world → [x, y] page px or null) }; holding = the cast/reel button is down.
   */
  update(dt, t, ctx, holding) {
    const st = this.state;
    if (st === 'idle') return;
    if (st === 'charge') {
      this.chargeT += dt;
      const p = this.power();
      $('fp-fill').style.height = `${p * 100}%`;
      $('fish-power').classList.toggle('perfect', p >= 0.9);
      if (!holding && this.chargeT > 0.05) this.release(ctx); // the release can come between frames
      return;
    }
    const tip = this.tipPos(ctx);
    if (st === 'fly') { // the bobber arcs out
      this.flyT += dt / 0.55;
      const k = Math.min(1, this.flyT);
      this.bob.lerpVectors(this.from, this.target, k);
      this.bob.y = this.from.y + (SEA - this.from.y) * k + Math.sin(k * Math.PI) * 1.3;
      if (k >= 1) {
        if (this.depthAt(ctx.world, this.target.x, this.target.z) <= 0.05) return this.end(ctx, 'Snagged on the shore: cast onto the water');
        ctx.effects.impact(this.bob.x, SEA, this.bob.z, 0.9, 'water');
        this.state = 'wait';
        this.waitT = (2 + Math.random() * 5) * (this.perfect ? 0.6 : 1);
        this.nibbleT = 0.8 + Math.random() * (this.waitT - 0.8) * 0.6;
        this.dip = 0;
      }
    } else if (st === 'wait') { // floating; a nibble or two, then the bite
      this.waitT -= dt;
      this.nibbleT -= dt;
      if (this.nibbleT <= 0 && this.waitT > 0.6) { this.dip = 0.07; this.nibbleT = 0.7 + Math.random() * 1.4; ctx.effects.impact(this.bob.x, SEA, this.bob.z, 0.3, 'water'); }
      this.dip = Math.max(0, this.dip - dt * 0.25);
      this.bob.set(this.target.x, SEA + Math.sin(t * 2.4) * 0.015 - this.dip, this.target.z);
      if (this.waitT <= 0) {
        this.state = 'bite';
        this.biteT = BITE_WINDOW + (this.perfect ? 0.15 : 0);
        ctx.effects.impact(this.bob.x, SEA, this.bob.z, 1.3, 'water');
        $('fish-bang').hidden = false;
      }
    } else if (st === 'bite') { // pulled under: click now!
      this.biteT -= dt;
      this.bob.set(this.target.x + Math.sin(t * 30) * 0.03, SEA - 0.12, this.target.z);
      if (this.biteT <= 0) return this.end(ctx, 'It got away… click when the bobber goes under');
    } else if (st === 'reel') { // the fight
      const f = this.fish;
      this.surgeT -= dt;
      if (this.surgeT <= 0) { this.surge = 0.25 + Math.random() * 0.35; this.surgeT = this.surge + 0.6 + Math.random() * (1.4 - f.str * 0.6); }
      const surging = this.surge > 0;
      this.surge = Math.max(0, this.surge - dt);
      this.tension += (holding ? 0.75 : -0.65) * dt + (surging ? (0.7 + 1.1 * f.str) * dt : 0) + (Math.random() - 0.5) * 0.25 * dt;
      this.tension = Math.max(0, Math.min(1, this.tension));
      const inZone = Math.abs(this.tension - ZONE_C) <= this.zoneHalf;
      this.progress += inZone ? (0.24 - 0.1 * f.str) * dt : this.tension < ZONE_C ? -0.16 * dt : -0.05 * dt;
      this.snapT = this.tension >= 0.97 ? this.snapT + dt : 0;
      $('fr-needle').style.left = `${this.tension * 100}%`;
      $('fr-catch-fill').style.width = `${Math.max(0, this.progress) * 100}%`;
      $('fr-fish').style.left = `${Math.max(0, Math.min(1, this.progress)) * 100}%`;
      $('fish-reel').classList.toggle('danger', this.tension > ZONE_C + this.zoneHalf);
      $('fish-reel').classList.toggle('good', inZone);
      // the bobber comes in toward you as the catch bar fills, thrashing while the fish surges
      const k = Math.max(0, Math.min(1, this.progress));
      this.bob.set(this.reelFrom.x + (tip.x - this.reelFrom.x) * k * 0.7 + (surging ? Math.sin(t * 40) * 0.05 : 0), SEA - (surging ? 0.06 : 0.02), this.reelFrom.z + (tip.z - this.reelFrom.z) * k * 0.7);
      if (surging && Math.random() < dt * 6) ctx.effects.impact(this.bob.x, SEA, this.bob.z, 0.4, 'water');
      if (this.snapT > 0.45) return this.end(ctx, 'Snap! The line broke: ease off when it\'s in the red');
      if (this.progress <= 0) return this.end(ctx, 'It slipped the hook: keep the line tighter');
      if (this.progress >= 1) return this.caught(ctx);
    } else if (st === 'back') { // reeling the bobber back to the rod
      this.backT += dt / 0.35;
      const k = Math.min(1, this.backT);
      this.bob.lerpVectors(this.backFrom, tip, k);
      this.bob.y += Math.sin(k * Math.PI) * 0.4;
      if (k >= 1) { this.state = 'idle'; this.line.visible = this.bobber.visible = false; ctx.char.rodPose = null; return; }
    }
    // the bobber, the line and the "!" over the bobber
    this.bobber.visible = this.line.visible = true;
    this.bobber.position.copy(this.bob);
    const pos = this.lineGeo.attributes.position, n = 13, slack = st === 'reel' ? 0.05 : st === 'wait' || st === 'bite' ? 0.35 : 0.15;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      pos.setXYZ(i, tip.x + (this.bob.x - tip.x) * k, tip.y + (this.bob.y + 0.12 - tip.y) * k - Math.sin(k * Math.PI) * slack, tip.z + (this.bob.z - tip.z) * k);
    }
    pos.needsUpdate = true;
    if (st === 'bite') {
      const s = ctx.project(this.bob.x, this.bob.y + 0.6, this.bob.z), el = $('fish-bang');
      if (s) { el.style.left = `${s[0]}px`; el.style.top = `${s[1]}px`; }
    }
  }
}
