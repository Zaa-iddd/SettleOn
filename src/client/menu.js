// Main menu: Singleplayer (a Minecraft-style world select), Multiplayer, Map editor, Settings.
// Behind it, a random island turns slowly as a diorama (its own WorldScene, disposed when the menu closes).

import * as THREE from 'three';
import { generateWorld } from '../shared/world.js';
import { encodeMap, cloneBase, blankBase, endlessMap, decodeMap, decodeEndless, isEndlessMap } from '../shared/mapfile.js';
import { WorldScene, setEditorView } from './world3d.js';
import { CharacterPanel } from './appearance.js';
import { saveNames, getSave, putSave, deleteSave, renameSave, freeName, getMeta, setMeta, saveOptions, esc } from './saves.js';

const $ = (id) => document.getElementById(id);

// ---------- menu icons: original 16×16 pixel art, drawn once into data URLs (outlined like the item icons) ----------
// `paint(x, y)` gives a CSS colour or null; a dark outline is added around whatever is painted.
function drawIcon(paint) {
  const grid = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => paint(x, y)));
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx]);
      const c = grid[y][x] ?? (near ? '#1e1612' : null);
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
  }
  return cv.toDataURL();
}
// from rows of letters (centred) and a palette
const maskIcon = (rows, pal) => drawIcon((x, y) => {
  const r = rows[y - Math.floor((16 - rows.length) / 2)];
  return r ? pal[r[x - Math.floor((16 - r.length) / 2)]] ?? null : null;
});
const MENU_ICONS = {
  // a little island with a palm tree in the sea
  play: () => maskIcon([
    '....gg..gg....', '..ggGGggGGgg..', '.gG..gGGg..Gg.', '......tg......', '......t.......', '.....t........',
    '.....t........', '..ssssssssss..', '.ssSssssssSss.', 'wwwwwwwwwwwwww', 'bbwbbbbbbbbwbb',
  ], { g: '#6fc04a', G: '#3f8a35', t: '#9a6336', s: '#ecd48e', S: '#d0b46c', w: '#8fdcef', b: '#3f8fd0' }),
  // two friends side by side
  multi: () => maskIcon([
    '..hhhh........', '.hhhhhh..HHHH.', '.hsssss.HHHHHH', '.sesses.SSSSSH', '.sssss..SeSSeS', '..ccc...SSSSS.',
    '.ccccc...DDD..', '.ccccc..DDDDD.', '.ccccc..DDDDD.',
  ], { h: '#5a3a24', s: '#f6c9a4', e: '#2a1d1a', c: '#e8554e', H: '#f0c869', S: '#e9b08a', D: '#3d8bfd' }),
  // a grass block with a shovel stuck in it
  editor: () => maskIcon([
    '..........mm', '.........mMm', '........hmm.', '.......hh...', '......hh....', 'GGGGGhhGGG..',
    'gGgggggggGg.', 'dddhddddddd.', 'ddDdddddDdd.', 'ddddddDdddd.', 'dDddddddddd.', 'ddddDddddDd.',
  ], { m: '#dfe5ea', M: '#9aa4ad', h: '#b07a48', G: '#8fd04f', g: '#5fa32f', d: '#8d5c3a', D: '#6a4329' }),
  // a brass gear: eight teeth, lit from the top left
  settings: () => drawIcon((x, y) => {
    const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (r < 2.3 || r > (Math.cos(a * 8) > 0.35 ? 7.4 : 5.6)) return null;
    return dx + dy < -3 ? '#ffe8a0' : dx + dy > 4 ? '#9a6a18' : '#e0b040';
  }),
};
const PANELS = ['menu-main', 'menu-looks', 'menu-single', 'menu-edit', 'menu-delete', 'menu-multi', 'menu-create'];
// Esc in a panel goes back to its parent
const BACK = { 'menu-looks': 'menu-main', 'menu-single': 'menu-main', 'menu-multi': 'menu-main', 'menu-create': 'menu-single', 'menu-edit': 'menu-single', 'menu-delete': 'menu-single' };

// turn free text into a seed: numbers are used as-is, anything else is hashed
export function seedFrom(text) {
  const t = String(text ?? '').trim();
  if (!t) return Math.floor(Math.random() * 2 ** 31);
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (const ch of t) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// "Today, 14:32" / "Yesterday, 09:10" / "Nov 20, 2026"
function when(ms) {
  if (!ms) return 'Never played';
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `Today, ${time}`;
  if (diff === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}, ${time}`;
}

export class Menu {
  /**
   * @param {{ pixel: import('./pixelfx.js').PixelRenderer, camera: THREE.PerspectiveCamera, getTime: () => number,
   *   inDiscord: boolean, defaultRoom: string, toast: (s: string) => void,
   *   onSingle: (map: object|null) => void, onMulti: (room: string, map: object|null) => void,
   *   onEditor: (base: object, name: string) => void, onSettings: () => void }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false;
    this.yaw = 0;
    this.selected = null; // the highlighted world in the world list
    this.panel = 'menu-main';
    this.looks = new CharacterPanel({ toast: (m) => this.toast(m) });
    this.bindUI();
  }

  show(panel = 'menu-main') {
    this.active = true;
    document.body.classList.add('in-menu');
    $('menu').hidden = false;
    $('loading').hidden = true;
    this.looks.open();
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

  /** Esc while the menu is up: back one panel. Returns true if it did something. */
  back() {
    const to = BACK[this.panel];
    if (!to) return false;
    this.go(to);
    return true;
  }

  /** Show one of the menu panels (and refresh its lists). */
  go(id) {
    this.panel = id;
    for (const p of PANELS) $(p).hidden = p !== id;
    if (id === 'menu-main') $('menu-play-single').focus({ preventScroll: true });
    if (id === 'menu-single') this.renderWorlds();
    if (id === 'menu-multi') {
      $('multi-room').value = this.defaultRoom;
      $('multi-room').disabled = this.inDiscord;
      $('multi-room-note').hidden = !this.inDiscord;
      $('multi-map').innerHTML = '<option value="">Keep the room\'s world</option>' + saveOptions(saveNames());
    }
    if (id === 'menu-create' && !this.prefill) {
      $('create-name').value = '';
      $('create-seed').value = String(Math.floor(Math.random() * 1e6));
      $('create-type').value = 'endless';
      $('create-mode').value = 'survival';
    }
    if (id === 'menu-create') {
      this.prefill = false;
      $('create-edit').disabled = $('create-type').value === 'endless';
      $('create-name').placeholder = freeName('New World');
    }
  }

  // ---------- the world list ----------

  /** Saved worlds, most recently played (or created) first. */
  worlds() {
    return saveNames().map((name) => {
      const map = getSave(name), meta = getMeta(name);
      return { name, map, meta, endless: isEndlessMap(map), recent: meta.played ?? meta.created ?? 0 };
    }).sort((a, b) => b.recent - a.recent || a.name.localeCompare(b.name));
  }

  renderWorlds() {
    const list = this.worlds();
    if (!list.some((w) => w.name === this.selected)) this.selected = list[0]?.name ?? null;
    const box = $('world-list');
    if (!list.length) {
      box.innerHTML = '<div class="world-empty">No worlds yet.<br>Create one to get started!</div>';
    } else {
      box.innerHTML = list.map((w) => {
        const type = w.endless ? 'Endless world' : 'Island';
        const seed = Number.isFinite(w.map?.seed) ? ` · Seed ${w.map.seed}` : '';
        const thumb = w.meta.thumb
          ? `<img class="world-thumb" src="${esc(w.meta.thumb)}" alt="" draggable="false" />`
          : `<span class="world-thumb none ${w.endless ? 'endless' : 'island'}"></span>`;
        return `<button class="world-row${w.name === this.selected ? ' sel' : ''}" data-name="${esc(w.name)}" role="option" aria-selected="${w.name === this.selected}">
          ${thumb}
          <span class="world-info">
            <span class="world-name">${esc(w.name)}</span>
            <span class="world-sub">${type}${seed}${w.meta.mode === 'creative' ? ' · Creative' : w.meta.mode === 'survival' ? ' · Survival' : ''}</span>
            <span class="world-sub">${w.meta.played ? `Last played: ${when(w.meta.played)}` : 'Never played'}</span>
          </span>
        </button>`;
      }).join('');
      for (const row of box.querySelectorAll('.world-row')) {
        row.onclick = () => this.select(row.dataset.name);
        row.ondblclick = () => this.playSelected();
      }
      box.querySelector('.world-row.sel')?.scrollIntoView({ block: 'nearest' });
    }
    this.updateWorldButtons();
  }

  select(name) {
    this.selected = name;
    for (const row of $('world-list').querySelectorAll('.world-row')) {
      const on = row.dataset.name === name;
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', String(on));
    }
    this.updateWorldButtons();
  }

  updateWorldButtons() {
    const none = !this.selected;
    for (const id of ['world-play', 'world-edit', 'world-delete', 'world-recreate']) $(id).disabled = none;
  }

  playSelected() {
    const map = this.selected && getSave(this.selected);
    if (map) this.onSingle(map);
  }

  /** Up / down arrows move the selection, Enter plays (only while the world list is shown). */
  key(e) {
    if (this.panel !== 'menu-single' || e.target.closest?.('input, select, textarea')) return false;
    const names = this.worlds().map((w) => w.name);
    if (!names.length) return false;
    const i = names.indexOf(this.selected);
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const j = Math.max(0, Math.min(names.length - 1, i + (e.code === 'ArrowDown' ? 1 : -1)));
      this.select(names[j]);
      $('world-list').querySelector('.world-row.sel')?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.code === 'Enter' && !e.target.closest?.('button:not(.world-row)')) { this.playSelected(); return true; }
    return false;
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
    this.looks.frame(dt, t); // your character, on the left of every menu screen
  }

  bindUI() {
    for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => this.go(b.dataset.go);
    window.addEventListener('keydown', (e) => { // arrow keys move through the main menu's buttons
      if (!this.active || this.panel !== 'menu-main' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const bs = [...document.querySelectorAll('#menu-main .mbtn')], i = bs.indexOf(document.activeElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length].focus();
      e.preventDefault();
    });
    for (const el of document.querySelectorAll('#menu-main .mb-icon[data-icon]')) el.innerHTML = `<img alt="" draggable="false" src="${MENU_ICONS[el.dataset.icon]()}" />`;
    $('menu-play-single').onclick = () => this.go('menu-single');
    $('menu-play-multi').onclick = () => this.go('menu-multi');
    $('menu-look').onclick = () => this.go('menu-looks');
    $('menu-settings').onclick = () => this.onSettings();
    $('menu-editor').onclick = () => {
      const base = cloneBase(generateWorld(Math.floor(Math.random() * 2 ** 31)).base);
      this.onEditor(base, 'My island');
    };

    // world select
    $('world-play').onclick = () => this.playSelected();
    $('world-create').onclick = () => this.go('menu-create');
    $('world-edit').onclick = () => {
      const map = this.selected && getSave(this.selected);
      if (!map) return;
      const endless = isEndlessMap(map), meta = getMeta(this.selected);
      $('edit-name').value = this.selected;
      $('edit-info').textContent = `${endless ? 'Endless world' : 'Island'}${Number.isFinite(map.seed) ? `, seed ${map.seed}` : ''}. Created ${meta.created ? when(meta.created) : 'a while ago'}.`;
      $('edit-editor').hidden = endless; // the editor only works on islands
      this.go('menu-edit');
      $('edit-name').focus();
      $('edit-name').select();
    };
    $('world-delete').onclick = () => {
      if (!this.selected) return;
      $('delete-text').innerHTML = `“${esc(this.selected)}” will be lost forever, along with the inventory you had there. (A long time!)`;
      this.go('menu-delete');
    };
    $('delete-yes').onclick = () => {
      if (this.selected) { deleteSave(this.selected); this.toast(`Deleted “${this.selected}”`); }
      this.selected = null;
      this.go('menu-single');
    };
    $('world-recreate').onclick = () => {
      const map = this.selected && getSave(this.selected);
      if (!map) return;
      this.prefill = true;
      $('create-name').value = freeName(this.selected);
      $('create-seed').value = Number.isFinite(map.seed) ? String(map.seed) : String(Math.floor(Math.random() * 1e6));
      $('create-type').value = isEndlessMap(map) ? 'endless' : 'random';
      $('create-mode').value = getMeta(this.selected).mode === 'creative' ? 'creative' : 'survival';
      this.go('menu-create');
    };
    $('world-import').onclick = () => $('world-file').click();
    $('world-file').onchange = async () => {
      const file = $('world-file').files?.[0];
      $('world-file').value = '';
      if (!file) return;
      try {
        const map = JSON.parse(await file.text());
        if (isEndlessMap(map)) decodeEndless(map); else decodeMap(map); // throws on a bad file
        const name = freeName(map.name || file.name.replace(/\.settleon\.json$|\.json$/i, '') || 'Imported world');
        if (!putSave(name, { ...map, name })) return this.toast("This browser won't store worlds here");
        this.selected = name;
        this.renderWorlds();
        this.toast(`Imported “${name}”`);
      } catch (err) {
        this.toast(`Couldn't import that file: ${err.message ?? err}`);
      }
    };

    // edit world
    const saveEdit = () => {
      const to = $('edit-name').value.trim();
      const err = renameSave(this.selected, to);
      if (err) return this.toast(err);
      this.selected = to.slice(0, 40);
      this.go('menu-single');
    };
    $('edit-save').onclick = saveEdit;
    $('edit-name').onkeydown = (e) => { if (e.code === 'Enter') saveEdit(); };
    $('edit-editor').onclick = () => {
      const map = getSave(this.selected);
      try { this.onEditor(decodeMap(map), this.selected); } catch (err) { this.toast(`Couldn't open it: ${err.message ?? err}`); }
    };
    $('edit-export').onclick = () => {
      const map = getSave(this.selected);
      if (!map) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(map)], { type: 'application/json' }));
      a.download = `${this.selected.replace(/[^\w -]/g, '_')}.settleon.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    // multiplayer
    $('multi-join').onclick = () => {
      const room = this.inDiscord ? this.defaultRoom : $('multi-room').value.trim().replace(/[^\w-]/g, '').slice(0, 64);
      if (!room) return this.toast('Enter a room code');
      const name = $('multi-map').value;
      this.onMulti(room, name ? getSave(name) : null);
    };
    $('multi-random-room').onclick = () => { $('multi-room').value = Math.random().toString(36).slice(2, 8); };

    // create world
    $('create-dice').onclick = () => { $('create-seed').value = String(Math.floor(Math.random() * 1e6)); };
    const create = () => {
      const typed = $('create-name').value.trim().slice(0, 40);
      if (typed && getSave(typed)) { this.toast('A world with that name already exists'); return null; }
      const name = typed || freeName('New World');
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
      setMeta(name, { mode: $('create-mode').value === 'creative' ? 'creative' : 'survival' });
      this.selected = name;
      return { base, map, name };
    };
    $('create-play').onclick = () => { const c = create(); if (c) this.onSingle(c.map); };
    $('create-edit').onclick = () => {
      if ($('create-type').value === 'endless') return this.toast("Endless worlds can't be edited. Pick an island type to use the map editor.");
      const c = create();
      if (c) this.onEditor(c.base, c.name);
    };
    // the editor only works on islands
    $('create-type').onchange = () => { $('create-edit').disabled = $('create-type').value === 'endless'; };
  }
}
