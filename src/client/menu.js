// Main menu: Play singleplayer, Multiplayer, Create world, Map editor. Behind it, a random
// island turns slowly as a diorama (its own WorldScene, disposed when the menu closes).

import * as THREE from 'three';
import { generateWorld } from '../shared/world.js';
import { encodeMap, cloneBase, blankBase, endlessMap } from '../shared/mapfile.js';
import { WorldScene, setEditorView } from './world3d.js';
import { saveNames, getSave, putSave, saveOptions } from './saves.js';

const $ = (id) => document.getElementById(id);
const PANELS = ['menu-main', 'menu-single', 'menu-multi', 'menu-create'];
// singleplayer list entries that aren't saved worlds
const NEW_ENDLESS = '\u0001endless', NEW_ISLAND = '\u0001island';

// turn free text into a seed: numbers are used as-is, anything else is hashed
export function seedFrom(text) {
  const t = String(text ?? '').trim();
  if (!t) return Math.floor(Math.random() * 2 ** 31);
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (const ch of t) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class Menu {
  /**
   * @param {{ pixel: import('./pixelfx.js').PixelRenderer, camera: THREE.PerspectiveCamera, getTime: () => number,
   *   inDiscord: boolean, defaultRoom: string, toast: (s: string) => void,
   *   onSingle: (map: object|null) => void, onMulti: (room: string, map: object|null) => void,
   *   onEditor: (base: object, name: string) => void }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false;
    this.yaw = 0;
    this.bindUI();
  }

  show(panel = 'menu-main') {
    this.active = true;
    document.body.classList.add('in-menu');
    $('menu').hidden = false;
    $('loading').hidden = true;
    this.go(panel);
    if (!this.scene) {
      this.world = generateWorld(Math.floor(Math.random() * 2 ** 31));
      this.scene = new WorldScene(this.world);
      this.scene.setTimeOfDay(this.getTime());
      this.camera.far = 320;
      this.camera.updateProjectionMatrix();
    }
  }

  hide() {
    this.active = false;
    document.body.classList.remove('in-menu');
    $('menu').hidden = true;
    this.scene?.dispose();
    this.scene = null;
    this.camera.far = 110;
    this.camera.updateProjectionMatrix();
  }

  /** Show one of the menu panels (and refresh its lists). */
  go(id) {
    for (const p of PANELS) $(p).hidden = p !== id;
    const names = saveNames();
    if (id === 'menu-single') {
      $('single-world').innerHTML = `<option value="${NEW_ENDLESS}">New endless world</option><option value="${NEW_ISLAND}">Random island</option>` + saveOptions(names);
    }
    if (id === 'menu-multi') {
      $('multi-room').value = this.defaultRoom;
      $('multi-room').disabled = this.inDiscord;
      $('multi-room-note').hidden = !this.inDiscord;
      $('multi-map').innerHTML = '<option value="">Keep the room\'s world</option>' + saveOptions(names);
    }
    if (id === 'menu-create') {
      $('create-name').value = '';
      $('create-seed').value = String(Math.floor(Math.random() * 1e6));
      $('create-edit').disabled = $('create-type').value === 'endless';
    }
  }

  /** Slowly circle the island. */
  frame(dt, t) {
    this.yaw += dt * 0.05;
    const dist = 46, pitch = 0.62;
    const focus = new THREE.Vector3(this.world.camp.x * 0.3, 2.5, this.world.camp.z * 0.3);
    this.camera.position.set(focus.x + Math.sin(this.yaw) * Math.cos(pitch) * dist, focus.y + Math.sin(pitch) * dist, focus.z + Math.cos(this.yaw) * Math.cos(pitch) * dist);
    this.camera.lookAt(focus);
    this.camera.updateMatrixWorld();
    const pixel = this.pixel;
    pixel.setZoom(14); // keep the chunky pixel look for the title diorama
    pixel.setTiltShift(1);
    this.scene.cloudRes.value.set(pixel.rt.width, pixel.rt.height);
    this.scene.update(t, dt, focus, 20);
    setEditorView();
    pixel.render(this.scene.scene, this.camera);
  }

  bindUI() {
    for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => this.go(b.dataset.go);
    $('menu-play-single').onclick = () => this.go('menu-single');
    $('menu-play-multi').onclick = () => this.go('menu-multi');
    $('menu-create-world').onclick = () => this.go('menu-create');
    $('menu-editor').onclick = () => {
      const base = cloneBase(generateWorld(Math.floor(Math.random() * 2 ** 31)).base);
      this.onEditor(base, 'My island');
    };

    $('single-play').onclick = () => {
      const name = $('single-world').value;
      if (name === NEW_ENDLESS) return this.onSingle(null);
      if (name === NEW_ISLAND) return this.onSingle(encodeMap(generateWorld(Math.floor(Math.random() * 2 ** 31)).base, 'Random island'));
      this.onSingle(getSave(name));
    };

    $('multi-join').onclick = () => {
      const room = this.inDiscord ? this.defaultRoom : $('multi-room').value.trim().replace(/[^\w-]/g, '').slice(0, 64);
      if (!room) return this.toast('Enter a room code');
      const name = $('multi-map').value;
      this.onMulti(room, name ? getSave(name) : null);
    };
    $('multi-random-room').onclick = () => { $('multi-room').value = Math.random().toString(36).slice(2, 8); };

    $('create-dice').onclick = () => { $('create-seed').value = String(Math.floor(Math.random() * 1e6)); };
    const create = () => {
      const name = ($('create-name').value.trim() || `World ${saveNames().length + 1}`).slice(0, 40);
      const seed = seedFrom($('create-seed').value);
      const type = $('create-type').value;
      let base = null, map;
      if (type === 'endless') map = endlessMap(name, seed); // generated as you explore: only the seed is stored
      else {
        base = type === 'blank' ? blankBase(seed) : cloneBase(generateWorld(seed).base);
        base.name = name;
        map = encodeMap(base, name);
      }
      if (!putSave(name, map)) this.toast("This browser won't store worlds here, so it can't be kept after you leave");
      return { base, map, name };
    };
    $('create-play').onclick = () => this.onSingle(create().map);
    $('create-edit').onclick = () => {
      if ($('create-type').value === 'endless') return this.toast("Endless worlds can't be edited. Pick an island type to use the map editor.");
      const c = create();
      this.onEditor(c.base, c.name);
    };
    // the editor only works on islands
    $('create-type').onchange = () => { $('create-edit').disabled = $('create-type').value === 'endless'; };
  }
}
