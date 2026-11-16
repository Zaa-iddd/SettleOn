// Map editor mode: sculpt terrain, paint ground kinds, place trees/rocks/ruins and the campfire,
// then save the map in the browser, export/import it as a file, or play it in the current room
// (the server sends it to everyone there). Uses the same renderer and camera as the game, with
// a free-panning overhead camera instead of the follow camera.

import * as THREE from 'three';
import { finishWorld, generateWorld, WORLD, STEP, SEA, K, toWorld, toCell, inWorld, TREE_SCALE } from '../shared/world.js';
import { encodeMap, decodeMap, cloneBase, blankBase, MAX_LEVEL, MAX_RUINS } from '../shared/mapfile.js';
import { WorldScene, setEditorView } from './world3d.js';
import { allSaves, putSave, deleteSave, saveOptions, saveNames } from './saves.js';

const $ = (id) => document.getElementById(id);
const CAM_PITCH = 0.66;
const UNDO_LIMIT = 40;

// tools: [id, label, group, colour for the brush outline]
const TOOLS = [
  ['raise', 'Raise', 'Terrain', 0xffe08a], ['lower', 'Lower', 'Terrain', 0xffe08a], ['flatten', 'Flatten', 'Terrain', 0xffe08a],
  ['paint:' + K.GRASS, 'Grass', 'Ground', 0x7fbf4f], ['paint:' + K.FOREST, 'Forest', 'Ground', 0x46823c], ['paint:' + K.DEEP, 'Deep forest', 'Ground', 0x224a28],
  ['paint:' + K.SAND, 'Sand', 'Ground', 0xe8d9a0], ['paint:' + K.ROCK, 'Rock', 'Ground', 0x8f8a80], ['paint:' + K.SNOW, 'Snow', 'Ground', 0xf2f4f6], ['paint:' + K.PATH, 'Path', 'Ground', 0xd6cdb4],
  ['tree:leafy', 'Tree', 'Objects', 0x9fd752], ['tree:pine', 'Pine', 'Objects', 0x478a47], ['tree:redwood', 'Redwood', 'Objects', 0xa45a3a],
  ['rock', 'Rock', 'Objects', 0xc9c4ba], ['ruin', 'Ruin', 'Objects', 0x7ef0ff], ['camp', 'Campfire', 'Objects', 0xff8c2a], ['erase', 'Erase', 'Objects', 0xff6a6a],
];

export class Editor {
  /**
   * @param {{ pixel: import('./pixelfx.js').PixelRenderer, camera: THREE.PerspectiveCamera,
   *   onPlay: (map: object) => void, onExit: () => void, toast: (s: string) => void, getTime: () => number }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.active = false;
    this.tool = 'raise';
    this.brush = 2;
    this.cam = { focus: new THREE.Vector3(), dist: 34, yaw: 0, yawTarget: 0 };
    this.keys = new Set();
    this.undo = [];
    this.redo = [];
    this.stroke = null;
    this.hover = null;
    this.cursor = makeCursor();
    this.buildUI();
    this.bindInput();
  }

  // ---------- open / close ----------

  /** Start editing a copy of `base`. */
  open(base, name) {
    this.active = true;
    document.body.classList.add('editing');
    $('editor').hidden = false;
    this.refreshSaves();
    this.load(cloneBase(base), name ?? base.name ?? 'My island');
    this.camera.far = 320;
    this.camera.updateProjectionMatrix();
  }

  close() {
    this.active = false;
    document.body.classList.remove('editing');
    $('editor').hidden = true;
    this.scene?.dispose();
    this.scene = null;
    this.camera.far = 110;
    this.camera.updateProjectionMatrix();
    this.onExit();
  }

  load(base, name) {
    this.base = base;
    this.undo = [];
    this.redo = [];
    $('ed-name').value = name;
    this.rebuild();
    const c = this.world.camp;
    this.cam.focus.set(c.x, c.y, c.z);
    this.cam.dist = 34;
  }

  /** Regenerate the full world (foliage, positions) and its 3D scene from the base. */
  rebuild() {
    this.world = finishWorld(this.base);
    this.scene?.dispose();
    this.scene = new WorldScene(this.world);
    this.scene.setTimeOfDay(this.getTime());
    this.scene.scene.add(this.cursor);
    this.needsRebuild = false;
  }

  // ---------- per frame ----------

  frame(dt, t) {
    const cam = this.cam;
    // keyboard pan in screen directions (turned by the camera yaw), speed grows with zoom
    cam.yaw += (cam.yawTarget - cam.yaw) * (1 - Math.exp(-dt * 10));
    const sp = cam.dist * 0.9 * dt;
    const k = this.keys;
    const sx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.panScreen(sx * sp, sz * sp);
    cam.focus.x = THREE.MathUtils.clamp(cam.focus.x, -WORLD * 0.6, WORLD * 0.6);
    cam.focus.z = THREE.MathUtils.clamp(cam.focus.z, -WORLD * 0.6, WORLD * 0.6);
    const ground = Math.max(this.world.H(toCell(cam.focus.x), toCell(cam.focus.z)), SEA);
    cam.focus.y += (ground - cam.focus.y) * (1 - Math.exp(-dt * 4));

    const camera = this.camera;
    const flat = Math.cos(CAM_PITCH) * cam.dist;
    camera.position.set(cam.focus.x + Math.sin(cam.yaw) * flat, cam.focus.y + Math.sin(CAM_PITCH) * cam.dist, cam.focus.z + Math.cos(cam.yaw) * flat);
    camera.lookAt(cam.focus);
    camera.updateMatrixWorld();

    // held raise/lower keeps stepping
    if (this.stroke && (this.tool === 'raise' || this.tool === 'lower') && t - this.stroke.lastApply > 0.16) this.apply(t);

    const pixel = this.pixel;
    pixel.setZoom(cam.dist);
    pixel.setTiltShift(0);
    this.scene.cloudRes.value.set(pixel.rt.width, pixel.rt.height);
    this.scene.update(t, dt, cam.focus, cam.dist);
    this.scene.cloudMat.uniforms.uOpacity.value = 0; // clouds would only get in the way here
    setEditorView();
    this.updateCursor();
    pixel.render(this.scene.scene, camera);
  }

  /** Move the camera focus by (right, up) in screen directions. */
  panScreen(right, up) {
    const y = this.cam.yaw;
    this.cam.focus.x += Math.cos(y) * right - Math.sin(y) * up;
    this.cam.focus.z += -Math.sin(y) * right - Math.cos(y) * up;
  }

  // ---------- editing ----------

  cellsInBrush(cx, cz) {
    const out = [], r = this.brush - 1;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (inWorld(cx + dx, cz + dz)) out.push([cx + dx, cz + dz]);
    return out;
  }

  startStroke(t) {
    if (!this.hover) return;
    this.pushUndo();
    const [ix, iz] = this.hover;
    this.stroke = { lastCell: -1, lastApply: -1, flat: Math.round(this.base.heights[iz * WORLD + ix] / STEP) * STEP };
    this.apply(t);
  }

  endStroke() {
    if (!this.stroke) return;
    this.stroke = null;
    if (this.needsRebuild) this.rebuild();
  }

  /** Apply the current tool at the hovered cell. */
  apply(t) {
    const st = this.stroke;
    if (!st || !this.hover) return;
    const [cx, cz] = this.hover, key = cz * WORLD + cx;
    const repeat = this.tool === 'raise' || this.tool === 'lower';
    if (key === st.lastCell && !(repeat && t - st.lastApply > 0.16)) return;
    st.lastCell = key;
    st.lastApply = t;
    const b = this.base, tool = this.tool;
    const cells = this.cellsInBrush(cx, cz);

    if (repeat || tool === 'flatten') {
      for (const [ix, iz] of cells) {
        const i = iz * WORLD + ix;
        const h = tool === 'flatten' ? st.flat : b.heights[i] + (tool === 'raise' ? STEP : -STEP);
        b.heights[i] = THREE.MathUtils.clamp(Math.round(h / STEP) * STEP, 0, MAX_LEVEL * STEP);
        fixKind(b, i);
      }
      this.scene.updateTerrain();
      this.needsRebuild = true;
      return;
    }
    if (tool.startsWith('paint:')) {
      const kind = Number(tool.slice(6));
      for (const [ix, iz] of cells) {
        const i = iz * WORLD + ix;
        if (b.heights[i] >= SEA) b.kinds[i] = kind;
      }
      this.scene.updateTerrain();
      this.needsRebuild = true;
      return;
    }
    const taken = new Set([...b.trees, ...b.rocks].map((o) => o.iz * WORLD + o.ix));
    const land = (ix, iz) => b.heights[iz * WORLD + ix] >= SEA;
    const nearCamp = (ix, iz, r) => Math.hypot(ix - b.camp.ix, iz - b.camp.iz) < r;
    if (tool.startsWith('tree:') || tool === 'rock') {
      const type = tool.slice(5);
      const scatter = cells.length > 1;
      for (const [ix, iz] of cells) {
        if (taken.has(iz * WORLD + ix) || !land(ix, iz) || nearCamp(ix, iz, 1.5)) continue;
        if (scatter && Math.random() > (type === 'redwood' ? 0.22 : 0.3)) continue;
        if (type === 'redwood' && b.trees.some((o) => o.type === 'redwood' && Math.hypot(o.ix - ix, o.iz - iz) < 2.1)) continue;
        if (tool === 'rock') b.rocks.push({ ix, iz, s: 0.25 + Math.random() * 0.3 });
        else b.trees.push({ ix, iz, type, s: type === 'redwood' ? 0.82 + Math.random() * 0.24 : (0.8 + Math.random() * 0.6) * TREE_SCALE * (type === 'pine' && b.kinds[iz * WORLD + ix] === K.ROCK ? 0.8 : 1) });
        taken.add(iz * WORLD + ix);
      }
    } else if (tool === 'ruin') {
      if (b.ruins.length >= MAX_RUINS) return this.toast(`An island can have up to ${MAX_RUINS} ruins`);
      if (b.ruins.some((r) => Math.hypot(r.ix - cx, r.iz - cz) < 7)) return this.toast('Too close to another ruin');
      if (!land(cx, cz)) return;
      b.ruins.push({ ix: cx, iz: cz });
      clearAround(b, cx, cz, 3.5);
    } else if (tool === 'camp') {
      if (!land(cx, cz)) return this.toast('The campfire needs dry land');
      b.camp = { ix: cx, iz: cz };
      clearAround(b, cx, cz, 2);
    } else if (tool === 'erase') {
      const inBrush = new Set(cells.map(([x, z]) => z * WORLD + x));
      b.trees = b.trees.filter((o) => !inBrush.has(o.iz * WORLD + o.ix));
      b.rocks = b.rocks.filter((o) => !inBrush.has(o.iz * WORLD + o.ix));
      b.ruins = b.ruins.filter((r) => Math.max(Math.abs(r.ix - cx), Math.abs(r.iz - cz)) > this.brush + 1);
    }
    this.needsRebuild = true;
    // object tools: rebuild right away for single clicks, at the end of a drag otherwise
    if (!this.stroke || this.tool === 'ruin' || this.tool === 'camp') this.rebuild();
  }

  pushUndo() {
    this.undo.push(cloneBase(this.base));
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
    this.redo = [];
  }

  undoRedo(back) {
    const from = back ? this.undo : this.redo, to = back ? this.redo : this.undo;
    if (!from.length) return;
    to.push(cloneBase(this.base));
    this.base = from.pop();
    this.rebuild();
  }

  // ---------- picking + cursor ----------

  pick(px, py) {
    const ndc = new THREE.Vector2((px / this.pixel.cssW) * 2 - 1, -(py / this.pixel.cssH) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction, H = this.world.H;
    for (let t = 0.5; t < 300; t += 0.1) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const ix = toCell(x), iz = toCell(z);
      if (y <= Math.max(inWorld(ix, iz) ? H(ix, iz) : 0, SEA)) return inWorld(ix, iz) ? [ix, iz] : null;
    }
    return null;
  }

  updateCursor() {
    const c = this.cursor;
    if (!this.hover) { c.visible = false; return; }
    const [ix, iz] = this.hover;
    const size = this.tool === 'ruin' ? 5 : this.tool === 'camp' ? 1 : this.brush * 2 - 1;
    c.visible = true;
    c.scale.set(size, 1, size);
    c.position.set(toWorld(ix), Math.max(this.world.H(ix, iz), SEA) + 0.06, toWorld(iz));
    c.userData.mat.color.setHex(TOOLS.find((tl) => tl[0] === this.tool)[3]);
    const i = iz * WORLD + ix;
    const kindName = Object.keys(K).find((n) => K[n] === this.world.kinds[i]).toLowerCase();
    $('ed-hint').textContent = `(${ix}, ${iz}) · height ${this.world.heights[i].toFixed(1)} · ${kindName}`;
  }

  // ---------- UI ----------

  buildUI() {
    const tools = $('ed-tools');
    let group = '';
    for (const [id, label, g, col] of TOOLS) {
      if (g !== group) {
        group = g;
        tools.insertAdjacentHTML('beforeend', `<div class="ed-group">${g}</div>`);
      }
      const btn = document.createElement('button');
      btn.className = 'ed-tool';
      btn.dataset.tool = id;
      btn.innerHTML = `<i style="background:#${col.toString(16).padStart(6, '0')}"></i>${label}`;
      btn.onclick = () => this.setTool(id);
      tools.append(btn);
    }
    tools.insertAdjacentHTML('beforeend', `<div class="ed-group">Brush <span id="ed-brush-n">2</span></div>
      <input id="ed-brush" type="range" min="1" max="8" value="2" tabindex="-1" aria-label="Brush size" />`);
    $('ed-brush').oninput = (e) => { this.brush = Number(e.target.value); $('ed-brush-n').textContent = this.brush; };
    this.setTool('raise');

    $('ed-new-blank').onclick = () => this.confirmDiscard() && this.load(blankBase(), 'New island');
    $('ed-new-random').onclick = () => {
      if (!this.confirmDiscard()) return;
      const base = cloneBase(generateWorld(Math.floor(Math.random() * 2 ** 31)).base);
      this.load(base, 'Random island');
    };
    $('ed-save').onclick = () => this.save();
    $('ed-load').onclick = () => this.loadSaved();
    $('ed-delete').onclick = () => this.deleteSaved();
    $('ed-export').onclick = () => this.exportFile();
    $('ed-import').onclick = () => $('ed-file').click();
    $('ed-file').onchange = (e) => this.importFile(e.target.files[0]);
    $('ed-undo').onclick = () => this.undoRedo(true);
    $('ed-redo').onclick = () => this.undoRedo(false);
    $('ed-play').onclick = () => {
      if (this.needsRebuild) this.rebuild();
      this.onPlay(encodeMap(this.base, $('ed-name').value || 'My island'));
    };
    $('ed-exit').onclick = () => this.close();
    this.refreshSaves();
  }

  setTool(id) {
    this.tool = id;
    for (const b of document.querySelectorAll('.ed-tool')) b.classList.toggle('on', b.dataset.tool === id);
  }

  confirmDiscard() {
    return !this.undo.length || confirm('Start a new map? Unsaved changes will be lost.');
  }

  saves() {
    return allSaves();
  }

  refreshSaves() {
    const names = saveNames();
    $('ed-saves').innerHTML = names.length ? saveOptions(names) : '<option value="">(no saved maps)</option>';
  }

  save() {
    const name = ($('ed-name').value || 'My island').trim().slice(0, 40);
    if (putSave(name, encodeMap(this.base, name))) this.toast(`Saved "${name}" in this browser`);
    else this.toast("Couldn't save here (storage is full or blocked). Use Export instead.");
    this.refreshSaves();
    $('ed-saves').value = name;
  }

  loadSaved() {
    const name = $('ed-saves').value, map = this.saves()[name];
    if (!map || !this.confirmDiscard()) return;
    try { this.load(decodeMap(map), name); } catch (err) { this.toast(`Couldn't load: ${err.message}`); }
  }

  deleteSaved() {
    const name = $('ed-saves').value;
    if (!this.saves()[name] || !confirm(`Delete the saved map "${name}"?`)) return;
    deleteSave(name);
    this.refreshSaves();
  }

  exportFile() {
    const name = ($('ed-name').value || 'island').trim();
    const blob = new Blob([JSON.stringify(encodeMap(this.base, name))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^\w-]+/g, '_') || 'island'}.settleon.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async importFile(file) {
    $('ed-file').value = '';
    if (!file) return;
    try {
      const base = decodeMap(JSON.parse(await file.text()));
      if (!this.confirmDiscard()) return;
      this.load(base, base.name);
    } catch (err) {
      this.toast(`That file isn't a SettleOn map (${err.message})`);
    }
  }

  // ---------- input ----------

  bindInput() {
    const canvas = this.pixel.canvas;
    let panning = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.button === 1 || e.button === 2) { panning = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
      if (e.button === 0) {
        this.hover = this.pickEvent(e);
        this.startStroke(performance.now() / 1000);
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (panning) {
        const s = this.cam.dist * 0.0022;
        this.panScreen(-(e.clientX - panning.x) * s, (e.clientY - panning.y) * s / Math.sin(CAM_PITCH));
        panning = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.target !== canvas && !this.stroke) { this.hover = null; return; }
      this.hover = this.pickEvent(e);
      if (this.stroke) this.apply(performance.now() / 1000);
    });
    window.addEventListener('pointerup', () => {
      panning = null;
      if (this.active) this.endStroke();
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this.cam.dist = THREE.MathUtils.clamp(this.cam.dist * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 8, 80);
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.undoRedo(!e.shiftKey); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); this.undoRedo(false); return; }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        this.brush = THREE.MathUtils.clamp(this.brush + (e.code === 'BracketRight' ? 1 : -1), 1, 8);
        $('ed-brush').value = this.brush;
        $('ed-brush-n').textContent = this.brush;
        return;
      }
      if (!e.repeat && (e.code === 'KeyQ' || e.code === 'KeyE')) this.cam.yawTarget += (e.code === 'KeyQ' ? -1 : 1) * (Math.PI / 4);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  pickEvent(e) {
    const r = this.pixel.canvas.getBoundingClientRect();
    return this.pick(e.clientX - r.left, e.clientY - r.top);
  }
}

// keep ground kinds consistent with the water line after a height change
function fixKind(b, i) {
  if (b.heights[i] < SEA) b.kinds[i] = K.SEABED;
  else if (b.kinds[i] === K.SEABED) b.kinds[i] = b.heights[i] <= SEA + 0.3 ? K.SAND : K.GRASS;
}

// remove trees and rocks within r cells of (cx, cz)
function clearAround(b, cx, cz, r) {
  const keep = (o) => Math.hypot(o.ix - cx, o.iz - cz) > r;
  b.trees = b.trees.filter(keep);
  b.rocks = b.rocks.filter(keep);
}

// a square outline one cell wide (scaled to the brush size), drawn on top of everything
function makeCursor() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, depthTest: false, transparent: true, opacity: 0.9 });
  const g = new THREE.Group();
  const bar = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), mat); m.position.set(x, 0, z); m.renderOrder = 40; g.add(m); };
  const t = 0.06;
  bar(1, t, 0, -0.5); bar(1, t, 0, 0.5); bar(t, 1, -0.5, 0); bar(t, 1, 0.5, 0);
  g.userData.mat = mat;
  g.traverse((o) => { if (o.geometry) o.geometry.userData.shared = true; });
  g.visible = false;
  return g;
}
