// The character panel of the main menu: gender, skin, face (eyes), hair and facial hair, each with its colour,
// beside a live 3D preview you can turn by dragging. Clothes are not here on purpose: they're crafted in game
// (see outfit.js and inventory.js). The look is kept per browser (`settleon.look`) and sent to the room on joining.

import * as THREE from 'three';
import { makeCharacter, animateCharacter, ANIM } from './character.js';
import {
  GENDERS, SKIN_TONES, HAIR_COLORS, EYE_COLORS, HAIR_STYLES, FACIAL_HAIR, FACES, cleanLook, defaultLook, randomLook,
} from '../shared/outfit.js';
import { PLAYER_COLORS } from '../shared/world.js';

const KEY = 'settleon.look';
const $ = (id) => document.getElementById(id);
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** The look chosen in the menu, or null when the player never picked one (then the default for their id is used). */
export function loadLook() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY));
    return o ? cleanLook(o) : null;
  } catch { return null; }
}
export function saveLook(look) {
  try { localStorage.setItem(KEY, JSON.stringify(look)); } catch {}
}

const swatches = (key, colors, cur) => `<span class="look-swatches">${colors.map((c) => `<button class="look-sw${c === cur ? ' on' : ''}" data-key="${key}" data-v="${c}" style="background:${hex(c)}" title="${hex(c)}" tabindex="-1"></button>`).join('')}`
  + `<input type="color" class="look-pick${colors.includes(cur) ? '' : ' on'}" data-key="${key}" value="${hex(cur)}" title="Pick any colour" tabindex="-1" /></span>`;
const stepper = (key, names, cur) => `<span class="look-step"><button class="btn" data-key="${key}" data-d="-1" tabindex="-1">&lt;</button><b>${names[cur]}</b><button class="btn" data-key="${key}" data-d="1" tabindex="-1">&gt;</button></span>`;
const row = (label, html) => `<div class="look-row"><span class="look-label">${label}</span>${html}</div>`;

/**
 * A small live 3D view of a character on a wooden plinth, in its own tiny WebGL renderer (made on first use), turned
 * by dragging. Used by the menu's Character panel and the inventory's Wardrobe page. The silhouette twins are hidden:
 * they need the game's stencil buffer.
 */
export class CharacterPreview {
  constructor(canvas, { camY = 0.6, dist = 2.35, aimY = 0.46 } = {}) {
    this.canvas = canvas;
    this.view = { camY, dist, aimY };
    this.yaw = 0.4;
    this.drag = null;
    this.key = null;
    canvas.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, yaw: this.yaw }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.drag) this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012; });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
  }

  setup() {
    if (this.renderer || this.failed) return !this.failed;
    try {
      const cv = this.canvas;
      this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(cv.width, cv.height, false);
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight(0xe6efff, 0x9a8a72, 2.1));
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
      sun.position.set(-1.2, 2, 2.4);
      this.scene.add(sun);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.06, 14), new THREE.MeshLambertMaterial({ color: 0x8a5a34 }));
      plinth.position.y = -0.03;
      this.scene.add(plinth);
      const { camY, dist, aimY } = this.view;
      this.camera = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.1, 20);
      this.camera.position.set(0, camY, dist);
      this.camera.lookAt(0, aimY, 0);
    } catch {
      this.failed = true;
      this.canvas.hidden = true;
    }
    return !this.failed;
  }

  /** Show this look wearing these clothes (rebuilt only when either changes). */
  set(look, wear, color = PLAYER_COLORS[0]) {
    const key = JSON.stringify([look, wear, color]);
    if (key === this.key || !this.setup()) return;
    this.key = key;
    if (this.char) this.scene.remove(this.char.root);
    this.char = makeCharacter('you', color, look, wear);
    this.char.root.traverse((o) => { if (o.userData.ghost) o.visible = false; });
    this.scene.add(this.char.root);
  }

  /** Draw one frame: idle breathing and blinking, a gentle sway unless it's being dragged. */
  frame(dt, t) {
    if (!this.renderer || !this.char) return;
    animateCharacter(this.char, ANIM.IDLE, 0, dt, t);
    this.char.root.rotation.y = this.yaw + (this.drag ? 0 : Math.sin(t * 0.7) * 0.25);
    this.renderer.render(this.scene, this.camera);
  }
}

export class CharacterPanel {
  constructor({ toast }) {
    this.toast = toast;
    this.look = loadLook() ?? defaultLook('you');
    this.preview = new CharacterPreview($('look-canvas'));
    $('look-options').addEventListener('click', (e) => this.click(e));
    $('look-options').addEventListener('input', (e) => {
      if (!e.target.classList.contains('look-pick')) return;
      this.set(e.target.dataset.key, parseInt(e.target.value.slice(1), 16), false);
    });
    $('look-random').onclick = () => { this.look = randomLook(); this.changed(); };
  }

  /** The menu opened this panel: show your saved look, and start drawing the preview. */
  open() {
    this.look = loadLook() ?? this.look;
    this.render();
    this.rebuild();
  }

  rebuild() {
    this.preview.set(this.look, import.meta.env.DEV ? window.__previewWear ?? null : null); // dev only: __previewWear shows clothes for testing
  }

  /** Draw one frame of the preview (called by the menu while the panel is up). */
  frame(dt, t) { this.preview.frame(dt, t); }

  click(e) {
    const b = e.target.closest('button');
    if (!b || !b.dataset.key) return;
    const key = b.dataset.key;
    if (b.classList.contains('look-sw')) return this.set(key, Number(b.dataset.v));
    if (b.dataset.d) {
      const n = { hs: HAIR_STYLES, fh: FACIAL_HAIR, face: FACES }[key].length;
      return this.set(key, (this.look[key] + Number(b.dataset.d) + n) % n);
    }
    if (b.dataset.v !== undefined) this.set(key, Number(b.dataset.v)); // gender buttons
  }

  set(key, v, redraw = true) {
    if (key === 'hair' && this.look.fc === this.look.hair) this.look.fc = v; // matching facial hair follows the hair colour
    this.look[key] = v;
    this.look = cleanLook(this.look);
    saveLook(this.look);
    this.rebuild();
    if (redraw) this.render();
  }

  changed() {
    saveLook(this.look);
    this.render();
    this.rebuild();
  }

  render() {
    const L = this.look;
    $('look-options').innerHTML = [
      row('Gender', `<span class="look-seg">${GENDERS.map((g, i) => `<button class="btn${L.g === i ? ' accent' : ''}" data-key="g" data-v="${i}" tabindex="-1">${g}</button>`).join('')}</span>`),
      row('Skin', swatches('skin', SKIN_TONES, L.skin)),
      row('Face', stepper('face', FACES, L.face)),
      row('Eyes', swatches('eyes', EYE_COLORS, L.eyes)),
      row('Hair', stepper('hs', HAIR_STYLES, L.hs)),
      row('Hair colour', swatches('hair', HAIR_COLORS, L.hair)),
      row('Facial hair', stepper('fh', FACIAL_HAIR, L.fh)),
      row('Facial hair colour', swatches('fc', HAIR_COLORS, L.fc)),
    ].join('');
  }
}
