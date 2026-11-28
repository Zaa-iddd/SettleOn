import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import * as THREE from 'three';
import PartySocket from 'partysocket';
import { finishWorld, spawnPoint, groundAt, toCell, toWorld, WORLD, SEA, STEP, K, cellKey, keyX, keyZ, PICK, isWood, PILE_MAX, FURNITURE, clockHour } from '../shared/world.js';
import { createEndlessWorld } from '../shared/endless.js';
import { decodeMap, isEndlessMap, decodeEndless, endlessMap, encodeMap, cleanEdits, cleanChops, cleanBenches, cleanPicks, cleanPiles, cleanBoats } from '../shared/mapfile.js';
import { WAVE_DIR, waveAt } from './waves.js';
// how the swell handles a boat you sail (scaled by how rough the sea is there): top speed lost heading straight into
// it / gained running with it, the push down a wave's slope (tiles/s² per unit of slope), and the drift (tiles/s)
const WAVE_HEAD_SLOW = 0.15, WAVE_FOLLOW = 0.06, WAVE_PUSH = 9, WAVE_DRIFT = 0.22;
import { Boats, BOAT, canStep, PIRATE_PARTS, PIRATE_PART_INDEX, slotsOf, upgradeOffered, hullContact, THROTTLE, UPGRADES, upgradeFor, CABINS, ROOFS, TOPS, MASTS, PROPS, DECK_SLOTS, layoutOf, propAt, engineFactor, rudderFactor, walkable, nearestWalkable, onDeck, toLocal, toWorldXZ, deckY, hullClear, boatHit, HULLS, DECO_SCALE, deckReach, decoFits, decoFoot, hullOf, blueprintGeometry, blueprintLines, resizeLook, SIZE_LEN, SIZE_H, SPLIT } from './boat.js';
import { getSave, putSave, setMeta, getMeta } from './saves.js';
import { Settings } from './settings.js';
import { Inventory, ITEMS, HOTBAR, iconURL } from './inventory.js';
import { BOAT_PALETTE, PAINT_SLOTS, UPGRADE_MAX, NAME_MAX, PART_KEYS, cleanLook, HULL_ITEMS, MAX_DECO, SIZE_COUNTS } from '../shared/boatlook.js';
import { Editor } from './editor.js';
import { identify, inDiscord } from './discord.js';
import { Menu } from './menu.js';
import { PLAYER_COLORS } from '../shared/world.js';
import { PixelRenderer, TILT, PIXEL_PREF } from './pixelfx.js';
import { partIcon } from './boaticons.js';
import { WorldScene, DEFAULT_TIME, furnitureGeometry, logGeo, logOffset, palmTrunk } from './world3d.js';
import { makeCharacter, animateCharacter, ANIM, TOOLS, setTool, swingTool, SWING_SECS, setLantern, lookKey } from './character.js';
import { loadLook, CharacterPreview } from './appearance.js';
import { flowerKey, cleanLook as cleanPlayerLook } from '../shared/outfit.js';
import { GridController, IMPACT_DROP } from './controller.js';
import { Fishing } from './fishing.js';
import { Drops } from './drops.js';
import { LEAFY_LIFT } from './trees3d.js';
import { Vitals } from './vitals.js';
import { Input } from './input.js';
import { PathFinder } from './pathfind.js';

const $ = (id) => document.getElementById(id);
const SEND_MS = 80;

const pixel = new PixelRenderer($('view'));
// Fixed ¾ top-down camera that follows the player (no rotation).
const CAM_PITCH = 0.66; // radians above the horizon (~38°, a ¾ view that shows faces)
const CAM_FOV = 35;
const MAX_ZOOM = 34;  // camera distance limit on land
const BOAT_ZOOM = 48; // and aboard a boat (further out to see the sea around you)
const camera = new THREE.PerspectiveCamera(CAM_FOV, pixel.aspect, 0.5, 110);
camera.layers.enable(2); // clouds (see WorldScene: layer 2, cast through the cloud sun; layers 1 and 31 are shadow-only)
const input = new Input($('view'), (x, y, first) => onTap(x, y, first));

const game = {
  mode: 'boot', // 'menu' | 'single' (offline, local only) | 'multi' (connected to a room)
  me: null,
  seed: null,
  world: null,
  scene: null,
  ctrl: null,
  local: null, // { char, color }
  roster: new Map(), // id -> { name, color }
  remotes: new Map(), // id -> { char, color, pos, target, ry, targetRy, a, speed, label }
  // ?zoom=N sets the starting camera distance (handy for screenshots)
  // yaw: camera angle around the player (0 = looking north); fixed 45 degree angles, Q/E ease yaw to yawTarget
  cam: { dist: Number(new URLSearchParams(location.search).get('zoom')) || 9.5, focus: new THREE.Vector3(), yaw: 0, yawTarget: 0 },
  paths: null, // PathFinder
  marker: null,
  ruinsFound: new Map(), // ruin id -> ruin
  lastSent: { x: 0, y: 0, z: 0, ry: 0, a: -1, at: 0 },
  climb: null, // { t, key, age, sx, sz, from, shook, w }: climbing a palm (climbPalm)
  tool: 0, // held tool: 0 hand, 1 shovel, 2 pickaxe (TOOLS)
  digHits: new Map(), // cellKey -> hits so far (stone takes 2)
  pendingDig: null, // { ix, iz }: dig once we've walked next to it
  nextDig: 0, // clock time the next swing may start
  saveName: null, // singleplayer on a saved world: digging is saved to it
};

let socket;
let identity;

// ---------- networking ----------

// The room is a PartyKit server on the same origin (/parties/room/<room>). PartySocket reconnects
// on its own with backoff, and onopen sends hello again each time.
function connect() {
  game.leaving = false;
  const room = String(identity.room).replace(/[^\w-]/g, '').slice(0, 64) || 'dev';
  socket = new PartySocket({ host: location.host, protocol: location.protocol === 'https:' ? 'wss' : 'ws', party: 'room', room });
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', room, ...identity.hello, look: loadLook(), wear: inventory.wear }));
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'welcome') onWelcome(msg);
    else if (msg.type === 'map') onMap(msg);
    else if (msg.type === 'roster') onRoster(msg.players);
    else if (msg.type === 'snap') onSnap(msg.p);
    else if (msg.type === 'dig') onDig(msg);
    else if (msg.type === 'chop') onChop(msg);
    else if (msg.type === 'bench') onBench(msg);
    else if (msg.type === 'pick') onPick(msg);
    else if (msg.type === 'pile') onPile(msg);
    else if (msg.type === 'time') onTime(msg);
    else if (msg.type === 'boat') onBoat(msg);
    else if (msg.type === 'boatlook') { game.boats?.setLook(msg.id, msg.look); const lb = game.boats?.list.get(msg.id); if (lb) unstickRider(lb); if (boatPanelBoat()?.id === msg.id) renderBoatPanel(); if (game.boatEdit === msg.id) renderPartMenu(); }
    else if (msg.type === 'error') { toast(msg.message); editor.playPending = false; }
  };
  socket.onclose = () => {
    if (game.mode !== 'multi' || game.leaving) return;
    $('loading').hidden = false;
    $('loading').textContent = 'Reconnecting…';
  };
}

const send = (obj) => {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(obj));
  return true;
};

function onWelcome({ you, seed, map, edits, chops, benches, picks, piles, boats, time }) {
  game.me = you;
  if (FROZEN === null && Number.isFinite(time)) setClock(time); // the room's time of day
  if (mapKey(seed, map) !== game.mapKey) buildWorld(seed, map, cleanEdits(edits), cleanChops(chops), cleanBenches(benches), cleanPicks(picks), cleanPiles(piles), cleanBoats(boats));
  else { // reconnected: catch up
    for (const [ix, iz, lvl, k, ul, uk] of cleanEdits(edits)) applyDig(ix, iz, lvl * STEP, k, ul >= 0 ? [ul * STEP, uk] : null);
    for (const [ix, iz] of cleanChops(chops)) applyChop(ix, iz);
    for (const [ix, iz, r, t] of cleanBenches(benches)) applyBench(ix, iz, r, true, t);
    for (const [ix, iz, t] of cleanPicks(picks)) applyPick(ix, iz, t);
    for (const [ix, iz, r, n] of cleanPiles(piles)) applyPile(ix, iz, r, n);
    for (const [id, x, z, yaw, look] of cleanBoats(boats)) game.boats.set(id, x, z, yaw, false, look);
  }
  $('loading').hidden = true;
  game.lastSent.a = -1; // force a position update
  // multiplayer menu: "Bring a world" plays it in the room once we're in
  if (game.bringMap) {
    send({ type: 'map', map: game.bringMap });
    game.bringMap = null;
  }
  // ?editor opens the map editor right away (handy for testing)
  if (new URLSearchParams(location.search).has('editor') && !game.editorOpened) {
    game.editorOpened = true;
    openEditor();
  }
}

// identifies what the room is playing: a random endless world (seed), a saved endless world or an island map
const mapKey = (seed, map) => (!map ? `seed:${seed}` : isEndlessMap(map) ? `endless:${map.seed}`
  : `map:${map.name}:${map.seed}:${hashStr(map.h + map.k + JSON.stringify(map.trees) + JSON.stringify(map.rocks) + JSON.stringify(map.ruins) + map.camp)}`);
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// someone in the room played a custom map (or went back to a random island)
function onMap({ map, seed, by }) {
  // leave the editor only when this is the map we just played (someone else's map loads in the
  // background so unsaved edits aren't lost)
  if (editor.active && editor.playPending) editor.close();
  editor.playPending = false;
  buildWorld(seed, map);
  toast(map ? `${by} loaded the world "${map.name}"` : `${by} started a new endless world`);
}

// a fresh tile-locked controller on (ix, iz): at the spawn, or stepping off a boat
function placeController(ix, iz) {
  game.ctrl = new GridController(game.paths, ix, iz);
  game.ctrl.onLand = (drop) => {
    const c = game.ctrl, p = c.pos;
    game.scene.effects.impact(p.x, p.y, p.z, drop, game.world.kind(c.ix, c.iz));
    if (drop >= FALL_HURT) vitals.hurt(Math.floor((drop - 2) * 2), 'fall'); // a long drop hurts (2.5: half a heart, 3: a heart)
  };
  return game.ctrl;
}

// ---------- the player's state in a world: where you stood, facing, camera, the boat you were on ----------
// Kept per world like the inventory (`settleon.player.save:<name>` / `room:<room>`, game.stateKey), written
// every few seconds, when leaving the world and when the tab closes, and read back when the world is built.
// Singleplayer worlds also keep their own time of day. A room's entry only counts for the same world (mapKey).
const PLAYER_KEY = 'settleon.player.';
function savePlayer() {
  const c = game.ctrl;
  if (!game.stateKey || !c || !game.world) return;
  const st = { v: 1, world: game.mapKey, ix: c.ix, iz: c.iz, ry: c.ry, yaw: game.cam.yawTarget, dist: game.cam.dist };
  if (game.mode === 'single' && Number.isFinite(game.time)) st.time = game.time;
  if (game.ride) st.ride = [game.ride.id, game.ride.lx, game.ride.lz];
  try { localStorage.setItem(PLAYER_KEY + game.stateKey, JSON.stringify(st)); } catch {}
}
/** Put the player back where they left this world. Returns false if there's nothing (valid) to restore. */
function restorePlayer() {
  let st = null;
  try { st = game.stateKey && JSON.parse(localStorage.getItem(PLAYER_KEY + game.stateKey)); } catch {}
  if (!st || st.v !== 1 || !Number.isInteger(st.ix) || !Number.isInteger(st.iz)) return false;
  if (game.mode === 'multi' && st.world !== game.mapKey) return false; // the room plays another world now
  const boat = st.ride && game.boats.list.get(st.ride[0]);
  // the tile may have been built on or dug since: the nearest open one
  const [cx, cz] = boat ? [toCell(boat.x), toCell(boat.z)] : [st.ix, st.iz];
  const [ix, iz] = game.paths.nearestOpen(cx, cz, 8) ?? [cx, cz];
  placeController(ix, iz);
  game.ctrl.ry = Number.isFinite(st.ry) ? st.ry : 0;
  if (boat) {
    const spot = nearestWalkable(st.ride[1], st.ride[2], boat.obs, boat.hull) ?? boat.hull.HELM;
    game.boatHint = true;
    board(boat, spot[0], spot[1]);
    game.ctrl.pos.x = boat.x; game.ctrl.pos.z = boat.z; game.ctrl.pos.y = deckY(boat, 0); // the deck walker places you from here on
  }
  if (Number.isFinite(st.yaw)) game.cam.yaw = game.cam.yawTarget = Math.round(st.yaw / (Math.PI / 4)) * (Math.PI / 4);
  if (Number.isFinite(st.dist)) game.cam.dist = Math.max(6, Math.min(boat ? BOAT_ZOOM : MAX_ZOOM, st.dist));
  if (game.mode === 'single' && FROZEN === null && Number.isFinite(st.time)) setClock(st.time);
  return true;
}
window.addEventListener('pagehide', () => { // closing or reloading the tab: keep everything
  savePlayer();
  writeSave();
  if (game.invKey) { clearTimeout(game.invTimer); game.invTimer = null; try { localStorage.setItem(INV_KEY + game.invKey, JSON.stringify(inventory.toJSON())); } catch {} }
  if (game.world) vitals.save();
});

function buildWorld(seed, map = null, roomEdits = [], roomChops = [], roomBenches = [], roomPicks = [], roomPiles = [], roomBoats = []) {
  game.seed = seed;
  game.mapKey = mapKey(seed, map);
  // no map: the endless world from the seed; otherwise a saved endless world or an island map
  let base = null, endless = null;
  try {
    if (isEndlessMap(map)) endless = decodeEndless(map);
    else if (map) base = decodeMap(map);
  } catch (err) { toast(`Couldn't load the room's world: ${err.message}`); }
  game.world = base ? finishWorld(base) : createEndlessWorld(endless ? endless.seed : seed);
  game.mapName = base ? base.name : endless ? endless.name : 'Endless world';
  // player digging: saved with the world, then the room's (before anything is built from the terrain)
  for (const [ix, iz, lvl, k, ul = -1, uk = 0] of [...(endless?.edits ?? []), ...roomEdits]) game.world.setEdit(ix, iz, lvl * STEP, k, ul >= 0 ? ul * STEP : -1, uk);
  for (const [ix, iz] of [...(endless?.chops ?? []), ...roomChops]) game.world.removeTree(ix, iz); // trees already chopped down
  // workbenches: saved with the world (endless saves, or an island save's extra field), then the room's
  const savedBenches = endless?.benches ?? (map && !isEndlessMap(map) ? cleanBenches(map.benches) : []);
  for (const [ix, iz, r, t] of [...savedBenches, ...roomBenches]) game.world.benches.set(cellKey(ix, iz), [ix, iz, r, t]);
  // log piles: saved with the world, then the room's
  const savedPiles = endless?.piles ?? (map && !isEndlessMap(map) ? cleanPiles(map.piles) : []);
  for (const [ix, iz, r, n] of [...savedPiles, ...roomPiles]) game.world.piles.set(cellKey(ix, iz), [ix, iz, r, n]);
  // broken bushes, picked berries and pebbles: saved with the world, then the room's
  const savedPicks = endless?.picks ?? (map && !isEndlessMap(map) ? cleanPicks(map.picks) : []);
  for (const [ix, iz, t] of [...savedPicks, ...roomPicks]) game.world.setPick(ix, iz, t);
  game.pendingAct = null;
  hideCtx();
  game.chopHits = new Map();
  game.digHits.clear();
  game.pendingDig = null;
  game.scene?.dispose();
  game.scene = new WorldScene(game.world);
  game.scene.setBenches(game.world.benches);
  game.scene.setPiles(game.world.piles);
  // boats: saved with the world (endless saves, or an island save's extra field), then the room's
  game.boats = new Boats(game.scene.scene, game.world);
  game.boats.effects = game.scene.effects; // bow spray
  game.ride = null;
  game.driving = null;
  const savedBoats = endless?.boats ?? (map && !isEndlessMap(map) ? cleanBoats(map.boats) : []);
  for (const [id, x, z, yaw, look] of [...savedBoats, ...roomBoats]) game.boats.set(id, x, z, yaw, true, look);
  for (const r of game.remotes.values()) r.label.remove();
  game.remotes.clear();
  game.ruinsFound.clear();
  game.paths = new PathFinder(game.world);
  game.paths.footprint = furnitureFootprint; // furniture blocks only where it stands
  // spawn on the center of the nearest open tile by the campfire
  const spawn = spawnPoint(game.world, game.me);
  // dev/testing: ?spawn=deep starts in the middle of the biggest deep (redwood) forest near the camp
  if (new URLSearchParams(location.search).get('spawn') === 'deep') {
    const { world } = game, R = world.endless ? 90 : WORLD / 2;
    let best = null, bn = -1;
    for (let iz = world.camp.iz - R; iz < world.camp.iz + R; iz += 2) {
      for (let ix = world.camp.ix - R; ix < world.camp.ix + R; ix += 2) {
        if (world.kind(ix, iz) !== K.DEEP || !game.paths.passable(ix, iz)) continue;
        let n = 0;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (world.kind(ix + dx, iz + dz) === K.DEEP) n++;
        if (n > bn) { bn = n; best = [ix, iz]; }
      }
    }
    if (best) { spawn.x = toWorld(best[0]); spawn.z = toWorld(best[1]); }
  }
  // dev/testing: ?spawn=trail starts on the mountain trail nearest the camp
  if (new URLSearchParams(location.search).get('spawn') === 'trail') {
    const { world } = game;
    let best = null;
    for (let r = 1; r < 160 && !best; r++) {
      for (let a = 0; a < 8 * r && !best; a++) {
        const ix = Math.round(world.camp.ix + Math.cos((a / (8 * r)) * 6.2832) * r), iz = Math.round(world.camp.iz + Math.sin((a / (8 * r)) * 6.2832) * r);
        if (world.kind(ix, iz) === K.TRAIL && game.paths.passable(ix, iz)) best = [ix, iz];
      }
    }
    if (best) { spawn.x = toWorld(best[0]); spawn.z = toWorld(best[1]); }
  }
  // dev/testing: ?spawn=shore starts on the dry shore nearest the camp with shallow water next to it
  if (new URLSearchParams(location.search).get('spawn') === 'shore') {
    const { world } = game, R = world.endless ? 120 : WORLD / 2;
    let best = null, bd = Infinity;
    for (let iz = world.camp.iz - R; iz < world.camp.iz + R; iz++) {
      for (let ix = world.camp.ix - R; ix < world.camp.ix + R; ix++) {
        const d = Math.hypot(ix - world.camp.ix, iz - world.camp.iz);
        if (d >= bd || world.kind(ix, iz) === K.SEABED || !game.paths.passable(ix, iz)) continue;
        let wet = 0;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (world.kind(ix + dx, iz + dz) === K.SEABED && world.H(ix + dx, iz + dz) >= SEA - 1.1) wet++;
        if (wet >= 14) { bd = d; best = [ix, iz]; }
      }
    }
    if (best) { spawn.x = toWorld(best[0]); spawn.z = toWorld(best[1]); }
  }
  // where you left off in this world (unless a ?spawn= test override is set); otherwise by the campfire
  if (new URLSearchParams(location.search).has('spawn') || !restorePlayer()) {
    const [six, siz] = game.paths.nearestOpen(toCell(spawn.x), toCell(spawn.z), 8) ?? [toCell(spawn.x), toCell(spawn.z)];
    placeController(six, siz);
    game.ctrl.ry = 0; // face the camera
  }
  game.scene.preload(game.ctrl.pos); // endless: build the chunks around the spawn before the first frame
  game.cam.focus.set(game.ctrl.pos.x, game.ctrl.pos.y + 0.5, game.ctrl.pos.z);
  applyTime(game.time);
  game.marker = makeMarker();
  game.scene.scene.add(game.marker);
  game.outline = makeOutline();
  game.scene.scene.add(game.outline);
  game.local = null;
  miniOrigin = null;
  drawMinimapBase();
  updateRuinsHud();
  for (const [id, p] of game.roster) ensureCharacter(id, p);
}

// ---------- time of day: a day/night cycle, one day every DAY_SECONDS (10 minutes) ----------
// The clock (game.clock = { h, at }) runs from the wall clock. In multiplayer the room's clock comes
// from the server (welcome.time) and the slider sets it for everyone (`time` message); alone, the
// time is remembered per browser. `?time=N` sets the hour and stops the clock (for screenshots).
const TIME_KEY = 'settleon.time';
const FROZEN = (() => { const q = new URLSearchParams(location.search).get('time'); return q !== null && !Number.isNaN(Number(q)) ? Number(q) : null; })();
function initialTime() {
  if (FROZEN !== null) return FROZEN;
  try { const v = localStorage.getItem(TIME_KEY); if (v !== null && !Number.isNaN(Number(v))) return Number(v); } catch {}
  return DEFAULT_TIME;
}
// start the clock at hour h
function setClock(h) {
  game.clock = { h: ((h % 24) + 24) % 24, at: Date.now() };
  applyTime(game.clock.h);
}
function applyTime(h) {
  game.time = h;
  game.scene?.setTimeOfDay(h);
  const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
  $('time-label').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  $('time-icon').classList.toggle('night', h < 6 || h >= 19.5);
  if (!game.dragTime) $('time-slider').value = h;
}
// every frame: move on to the clock's current minute (the sun moves in one-minute steps, about
// once a real second, so shadows step instead of crawling), and remember it every few seconds when alone
function tickClock() {
  if (FROZEN !== null || game.dragTime || !game.clock) return;
  const h = clockHour(game.clock.h, Date.now() - game.clock.at);
  if (Math.floor(h * 60) === Math.floor(game.time * 60)) return;
  applyTime(h);
  const now = Date.now();
  if (game.mode !== 'multi' && now - (game.timeSaved ?? 0) > 5000) {
    game.timeSaved = now;
    try { localStorage.setItem(TIME_KEY, String(h)); } catch {}
  }
}
function onTime({ id, by, h }) {
  if (id === game.me || !Number.isFinite(h)) return;
  setClock(h);
  if (by) toast(`${by} set the time to ${$('time-label').textContent}`);
}
{
  const slider = $('time-slider');
  slider.addEventListener('pointerdown', () => { game.dragTime = true; });
  slider.addEventListener('input', () => applyTime(Number(slider.value)));
  slider.addEventListener('change', () => { // released: the clock carries on from here
    game.dragTime = false;
    const h = Number(slider.value) % 24;
    setClock(h);
    if (game.mode === 'multi') send({ type: 'time', h });
    else try { localStorage.setItem(TIME_KEY, String(h)); } catch {}
  });
  // don't keep focus, so WASD / arrows keep moving the character instead of the slider
  slider.addEventListener('pointerup', () => { game.dragTime = false; slider.blur(); });
  slider.addEventListener('keydown', (e) => e.preventDefault());
}
setClock(initialTime());

function onRoster(players) {
  game.roster = new Map(players.map((p) => [p.id, p]));
  if (game.scene) {
    for (const [id, p] of game.roster) ensureCharacter(id, p);
    for (const [id, r] of game.remotes) {
      if (!game.roster.has(id)) {
        game.scene.scene.remove(r.char.root);
        r.label.remove();
        game.remotes.delete(id);
      }
    }
  }
  $('players').innerHTML = players.map((p) => `
    <li><i style="background:${p.color}"></i>${esc(p.name)}${p.id === game.me ? ' (you)' : ''}</li>`).join('');
}

function ensureCharacter(id, p) {
  const scene = game.scene.scene;
  const key = lookKey(p.look, p.wear) + p.color; // rebuilt when the look, the clothes or the colour change
  if (id === game.me) {
    if (game.local?.key === key) return;
    const old = game.local?.char;
    if (old) scene.remove(old.root);
    const char = makeCharacter(id, p.color, p.look, p.wear);
    if (old) { char.root.position.copy(old.root.position); char.root.rotation.copy(old.root.rotation); }
    game.local = { char, color: p.color, key };
    setTool(char, game.tool);
    scene.add(char.root);
    return;
  }
  const existing = game.remotes.get(id);
  if (existing && existing.key === key) {
    existing.label.textContent = p.name;
    return;
  }
  if (existing) { scene.remove(existing.char.root); existing.label.remove(); }
  const char = makeCharacter(id, p.color, p.look, p.wear);
  char.root.visible = false;
  scene.add(char.root);
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = p.name;
  label.style.color = p.color;
  label.hidden = true;
  $('labels').append(label);
  game.remotes.set(id, {
    char, color: p.color, key, label, pos: new THREE.Vector3(), target: new THREE.Vector3(),
    ry: 0, targetRy: 0, a: ANIM.IDLE, speed: 0, seen: false,
  });
}

function onSnap(list) {
  for (const [id, x, y, z, ry, code, rb] of list) {
    if (id === game.me) continue;
    const r = game.remotes.get(id);
    if (!r || y < -50) continue; // not placed yet
    if (Array.isArray(rb) && game.boats?.list.has(rb[0])) { if (r.ride?.[0] !== rb[0]) r.rl = [rb[1], rb[2]]; r.ride = rb; } else r.ride = null; // on a boat: [id, deck x, deck z]
    const a = code % 10; // animation; the tens digit is the held tool
    setTool(r.char, Math.floor(code / 10) % TOOLS.length);
    // landing impacts for other players: an AIR hop that ends 2+ blocks lower, on dry ground
    if (r.seen && a === ANIM.AIR && r.a !== ANIM.AIR) r.airFrom = r.target.y;
    if (r.seen && a !== ANIM.AIR && r.a === ANIM.AIR && a !== ANIM.SWIM && r.airFrom - y >= IMPACT_DROP - 0.01) {
      const ix = toCell(x), iz = toCell(z);
      game.scene.effects.impact(toWorld(ix), y, toWorld(iz), r.airFrom - y, game.world.kind(ix, iz));
    }
    r.target.set(x, y, z);
    r.targetRy = ry;
    r.a = a;
    if (!r.seen) {
      r.seen = true;
      r.pos.copy(r.target);
      r.ry = ry;
      r.char.root.visible = true;
    }
  }
}

function sendPosition(now) {
  const c = game.ctrl, l = game.lastSent;
  if (!c || now - l.at < SEND_MS) return;
  const moved = Math.abs(c.pos.x - l.x) + Math.abs(c.pos.y - l.y) + Math.abs(c.pos.z - l.z) > 0.01;
  const a = c.anim + 10 * game.tool; // animation + held tool
  const r = game.ride, b = r ? [r.id, +r.lx.toFixed(2), +r.lz.toFixed(2)] : null, bk = b ? b.join() : '';
  if (!moved && a === l.a && Math.abs(c.ry - l.ry) < 0.02 && bk === l.b) return;
  send({ type: 'move', x: c.pos.x, y: c.pos.y, z: c.pos.z, ry: c.ry, a, ...(b ? { b } : {}) });
  Object.assign(l, { x: c.pos.x, y: c.pos.y, z: c.pos.z, ry: c.ry, a, b: bk, at: now });
}

// ---------- swimming splashes ----------

/**
 * Splashes for a swimming character: a splash when it goes into the water, droplets flicked up by each
 * paddling hand (in time with the doggy paddle, `ch.phase`), foam from the kicking feet, and a gentle
 * ring of foam now and then while treading water. Client-only, for you and for other players.
 */
function swimSplash(ch, anim, speed, x, z, ry, dt) {
  const fx = game.scene?.effects;
  const was = ch.swimWas;
  ch.swimWas = anim === ANIM.SWIM;
  if (!fx || anim !== ANIM.SWIM) return;
  const y = SEA + waveAt(game.world, x, z);
  const sx = Math.sin(ry), sz = Math.cos(ry); // facing
  if (!was) { fx.splash(x + sx * 0.15, y, z + sz * 0.15, 0.35 + Math.min(0.4, speed * 0.08), sx * 0.4, sz * 0.4); ch.swimSide = Math.sin(ch.phase) >= 0; return; }
  const moving = speed > 0.3;
  // each arm's stroke: the sine of the paddle phase changes sign as a hand slaps the water
  const side = Math.sin(ch.phase) >= 0;
  if (side !== ch.swimSide) {
    ch.swimSide = side;
    const s = side ? 1 : -1; // which hand (right / left)
    const hx = x + sx * 0.24 + sz * 0.13 * s, hz = z + sz * 0.24 - sx * 0.13 * s;
    const n = moving ? 4 + Math.round(Math.random() * 3) : 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, out = 0.2 + Math.random() * 0.5;
      fx.drop(hx, y + 0.03, hz, Math.cos(a) * out + sx * (moving ? 0.6 : 0.1), 1.2 + Math.random() * 1.3, Math.sin(a) * out + sz * (moving ? 0.6 : 0.1), 0.035 + Math.random() * 0.03, y);
    }
    fx.foamAt(hx, hz, sz * 0.25 * s, -sx * 0.25 * s, 0.11, 0.7 + Math.random() * 0.4, 0.5, y);
  }
  // kicking feet churn foam behind, and a soft wake fans out to the sides while moving
  ch.swimFoam = (ch.swimFoam ?? 0) + dt * (moving ? 14 : 2.5);
  while (ch.swimFoam >= 1) {
    ch.swimFoam -= 1;
    const j = (Math.random() - 0.5) * 0.22;
    if (moving) {
      const s = Math.random() < 0.5 ? 1 : -1;
      fx.foamAt(x - sx * 0.3 + sz * j, z - sz * 0.3 - sx * j, (-sx * 0.3 + sz * 0.35 * s) * (0.5 + Math.random() * 0.5), (-sz * 0.3 - sx * 0.35 * s) * (0.5 + Math.random() * 0.5), 0.09 + Math.random() * 0.05, 0.9 + Math.random() * 0.6, 0.4, y);
      if (Math.random() < 0.25) fx.drop(x - sx * 0.32, y + 0.02, z - sz * 0.32, -sx * 0.4 + (Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.8, -sz * 0.4 + (Math.random() - 0.5) * 0.4, 0.03 + Math.random() * 0.02, y);
    } else { // treading water: a little ring around the body
      const a = Math.random() * Math.PI * 2;
      fx.foamAt(x + Math.cos(a) * 0.22, z + Math.sin(a) * 0.22, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.08, 1 + Math.random() * 0.5, 0.3, y);
    }
  }
}

// ---------- per-frame ----------

const clock = new THREE.Clock();
const tmp = new THREE.Vector3();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;
  tickClock();
  if (editor.active) { editor.frame(dt, t); return; }
  if (menu.active) { menu.frame(dt, t); return; }
  if (!game.world || !game.ctrl) return;
  // singleplayer pause: the world stands still, only the last view is drawn
  if (game.paused && game.mode === 'single') { pixel.render(game.scene.scene, camera); return; }
  drawDoll(dt, t);

  const cam = game.cam;
  // aboard a boat you can zoom out further (BOAT_ZOOM); stepping ashore eases back inside the normal limit
  const zoomMax = game.ride ? BOAT_ZOOM : MAX_ZOOM;
  const before = cam.dist;
  cam.dist = Math.max(6, cam.dist * (1 + input.takeZoom() * 0.1));
  if (cam.dist > zoomMax) cam.dist = before <= zoomMax ? zoomMax : Math.max(zoomMax, Math.min(before, cam.dist) - (before - zoomMax) * (1 - Math.exp(-dt * 4)));
  // the far plane reaches as far as the fog, so a far zoom doesn't clip the horizon
  const far = Math.max(110, Math.round(70 + cam.dist * 1.3));
  if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
  // fixed camera angles: Q/E turn 45 degrees, eased
  cam.yawTarget += input.takeRotate() * (Math.PI / 4);
  cam.yaw += (cam.yawTarget - cam.yaw) * (1 - Math.exp(-dt * 10));

  // local player (tile-locked); keyboard overrides tap-to-go inside the controller.
  // WASD are screen directions, so turn them by the camera yaw and snap to the 8 grid directions.
  const keys = input.read(); // read even when ignored, so a queued jump doesn't fire later
  const k0 = game.paused || inventory.isOpen || !$('boat-panel').hidden || game.boatEdit ? { x: 0, z: 0, run: false, jump: false } : keys;
  if (game.boatEdit && (!game.ride || game.ride.id !== game.boatEdit)) setBoatEdit(false);
  $('boat-btn').hidden = !game.ride; // the Boat button shows while you're aboard
  updatePrompt();
  if (!game.ride && !$('boat-panel').hidden) toggleBoatPanel(false);
  // boats: sail the one you steer, ease the others, then walk on deck, board one, or walk the land
  const throttleSteps = input.takeThrottle(); // W / S presses (only used at a boat's helm)
  if (game.ride) driveBoat(dt, k0, inventory.isOpen || game.paused ? 0 : throttleSteps);
  else if (!$('throttle').hidden) throttleHud(null);
  game.boats.update(dt, t, game.driving);
  if (game.ride) walkOnDeck(dt, t, k0, cam.yaw);
  else if (game.climb) climbStep(dt);
  else if (!tryBoard(k0, cam.yaw, t)) game.ctrl.update(dt, screenToGrid(k0, cam.yaw));
  const c = game.ctrl;
  if (!c.moving && game.marker.visible && !game.marker.userData.bad) game.marker.visible = false;
  if (game.local) {
    const root = game.local.char.root;
    root.position.set(c.pos.x, c.pos.y, c.pos.z);
    root.rotation.y = c.ry;
    game.local.char.rowPhase = game.boats.list.get(game.ride?.id)?.rowPhase ?? 0; // in step with the oars
    animateCharacter(game.local.char, c.anim, c.speed, dt, t);
    swimSplash(game.local.char, c.anim, c.speed, c.pos.x, c.pos.z, c.ry, dt);
    // fishing: one per world scene; moving or putting the rod away reels the line in
    if (game.fishing?.scene !== game.scene.scene) { game.fishing?.cancel(fishCtx()); game.fishing = new Fishing(game.scene.scene); }
    if (game.fishing.active && ((keys.x || keys.z) && !game.ride?.steer || TOOLS[game.tool] !== 'rod')) game.fishing.cancel(fishCtx());
    game.fishing.update(dt, t, fishCtx(), input.pressed);
  }
  // items on the ground: one Drops per world scene; walk up to them to pick them up
  if (game.drops?.scene !== game.scene.scene) { game.drops?.clear(); game.drops = new Drops(game.scene.scene); }
  updateNuts(dt);
  game.drops.update(dt, t, {
    floor: dropFloor, player: game.local ? c.pos : null, night: game.scene.night ?? 0,
    add: (id, n) => inventory.add(id, n), onFull: () => toast('Your inventory is full'),
  });
  // health and hunger: hunger drains faster running, swimming and rowing
  const effort = c.anim === ANIM.RUN ? 'run' : c.anim === ANIM.SWIM ? 'swim' : c.anim === ANIM.ROW ? (game.driving ? 'row' : 'idle') : c.anim === ANIM.WALK ? 'walk' : 'idle';
  vitals.update(dt, effort, inventory.creative);
  updateMarker(t);
  updateOutline();
  if (game.ride || game.blueprint?.visible) updateDeckBlueprint(); // placing on a boat's deck
  updateLaunchBlueprint(t); // a boat in hand: where it would go in the water
  // walked next to a block we clicked with a tool: dig it (a movement key cancels the walk, and the dig)
  if (game.pendingDig && (keys.x || keys.z)) game.pendingDig = null;
  if (game.pendingCatch != null && (keys.x || keys.z)) game.pendingCatch = null;
  if (game.pendingChop && (keys.x || keys.z)) game.pendingChop = null;
  if (game.pendingAct && (keys.x || keys.z)) game.pendingAct = null;
  if (game.pendingAct && !c.moving) { // walked over to a bush or pebble we clicked
    const a = game.pendingAct;
    game.pendingAct = null;
    if (Math.hypot(a.x - c.pos.x, a.z - c.pos.z) <= a.reach + 0.3) a.run(); else toast("Can't reach that");
  }
  if (game.pendingChop && !c.moving) {
    const t = game.pendingChop;
    game.pendingChop = null;
    if (Math.hypot(t.x - c.pos.x, t.z - c.pos.z) <= CHOP_REACH + 0.3 && TOOLS[game.tool] === 'axe') chopTree(t);
  }
  if (game.pendingCatch != null && !c.moving) { // walked over to a frog: catch it if it's still there
    const f = game.scene.ambient.catchableFrogs().find((q) => q.i === game.pendingCatch);
    game.pendingCatch = null;
    if (f && Math.hypot(f.x - c.pos.x, f.z - c.pos.z) <= CATCH_REACH + 0.4) catchFrog(f);
    else toast('The frog hopped away!');
  }
  if (game.pendingDig && !c.moving) {
    const { ix, iz } = game.pendingDig;
    game.pendingDig = null;
    if (Math.max(Math.abs(ix - c.ix), Math.abs(iz - c.iz)) === 1) actAt(ix, iz);
  }

  // remote players: smooth toward the latest snapshot
  const k = 1 - Math.exp(-dt * 12);
  for (const r of game.remotes.values()) {
    if (!r.seen) continue;
    const before = tmp.copy(r.pos);
    const rb = r.ride && game.boats.list.get(r.ride[0]);
    if (rb) { // on a boat: ease their deck position, then place them on the deck as it's drawn now
      r.rl[0] += (r.ride[1] - r.rl[0]) * k;
      r.rl[1] += (r.ride[2] - r.rl[1]) * k;
      const [wx, wz] = toWorldXZ(rb, r.rl[0], r.rl[1]);
      r.pos.set(wx, deckY(rb, t, r.rl[0], r.rl[1]), wz);
    } else r.pos.lerp(r.target, k);
    r.speed = before.distanceTo(r.pos) / Math.max(dt, 1e-3);
    let d = r.targetRy - r.ry;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.ry += d * k;
    r.char.root.position.copy(r.pos);
    r.char.root.rotation.y = r.ry;
    r.char.rowPhase = rb?.rowPhase ?? 0;
    animateCharacter(r.char, r.a, r.speed, dt, t);
    swimSplash(r.char, r.a, r.speed, r.pos.x, r.pos.z, r.ry, dt);
  }

  // lanterns at night: everyone carries one; real lights for you and the 3 nearest other players
  const lit = (game.scene.timeNight ?? 0) > 0.02;
  if (game.local) setLantern(game.local.char, lit);
  const others = [];
  for (const r of game.remotes.values()) {
    setLantern(r.char, lit && r.seen);
    if (lit && r.seen) others.push([r.pos.distanceToSquared(c.pos), { x: r.pos.x, y: r.pos.y, z: r.pos.z, ry: r.ry }]);
  }
  others.sort((a, b) => a[0] - b[0]);
  game.scene.setLanterns(lit ? [{ x: c.pos.x, y: c.pos.y, z: c.pos.z, ry: c.ry }, ...others.slice(0, 3).map((o) => o[1])] : [], t);

  // fixed-angle follow camera
  // aboard a boat the camera follows the boat itself (its middle, at deck height), not you walking around on it;
  // it follows faster then, so a boat at full speed doesn't run away from the view
  const rideBoat = game.ride && game.boats.list.get(game.ride.id);
  if (rideBoat) cam.focus.lerp(tmp.set(rideBoat.sx, deckY(rideBoat, t) - (rideBoat.wH ?? 0) * 0.7 + 0.5, rideBoat.sz), 1 - Math.exp(-dt * 10));
  else cam.focus.lerp(tmp.set(c.pos.x, c.pos.y + 0.5, c.pos.z), 1 - Math.exp(-dt * 6));
  placeCamera(camera, cam.focus, cam.dist, cam.yaw);

  pixel.setZoom(cam.dist);
  // tilt-shift: subtle up close, a little stronger zoomed out (where the miniature look reads best)
  pixel.setTiltShift(settings.v.tilt ? TILT.strength * (0.7 + 0.6 * Math.min(1, Math.max(0, (cam.dist - 8) / 20))) : 0);
  if (game.scene.sun.castShadow !== settings.v.shadows) game.scene.sun.castShadow = game.scene.cloudSun.castShadow = settings.v.shadows; // the Shadows setting
  game.scene.cloudRes.value.set(pixel.rt.width, pixel.rt.height);
  game.scene.update(t, dt, c.pos, cam.dist);
  camera.updateMatrixWorld();
  game.scene.setSeeThrough(camera, game.boatEdit ? null : c.pos, pixel.rt.width, pixel.rt.height); // no cutaway while customizing the boat
  pixel.render(game.scene.scene, camera);
  // a picture for the world list: shortly after starting, then every minute
  if (t - (game.playerSaved ?? 0) > 5) { game.playerSaved = t; savePlayer(); }
  if (game.saveName && t - game.thumbAt > (game.thumbAt === game.playStart ? 3 : 60)) { game.thumbAt = t; captureThumb(false); }

  updateLabels();
  updateArea(t);
  sendPosition(performance.now());
  if (t - (frame.lastMini ?? 0) > 0.12) { frame.lastMini = t; drawMinimap(); }
}

/** Put the camera at `dist` from `focus`, CAM_PITCH above the horizon, turned `yaw` around it. */
function placeCamera(cam, focus, dist, yaw) {
  const flat = Math.cos(CAM_PITCH) * dist;
  cam.position.set(focus.x + Math.sin(yaw) * flat, focus.y + Math.sin(CAM_PITCH) * dist, focus.z + Math.cos(yaw) * flat);
  cam.lookAt(focus);
}

/**
 * Screen-space keys (x = right, z = up) -> grid step keys for the controller (which reads
 * x = +x step, z = -z step), turned by the camera yaw and snapped to 8 directions.
 */
function screenToGrid(keys, yaw) {
  if (!keys.x && !keys.z) return keys;
  // screen right = (cos yaw, -sin yaw), screen up (forward) = (-sin yaw, -cos yaw) in world x/z
  const wx = Math.cos(yaw) * keys.x - Math.sin(yaw) * keys.z;
  const wz = -Math.sin(yaw) * keys.x - Math.cos(yaw) * keys.z;
  const a = Math.round(Math.atan2(wz, wx) / (Math.PI / 4)) * (Math.PI / 4);
  return { ...keys, x: Math.round(Math.cos(a)), z: -Math.round(Math.sin(a)) };
}

// ---------- tap to go ----------

// Screen point -> where the ray meets the ground or water, by marching along the ray.
function groundPoint(px, py) {
  const ndc = new THREE.Vector2((px / pixel.cssW) * 2 - 1, -(py / pixel.cssH) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let prev = 0;
  for (let t = 0.5; t < 120; t += 0.1) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const floor = Math.max(groundAt(game.world, x, z), SEA);
    if (y <= floor) {
      // refine between the last two samples
      let lo = prev, hi = t;
      for (let k = 0; k < 8; k++) {
        const m = (lo + hi) / 2;
        const mx = o.x + d.x * m, my = o.y + d.y * m, mz = o.z + d.z * m;
        if (my <= Math.max(groundAt(game.world, mx, mz), SEA)) hi = m; else lo = m;
      }
      return { x: o.x + d.x * hi, z: o.z + d.z * hi };
    }
    prev = t;
  }
  return null;
}

// Clicks don't move the character (movement is WASD/arrows only, at the user's request): with a
// tool in hand, a click on a neighbouring tile uses it.
function onTap(px, py, first) {
  if (!game.world || !game.ctrl || editor.active || !first || inventory.isOpen || game.climb) return;
  hideCtx();
  game.pendingAct = null;
  if (game.boatEdit) return editClick(px, py); // edit mode: a click picks a part of the boat
  if (TOOLS[game.tool] === 'rod' && game.fishing && game.local && !(game.ride?.steer && wheelAt(px, py))) return game.fishing.press(fishCtx(), groundPoint(px, py)); // fishing.js
  if (game.ride) { // aboard: a click on the wheel takes (or leaves) the helm; furniture goes on the deck, the axe takes it back
    if (wheelAt(px, py)) return toggleHelm();
    if (ITEMS[inventory.held?.id]?.furn) return placeOnDeck(px, py);
    if (TOOLS[game.tool] === 'axe') return takeFromDeck(px, py);
    if (ITEMS[inventory.held?.id]?.food) return eatHeld();
    if (ITEMS[inventory.held?.id]?.cloth) return wearHeld();
    return;
  }
  const frog = frogAt(px, py);
  if (frog) return catchFrog(frog); // clicking a frog catches it, whatever is in hand
  const held = inventory.held;
  if (held && ITEMS[held.id].throwable) return ITEMS[held.id].throwable === 'nut' ? throwNut(px, py) : throwAt(px, py); // a frog or a coconut in hand: throw it there
  const item = held && ITEMS[held.id];
  if (item?.boat) return launchBoat(px, py); // a boat in hand: put it in the water there
  if (item?.cloth) return wearHeld(); // clothes in hand: put them on
  if (TOOLS[game.tool] === 'axe') { // a boat, furniture, then a log pile, then a tree, else wood blocks
    const boat = boatAt(px, py);
    if (boat) return takeBoat(boat);
    const bench = benchAt(px, py);
    if (bench) return takeBench(bench);
    const pile = pileAt(px, py);
    if (pile) return takeLog(pile);
    const tree = treeAt(px, py);
    if (tree) return chopTree(tree);
  } else if (!item?.block && !item?.place) { // a workbench opens its crafting (unless you're placing something)
    const bench = benchAt(px, py);
    if (bench && bench[3] === 0) return useWorkbench(bench);
  }
  if (canClimb(item)) { const palm = palmAt(px, py); if (palm) return climbPalm(palm); } // an empty hand climbs a palm
  const bush = bushAt(px, py);
  if (bush) return breakBush(bush); // a click breaks a bush, whatever is in hand
  const pebble = pebbleAt(px, py);
  if (pebble) return pickPebble(pebble);
  if (handFree(item)) { // with a free hand: harvest cotton, pick flowers
    const plant = cottonAt(px, py);
    if (plant) return harvestCotton(plant);
    const flower = flowerAt(px, py);
    if (flower) return pickFlowers(flower);
  }
  if (TOOLS[game.tool] === 'pickaxe') { const rock = rockAt(px, py); if (rock) return mineRock(rock); } // the pickaxe breaks rocks
  if (item &&(item.tool || item.block || item.place)) useToolAt(px, py); // a tool digs, a block or workbench is placed
  else if (item?.food) eatHeld(); // food in hand: a click eats one
}

// ---------- climbing palms and shaking coconuts down ----------
// Click a coconut palm with an empty (or material) hand: walk to its trunk, climb it, shake the crown and slide
// back down. 1–3 Coconuts drop. A palm has coconuts again COCONUT_REGROW seconds later (client-only, not synced).
const COCONUT_REGROW = 180, CLIMB_UP = 1.5, CLIMB_SHAKE = 1.0, CLIMB_DOWN = 1.1, CLIMB_TOP = 0.82;
const palmReady = new Map(); // cellKey -> clock time when the palm has coconuts again
const canClimb = (item) => !item || !(item.tool || item.block || item.place || item.food || item.throwable || item.boat);
const palmAt = (px, py) => treeAt(px, py, (t) => t.palm);
const ease = (k) => k * k * (3 - 2 * k);
function climbPalm(t) {
  if (game.climb || game.ride || !game.local) return;
  if (!inReach(t, () => { if (nearbyTrees(16).includes(t)) climbPalm(t); })) return;
  const key = cellKey(t.ix, t.iz), c = game.ctrl;
  if (clock.elapsedTime < (palmReady.get(key) ?? 0)) return toast('No ripe coconuts up there right now');
  let sx = c.pos.x - t.x, sz = c.pos.z - t.z;
  const len = Math.hypot(sx, sz) || 1;
  sx /= len; sz /= len;
  game.fishing?.cancel(fishCtx());
  game.climb = { t, key, age: 0, sx, sz, from: { x: c.pos.x, y: c.pos.y, z: c.pos.z }, shook: false, w: game.world };
  game.local.char.climbPhase = 0;
  game.local.char.lastClimbHalf = undefined;
}
function climbStep(dt) {
  const k = game.climb, c = game.ctrl;
  if (!k || k.w !== game.world) { game.climb = null; return; }
  k.age += dt;
  const total = CLIMB_UP + CLIMB_SHAKE + CLIMB_DOWN;
  const a = k.age;
  const u = a < CLIMB_UP ? ease(a / CLIMB_UP) * CLIMB_TOP : a < CLIMB_UP + CLIMB_SHAKE ? CLIMB_TOP : CLIMB_TOP * (1 - ease(Math.min(1, (a - CLIMB_UP - CLIMB_SHAKE) / CLIMB_DOWN)));
  if (a >= total) { // back on the ground where we started
    c.pos.x = k.from.x; c.pos.y = k.from.y; c.pos.z = k.from.z;
    c.anim = ANIM.IDLE;
    game.climb = null;
    return;
  }
  const t = k.t, p = palmTrunk(t, u), off = 0.2 * t.s, w = Math.min(1, u / 0.1);
  c.pos.x = k.from.x + (p.x + k.sx * off - k.from.x) * w;
  c.pos.z = k.from.z + (p.z + k.sz * off - k.from.z) * w;
  c.pos.y = k.from.y + (p.y - t.y);
  c.ry = Math.atan2(-k.sx, -k.sz);
  c.anim = ANIM.CLIMB;
  c.speed = 0;
  const mode = a < CLIMB_UP ? 'up' : a < CLIMB_UP + CLIMB_SHAKE ? 'shake' : 'down';
  game.local.char.climbMode = mode;
  if (mode === 'up') game.local.char.climbPhase += dt * 9;
  if (!k.shook && a >= CLIMB_UP + 0.3) { // up in the crown: shake it
    k.shook = true;
    const top = palmTrunk(t, 1), fx = game.scene.effects;
    game.scene.shakeTree(t, -k.sx, -k.sz, 0.1);
    fx.leafFall(top.x, top.y, top.z, 0.9 * t.s, 12, dropFloor);
    swingTool(game.local.char);
    if (clock.elapsedTime < (palmReady.get(k.key) ?? 0)) return;
    palmReady.set(k.key, clock.elapsedTime + COCONUT_REGROW);
    const n = 1 + Math.floor(Math.random() * 3);
    dropItem('coconut', n, top.x + k.sx * 0.2, top.y - 0.2, top.z + k.sz * 0.2, 1.1);
    toast(n === 1 ? 'A coconut falls!' : `${n} coconuts fall!`);
  }
}

// ---------- bushes and pebbles ----------
// Left click a bush: break it for sticks (and its berries). Right click: a menu to search it for
// berries. Left click a pebble: pick it up. Far ones are walked to first. All three are "picks"
// (world.setPick), synced with the `pick` message and saved with the world.
const GATHER_REACH = 1.9;
const nearby = (name, range) => {
  const w = game.world, list = (w.endless ? game.scene.live : w)[name] ?? [], p = game.ctrl.pos;
  return list.filter((o) => Math.abs(o.x - p.x) < range && Math.abs(o.z - p.z) < range);
};
// the closest of `list` to the cursor on screen (aiming `up` above its base), within `limit` px
function thingAt(list, px, py, up, limit) {
  let best = null, bd = limit;
  const v = new THREE.Vector3();
  for (const o of list) {
    v.set(o.x, o.y + up, o.z).project(camera);
    if (v.z > 1) continue;
    const d = Math.hypot((v.x + 1) / 2 * pixel.cssW - px, (1 - v.y) / 2 * pixel.cssH - py);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
const bushAt = (px, py) => thingAt(nearby('bushes', 14), px, py, 0.3, Math.max(18, 280 / game.cam.dist));
const pebbleAt = (px, py) => thingAt(nearby('pebbles', 14), px, py, 0.05, Math.max(12, 150 / game.cam.dist));
// what's on a cell right now (it may have been taken while we walked over)
const onCell = (name, ix, iz) => nearby(name, 6).find((o) => toCell(o.x) === ix && toCell(o.z) === iz);
// within reach of (x, z)? Otherwise walk next to it and then `run`
function inReach(o, run) {
  const c = game.ctrl;
  if (!c.moving && Math.hypot(o.x - c.pos.x, o.z - c.pos.z) <= GATHER_REACH) return true;
  const tx = toCell(o.x), tz = toCell(o.z), [ox, oz] = c.step ? [c.step.toIx, c.step.toIz] : [c.ix, c.iz];
  const cells = game.paths.route(ox, oz, tx, tz);
  if (!cells) { toast("Can't get there from here"); return false; }
  if (cells.length && cells[cells.length - 1] === cellKey(tx, tz)) cells.pop();
  c.setPath(cells);
  game.pendingDig = game.pendingChop = null;
  game.pendingAct = { x: o.x, z: o.z, reach: GATHER_REACH, run };
  return false;
}
// a furniture piece's footprint in its tile, [x0, x1, z0, z1] unrotated (from the model's bounding box)
const footprints = new Map();
function furnitureFootprint(t) {
  if (!footprints.has(t)) {
    const g = furnitureGeometry(t);
    if (!g.boundingBox) g.computeBoundingBox();
    const { min, max } = g.boundingBox;
    footprints.set(t, [min.x, max.x, min.z, max.z]);
  }
  return footprints.get(t);
}
const give = (id, n) => { if (n > 0 && inventory.add(id, n) > 0) toast('Your inventory is full'); };
// break something: its items pop out on the ground to be picked up (see drops.js)
function dropItem(id, n, x, y, z, spread = 1) {
  if (!game.drops || game.drops.scene !== game.scene?.scene) return give(id, n);
  game.drops.spawn(id, n, x, y, z, spread);
}
// ground height for drops and falling leaves: the floor you'd stand on, or the water's surface
function dropFloor(x, z) {
  const ix = toCell(x), iz = toCell(z), P = game.paths;
  if (!P) return groundAt(game.world, x, z);
  return P.waterAt(ix, iz) ? SEA : P.floorAt(ix, iz);
}
function breakBush(b) {
  const ix = toCell(b.x), iz = toCell(b.z), c = game.ctrl, now = clock.elapsedTime, w = game.world;
  if (!inReach(b, () => { const q = onCell('bushes', ix, iz); if (q) breakBush(q); })) return;
  if (now < game.nextDig) return;
  game.nextDig = now + SWING_SECS + 0.05;
  c.ry = Math.atan2(b.x - c.pos.x, b.z - c.pos.z);
  if (game.local) swingTool(game.local.char);
  setTimeout(() => {
    const q = game.world === w && onCell('bushes', ix, iz);
    if (!q) return;
    game.scene.effects.impact(q.x, q.y + 0.35, q.z, 1.6, 'leaves');
    applyPick(ix, iz, PICK.BUSH);
    const by = q.y + 0.35; // 1-2 sticks, 1-2 leaves, and its berries if it had any
    dropItem('stick', 1 + Math.floor(Math.random() * 2), q.x, by, q.z);
    dropItem('leaves', 1 + Math.floor(Math.random() * 2), q.x, by, q.z);
    if (q.berries) dropItem('berries', 1 + Math.floor(Math.random() * 2), q.x, by, q.z);
    if (game.mode === 'multi') send({ type: 'pick', ix, iz, t: PICK.BUSH });
    saveDigging();
  }, SWING_SECS * 450);
}
function searchBush(b) {
  const ix = toCell(b.x), iz = toCell(b.z);
  if (!inReach(b, () => { const q = onCell('bushes', ix, iz); if (q) searchBush(q); })) return;
  const q = onCell('bushes', ix, iz);
  if (!q) return;
  game.ctrl.ry = Math.atan2(q.x - game.ctrl.pos.x, q.z - game.ctrl.pos.z);
  if (!q.berries) return toast('No berries on this bush');
  const n = 1 + Math.floor(Math.random() * 3);
  applyPick(ix, iz, PICK.BERRIES);
  dropItem('berries', n, q.x, q.y + 0.4, q.z, 0.7);
  toast(n === 1 ? 'You found a berry' : `You found ${n} berries`);
  if (game.mode === 'multi') send({ type: 'pick', ix, iz, t: PICK.BERRIES });
  saveDigging();
}
function pickPebble(p) {
  const ix = toCell(p.x), iz = toCell(p.z);
  if (!inReach(p, () => { const q = onCell('pebbles', ix, iz); if (q) pickPebble(q); })) return;
  if (!onCell('pebbles', ix, iz)) return;
  applyPick(ix, iz, PICK.PEBBLE);
  give('pebble', 1);
  if (game.mode === 'multi') send({ type: 'pick', ix, iz, t: PICK.PEBBLE });
  saveDigging();
}
// ---------- cotton plants and wild flowers (picks COTTON and FLOWER) ----------
// With a free hand (nothing that digs, places, eats or is worn), a click on a cotton plant harvests it for 2-4 Cotton
// Balls (the plant is gone for good, like a broken bush), and a click on wild flowers picks every flower on that tile.
// Cotton makes clothes (RECIPES); flowers grind into dyes (Inventory.dyeRecipes). Both sync like other picks.
const handFree = (item) => !item || !(item.tool || item.block || item.place || item.food || item.cloth || item.boat || item.throwable);
const cottonAt = (px, py) => thingAt(nearby('cotton', 14), px, py, 0.25, Math.max(16, 240 / game.cam.dist));
const flowerAt = (px, py) => thingAt(nearby('flowers', 14), px, py, 0.08, Math.max(12, 170 / game.cam.dist));
function harvestCotton(p) {
  const ix = toCell(p.x), iz = toCell(p.z), c = game.ctrl, now = clock.elapsedTime, w = game.world;
  if (!inReach(p, () => { const q = onCell('cotton', ix, iz); if (q) harvestCotton(q); })) return;
  if (now < game.nextDig) return;
  game.nextDig = now + SWING_SECS + 0.05;
  c.ry = Math.atan2(p.x - c.pos.x, p.z - c.pos.z);
  if (game.local) swingTool(game.local.char);
  setTimeout(() => {
    const q = game.world === w && onCell('cotton', ix, iz);
    if (!q) return;
    game.scene.effects.impact(q.x, q.y + 0.3, q.z, 1.2, 'leaves');
    applyPick(ix, iz, PICK.COTTON);
    dropItem('cotton', 2 + Math.floor(Math.random() * 3), (q.x + c.pos.x) / 2, q.y + 0.35, (q.z + c.pos.z) / 2, 0.6); // tossed halfway to you, so it's always in reach
    if (game.mode === 'multi') send({ type: 'pick', ix, iz, t: PICK.COTTON });
    saveDigging();
  }, SWING_SECS * 450);
}
function pickFlowers(f) {
  const ix = toCell(f.x), iz = toCell(f.z), here = () => nearby('flowers', 6).filter((o) => toCell(o.x) === ix && toCell(o.z) === iz);
  if (!inReach(f, () => { const q = onCell('flowers', ix, iz); if (q) pickFlowers(q); })) return;
  const list = here();
  if (!list.length) return;
  const by = {}; // flowers on this tile, by colour
  for (const o of list) by[flowerKey(o.c)] = (by[flowerKey(o.c)] ?? 0) + 1;
  const at = list[0];
  game.ctrl.ry = Math.atan2(at.x - game.ctrl.pos.x, at.z - game.ctrl.pos.z);
  applyPick(ix, iz, PICK.FLOWER);
  const c = game.ctrl, mx = (at.x + c.pos.x) / 2, mz = (at.z + c.pos.z) / 2; // tossed halfway to you, so it's always in reach
  for (const [key, n] of Object.entries(by)) dropItem(`flower_${key}`, n, mx, at.y + 0.2, mz, 0.5);
  if (game.mode === 'multi') send({ type: 'pick', ix, iz, t: PICK.FLOWER });
  saveDigging();
}

// Rocks: the pickaxe breaks them (rockHits swings, by size) into Stone (rockStone), and sometimes a pebble.
// A mined rock is a pick (PICK.ROCK): gone for good, synced and saved like a broken bush.
const rockHits = (r) => (r.s < 0.38 ? 2 : 3);
const rockStone = (r) => 1 + Math.round(r.s * 6); // 3 for a small rock, 4 for a big one
const rockAt = (px, py) => thingAt(nearby('rocks', 14), px, py, 0.25, Math.max(18, 240 / game.cam.dist));
const mineHits = new Map(); // cellKey -> swings so far on a rock
function mineRock(r) {
  const ix = toCell(r.x), iz = toCell(r.z), c = game.ctrl, now = clock.elapsedTime, w = game.world;
  if (!inReach(r, () => { const q = onCell('rocks', ix, iz); if (q) mineRock(q); })) return;
  if (now < game.nextDig) return;
  game.nextDig = now + SWING_SECS + 0.05;
  c.ry = Math.atan2(r.x - c.pos.x, r.z - c.pos.z);
  if (game.local) swingTool(game.local.char);
  setTimeout(() => {
    const q = game.world === w && onCell('rocks', ix, iz);
    if (!q) return;
    const key = cellKey(ix, iz), hits = (mineHits.get(key) ?? 0) + 1, top = q.y + q.s * 0.6;
    game.scene.effects.impact(q.x, top, q.z, 1.2, K.ROCK); // stone chips fly
    if (hits < rockHits(q)) { mineHits.set(key, hits); return; }
    mineHits.delete(key);
    game.scene.effects.impact(q.x, q.y + 0.2, q.z, 2.2, K.ROCK); // it breaks apart
    applyPick(ix, iz, PICK.ROCK);
    dropItem('stone', rockStone(q), q.x, top, q.z, 1.1);
    if (Math.random() < 0.4) dropItem('pebble', 1, q.x, top, q.z, 1.1);
    if (game.mode === 'multi') send({ type: 'pick', ix, iz, t: PICK.ROCK });
    saveDigging();
  }, SWING_SECS * 450);
}
// take a bush, its berries, a pebble or a rock out of the world and the scene
function applyPick(ix, iz, t) {
  const w = game.world, hit = w.setPick(ix, iz, t);
  if (w.endless) game.scene.refreshCell(ix, iz); // rebuilds that chunk without it
  else for (const o of hit) {
    if (t === PICK.ROCK) { game.scene.hideTree({ x: o.x, y: o.y + o.s * 0.35, z: o.z }); continue; } // the rock instance sits a little up
    if (t === PICK.BUSH || t === PICK.BERRIES) game.scene.hideBerries(o);
    if (t !== PICK.BERRIES) game.scene.hideTree(o);
  }
  if (t === PICK.ROCK && game.paths) { game.paths.refresh(ix, iz); game.digVersion = (game.digVersion ?? 0) + 1; } // its tile is open now
}
function onPick({ id, ix, iz, t }) {
  if (id === game.me) return;
  applyPick(ix, iz, t);
  const r = game.remotes.get(id);
  if (r && (t === PICK.BUSH || t === PICK.ROCK)) swingTool(r.char);
}
// right click: a small menu for the bush under the cursor
function hideCtx() { $('ctx-menu').hidden = true; }
function onRight(px, py) {
  hideCtx();
  if (!game.world || !game.ctrl || editor.active || inventory.isOpen || (game.mode !== 'single' && game.mode !== 'multi')) return;
  if (game.ride) { if (ITEMS[inventory.held?.id]?.food) eatHeld(); else if (ITEMS[inventory.held?.id]?.cloth) wearHeld(); return; } // aboard: right-click only eats or dresses
  const wb = benchAt(px, py);
  if (wb && wb[3] === 0) return useWorkbench(wb); // right-clicking a workbench opens it too
  // a small menu: a boat can go back in your inventory, a bush can be searched for berries
  const boat = boatAt(px, py), b = boat ? null : bushAt(px, py);
  if (!boat && !b) { if (ITEMS[inventory.held?.id]?.food) eatHeld(); else if (ITEMS[inventory.held?.id]?.cloth) wearHeld(); return; } // nothing to right-click: eat or wear what's in hand

  const el = $('ctx-menu'), btn = el.querySelector('button');
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.hidden = false;
  btn.textContent = boat ? 'Put boat in inventory' : 'Search for berries';
  btn.onclick = (e) => { e.currentTarget.blur(); hideCtx(); if (boat) takeBoat(boat); else searchBush(b); };
}
input.onRight = onRight;
input.onUp = () => { if (game.fishing && game.local) game.fishing.release(fishCtx()); }; // let go: the cast goes out
// what fishing.js needs from the game each call
const _fp = new THREE.Vector3();
function fishCtx() {
  const c = game.ctrl;
  return {
    world: game.world, pos: c.pos, facing: c.ry, char: game.local.char, effects: game.scene.effects, night: game.scene.night ?? 0,
    toast, give, icon: iconURL,
    swing: () => swingTool(game.local.char),
    faceTo: (dx, dz) => { c.ry = Math.atan2(dx, dz); },
    project: (x, y, z) => {
      _fp.set(x, y, z).project(camera);
      if (_fp.z > 1) return null;
      const r = $('view').getBoundingClientRect();
      return [r.left + (_fp.x + 1) / 2 * r.width, r.top + (1 - _fp.y) / 2 * r.height];
    },
  };
}

// ---------- chopping trees with the axe ----------
const CHOP_REACH = 1.95;
const TREE_WOOD = { leafy: 3, pine: 4, redwood: 8, palm: 3 }, TREE_HITS = { leafy: 3, pine: 3, redwood: 6, palm: 3 }, TREE_LEAVES = { leafy: 3, pine: 2, redwood: 4, palm: 3 };
const treeType = (t) => (t.palm ? 'palm' : t.pine ? 'pine' : t.pine === false ? 'leafy' : 'redwood');
// trees near the player: the island's lists, or what's loaded in an endless world
function nearbyTrees(range) {
  const w = game.world, src = w.endless ? game.scene.live : w, p = game.ctrl.pos;
  return [...src.trees, ...src.redwoods].filter((t) => Math.abs(t.x - p.x) < range && Math.abs(t.z - p.z) < range);
}
// the tree under the cursor: closest trunk (base to about head height) on screen
function treeAt(px, py, only = null) {
  let best = null, bd = Math.max(18, 260 / game.cam.dist);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const t of nearbyTrees(16)) {
    if (only && !only(t)) continue;
    const tall = treeType(t) === 'redwood' ? 4 * t.s : (treeType(t) === 'palm' ? 1.8 : 1.4) * t.s;
    a.set(t.x, t.y + 0.15, t.z).project(camera);
    b.set(t.x, t.y + tall, t.z).project(camera);
    if (a.z > 1 || b.z > 1) continue;
    const ax = (a.x + 1) / 2 * pixel.cssW, ay = (1 - a.y) / 2 * pixel.cssH, bx = (b.x + 1) / 2 * pixel.cssW, by = (1 - b.y) / 2 * pixel.cssH;
    const vx = bx - ax, vy = by - ay, k = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / Math.max(1, vx * vx + vy * vy)));
    const d = Math.hypot(px - (ax + vx * k), py - (ay + vy * k));
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function chopTree(t) {
  const c = game.ctrl, now = clock.elapsedTime;
  if (Math.hypot(t.x - c.pos.x, t.z - c.pos.z) > CHOP_REACH) { // walk next to it first
    const tx = toCell(t.x), tz = toCell(t.z), cells = game.paths.route(c.ix, c.iz, tx, tz);
    if (!cells) return toast("Can't get there from here");
    if (cells.length && cells[cells.length - 1] === cellKey(tx, tz)) cells.pop();
    c.setPath(cells);
    game.pendingDig = null;
    game.pendingChop = t;
    showMarker({ x: t.x, z: t.z }, false);
    return;
  }
  if (now < game.nextDig) return;
  game.nextDig = now + SWING_SECS + 0.05;
  c.ry = Math.atan2(t.x - c.pos.x, t.z - c.pos.z);
  if (game.local) swingTool(game.local.char);
  const key = cellKey(t.ix, t.iz), type = treeType(t), w = game.world;
  setTimeout(() => {
    if (game.world !== w) return;
    const hits = (game.chopHits.get(key) ?? 0) + 1, last = hits >= TREE_HITS[type];
    game.scene.effects.impact(t.x, t.y + 0.45, t.z, 1.0, 'wood'); // chips fly
    // the tree shakes and leaves flutter down from the canopy
    const cy = t.y + (type === 'redwood' ? 8 : type === 'pine' ? 1.1 : type === 'palm' ? 2.3 : 1.1 + LEAFY_LIFT) * t.s, cr = (type === 'redwood' ? 1.6 : 0.65) * t.s;
    game.scene.effects.leafFall(t.x, cy, t.z, cr, last ? 40 : 10 + Math.floor(Math.random() * 6), dropFloor);
    if (!last) {
      game.chopHits.set(key, hits);
      game.scene.shakeTree(t, t.x - game.ctrl.pos.x, t.z - game.ctrl.pos.z, type === 'redwood' ? 0.03 : 0.08);
      return;
    }
    game.chopHits.delete(key);
    game.scene.effects.impact(t.x, cy, t.z, 2.4, 'leaves'); // the canopy bursts
    applyChop(t.ix, t.iz);
    dropItem('log', TREE_WOOD[type], t.x, t.y + 0.8, t.z, 1.3);
    dropItem('leaves', TREE_LEAVES[type], t.x, t.y + 0.8, t.z, 1.3);
    if (game.mode === 'multi') send({ type: 'chop', ix: t.ix, iz: t.iz });
    saveDigging();
  }, SWING_SECS * 450);
}
// take the tree growing from cell (ix, iz) out of the world and refresh what depends on it
function applyChop(ix, iz) {
  const w = game.world;
  if (w.endless) {
    w.removeTree(ix, iz);
    game.scene.refreshCell(ix, iz); // rebuilds that chunk without the tree
  } else {
    const t = w.removeTree(ix, iz);
    if (!t) return;
    game.scene.hideTree(t);
  }
  game.paths.refresh(ix, iz);
  game.digVersion = (game.digVersion ?? 0) + 1;
}
function onChop({ id, ix, iz }) {
  if (id === game.me) return;
  applyChop(ix, iz);
  const r = game.remotes.get(id);
  if (r) swingTool(r.char);
}

// ---------- frogs: catch them, throw them ----------
const CATCH_REACH = 2.2, THROW_RANGE = 7;
// the frog under the cursor (screen distance from its projected position), or null
function frogAt(px, py) {
  let best = null, bd = Math.max(16, 240 / game.cam.dist);
  const v = new THREE.Vector3();
  for (const f of game.scene.ambient.catchableFrogs()) {
    v.set(f.x, f.y + 0.12, f.z).project(camera);
    if (v.z > 1) continue;
    const d = Math.hypot((v.x + 1) / 2 * pixel.cssW - px, (1 - v.y) / 2 * pixel.cssH - py);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
function catchFrog(f) {
  const c = game.ctrl;
  if (Math.hypot(f.x - c.pos.x, f.z - c.pos.z) > CATCH_REACH) { // walk over first (it may hop off meanwhile)
    const cells = game.paths.route(c.ix, c.iz, toCell(f.x), toCell(f.z));
    if (!cells) return toast("Can't get there from here");
    if (cells.length && cells[cells.length - 1] === cellKey(toCell(f.x), toCell(f.z))) cells.pop();
    c.setPath(cells);
    game.pendingDig = null;
    game.pendingCatch = f.i;
    return;
  }
  if (inventory.add('frog', 1) > 0) return toast('Your inventory is full');
  c.ry = Math.atan2(f.x - c.pos.x, f.z - c.pos.z);
  game.scene.ambient.takeFrog(f.i);
  if (game.local) swingTool(game.local.char);
  toast('You caught a frog!');
}
function throwAt(px, py) {
  const p = groundPoint(px, py), c = game.ctrl, t = clock.elapsedTime;
  if (!p || t < game.nextDig) return;
  let dx = p.x - c.pos.x, dz = p.z - c.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return;
  if (d > THROW_RANGE) { dx *= THROW_RANGE / d; dz *= THROW_RANGE / d; } // as far as you can throw
  c.ry = Math.atan2(dx, dz);
  if (!inventory.takeHeld(1)) return;
  game.nextDig = t + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  const w = game.world;
  setTimeout(() => { // let go mid-swing
    if (game.world !== w) return;
    const from = { x: c.pos.x + Math.sin(c.ry) * 0.25, y: c.pos.y + 0.75, z: c.pos.z + Math.cos(c.ry) * 0.25 };
    game.scene.ambient.throwFrog(from, { x: c.pos.x + dx, z: c.pos.z + dz }, c.pos);
  }, SWING_SECS * 400);
}

// A thrown coconut flies in an arc, spinning, and splits in two where it lands: two Coconut Halves (edible) pop out.
const nuts = []; // in flight: { w, x0, y0, z0, x1, z1, age, dur, h, mesh }
function throwNut(px, py) {
  const p = groundPoint(px, py), c = game.ctrl, t = clock.elapsedTime;
  if (!p || t < game.nextDig) return;
  let dx = p.x - c.pos.x, dz = p.z - c.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.3) return;
  if (d > THROW_RANGE) { dx *= THROW_RANGE / d; dz *= THROW_RANGE / d; }
  c.ry = Math.atan2(dx, dz);
  if (!inventory.takeHeld(1)) return;
  game.nextDig = t + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  const w = game.world, len = Math.hypot(dx, dz);
  setTimeout(() => { // let go mid-swing
    if (game.world !== w || !game.scene) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.17, 0.17), new THREE.MeshLambertMaterial({ color: 0x6e4a30 }));
    mesh.castShadow = true;
    game.scene.scene.add(mesh);
    nuts.push({ w, mesh, x0: c.pos.x + Math.sin(c.ry) * 0.25, y0: c.pos.y + 0.75, z0: c.pos.z + Math.cos(c.ry) * 0.25, x1: c.pos.x + dx, z1: c.pos.z + dz, age: 0, dur: 0.4 + 0.06 * len, h: 0.7 + 0.15 * len });
  }, SWING_SECS * 400);
}
function updateNuts(dt) {
  for (let i = nuts.length - 1; i >= 0; i--) {
    const n = nuts[i];
    if (n.w !== game.world) { n.mesh.parent?.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose(); nuts.splice(i, 1); continue; }
    n.age += dt;
    const k = Math.min(1, n.age / n.dur), x = n.x0 + (n.x1 - n.x0) * k, z = n.z0 + (n.z1 - n.z0) * k, floor = dropFloor(x, z) + 0.1;
    const y = n.y0 + (floor - n.y0) * k + Math.sin(k * Math.PI) * n.h;
    n.mesh.position.set(x, y, z);
    n.mesh.rotation.set(n.age * 14, n.age * 9, n.age * 6);
    if (k < 1) continue;
    // it lands and cracks open
    n.mesh.parent?.remove(n.mesh); n.mesh.geometry.dispose(); n.mesh.material.dispose(); nuts.splice(i, 1);
    const water = game.paths?.waterAt(toCell(x), toCell(z));
    game.scene.effects.impact(x, floor, z, 1.5, water ? 'water' : 'wood');
    dropItem('coconut_half', 2, x, floor + 0.2, z, 0.8);
    toast('The coconut cracks open!');
  }
}

// ---------- boats: launch, board, walk the deck, steer, step off ----------
// game.boats (boat.js) holds every boat; game.ride = { id, lx, lz, steer, push } while you're aboard
// (lx, lz = your deck position); game.driving = the boat id you're sailing (also while it coasts).
const BOAT_SEND_MS = 100;
const BOAT_LOCKER = 'settleon.boatlook'; // the look of the last boat you took out of the water
// a screen-relative key direction as a unit world vector (not snapped), or null
function screenDir(keys, yaw) {
  if (!keys.x && !keys.z) return null;
  const wx = Math.cos(yaw) * keys.x - Math.sin(yaw) * keys.z, wz = -Math.sin(yaw) * keys.x - Math.cos(yaw) * keys.z;
  const l = Math.hypot(wx, wz);
  return [wx / l, wz / l];
}
function sendBoat(b, on = true, withLook = false) {
  if (game.mode !== 'multi') return;
  send({ type: 'boat', id: b.id, x: +b.x.toFixed(2), z: +b.z.toFixed(2), yaw: +b.yaw.toFixed(3), on, t: Math.round(performance.now()), h: +(b.heel ?? 0).toFixed(3), l: +(b.lean ?? 0).toFixed(3), g: b.throttle ?? 0, r: +(b.rudder ?? 0).toFixed(2), ...(withLook ? { look: b.look } : {}) });
}
function onBoat({ id, x, z, yaw, on, look, t, h, l, g, r }) {
  if (on) {
    if (game.driving !== id) {
      const b = game.boats.set(id, x, z, yaw, false, look);
      if (typeof t === 'number') game.boats.sample(id, x, z, yaw, t, typeof h === 'number' ? h : null, typeof l === 'number' ? l : null);
      if (typeof g === 'number') { b.netThrottle = g; b.netRudder = typeof r === 'number' ? r : 0; } // (the pirate ship's sails follow them)
    }
    return;
  }
  if (game.ride?.id === id) leaveBoat(); // it was taken out of the water under us
  game.boats.remove(id);
}

// put the held boat in the water: its stern toward you, on open water around the clicked tile
function launchBoat(px, py) {
  const p = groundPoint(px, py);
  if (!p) return;
  if (launchAt(toCell(p.x), toCell(p.z)) && game.local) swingTool(game.local.char);
}
// the look a launched boat gets: the last boat you took out of the water (paint, name, upgrades, size; kept in the
// locker), as the kind of boat you're launching
function lockerLook(t) {
  let raw = null;
  try { raw = localStorage.getItem(BOAT_LOCKER); } catch {}
  if (lockerLook.raw !== raw || lockerLook.t !== t) {
    let saved = null;
    try { saved = JSON.parse(raw ?? 'null'); } catch {}
    Object.assign(lockerLook, { raw, t, look: cleanLook({ ...cleanLook(saved), t }) });
  }
  return lockerLook.look;
}
/**
 * Where a boat of kind t would go in for a click on cell (ix, iz): its stern toward you, pointing away (snapped to
 * 45°), moved out until the whole hull floats clear of land and other boats. { x, z, yaw, look, hl, why } with `why`
 * the reason it can't (x, z is then just where the click was). Shared by the click and the launch blueprint.
 */
function launchPlan(ix, iz, t) {
  const look = lockerLook(t), hl = hullOf(look);
  const c = game.ctrl, w = game.world, x0 = toWorld(ix), z0 = toWorld(iz);
  const yaw = Math.round(Math.atan2(x0 - c.pos.x, z0 - c.pos.z) / (Math.PI / 4)) * (Math.PI / 4);
  const plan = { x: x0 - Math.sin(yaw) * hl.STERN, z: z0 - Math.cos(yaw) * hl.STERN, y: Math.max(SEA, w.H(ix, iz)), yaw, look, hl, why: null }; // (stern on the click, on the ground there)
  if (Math.hypot(x0 - c.pos.x, z0 - c.pos.z) > 5) return { ...plan, why: 'Too far: click the water near you' };
  if (w.H(ix, iz) >= SEA) return { ...plan, why: 'Boats go in the water' };
  for (const k of [2.5, 3, 2, 3.5, 4, 1.5, 5, 6, 7, 8, 10].map((k) => k * Math.max(1, hl.reach / 4.5))) { // further out for a big boat // move it out (past sandbanks) until the whole hull floats
    const x = x0 + Math.sin(yaw) * k, z = z0 + Math.cos(yaw) * k;
    if (hullClear(w, x, z, yaw, hl) && !boatHit(game.boats, 0, x, z, yaw, hl)) return { ...plan, x, z, y: SEA }; // floating, and clear of other boats
  }
  return { ...plan, why: 'Not enough open water here' };
}
function launchAt(ix, iz, t = ITEMS[inventory.held?.id]?.hull ?? 0) {
  const plan = launchPlan(ix, iz, t);
  if (plan.why) return void toast(plan.why);
  if (!inventory.takeHeld(1)) return;
  const b = game.boats.set(1 + Math.floor(Math.random() * (2 ** 31 - 2)), plan.x, plan.z, plan.yaw, true, plan.look);
  game.scene.effects.splash(plan.x, SEA, plan.z, 0.9); // in it goes
  sendBoat(b, true, true);
  saveDigging();
  toast('Walk aboard, then press F at the wheel to sail');
  return true;
}
// The launch blueprint: with a boat in hand, a see-through blue copy of it (pale lines frame the hull and cabin) bobbing on the
// water where a click would put it in; red, with its stern on the clicked spot, where it can't go.
const BOAT_BP = { ok: [0x3a9cff, 0xd8eeff], bad: [0xff4a3a, 0xffd8d0], fill: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false }), edge: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }) };
function updateLaunchBlueprint(t) {
  const item = ITEMS[inventory.held?.id], hover = input.hover;
  let bp = game.launchBp;
  const show = item?.boat && hover && !inventory.isOpen && !game.ride && !game.boatEdit && game.ctrl;
  let plan = null;
  if (show) {
    // only re-march the ray and re-plan when the mouse, the camera, you or the terrain changed
    const cp = camera.position, c = game.ctrl;
    const key = `${hover[0]},${hover[1]},${game.digVersion},${cp.x.toFixed(2)},${cp.z.toFixed(2)},${c.ix},${c.iz},${item.hull},${game.boats.list.size}`;
    const memo = (game.launchMemo ??= {});
    if (memo.key !== key) {
      const p = groundPoint(hover[0], hover[1]);
      Object.assign(memo, { key, plan: p ? launchPlan(toCell(p.x), toCell(p.z), item.hull ?? 0) : null });
    }
    plan = memo.plan;
  }
  if (!plan) { if (bp) bp.visible = false; return; }
  if (!bp) {
    bp = game.launchBp = new THREE.Group();
    bp.add(new THREE.Mesh(undefined, BOAT_BP.fill), new THREE.LineSegments(undefined, BOAT_BP.edge));
    bp.children.forEach((o) => { o.renderOrder = 8; });
    game.scene.scene.add(bp);
  }
  if (bp.parent !== game.scene.scene) game.scene.scene.add(bp);
  bp.children[0].geometry = blueprintGeometry(plan.look);
  bp.children[1].geometry = blueprintLines(plan.look);
  bp.position.set(plan.x, plan.y + Math.sin(t * 1.25) * 0.045, plan.z);
  bp.rotation.y = plan.yaw;
  const [fill, edge] = plan.why ? BOAT_BP.bad : BOAT_BP.ok;
  BOAT_BP.fill.color.setHex(fill);
  BOAT_BP.edge.color.setHex(edge); // pale edges, so the boat's lines read over the water
  // where it can't go (often on land, half buried in the slope), it's drawn over everything, a little fainter
  if (BOAT_BP.fill.depthTest !== !plan.why) { BOAT_BP.fill.depthTest = BOAT_BP.edge.depthTest = !plan.why; BOAT_BP.fill.needsUpdate = BOAT_BP.edge.needsUpdate = true; }
  BOAT_BP.fill.opacity = plan.why ? 0.28 : 0.42;
  bp.visible = true;
}
// the boat under the cursor (where the cursor meets the water), or null
function boatAt(px, py) {
  const p = groundPoint(px, py);
  if (!p || !game.boats.list.size) return null;
  const b = game.boats.at(p.x, p.z);
  return b && Math.hypot(b.sx - game.ctrl.pos.x, b.sz - game.ctrl.pos.z) < 16 ? b : null;
}
// the axe takes a boat back out of the water (when nobody is aboard)
function takeBoat(b) {
  const c = game.ctrl;
  const [lx, lz] = toLocal(b, c.pos.x, c.pos.z);
  if (Math.hypot(lx, lz) > 5.5) return toast('Walk up to the boat first');
  for (const r of game.remotes.values()) if (r.ride?.[0] === b.id) return toast('Someone is aboard');
  if (game.local) swingTool(game.local.char);
  try { localStorage.setItem(BOAT_LOCKER, JSON.stringify(b.look)); } catch {} // your boat's look comes back at the next launch
  game.boats.remove(b.id);
  game.scene.effects.splash(b.sx, SEA, b.sz, 0.8);
  give(HULL_ITEMS[b.look.t] ?? 'boat', 1);
  sendBoat(b, false);
  saveDigging();
}

// walking toward a boat from the shore or the water climbs aboard
function tryBoard(keys, yaw, t) {
  const c = game.ctrl;
  if (!game.boats.list.size) return false; // also mid-step: holding a key chains steps back to back
  const d = screenDir(keys, yaw);
  if (!d) return false;
  for (const b of game.boats.list.values()) {
    if (Math.hypot(b.sx - c.pos.x, b.sz - c.pos.z) > 5) continue;
    const [lx, lz] = toLocal(b, c.pos.x + d[0] * 1.25, c.pos.z + d[1] * 1.25); // far enough to reach the deck from the nearest half tile beside the hull
    if (!onDeck(lx, lz, b.hull)) continue;
    const spot = nearestWalkable(lx, lz, b.obs, b.hull);
    if (!spot) continue;
    const up = deckY(b, t) - c.pos.y;
    if (!c.swimming && (up > 1.4 || up < -3)) continue; // too high a climb from here (from the water you just climb aboard)
    board(b, spot[0], spot[1]);
    return true;
  }
  return false;
}
function board(b, lx, lz) {
  const c = game.ctrl;
  c.step = null;
  c.queue = [];
  game.pendingDig = game.pendingChop = game.pendingAct = null;
  game.pendingCatch = null;
  game.ride = { id: b.id, lx, lz, steer: false, push: 0 };
  if (!game.boatHint) { game.boatHint = true; toast('All aboard! Press F at the wheel to sail'); }
}
// step off onto the tile at world (x, z): land within a climb of the deck, or into the water
function leaveBoat(ix = null, iz = null) {
  const c = game.ctrl, ry = c.ry;
  if (ix === null) [ix, iz] = game.paths.nearestOpen(toCell(c.pos.x), toCell(c.pos.z), 8) ?? [toCell(c.pos.x), toCell(c.pos.z)];
  if (game.driving === game.ride?.id) game.driving = null;
  game.ride = null;
  placeController(ix, iz).ry = ry;
}

// F: aboard, take or leave the helm; ashore, board a boat that's close and take its helm
function boatKey() {
  if (!game.ctrl || !game.boats) return;
  if (game.ride) return toggleHelm();
  const c = game.ctrl, best = nearestBoat();
  if (!best) return toast('No boat nearby');
  if (!c.swimming && deckY(best, 0) - c.pos.y > 1.4) return toast("Can't climb aboard from here");
  board(best, best.hull.HELM[0], best.hull.HELM[1]);
  toggleHelm();
}
function toggleHelm() {
  const r = game.ride;
  if (!r) return;
  r.steer = !r.steer;
  const b = game.boats.list.get(r.id);
  if (r.steer) { [r.lx, r.lz] = b.hull.HELM; game.driving = r.id; r.repeat = 0.4; }
  else if (b) setThrottle(b, 0); // letting go of the wheel rings Stop: it glides to a halt
  toast(r.steer ? 'At the helm: W / S throttle up and down, A / D steer, F to let go' : 'You let go of the wheel: throttle to Stop');
}
// the ship's wheel under the cursor, while aboard
function wheelAt(px, py) {
  const b = game.boats.list.get(game.ride?.id);
  if (!b) return false;
  const [wx, wz, wy] = b.hull.WHEEL, [x, z] = toWorldXZ(b, wx, wz);
  const v = new THREE.Vector3(x, SEA + b.hull.DECK + wy, z).project(camera);
  return Math.hypot((v.x + 1) / 2 * pixel.cssW - px, (1 - v.y) / 2 * pixel.cssH - py) < Math.max(18, 300 / game.cam.dist);
}

// sail: the boat turns toward the held screen direction and picks up speed when it's facing there;
// it coasts to a stop when you let go, and stops dead against land
// the throttle gauge (#throttle, shown at the helm): the current notch and the speed
function setThrottle(b, t) {
  b.throttle = Math.max(-1, Math.min(THROTTLE.length - 2, t));
}
const GEAR_PX = 26; // notch spacing on the throttle lever's track (index.html / style.css)
function throttleHud(b) {
  const el = $('throttle'), show = !!(b && game.ride?.steer);
  if (el.hidden === show) el.hidden = !show;
  if (!show) return;
  const t = b.throttle ?? 0;
  if (el.dataset.t !== String(t)) { // move the lever to its notch (CSS eases it there with a clunk)
    el.dataset.t = String(t);
    el.querySelector('.th-lever').style.top = `${(THROTTLE.length - 2 - t) * GEAR_PX}px`;
    el.querySelectorAll('.th-labels span').forEach((x) => x.classList.toggle('on', Number(x.dataset.t) === t));
  }
  const v = (b.vx ?? 0) * Math.sin(b.yaw) + (b.vz ?? 0) * Math.cos(b.yaw);
  $('th-speed').textContent = `${Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1)} tiles/s`;
}

function driveBoat(dt, keys, steps = 0) {
  const r = game.ride, b = game.boats.list.get(r.id), w = game.world;
  if (!b) return leaveBoat();
  throttleHud(b);
  if (game.driving !== b.id) return;
  b.vx ??= 0; b.vz ??= 0; b.sail ??= 0; b.rudder ??= 0; b.throttle ??= 0;
  const k = r.steer ? keys : { x: 0, z: 0 };
  // throttle: each press of W / S moves it one notch (holding repeats after 0.4 s), and it stays there
  const z = Math.sign(k.z);
  if (r.steer && steps) { setThrottle(b, b.throttle + steps); r.repeat = 0.4; }
  else if (!z) r.repeat = 0.4;
  else if ((r.repeat -= dt) <= 0) { r.repeat = 0.3; setThrottle(b, b.throttle + z); }
  const sailTo = THROTTLE[b.throttle + 1].sail;
  b.sail += (sailTo - b.sail) * (1 - Math.exp(-dt * BOAT.SAIL_RATE)); // the sails fill and slacken gradually
  // steering is relative to the boat, not the camera, so it can turn a full 360° with the camera left alone:
  // D puts the rudder over to the boat's right (its heading decreases), A to its left
  const helm = r.steer ? -k.x : 0; // the wheel swings over at RUDDER_RATE and springs back to centre faster
  b.rudder += (helm - b.rudder) * (1 - Math.exp(-dt * BOAT.RUDDER_RATE * (helm ? 1 : 1.8)));
  // velocity in the boat's frame: forward speed eases toward what the sail gives (and glides a long way
  // without it); sideways slip from turning is damped by the keel, so the boat drifts a little in turns
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
  let fwd = b.vx * fx + b.vz * fz, side = b.vx * rx + b.vz * rz;
  // over shallow sand (how far it has ridden up, see Boats.update) the hull drags: top speed falls by up to
  // SHALLOW_SLOW, and it sheds speed quickly on running onto a sandbank
  const shallow = Math.min(1, (b.lift ?? 0) / BOAT.SHALLOW_LIFT);
  const hl = b.hull;
  // the swell (waves.js, open water only): heading into it costs a little top speed, running with it gains a little
  const env = Math.min(1, b.wEnv ?? 0), head = -(fx * WAVE_DIR.x + fz * WAVE_DIR.z); // 1 = bow straight into the swell
  const seas = 1 - env * (head > 0 ? WAVE_HEAD_SLOW * head : -WAVE_FOLLOW * head);
  const want = b.sail * hl.MAX_SPEED * engineFactor(b) * (1 - BOAT.SHALLOW_SLOW * shallow) * seas; // the engine upgrade adds 15% a level
  // filling the sail builds speed (ACCEL); backing it against your way brakes a bit harder; no sail glides (GLIDE)
  let rate = !want ? hl.GLIDE : fwd && Math.sign(want) !== Math.sign(fwd) ? hl.ACCEL * 1.4 : Math.abs(want) > Math.abs(fwd) ? hl.ACCEL : hl.GLIDE;
  if (Math.abs(fwd) > Math.abs(want)) rate = Math.max(rate, BOAT.SAND_DRAG * shallow); // the sand drags it down
  fwd += (want - fwd) * (1 - Math.exp(-dt * rate));
  // climbing a wave's face slows it, sliding down the back surfs it on (wP: the bow's pitch on the swell, + = up)
  fwd -= Math.sin(b.wP ?? 0) * WAVE_PUSH * dt;
  side *= Math.exp(-dt * BOAT.KEEL);
  b.vx = fwd * fx + side * rx;
  b.vz = fwd * fz + side * rz;
  // the rudder only bites with water flowing past it: barely any turning at a standstill. It turns the same
  // way going astern (not reversed like a real rudder), so the keys always mean the same thing
  const bite = Math.min(1, Math.abs(fwd) / BOAT.FULL_TURN_SPEED);
  b.turn = b.rudder * hl.TURN * rudderFactor(b) * Math.max(bite, BOAT.IDLE_TURN); // the rudder upgrade adds 20% a level
  const ny = b.yaw + b.turn * dt;
  // turning can't swing the hull into land, or deeper into another boat
  const hitNow = boatHit(game.boats, b.id, b.x, b.z, b.yaw, hl)?.depth ?? 0;
  if (hullClear(w, b.x, b.z, ny, hl) && (boatHit(game.boats, b.id, b.x, b.z, ny, hl)?.depth ?? 0) <= hitNow + 1e-4) b.yaw = ny;
  else {
    // swinging the bow or stern into the shore: a small splash where it touches
    if (Math.abs(b.turn) > 0.15 && !hullClear(w, b.x, b.z, ny, hl)) shoreSplash(b, hullContact(w, b.x, b.z, ny, hl), Math.abs(b.turn) * 1.2, 0, 0);
    b.turn = 0;
  }
  // move; against land it bumps back a little and loses its way
  // the swell also sets the boat slowly along with it (drift, not kept as speed)
  const dvx = WAVE_DIR.x * WAVE_DRIFT * env, dvz = WAVE_DIR.z * WAVE_DRIFT * env;
  const speed = Math.hypot(b.vx, b.vz);
  if (speed > 0.005 || env > 0.05) {
    const nx = b.x + (b.vx + dvx) * dt, nz = b.z + (b.vz + dvz) * dt;
    if (hullClear(w, nx, nz, b.yaw, hl)) { b.x = nx; b.z = nz; }
    else {
      // a splash where the hull meets the shore, bigger the faster it hit (even a gentle nudge sloshes a little)
      const k = Math.min(1, speed / hl.MAX_SPEED), mx = (b.vx + dvx) / (speed || 1), mz = (b.vz + dvz) / (speed || 1);
      shoreSplash(b, hullContact(w, nx, nz, b.yaw, hl), speed, mx * (0.4 + k), mz * (0.4 + k));
      if (speed > 1.2) toast('Bump! Land ahead');
      b.vx *= -0.25; b.vz *= -0.25;
      b.sail *= 0.3;
    }
  }
  // other boats: push apart, bounce off a little, and lose some way. Parked and remote boats don't budge here
  // (whoever sails a boat moves it), so this boat takes the whole push.
  const hit = boatHit(game.boats, b.id, b.x, b.z, b.yaw, hl);
  if (hit) {
    const px = b.x + hit.nx * (hit.depth + 0.01), pz = b.z + hit.nz * (hit.depth + 0.01);
    if (hullClear(w, px, pz, b.yaw, hl)) { b.x = px; b.z = pz; }
    const vn = b.vx * hit.nx + b.vz * hit.nz; // speed into the other boat (negative = closing in)
    if (vn < 0) {
      b.vx -= 1.3 * vn * hit.nx; b.vz -= 1.3 * vn * hit.nz; // reflect 30% of it
      b.vx *= 0.8; b.vz *= 0.8; // scraping hulls
      b.sail *= 0.5;
      if (-vn > 1.0) {
        game.scene.effects.splash(hit.cx, SEA, hit.cz, Math.min(1, 0.35 - vn * 0.15), -hit.nx * 0.5, -hit.nz * 0.5); // spray between the hulls
        const now = performance.now();
        if (now - (game.boatBumpAt ?? 0) > 1500) { game.boatBumpAt = now; toast(hit.other.look?.n ? `Bump! You ran into ${hit.other.look.n}` : 'Bump! Mind the other boat'); }
      }
    }
  }
  b.speed = Math.hypot(b.vx, b.vz);
  Object.assign(b, { sx: b.x, sz: b.z, syaw: b.yaw }); // the driver draws it exactly where it is
  const now = performance.now(), moved = Math.abs(b.x - (b.sentX ?? 0)) + Math.abs(b.z - (b.sentZ ?? 0)) + Math.abs(b.yaw - (b.sentYaw ?? 0)) > 0.005;
  if (moved && now - (b.sentAt ?? 0) > BOAT_SEND_MS) {
    Object.assign(b, { sentX: b.x, sentZ: b.z, sentYaw: b.yaw, sentAt: now });
    sendBoat(b);
    saveDigging();
  }
  if (!r.steer && b.speed < 0.04 && Math.abs(b.sail) < 0.02) { // drifted to a stop after letting go
    Object.assign(b, { vx: 0, vz: 0, sail: 0, rudder: 0, speed: 0, turn: 0, throttle: 0 });
    sendBoat(b);
    game.driving = null;
  }
}

// A splash where a boat touches the shore at (cx, cz) (hullContact), thrown along (dx, dz). Its size follows the
// speed it hit at; small bumps while grinding along the shore are spaced out (SHORE_SPLASH_GAP) so it doesn't fizz.
const SHORE_SPLASH_GAP = 0.35;
function shoreSplash(b, at, speed, dx, dz) {
  if (!at || speed < 0.15) return;
  const now = performance.now() / 1000, big = speed > 1.2;
  if (!big && now - (b.shoreAt ?? 0) < SHORE_SPLASH_GAP) return;
  if (big && now - (b.shoreAt ?? 0) < 0.12) return;
  b.shoreAt = now;
  const k = Math.min(1, speed / (b.hull?.MAX_SPEED ?? BOAT.MAX_SPEED)), s = Math.sqrt((b.hull?.W ?? BOAT.W) / BOAT.W);
  // pull the point back a little toward the boat, onto the water's edge
  const ex = at[0] + (b.x - at[0]) * 0.12, ez = at[1] + (b.z - at[1]) * 0.12;
  game.scene.effects.splash(ex, SEA, ez, (0.22 + 0.78 * k) * s, dx, dz);
}

// walking on deck: free movement (not tile-locked) in deck coordinates, around the cabin and cargo;
// pushing against the rail for a moment steps off onto land or into the water there
function walkOnDeck(dt, t, keys, yaw) {
  const r = game.ride, b = game.boats.list.get(r?.id), c = game.ctrl;
  if (!b) return void (game.ride && leaveBoat());
  let anim = ANIM.IDLE, speed = 0;
  const g = r.steer ? null : screenToGrid(keys, yaw); // the same 8 directions as walking ashore
  if (g && (g.x || g.z)) {
    const l = Math.hypot(g.x, g.z), dx = g.x / l, dz = -g.z / l; // world direction
    const cs = Math.cos(b.syaw), sn = Math.sin(b.syaw);
    const dlx = dx * cs - dz * sn, dlz = dx * sn + dz * cs; // in deck coordinates
    speed = keys.run ? 5.6 : 3.2;
    const nlx = r.lx + dlx * speed * dt, nlz = r.lz + dlz * speed * dt;
    let moved = true;
    // somewhere to stand, and on a ship with levels (the pirate ship's quarterdeck) not up or down a wall: take the stairs
    const can = (x, z) => walkable(x, z, undefined, b.obs, b.hull) && canStep(b.hull, r.lx, r.lz, x, z);
    if (can(nlx, nlz)) { r.lx = nlx; r.lz = nlz; }
    else if (can(nlx, r.lz) && Math.abs(dlx) > 0.2) r.lx = nlx;
    else if (can(r.lx, nlz) && Math.abs(dlz) > 0.2) r.lz = nlz;
    else moved = false;
    c.ry = Math.atan2(dx, dz);
    anim = keys.run ? ANIM.RUN : ANIM.WALK;
    // against the rail (the spot ahead is off the deck): after a moment, step off there
    const [ax, az] = [r.lx + dlx * 0.75, r.lz + dlz * 0.75];
    if (!moved && !onDeck(ax, az, b.hull)) {
      r.push += dt;
      const [wx, wz] = toWorldXZ(b, r.lx + dlx * 1.1, r.lz + dlz * 1.1);
      const ix = toCell(wx), iz = toCell(wz), dy = deckY(b, t);
      const ok = game.paths.passable(ix, iz) && (game.paths.waterAt(ix, iz) || (game.paths.floorAt(ix, iz) - dy <= 1.3 && dy - game.paths.floorAt(ix, iz) <= 3));
      if (ok && r.push > 0.25) return leaveBoat(ix, iz);
      if (!ok && r.push > 0.25 && !r.warned) { r.warned = true; toast("Can't step off here"); }
      if (!moved) { anim = ANIM.IDLE; speed = 0; }
    } else { r.push = 0; r.warned = false; if (!moved) { anim = ANIM.IDLE; speed = 0; } }
  } else r.push = 0;
  if (r.steer) {
    [r.lx, r.lz] = b.hull.HELM;
    c.ry = b.syaw;
    if (b.look.t === 1) { anim = ANIM.ROW; c.ry = b.syaw + Math.PI; } // at the oars, facing the stern like a real rower
  }
  const [wx, wz] = toWorldXZ(b, r.lx, r.lz);
  c.pos.x = wx; c.pos.z = wz; c.pos.y = deckY(b, t, r.lx, r.lz);
  c.ix = toCell(wx); c.iz = toCell(wz);
  c.swimming = false;
  c.anim = anim;
  c.speed = speed;
}

// ---------- digging (shovel and pickaxe) ----------

// ---------- inventory ----------
// The selected hotbar slot is what you hold: a shovel or pickaxe there is the tool.
const inventory = new Inventory({ onChange: () => { syncTool(); syncWear(); saveInventory(); }, toast: (s) => toast(s) });
// the Wardrobe page shows you, dressed as you are, in a little live preview (appearance.js)
const doll = new CharacterPreview($('inv-doll'), { camY: 0.62, dist: 2.25, aimY: 0.44 });
function drawDoll(dt, t) {
  if (!inventory.isOpen || inventory.page !== 'wear') return;
  const me = game.roster?.get(game.me);
  doll.set(me?.look ?? loadLook(), inventory.wear, me?.color ?? PLAYER_COLORS[0]);
  doll.frame(dt, t);
}
// what you wear changed (clothes put on or taken off): show it on your character, and tell the room
function syncWear() {
  const key = JSON.stringify(inventory.wear);
  if (key === game.wearKey) return;
  game.wearKey = key;
  if (game.mode === 'multi') send({ type: 'wear', wear: inventory.wear }); // the roster comes back with it
  else if (game.mode === 'single' && game.scene) {
    const me = game.roster.get(game.me);
    if (me) { me.wear = { ...inventory.wear }; ensureCharacter(game.me, me); }
  }
}
// click with clothes in hand (or right-click): put them on
function wearHeld() {
  const held = inventory.held;
  if (!held || !inventory.wearFrom(inventory.selected)) return;
  toast(`You put on the ${ITEMS[held.id].name}`);
}
function syncTool() {
  const held = inventory.held, before = game.tool;
  game.tool = held ? Math.max(0, TOOLS.indexOf(ITEMS[held.id].tool ?? held.id)) : 0; // a tool or a block in hand
  heldLabel();
  if (game.tool !== before) game.pendingDig = null; // switched tools on the way: forget the dig
  if (game.local) setTool(game.local.char, game.tool);
}
// ---------- health and hunger (vitals.js) ----------
const FALL_HURT = 2.5; // drops this big or bigger hurt
const vitals = new Vitals({ el: $('vitals'), hurtEl: $('hurt'), onFaint: faint });
// eat one of the food in hand (berries, fish)
function eatHeld() {
  const held = inventory.held, item = held && ITEMS[held.id];
  if (!item?.food) return;
  if (!vitals.eat(item.food)) return toast("You're full");
  inventory.takeHeld();
  if (game.local) swingTool(game.local.char);
  toast(`Yum! ${item.name}`);
}
// out of health: faint, and wake up by the campfire with full health (keeping your things)
function faint(why) {
  if (!game.world || !game.ctrl) return;
  game.climb = null;
  game.fishing?.cancel(fishCtx());
  if (game.boatEdit) setBoatEdit(false);
  if (game.driving === game.ride?.id) game.driving = null;
  game.ride = null;
  game.pendingDig = game.pendingChop = game.pendingAct = game.pendingCatch = game.climb = null;
  const sp = spawnPoint(game.world, game.me);
  const [ix, iz] = game.paths.nearestOpen(toCell(sp.x), toCell(sp.z), 8) ?? [toCell(sp.x), toCell(sp.z)];
  placeController(ix, iz).ry = 0;
  game.scene.preload(game.ctrl.pos);
  game.cam.focus.set(game.ctrl.pos.x, game.ctrl.pos.y + 0.5, game.ctrl.pos.z);
  vitals.revive();
  toast(why === 'hunger' ? 'You fainted from hunger... and woke up by the campfire. Eat something!' : 'You fainted... and woke up by the campfire');
}

// The inventory is kept in this browser per saved world (singleplayer) or per room (multiplayer).
const INV_KEY = 'settleon.inv.';
function loadInventory(key) {
  game.invKey = key;
  inventory.reset();
  try { if (key) inventory.fromJSON(JSON.parse(localStorage.getItem(INV_KEY + key))); } catch {}
  if (inventory.creative) inventory.setCreative(true); // a fresh inventory: creative still opens the bag
  vitals.load(key); // health and hunger go with the inventory
  syncTool();
  game.wearKey = null;
  syncWear(); // and so does what you wear
  if (inventory.slots.every((s) => !s)) toast('Break bushes for sticks and leaves, pick up pebbles, then craft (I)');
}
function saveInventory() {
  if (!game.invKey || game.invTimer) return;
  game.invTimer = setTimeout(() => {
    game.invTimer = null;
    try { localStorage.setItem(INV_KEY + game.invKey, JSON.stringify(inventory.toJSON())); } catch {}
  }, 800);
}
// R turns what you're about to place (game.rot, quarter turns): log piles and furniture's facing
function heldLabel() {
  const held = inventory.held, rot = game.rot ?? 0;
  let text = held ? ITEMS[held.id].name : '';
  if (held?.id === 'log') text += ` · place to stack, lying ${rot % 2 ? 'north-south' : 'east-west'} (R)`;
  if (held && ITEMS[held.id].furn) text += rot ? ` · turned ${rot * 90}° (R)` : ' · R turns it';
  if (held && ITEMS[held.id].food) text += ' · click to eat';
  if (held && ITEMS[held.id].cloth) text += ' · click to wear';
  $('held-name').textContent = text;
}
// R: turn the furniture under the cursor, or else what's in hand
function rotateKey() {
  const b = input.hover && game.ctrl ? benchAt(input.hover[0], input.hover[1]) : null;
  if (b) {
    const r = (b[2] + 1) % 4;
    applyBench(b[0], b[1], r, true, b[3]);
    if (game.mode === 'multi') send({ type: 'bench', ix: b[0], iz: b[1], r, t: b[3], on: true });
    saveDigging();
    return;
  }
  const pl = input.hover && game.ctrl ? pileAt(input.hover[0], input.hover[1]) : null;
  if (pl) { // turn a log pile under the cursor
    applyPile(pl[0], pl[1], 1 - pl[2], pl[3]);
    sendPile(pl[0], pl[1]);
    saveDigging();
    return;
  }
  const id = inventory.held?.id;
  if (id !== 'log' && !ITEMS[id]?.furn) return;
  game.rot = ((game.rot ?? 0) + 1) % 4;
  heldLabel();
}

// what a broken block drops
const DROPS = { [K.SAND]: 'sand', [K.ROCK]: 'stone', [K.SNOW]: 'snow', [K.WOOD]: 'wood', [K.WOOD2]: 'wood', [K.WALL]: 'wall' }; // everything else the shovel digs gives dirt

const SHOVEL_KINDS = new Set([K.GRASS, K.FOREST, K.DEEP, K.DIRT, K.SOIL, K.SAND, K.TRAIL, K.SNOW, K.PATH]);
const PICKAXE_KINDS = new Set([K.ROCK]);
const AXE_KINDS = new Set([K.WOOD, K.WOOD2, K.WALL]); // the axe also chops trees (see chopTree)
// a click with a tool or block: dig or place on the clicked tile, walking next to it first if it's
// further away (this is the only time a click moves the character; plain movement is WASD)
function useToolAt(px, py) {
  const target = groundPoint(px, py);
  if (!target) return;
  const ix = toCell(target.x), iz = toCell(target.z), c = game.ctrl;
  const [ox, oz] = c.step ? [c.step.toIx, c.step.toIz] : [c.ix, c.iz]; // where the current step ends
  const dist = Math.max(Math.abs(ix - ox), Math.abs(iz - oz));
  if (dist === 0) return toast('Step aside to dig here');
  if (dist === 1 && !c.moving) return actAt(ix, iz);
  // walk to the last tile before it, then dig (see frame)
  const cells = game.paths.route(ox, oz, ix, iz);
  if (!cells) { showMarker({ x: toWorld(ix), z: toWorld(iz) }, true); return toast("Can't get there from here"); }
  if (cells.length && cells[cells.length - 1] === cellKey(ix, iz)) cells.pop();
  c.setPath(cells);
  game.pendingDig = { ix, iz };
  showMarker({ x: toWorld(ix), z: toWorld(iz) }, false);
}

// Why the held tool can't dig this tile (a message), or null if it can. Shared by digging and the outline.
function digProblem(ix, iz) {
  const w = game.world, k = w.kind(ix, iz), h = w.H(ix, iz), tool = TOOLS[game.tool];
  if (h < SEA) return "Can't dig underwater";
  if (w.piles.has(cellKey(ix, iz))) return 'Take the logs off first';
  if (tool === 'shovel' && !SHOVEL_KINDS.has(k)) return k === K.ROCK ? "That's stone: use the pickaxe" : "The shovel can't dig that";
  if (tool === 'pickaxe' && !PICKAXE_KINDS.has(k)) return SHOVEL_KINDS.has(k) ? "That's soft ground: use the shovel" : isWood(k) ? "That's wood: use the axe" : "The pickaxe can't break that";
  if (tool === 'axe' && !AXE_KINDS.has(k)) return 'The axe chops trees and wood blocks';
  if (tool === 'shovel' && isWood(k)) return "That's wood: use the axe";
  if (!game.paths.passable(ix, iz)) return "Something's in the way";
  if (cornerTree(ix, iz)) return "A tree's roots are in the way";
  if (h <= STEP + 0.01) return "Can't dig any deeper";
  return null;
}
// Why the held block can't go on this tile, or null if it can.
function placeProblem(ix, iz) {
  if (game.ctrl?.touching().some(([x, z]) => x === ix && z === iz)) return "You're standing there";
  if (game.world.piles.has(cellKey(ix, iz))) return 'Take the logs off first';
  if (game.world.H(ix, iz) + STEP > MAX_BUILD_H + 0.01) return "Can't build any higher";
  if (!game.paths.passable(ix, iz)) return "Something's in the way";
  if (cornerTree(ix, iz)) return "A tree's in the way";
  for (const r of game.remotes.values()) if (r.seen && toCell(r.pos.x) === ix && toCell(r.pos.z) === iz) return 'Someone is standing there';
  return null;
}
const cornerTree = (ix, iz) => [[ix, iz], [ix + 1, iz], [ix, iz + 1], [ix + 1, iz + 1]].some(([vx, vz]) => game.paths.cornerBlocked(vx, vz));

// ---------- hover outline: which block a tool would dig, or where a held block would go ----------
const OUTLINE_OK = 0xffffff, OUTLINE_BAD = 0xff6a5a;
function makeOutline() {
  const g = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: OUTLINE_OK }));
  const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: OUTLINE_OK, transparent: true, opacity: 0.18, depthWrite: false }));
  lines.renderOrder = fill.renderOrder = 15;
  const log = new THREE.Mesh(logGeo(), ghostParts().benchMat);
  log.renderOrder = 14;
  g.add(log);
  // see-through previews of what you're about to place, turned the way R set it (ghostParts)
  const { blockGeo, benchMat } = ghostParts();
  const block = new THREE.Mesh(blockGeo, null);
  const bench = new THREE.Mesh(furnitureGeometry(0), benchMat); // its geometry follows the held furniture
  bench.position.y = -0.5; // the outline box is centred; the model stands on its base
  block.renderOrder = bench.renderOrder = 14;
  g.add(lines, fill, block, bench);
  g.userData = { lines, fill, block, bench, log, cell: null };
  g.visible = false;
  return g;
}
// Ghost materials and the block geometry, made once and kept across worlds (marked shared so a
// world's dispose leaves them alone). Wood gets the plank pattern, turned 90° for odd R turns,
// matching how K.WOOD / K.WOOD2 draw: planks east-west on top and horizontal boards on the sides,
// or north-south and vertical.
let ghost = null;
function ghostParts() {
  if (ghost) return ghost;
  const see = { transparent: true, opacity: 0.55, depthWrite: false };
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const row = y >> 2, lp = y & 3, joint = (x + row * 5) % 12;
      g.fillStyle = lp === 0 ? '#664226' : joint === 0 ? '#7c5232' : lp === 1 ? '#b8835a' : row % 2 ? '#a3714a' : '#ab774d';
      g.fillRect(x, y, 1, 1);
    }
  }
  const tex = (turned) => {
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.center.set(0.5, 0.5);
    t.rotation = turned ? Math.PI / 2 : 0;
    return t;
  };
  // one STEP-high block: the sides only show the bottom half of the texture, so boards keep their size
  const blockGeo = new THREE.BoxGeometry(1, 1, 1);
  const uv = blockGeo.attributes.uv;
  for (const face of [0, 1, 4, 5]) for (let i = face * 4; i < face * 4 + 4; i++) uv.setY(i, uv.getY(i) * STEP);
  blockGeo.userData.shared = true;
  const color = (hex) => new THREE.MeshLambertMaterial({ color: hex, ...see });
  ghost = {
    blockGeo,
    benchMat: new THREE.MeshLambertMaterial({ vertexColors: true, ...see }),
    mats: {
      wood: new THREE.MeshLambertMaterial({ map: tex(false), ...see }),
      wood2: new THREE.MeshLambertMaterial({ map: tex(true), ...see }),
      dirt: color(0x8d5c3a), stone: color(0x8e8c88), sand: color(0xe2cf92), snow: color(0xeef3f8), wall: color(0x8a5730),
    },
  };
  return ghost;
}
// What a click under the cursor would act on (the same order as onTap), for the hover highlight:
// { kind: 'frog' | 'bench' | 'pile' | 'tree' | 'bush' | 'pebble', obj } or null.
function hoverTarget(px, py) {
  const held = inventory.held, item = held && ITEMS[held.id];
  if (game.ride) return null;
  const frog = frogAt(px, py);
  if (frog) return { kind: 'frog', obj: frog };
  if (item?.throwable) return null; // a click throws the frog in hand
  if (TOOLS[game.tool] === 'axe') {
    const boat = boatAt(px, py);
    if (boat) return { kind: 'boat', obj: boat };
    const bench = benchAt(px, py);
    if (bench) return { kind: 'bench', obj: bench };
    const pile = pileAt(px, py);
    if (pile) return { kind: 'pile', obj: pile };
    const tree = treeAt(px, py);
    if (tree) return { kind: 'tree', obj: tree };
  } else if (!item?.block && !item?.place) {
    const bench = benchAt(px, py);
    if (bench && bench[3] === 0) return { kind: 'bench', obj: bench }; // a workbench opens its crafting
  }
  if (canClimb(item)) { const palm = palmAt(px, py); if (palm) return { kind: 'palm', obj: palm }; }
  const bush = bushAt(px, py);
  if (bush) return { kind: 'bush', obj: bush };
  const pebble = pebbleAt(px, py);
  if (pebble) return { kind: 'pebble', obj: pebble };
  if (handFree(item)) {
    const plant = cottonAt(px, py);
    if (plant) return { kind: 'cotton', obj: plant };
    const flower = flowerAt(px, py);
    if (flower) return { kind: 'flower', obj: flower };
  }
  if (TOOLS[game.tool] === 'pickaxe') { const rock = rockAt(px, py); if (rock) return { kind: 'rock', obj: rock }; }
  return null;
}

function updateOutline() {
  const o = game.outline;
  if (!o) return;
  const held = inventory.held, item = held && ITEMS[held.id];
  const hover = input.hover;
  o.visible = false;
  o.userData.block.visible = o.userData.bench.visible = o.userData.log.visible = false;
  if (game.boatEdit) return editHover(); // edit mode: outline the boat part under the cursor
  // highlight what a click would act on (frogs, bushes, pebbles, workbenches; with the axe furniture
  // and log piles), with a hand cursor; trees under the axe get the trunk box below
  const target = hover && !inventory.isOpen && game.ctrl ? hoverTarget(hover[0], hover[1]) : null;
  game.scene.setHighlight(target && target.kind !== 'tree' && target.kind !== 'palm' ? target : null, clock.elapsedTime, game.cam.dist);
  $('view').style.cursor = target ? 'pointer' : '';
  if (target && target.kind !== 'tree' && target.kind !== 'palm') return;
  if (game.ride || item?.boat) return;
  if (!item || !(item.tool || item.block || item.place) || !hover || inventory.isOpen) return;
  // the axe over a tree: outline its trunk
  if (item.tool === 'axe') {
    const t = treeAt(hover[0], hover[1]);
    if (t) {
      const red = treeType(t) === 'redwood', w = (red ? 0.9 : 0.42) * t.s, h = (red ? 3.5 : 1.0) * t.s;
      o.position.set(t.x, t.y + h / 2, t.z);
      o.scale.set(w, h, w);
      o.userData.lines.material.color.setHex(OUTLINE_OK);
      o.userData.fill.visible = false;
      o.visible = true;
      return;
    }
  }
  // only re-march the ray when the mouse, the camera or the terrain changed
  const cp = camera.position, key = `${hover[0]},${hover[1]},${game.digVersion},${cp.x.toFixed(2)},${cp.y.toFixed(2)},${cp.z.toFixed(2)}`;
  if (o.userData.key !== key) {
    o.userData.key = key;
    const p = groundPoint(hover[0], hover[1]);
    o.userData.cell = p ? [toCell(p.x), toCell(p.z)] : null;
  }
  if (!o.userData.cell) return;
  const [ix, iz] = o.userData.cell, c = game.ctrl, w = game.world;
  if (ix === c.ix && iz === c.iz) return; // your own tile: nothing to show
  const h = w.H(ix, iz), placing = !!(item.block || item.place), tall = item.place ? 1 : STEP; // a workbench is a full unit high
  const bad = held.id === 'log' ? logProblem(ix, iz) : item.place ? benchProblem(ix, iz) : placing ? placeProblem(ix, iz) : digProblem(ix, iz);
  // digging: the top block of the tile; placing: the new block (or workbench) on top of it
  const y0 = placing ? h : Math.max(0, h - STEP);
  o.position.set(toWorld(ix), y0 + tall / 2, toWorld(iz));
  o.scale.set(1.02, tall + 0.02, 1.02);
  const col = bad ? OUTLINE_BAD : OUTLINE_OK;
  o.userData.lines.material.color.setHex(col);
  o.userData.fill.material.color.setHex(col);
  // placing: a see-through preview of the block or workbench, turned the way it will go (R);
  // where it can't go, a red box instead
  o.userData.fill.visible = placing && !!bad;
  if (placing && !bad) {
    const rot = game.rot ?? 0;
    if (held.id === 'log') { // the next log of the pile, where it will lie
      const pl = w.piles.get(cellKey(ix, iz)), r = pl ? pl[2] : rot % 2;
      logOffset(pl ? pl[3] : 0, r, o.userData.log.position).y -= 0.5;
      o.userData.log.rotation.y = r * Math.PI / 2;
      o.userData.log.visible = true;
    } else if (item.place) {
      o.userData.bench.geometry = furnitureGeometry(FURNITURE.indexOf(held.id));
      o.userData.bench.visible = true;
      o.userData.bench.rotation.y = (((Math.round(Math.atan2(c.ix - ix, c.iz - iz) / (Math.PI / 2)) % 4) + 4 + rot) % 4) * Math.PI / 2;
    } else {
      const mats = ghostParts().mats;
      o.userData.block.material = mats[held.id] ?? mats.dirt;
      o.userData.block.visible = true;
    }
  }
  o.visible = true;
}

// use what's in hand on a neighbouring tile: a tool digs, a block is placed
function actAt(ix, iz) {
  const held = inventory.held;
  if (held?.id === 'log') placeLog(ix, iz);
  else if (held && ITEMS[held.id].place) placeBench(ix, iz);
  else if (held && ITEMS[held.id].block) placeAt(ix, iz);
  else digAt(ix, iz);
}

// what a placed block becomes, and the highest you can build
const PLACE_KINDS = { dirt: K.SOIL, stone: K.ROCK, sand: K.SAND, snow: K.SNOW, wall: K.WALL }; // (planks aren't placeable; old wooden floors still break into planks)
const MAX_BUILD_H = 24;

// put the held block on a neighbouring tile: the tile rises one block
function placeAt(ix, iz) {
  const t = clock.elapsedTime, c = game.ctrl, w = game.world, held = inventory.held;
  if (t < game.nextDig || !held || !ITEMS[held.id].block) return;
  c.ry = Math.atan2(ix - c.ix, iz - c.iz); // face it
  const h = w.H(ix, iz), why = placeProblem(ix, iz);
  if (why) return toast(why);
  const id = held.id;
  inventory.takeHeld(1);
  game.nextDig = t + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  setTimeout(() => {
    if (game.world !== w) return;
    const nh = h + STEP, nk = nh < SEA ? K.SEABED : PLACE_KINDS[id]; // underwater, it builds up the bottom
    // remember the ground below the placed blocks, so the column's lower part keeps showing it
    const k0 = w.kind(ix, iz), cur = w.under(ix, iz);
    const u = nk === K.SEABED ? null : !cur ? [h, k0] : k0 !== nk ? [h, k0] : cur;
    game.digHits.delete(cellKey(ix, iz));
    applyDig(ix, iz, nh, nk, u);
    game.scene.effects.impact(toWorld(ix), nh, toWorld(iz), 1.0, nk === K.SEABED ? K.SAND : nk);
    sendDig(ix, iz, nh, nk, u);
    saveDigging();
  }, SWING_SECS * 450);
}

// ---------- log piles ----------
// A Log is placed on a tile as a lying log; more logs on the same tile stack up 3, 2, 1 (PILE_MAX).
// world.piles: Map(cellKey -> [ix, iz, r, n]); the pile blocks its tile. The axe takes logs back off.
function logProblem(ix, iz) {
  const pl = game.world.piles.get(cellKey(ix, iz));
  if (pl) return pl[3] >= PILE_MAX ? 'That pile is full' : null;
  if (game.world.H(ix, iz) < SEA) return "Logs can't be stacked in water";
  return placeProblem(ix, iz);
}
function placeLog(ix, iz) {
  const t = clock.elapsedTime, c = game.ctrl, w = game.world, why = logProblem(ix, iz);
  if (t < game.nextDig) return;
  c.ry = Math.atan2(ix - c.ix, iz - c.iz);
  if (why) return toast(why);
  inventory.takeHeld(1);
  game.nextDig = t + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  const r0 = (game.rot ?? 0) % 2;
  setTimeout(() => {
    if (game.world !== w) return;
    const pl = w.piles.get(cellKey(ix, iz));
    if (pl && pl[3] >= PILE_MAX) return void give('log', 1); // someone filled it meanwhile
    applyPile(ix, iz, pl ? pl[2] : r0, (pl ? pl[3] : 0) + 1);
    game.scene.effects.impact(toWorld(ix), w.H(ix, iz) + 0.2, toWorld(iz), 0.8, 'wood');
    sendPile(ix, iz);
    saveDigging();
  }, SWING_SECS * 450);
}
function applyPile(ix, iz, r, n) {
  const w = game.world, key = cellKey(ix, iz), cur = w.piles.get(key);
  if (n ? cur?.[2] === r && cur[3] === n : !cur) return;
  if (n) w.piles.set(key, [ix, iz, r, n]); else w.piles.delete(key);
  game.scene.setPiles(w.piles);
  game.digVersion = (game.digVersion ?? 0) + 1;
}
// tell the room what the pile on a cell is now (n 0 = gone)
function sendPile(ix, iz) {
  if (game.mode !== 'multi') return;
  const pl = game.world.piles.get(cellKey(ix, iz));
  send({ type: 'pile', ix, iz, r: pl ? pl[2] : 0, n: pl ? pl[3] : 0 });
}
function onPile({ id, ix, iz, r, n }) {
  if (id === game.me) return;
  applyPile(ix, iz, r, n);
  const p = game.remotes.get(id);
  if (p) swingTool(p.char);
}
// the log pile under the cursor, or null
function pileAt(px, py) {
  const p = game.ctrl.pos, list = [];
  for (const pl of game.world.piles.values()) {
    const x = toWorld(pl[0]), z = toWorld(pl[1]);
    if (Math.abs(x - p.x) < 16 && Math.abs(z - p.z) < 16) list.push({ x, y: game.world.H(pl[0], pl[1]), z, pl });
  }
  const lim = Math.max(20, 300 / game.cam.dist);
  return (thingAt(list, px, py, 0.2, lim) ?? thingAt(list, px, py, 0.6, lim))?.pl ?? null;
}
// the axe takes the top log off a pile (one swing)
function takeLog(pl) {
  const c = game.ctrl, now = clock.elapsedTime, [ix, iz] = pl, x = toWorld(ix), z = toWorld(iz);
  if (Math.hypot(x - c.pos.x, z - c.pos.z) > 1.6) return toast('Walk up to the logs first');
  if (now < game.nextDig) return;
  game.nextDig = now + SWING_SECS + 0.05;
  c.ry = Math.atan2(x - c.pos.x, z - c.pos.z);
  if (game.local) swingTool(game.local.char);
  const w = game.world;
  setTimeout(() => {
    const cur = game.world === w && w.piles.get(cellKey(ix, iz));
    if (!cur) return;
    applyPile(ix, iz, cur[2], cur[3] - 1);
    game.scene.effects.impact(x, w.H(ix, iz) + 0.4, z, 1.0, 'wood');
    dropItem('log', 1, x, w.H(ix, iz) + 0.6, z, 0.6);
    sendPile(ix, iz);
    saveDigging();
  }, SWING_SECS * 450);
}

// ---------- furniture: workbenches, chairs, tables, beds, lamps, bookshelves ----------
// ---------- furniture and decorations on your boat's deck (boat.js b.look.f, synced and saved with the look) ----------
const DECO_SNAP = 0.125;
const _dp = new THREE.Vector3(), _dr = new THREE.Raycaster(), _dn = new THREE.Vector2();
// where a screen point meets the boat's deck, in deck coordinates, or null
function deckPoint(b, px, py) {
  _dn.set((px / pixel.cssW) * 2 - 1, -(py / pixel.cssH) * 2 + 1);
  _dr.setFromCamera(_dn, camera);
  const o = _dr.ray.origin, d = _dr.ray.direction, y = deckY(b, clock.elapsedTime);
  if (Math.abs(d.y) < 1e-4) return null;
  const k = (y - o.y) / d.y;
  if (k < 0) return null;
  _dp.copy(o).addScaledVector(d, k);
  return toLocal(b, _dp.x, _dp.z);
}
// Where the held piece would go for a screen point: { b, type, lx, lz, rot, why } (why = the reason it can't, or
// null), or null when it's not over the deck. Shared by the blueprint preview and the click.
function decoPlan(px, py) {
  const r = game.ride, b = r && game.boats.list.get(r.id), type = FURNITURE.indexOf(inventory.held?.id);
  if (!b || type < 0) return null;
  const p = deckPoint(b, px, py);
  if (!p) return null;
  const [lx, lz] = p.map((v) => Math.round(v / DECO_SNAP) * DECO_SNAP), hl = b.hull;
  if (!onDeck(lx, lz, hl)) return null;
  const rot = ((Math.round(Math.atan2(r.lx - lx, r.lz - lz) / (Math.PI / 2)) % 4) + 4 + (game.rot ?? 0)) % 4; // facing you, plus R turns
  const plan = { b, type, lx, lz, rot, why: null };
  if (b.look.f.length >= MAX_DECO) plan.why = 'This boat is full of things already';
  else if (!decoFits(type, rot, lx, lz, b.obs, hl)) plan.why = "There's no room for that there";
  else if (!walkable(hl.HELM[0], hl.HELM[1], undefined, { rects: [decoFoot(type, rot, lx, lz)], circles: [] }, hl) || !walkable(r.lx, r.lz, 0.15, { rects: [decoFoot(type, rot, lx, lz)], circles: [] }, hl)) plan.why = "You're standing there";
  else { // it mustn't cut a real part of the deck off from the wheel; closing a small dead-end nook is fine
    // (cached: the flood fill only reruns when the spot or the deck changes)
    const key = `${b.id}|${b.decoKey}|${type},${rot},${lx},${lz}`;
    if (game.decoReachKey !== key) {
      const after = { rects: [...b.obs.rects, decoFoot(type, rot, lx, lz)], circles: b.obs.circles }, before = deckReach(b.obs, hl);
      game.decoReachKey = key;
      game.decoReachOk = deckReach(after, hl) >= before - 80 - before * 0.12; // its own footprint plus a nook
    }
    if (!game.decoReachOk) plan.why = 'That would block the way along the deck';
  }
  return plan;
}
function placeOnDeck(px, py) {
  const now = clock.elapsedTime, plan = decoPlan(px, py);
  if (!plan || now < game.nextDig) return;
  if (plan.why) return toast(plan.why);
  const { b, type, lx, lz, rot } = plan, L = b.look;
  inventory.takeHeld(1);
  game.nextDig = now + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  setBoatLook(b, { ...L, f: [...L.f, [type, Math.round(lx * 100), Math.round(lz * 100), rot]] });
  const [wx, wz] = toWorldXZ(b, lx, lz);
  game.scene.effects.impact(wx, deckY(b, now) + 0.05, wz, 0.8, 'wood');
}
// The blueprint: a see-through blue copy of the held piece (with its edges drawn) where a click would put it, on the
// boat so it bobs along; red where it can't go. Shown while aboard with furniture or a decoration in hand.
const BLUEPRINT = { ok: 0x3a9cff, okEdge: 0x1f5fb8, bad: 0xff4a3a, badEdge: 0xa82418 };
const blueprintFill = new THREE.MeshBasicMaterial({ color: BLUEPRINT.ok, transparent: true, opacity: 0.55, depthWrite: false });
const blueprintEdge = new THREE.LineBasicMaterial({ color: BLUEPRINT.okEdge, transparent: true, opacity: 0.8, depthWrite: false });
const blueprintEdges = new Map(); // furniture type -> edges geometry
function updateDeckBlueprint() {
  let bp = game.blueprint;
  const plan = !inventory.isOpen && input.hover && ITEMS[inventory.held?.id]?.furn ? decoPlan(...input.hover) : null;
  if (!plan) { if (bp) bp.visible = false; return; }
  if (!bp) {
    bp = game.blueprint = new THREE.Group();
    bp.add(new THREE.Mesh(furnitureGeometry(0), blueprintFill), new THREE.LineSegments(undefined, blueprintEdge));
    bp.children.forEach((o) => { o.renderOrder = 8; });
  }
  if (bp.userData.type !== plan.type) {
    bp.userData.type = plan.type;
    bp.children[0].geometry = furnitureGeometry(plan.type);
    if (!blueprintEdges.has(plan.type)) blueprintEdges.set(plan.type, new THREE.EdgesGeometry(furnitureGeometry(plan.type), 25));
    bp.children[1].geometry = blueprintEdges.get(plan.type);
  }
  if (bp.parent !== plan.b.group) plan.b.group.add(bp);
  bp.position.set(plan.lx, plan.b.hull.DECK + 0.03, plan.lz);
  bp.rotation.y = plan.rot * Math.PI / 2;
  bp.scale.setScalar(DECO_SCALE);
  blueprintFill.color.setHex(plan.why ? BLUEPRINT.bad : BLUEPRINT.ok);
  blueprintEdge.color.setHex(plan.why ? BLUEPRINT.badEdge : BLUEPRINT.okEdge);
  bp.visible = true;
}

function takeFromDeck(px, py) {
  const b = game.boats.list.get(game.ride.id), p = b && deckPoint(b, px, py), now = clock.elapsedTime;
  if (!p || now < game.nextDig) return;
  let best = -1, bd = 0.55;
  b.look.f.forEach(([, x, z], i) => { const d = Math.hypot(x / 100 - p[0], z / 100 - p[1]); if (d < bd) { bd = d; best = i; } });
  if (best < 0) return;
  const [t, x, z] = b.look.f[best];
  game.nextDig = now + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  setBoatLook(b, { ...b.look, f: b.look.f.filter((_, i) => i !== best) });
  give(FURNITURE[t] ?? 'crate', 1);
  const [wx, wz] = toWorldXZ(b, x / 100, z / 100);
  game.scene.effects.impact(wx, deckY(b, now) + 0.05, wz, 0.8, 'wood');
}

// world.benches: Map(cellKey -> [ix, iz, rot, type]); type = index in FURNITURE (and the item id).
// Why a piece of furniture can't go on this tile, or null.
function benchProblem(ix, iz) {
  if (game.world.H(ix, iz) < SEA) return "Furniture can't stand in water";
  return placeProblem(ix, iz);
}
// put the held furniture on a neighbouring tile, its front facing you
function placeBench(ix, iz) {
  const t = clock.elapsedTime, c = game.ctrl, w = game.world, why = benchProblem(ix, iz);
  if (t < game.nextDig) return;
  c.ry = Math.atan2(ix - c.ix, iz - c.iz);
  if (why) return toast(why);
  const type = FURNITURE.indexOf(inventory.held?.id);
  if (type < 0) return;
  const r = ((Math.round(Math.atan2(c.ix - ix, c.iz - iz) / (Math.PI / 2)) % 4) + 4 + (game.rot ?? 0)) % 4; // facing you, plus R turns
  inventory.takeHeld(1);
  game.nextDig = t + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  setTimeout(() => {
    if (game.world !== w) return;
    applyBench(ix, iz, r, true, type);
    game.scene.effects.impact(toWorld(ix), w.H(ix, iz) + 0.1, toWorld(iz), 1.0, 'wood');
    if (game.mode === 'multi') send({ type: 'bench', ix, iz, r, t: type, on: true });
    saveDigging();
  }, SWING_SECS * 450);
}
function applyBench(ix, iz, r, on, type = 0) {
  const w = game.world, key = cellKey(ix, iz);
  const cur = w.benches.get(key);
  if (on ? cur?.[2] === r && cur[3] === type : !cur) return;
  if (on) w.benches.set(key, [ix, iz, r, type]); else w.benches.delete(key);
  game.scene.setBenches(w.benches);
  game.digVersion = (game.digVersion ?? 0) + 1;
}
// clicking a workbench: walk up to it, then open the inventory screen with its recipes
function useWorkbench(b) {
  const o = { x: toWorld(b[0]), z: toWorld(b[1]) }, key = cellKey(b[0], b[1]);
  if (!inReach(o, () => { const q = game.world.benches.get(key); if (q?.[3] === 0) useWorkbench(q); })) return;
  game.ctrl.ry = Math.atan2(o.x - game.ctrl.pos.x, o.z - game.ctrl.pos.z);
  hideCtx();
  inventory.open('bench');
}
function onBench({ id, ix, iz, r, t = 0, on }) {
  if (id === game.me) return;
  applyBench(ix, iz, r, on, t);
  const p = game.remotes.get(id);
  if (p) swingTool(p.char);
}
// the furniture under the cursor (closest projected middle), or null
function benchAt(px, py) {
  let best = null, bd = Math.max(20, 300 / game.cam.dist);
  const p = game.ctrl.pos, a = new THREE.Vector3();
  for (const b of game.world.benches.values()) {
    const x = toWorld(b[0]), z = toWorld(b[1]);
    if (Math.abs(x - p.x) > 16 || Math.abs(z - p.z) > 16) continue;
    for (const up of [0.2, 0.6]) { // its desk and its back board
      a.set(x, game.world.H(b[0], b[1]) + up, z).project(camera);
      if (a.z > 1) continue;
      const d = Math.hypot((a.x + 1) / 2 * pixel.cssW - px, (1 - a.y) / 2 * pixel.cssH - py);
      if (d < bd) { bd = d; best = b; }
    }
  }
  return best;
}
// the axe picks furniture back up (one swing)
function takeBench(b) {
  const c = game.ctrl, now = clock.elapsedTime, [ix, iz] = b, x = toWorld(ix), z = toWorld(iz), id = FURNITURE[b[3]] ?? 'workbench';
  if (Math.hypot(x - c.pos.x, z - c.pos.z) > 1.6) return toast(`Walk up to the ${ITEMS[id].name.toLowerCase()} first`);
  if (now < game.nextDig) return;
  game.nextDig = now + SWING_SECS + 0.05;
  c.ry = Math.atan2(x - c.pos.x, z - c.pos.z);
  if (game.local) swingTool(game.local.char);
  const w = game.world;
  setTimeout(() => {
    if (game.world !== w || !w.benches.has(cellKey(ix, iz))) return;
    applyBench(ix, iz, 0, false);
    game.scene.effects.impact(x, w.H(ix, iz) + 0.4, z, 1.4, 'wood');
    dropItem(id, 1, x, w.H(ix, iz) + 0.6, z, 0.6);
    if (game.mode === 'multi') send({ type: 'bench', ix, iz, r: 0, t: 0, on: false });
    saveDigging();
  }, SWING_SECS * 450);
}

// one swing at a neighbouring tile; the block comes out as the tool lands
function digAt(ix, iz) {
  const t = clock.elapsedTime, c = game.ctrl, w = game.world;
  if (t < game.nextDig || !ITEMS[inventory.held?.id]?.tool) return;
  c.ry = Math.atan2(ix - c.ix, iz - c.iz); // face it
  const k = w.kind(ix, iz), h = w.H(ix, iz), why = digProblem(ix, iz);
  if (why) return toast(why);
  game.nextDig = t + SWING_SECS + 0.05;
  if (game.local) swingTool(game.local.char);
  const key = cellKey(ix, iz), hits = (game.digHits.get(key) ?? 0) + 1, need = k === K.ROCK ? 2 : 1;
  setTimeout(() => {
    if (game.world !== w) return; // left the world meanwhile
    const x = toWorld(ix), z = toWorld(iz);
    if (hits < need) { // stone cracks first
      game.digHits.set(key, hits);
      game.scene.effects.impact(x, h, z, 1.0, k);
      return;
    }
    game.digHits.delete(key);
    const nh = h - STEP, cur = w.under(ix, iz);
    let nk, u = null;
    if (cur && nh <= cur[0] + 0.01) nk = nh < SEA ? K.SEABED : cur[1]; // the last placed block is off: the old ground shows again
    else if (cur) { nk = k; u = cur; } // still on placed blocks
    else nk = nh < SEA ? K.SEABED : k === K.SAND || k === K.SNOW || k === K.ROCK || isWood(k) ? k : K.SOIL;
    applyDig(ix, iz, nh, nk, u);
    game.scene.effects.impact(x, h, z, 1.8, k);
    dropItem(DROPS[k] ?? 'dirt', 1, x, nh + 0.4, z, 0.6);
    sendDig(ix, iz, nh, nk, u);
    saveDigging();
  }, SWING_SECS * 450); // about when the tool lands
}

// tell the room (the under layer travels as a level and kind, -1 when there's none)
function sendDig(ix, iz, h, k, u) {
  if (game.mode !== 'multi') return;
  send({ type: 'dig', ix, iz, lvl: Math.round(h / STEP), k, ulvl: u ? Math.round(u[0] / STEP) : -1, uk: u ? u[1] : 0 });
}

// change a tile's height and kind (u: the ground under placed blocks, [height, kind] or null),
// and refresh everything that depends on it
function applyDig(ix, iz, h, k, u = null) {
  const w = game.world;
  const cu = w?.under(ix, iz);
  if (!w || (w.H(ix, iz) === h && w.kind(ix, iz) === k && (cu?.[0] ?? -1) === (u?.[0] ?? -1) && (cu?.[1] ?? -1) === (u?.[1] ?? -1))) return;
  w.setEdit(ix, iz, h, k, u ? u[0] : -1, u ? u[1] : 0);
  game.digVersion = (game.digVersion ?? 0) + 1;
  game.scene.refreshCell(ix, iz);
  game.paths.refresh(ix, iz);
  game.miniDirty = true;
}

// someone else in the room dug
function onDig({ id, ix, iz, lvl, k, ulvl = -1, uk = 0 }) {
  if (id === game.me) return;
  applyDig(ix, iz, lvl * STEP, k, ulvl >= 0 ? [ulvl * STEP, uk] : null);
  const r = game.remotes.get(id);
  if (r) swingTool(r.char);
}

// singleplayer on a saved world: keep the digging in the save (at most every 1.5 s)
function saveDigging() {
  if (game.mode !== 'single' || !game.saveName || game.saveTimer) return;
  game.saveTimer = setTimeout(writeSave, 1500);
}
// write the world back to its save now (also when quitting, so the last 1.5 s of building aren't lost)
function writeSave() {
  clearTimeout(game.saveTimer);
  game.saveTimer = null;
  {
    const w = game.world, name = game.saveName;
    if (game.mode !== 'single' || !w || !name || !getSave(name)) return;
    const benches = [...w.benches.values()], picks = w.pickList(), piles = [...w.piles.values()], boats = game.boats?.listOut() ?? [];
    putSave(name, w.endless ? endlessMap(name, w.seed, w.editsList(), w.choppedList(), benches, picks, piles, boats) : { ...encodeMap(w.base, name), ...(benches.length ? { benches } : {}), ...(picks.length ? { picks } : {}), ...(piles.length ? { piles } : {}), ...(boats.length ? { boats } : {}) });
  }
}

// a small screenshot of the world for the world list (the canvas holds only the 3D view; the HUD is HTML)
const thumbCanvas = document.createElement('canvas');
thumbCanvas.width = 192;
thumbCanvas.height = 108;
function captureThumb(redraw) {
  if (!game.saveName || !game.scene) return;
  try {
    if (redraw) pixel.render(game.scene.scene, camera); // the drawing buffer is only readable right after a render
    const src = pixel.renderer.domElement, ctx = thumbCanvas.getContext('2d');
    const sw = src.width, sh = src.height, want = 16 / 9;
    const cw = Math.min(sw, sh * want), ch = cw / want; // the middle, cropped to 16:9
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, thumbCanvas.width, thumbCanvas.height);
    setMeta(game.saveName, { thumb: thumbCanvas.toDataURL('image/jpeg', 0.82), played: Date.now() });
  } catch {}
}

function makeMarker() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 4, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.24, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  arrow.position.y = 0.5;
  g.add(ring, arrow);
  g.userData = { ring, arrow };
  g.visible = false;
  return g;
}

function showMarker(p, bad) {
  const m = game.marker;
  m.visible = true;
  m.position.set(p.x, Math.max(groundAt(game.world, p.x, p.z), SEA) + 0.03, p.z);
  const col = bad ? 0xff7a7a : 0xffe08a;
  m.userData.ring.material.color.setHex(col);
  m.userData.arrow.material.color.setHex(col);
  m.userData.born = clock.elapsedTime;
  m.userData.bad = bad;
}

function updateMarker(t) {
  const m = game.marker;
  if (!m?.visible) return;
  const age = t - (m.userData.born ?? t);
  m.userData.arrow.position.y = 0.45 + Math.abs(Math.sin(t * 5)) * 0.15;
  m.userData.arrow.rotation.y = t * 2;
  m.userData.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
  if (m.userData.bad && age > 0.8) m.visible = false;
}

// ---------- HUD ----------

function updateLabels() {
  const w = pixel.cssW, h = pixel.cssH;
  for (const r of game.remotes.values()) {
    if (!r.seen) { r.label.hidden = true; continue; }
    tmp.copy(r.pos);
    tmp.y += 1.25;
    const dist = tmp.distanceTo(camera.position);
    tmp.project(camera);
    const visible = tmp.z < 1 && dist < 40 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    r.label.hidden = !visible;
    if (visible) r.label.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
  }
}

const AREA_NAMES = {
  [K.SEABED]: 'Open Water', [K.SAND]: 'Beach', [K.GRASS]: 'Meadow',
  [K.FOREST]: 'Forest', [K.ROCK]: 'Mountains', [K.SNOW]: 'Snowy Peaks', [K.PATH]: 'Village', [K.DEEP]: 'Deep Forest', [K.TRAIL]: 'Mountain Trail', [K.DIRT]: 'Meadow', [K.SOIL]: 'Dug Soil', [K.WOOD]: 'Wooden Floor', [K.WOOD2]: 'Wooden Floor', [K.WALL]: 'Log Cabin',
};

function updateArea() {
  const { world, ctrl } = game;
  const p = ctrl.pos;
  let name = AREA_NAMES[world.kind(toCell(p.x), toCell(p.z))];
  const dCamp = Math.hypot(p.x - world.camp.x, p.z - world.camp.z);
  if (dCamp < 2.5) name = 'Campfire';
  const ruins = world.endless ? world.ruinsNear(ctrl.ix, ctrl.iz, 6) : world.ruins;
  for (const ru of ruins) {
    if (Math.hypot(p.x - ru.x, p.z - ru.z) < 4) {
      name = 'Ancient Ruins';
      if (!game.ruinsFound.has(ru.id)) {
        game.ruinsFound.set(ru.id, ru);
        updateRuinsHud();
        const n = game.ruinsFound.size;
        toast(`You discovered Ancient Ruins! (${world.endless ? `${n} found` : `${n}/${world.ruins.length}`})`);
      }
    }
  }
  if ($('area').textContent !== name) $('area').textContent = name;
}

function updateRuinsHud() {
  const n = game.ruinsFound.size;
  // worlds don't generate ruins any more; the counter shows only on maps with ruins placed in the editor
  $('ruins-found').hidden = !game.world.ruins.length;
  $('ruins-found').textContent = `Ruins found: ${n}/${game.world.ruins.length}`;
}

const MINI_COLORS = {
  [K.SEABED]: [63, 143, 214], [K.SAND]: [232, 217, 160], [K.GRASS]: [127, 191, 79],
  [K.FOREST]: [70, 130, 60], [K.ROCK]: [143, 138, 128], [K.SNOW]: [242, 244, 246], [K.PATH]: [214, 205, 180], [K.DEEP]: [34, 74, 40], [K.TRAIL]: [204, 166, 112], [K.DIRT]: [150, 160, 88], [K.SOIL]: [140, 104, 70], [K.WOOD]: [168, 116, 68], [K.WOOD2]: [168, 116, 68], [K.WALL]: [122, 78, 44],
};
let miniBase = null;
let miniOrigin = null; // top-left cell of the minimap: the whole island, or a window around you in an endless world
const MINI_RECENTER = 12; // endless: redraw the window once you're this many cells off its centre

function drawMinimapBase() {
  const { world } = game;
  const c = game.ctrl;
  miniOrigin = world.endless ? [c.ix - WORLD / 2, c.iz - WORLD / 2] : [0, 0];
  const [ox, oz] = miniOrigin;
  miniBase = document.createElement('canvas');
  miniBase.width = miniBase.height = WORLD;
  const ctx = miniBase.getContext('2d');
  const img = ctx.createImageData(WORLD, WORLD);
  for (let z = 0; z < WORLD; z++) {
    for (let x = 0; x < WORLD; x++) {
      const k = world.kind(ox + x, oz + z), h = world.H(ox + x, oz + z);
      if (k === K.SEABED) { // water by depth, like the water itself: turquoise shallows, reef teal, blue, deep navy
        const d = SEA - h;
        const [r, g, b] = d < 0.6 ? [112, 206, 204] : d < 1.5 ? [62, 168, 186] : d < 2.6 ? [44, 120, 186] : d < 3.6 ? [30, 86, 158] : [18, 52, 112];
        img.data.set([r, g, b, 255], (z * WORLD + x) * 4);
        continue;
      }
      const shade = 0.85 + Math.min(h, 10) * 0.025;
      const [r, g, b] = MINI_COLORS[k];
      img.data.set([r * shade, g * shade, b * shade, 255], (z * WORLD + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawMinimap() {
  const c = game.ctrl;
  if (game.miniDirty) { game.miniDirty = false; drawMinimapBase(); } // terrain was dug
  const off = Math.max(Math.abs(c.ix - miniOrigin[0] - WORLD / 2), Math.abs(c.iz - miniOrigin[1] - WORLD / 2));
  if (game.world.endless && off > MINI_RECENTER) drawMinimapBase();
  const ctx = $('minimap').getContext('2d');
  ctx.drawImage(miniBase, 0, 0);
  const [ox, oz] = miniOrigin;
  const dot = (x, z, color, size = 3) => {
    const px = Math.round(x + WORLD / 2 - ox), pz = Math.round(z + WORLD / 2 - oz);
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(px - size / 2 - 1, pz - size / 2 - 1, size + 2, size + 2);
    ctx.fillStyle = color;
    ctx.fillRect(px - size / 2, pz - size / 2, size, size);
  };
  const { world } = game;
  dot(world.camp.x, world.camp.z, '#ff8c2a', 2);
  for (const ru of game.ruinsFound.values()) dot(ru.x, ru.z, '#7ef0ff', 2);
  for (const b of game.boats.list.values()) dot(b.sx, b.sz, '#c8643a', 4);
  for (const r of game.remotes.values()) {
    if (!r.seen) continue;
    const rx = r.pos.x + WORLD / 2 - ox, rz = r.pos.z + WORLD / 2 - oz;
    if (rx >= 1 && rx <= WORLD - 1 && rz >= 1 && rz <= WORLD - 1) dot(r.pos.x, r.pos.z, r.color);
    else edgePointer(ctx, game.ctrl.pos.x + WORLD / 2 - ox, game.ctrl.pos.z + WORLD / 2 - oz, rx, rz, r.color);
  }
  // which way the camera looks: a short tick from the player
  const px = Math.round(game.ctrl.pos.x + WORLD / 2 - ox), pz = Math.round(game.ctrl.pos.z + WORLD / 2 - oz);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, pz);
  ctx.lineTo(px - Math.sin(game.cam.yaw) * 7, pz - Math.cos(game.cam.yaw) * 7);
  ctx.stroke();
  dot(game.ctrl.pos.x, game.ctrl.pos.z, '#ffffff', 4);
}

// A player beyond the minimap's edge: a pixel marker pinned to the edge on the line from you to them,
// with a tip pixel pointing outward (toward where they are).
const EDGE_INSET = 3;
function edgePointer(ctx, fx, fz, tx, tz, color) {
  const dx = tx - fx, dz = tz - fz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const lo = EDGE_INSET, hi = WORLD - 1 - EDGE_INSET;
  let t = 1; // shrink the ray from you until it stays inside the inset box
  if (fx + dx * t < lo) t = (lo - fx) / dx;
  if (fx + dx * t > hi) t = (hi - fx) / dx;
  if (fz + dz * t < lo) t = (lo - fz) / dz;
  if (fz + dz * t > hi) t = (hi - fz) / dz;
  const px = Math.round(fx + dx * t), pz = Math.round(fz + dz * t);
  // tip direction snapped to 8 ways
  const ux = dx / len, uz = dz / len;
  const sx = Math.abs(ux) > 0.38 ? Math.sign(ux) : 0, sz = Math.abs(uz) > 0.38 ? Math.sign(uz) : 0;
  ctx.fillStyle = '#0d1016';
  ctx.fillRect(px - 2, pz - 2, 5, 5);
  ctx.fillRect(px + sx * 2 - 1, pz + sz * 2 - 1, 3, 3);
  ctx.fillStyle = color;
  ctx.fillRect(px - 1, pz - 1, 3, 3);
  ctx.fillRect(px + sx * 2, pz + sz * 2, 1, 1);
}

// ---------- misc ----------

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

window.addEventListener('resize', () => {
  pixel.resize();
  camera.aspect = pixel.aspect;
  camera.updateProjectionMatrix();
});

// ---------- map editor ----------

const editor = new Editor({
  pixel, camera, toast,
  getTime: () => game.time ?? DEFAULT_TIME,
  onPlay: (map) => {
    if (game.mode === 'multi') {
      if (!send({ type: 'map', map })) return toast('Not connected to the game server');
      editor.playPending = true;
      toast('Loading your map for everyone here…');
    } else {
      // singleplayer (or straight from the menu): just play it here
      game.exitToGame = true;
      editor.close();
      startSingle(map);
    }
  },
  onExit: () => {
    input.takeZoom(); // drop wheel and rotate input from the editor
    input.takeRotate();
    game.lastSent.a = -1;
    if (game.mode === 'menu' && !game.exitToGame) menu.show();
    game.exitToGame = false;
  },
});

// ---------- modes: main menu, singleplayer, multiplayer ----------

const menu = new Menu({
  pixel, camera, toast,
  getTime: () => game.time ?? DEFAULT_TIME,
  inDiscord: inDiscord(),
  get defaultRoom() { return identity?.room ?? 'dev'; },
  onSingle: (map) => startSingle(map),
  onMulti: (room, map) => startMulti(room, map),
  onEditor: (base, name) => { menu.hide(); editor.open(base, name); },
  onSettings: () => settings.open(),
});

function myName() {
  return identity?.hello?.dev?.name ?? 'You';
}

/** Offline play: a new endless world (map = null), a saved endless world or an island map. */
function startSingle(map) {
  menu.hide();
  resetSession();
  game.mode = 'single';
  game.me = 'solo';
  game.roster = new Map([[game.me, { id: game.me, name: myName(), color: PLAYER_COLORS[0], look: cleanPlayerLook(loadLook(), game.me), wear: null }]]);
  game.saveName = map?.name && getSave(map.name) ? map.name : null;
  game.stateKey = game.saveName ? `save:${game.saveName}` : null;
  // the world's own game mode (worlds from before modes keep the browser-wide toggle)
  const mode = game.saveName && getMeta(game.saveName).mode;
  if (mode === 'creative' || mode === 'survival') settings.hold('creative', mode === 'creative', true);
  buildWorld(Math.floor(Math.random() * 2 ** 31), map);
  if (game.saveName) setMeta(game.saveName, { played: Date.now() });
  game.playStart = game.thumbAt = clock.elapsedTime;
  loadInventory(game.saveName ? `save:${game.saveName}` : null);
  game.roster.get(game.me).wear = { ...inventory.wear }; // what you wore in this world
  onRoster([...game.roster.values()]);
  $('loading').hidden = true;
  if (map) toast(`Welcome to ${map.name}`);
}

/** Join a room on the server, optionally bringing a world to play there. */
function startMulti(room, map = null) {
  menu.hide();
  resetSession();
  game.mode = 'multi';
  identity.room = room;
  game.stateKey = `room:${room}`;
  loadInventory(`room:${room}`);
  game.bringMap = map;
  $('loading').hidden = false;
  $('loading').textContent = 'Connecting…';
  connect();
}

/** Back to the main menu (leaves the multiplayer room). */
function toMenu() {
  if (editor.active) { editor.playPending = false; game.exitToGame = true; editor.close(); }
  const wasSaved = game.mode === 'single' && !!game.saveName;
  if (wasSaved) { captureThumb(true); writeSave(); }
  togglePause(false);
  resetSession();
  game.mode = 'menu';
  menu.show(wasSaved ? 'menu-single' : 'menu-main');
}

// ---------- pause menu (Esc in game): Back to Game, Settings, Quit ----------
// Singleplayer really pauses (the world stops and the clock waits); in multiplayer the room carries on.
function togglePause(open = !game.paused) {
  const playing = (game.mode === 'single' || game.mode === 'multi') && game.world;
  if (open && !playing) return;
  if (open === !!game.paused) return;
  game.paused = open;
  document.body.classList.toggle('paused', open);
  $('pause').hidden = !open;
  if (open) {
    if (inventory.isOpen) inventory.close();
    hideCtx();
    game.pausedAt = Date.now();
    const single = game.mode === 'single';
    $('pause-title').textContent = single ? 'Game paused' : 'Game menu';
    $('pause-note').textContent = single
      ? (game.saveName ? `“${game.saveName}” waits for you.` : "This world isn't saved. Create a world from the menu to keep one.")
      : `Room ${identity?.room ?? ''}: everyone else keeps playing.`;
    $('pause-quit').textContent = single ? (game.saveName ? 'Save & Quit to Title' : 'Quit to Title') : 'Leave Room';
  } else {
    settings.close();
    // the clock stood still too: carry on from where it was paused
    if (game.mode === 'single' && game.clock && game.pausedAt) game.clock.at += Date.now() - game.pausedAt;
    game.pausedAt = 0;
    clock.getDelta(); // no big step on the first frame back
  }
}
$('pause-resume').addEventListener('click', () => togglePause(false));
$('pause-settings').addEventListener('click', () => { $('pause').hidden = true; settings.open(() => { if (game.paused) $('pause').hidden = false; }); });
$('pause-quit').addEventListener('click', () => toMenu());

// forget the current world, players and connection
function resetSession() {
  savePlayer();
  game.stateKey = null;
  game.blueprint?.removeFromParent();
  game.blueprint = null;
  game.launchBp?.removeFromParent();
  game.launchBp = game.launchMemo = null;
  if (game.fishing && game.local) game.fishing.cancel(fishCtx());
  game.fishing = null;
  game.drops?.clear();
  game.drops = null;
  if (socket) { game.leaving = true; socket.close(); socket = null; }
  game.saveName = null;
  settings.release('creative'); // back to the browser-wide creative toggle
  if (inventory.isOpen) inventory.close();
  if (game.world) vitals.save();
  game.scene?.dispose();
  game.scene = null;
  game.world = null;
  game.ctrl = null;
  game.ride = null;
  game.driving = null;
  game.boats = null;
  game.local = null;
  game.mapKey = null;
  game.seed = null;
  for (const r of game.remotes.values()) r.label.remove();
  game.remotes.clear();
  game.roster = new Map();
  $('players').innerHTML = '';
}

$('open-menu').addEventListener('click', (e) => { e.currentTarget.blur(); togglePause(true); });
// ---------- the boat panel (B while aboard): name, paint and upgrades ----------
const boatPanelBoat = () => (game.ride ? game.boats?.list.get(game.ride.id) : null);
function toggleBoatPanel(open = $('boat-panel').hidden) {
  if (open && !boatPanelBoat()) return toast('Board a boat first (B opens its panel)');
  $('boat-panel').hidden = !open;
  if (open) renderBoatPanel();
}
// change the boat's look here and for everyone, and keep it in the save
// a new cabin or prop may now stand where you are: step to the nearest free spot on deck
function unstickRider(b) {
  const r = game.ride;
  if (!r || r.id !== b.id || r.steer || walkable(r.lx, r.lz, undefined, b.obs, b.hull)) return;
  const spot = nearestWalkable(r.lx, r.lz, b.obs, b.hull) ?? b.hull.HELM;
  [r.lx, r.lz] = spot;
}
function setBoatLook(b, look) {
  game.boats.setLook(b.id, look);
  unstickRider(b);
  if (game.mode === 'multi') send({ type: 'boatlook', id: b.id, look: b.look });
  saveDigging();
  renderBoatPanel();
}
const canPay = (cost) => inventory.creative || Object.entries(cost).every(([id, n]) => inventory.count(id) >= n);
function renderBoatPanel() {
  const b = boatPanelBoat();
  if (!b) return;
  const L = b.look;
  if (document.activeElement !== $('bp-name')) $('bp-name').value = L.n;
  // upgrades: level pips, the next level's cost, and a Build button
  $('bp-ups').innerHTML = UPGRADES.map((u0, i) => {
    if (!upgradeOffered(i, b.look.t)) return ''; // decorations are built for the cabin boat (the pirate ship has its own)
    const u = upgradeFor(i, b.look.t); // the rowboat's Engine is its Sail
    const lvl = L.u[i], max = UPGRADE_MAX[i], cost = u.cost[lvl];
    const pips = Array.from({ length: max }, (_, k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('');
    const items = cost ? Object.entries(cost).map(([id, n]) => `<span class="craft-item${inventory.count(id) >= n || inventory.creative ? '' : ' short'}"><img alt="" src="${iconURL(id)}" /><b>${n}</b></span>`).join('') : '';
    const pic = partIcon(pixel.renderer, 'upgrade', i, L, Math.min(max, lvl + 1)); // what the next level adds (or the finished one)
    return `<div class="bp-up${cost ? '' : ' done'}"><img class="bp-up-pic" alt="" src="${pic}" /><div class="bp-up-text"><b>${u.name}</b> <span class="bp-pips">${pips}</span><br><small>${u.desc}</small></div>
      <div class="bp-up-cost">${items}</div>
      <button class="btn${cost && canPay(cost) ? ' accent' : ''}" data-u="${i}" tabindex="-1" ${cost ? (canPay(cost) ? '' : 'disabled') : 'disabled'}>${cost ? (lvl ? 'Upgrade' : 'Build') : 'Done'}</button></div>`;
  }).join('');
}
$('bp-ups').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-u]'), b = boatPanelBoat();
  if (!btn || !b) return;
  btn.blur();
  const i = Number(btn.dataset.u), up = upgradeFor(i, b.look.t), cost = up.cost[b.look.u[i]];
  if (!cost || !canPay(cost)) return;
  if (!inventory.creative) for (const [id, n] of Object.entries(cost)) inventory.remove(id, n);
  inventory.render(); inventory.onChange();
  const u = b.look.u.slice();
  u[i]++;
  setBoatLook(b, { ...b.look, u });
  toast(`${up.name} ${UPGRADE_MAX[i] > 1 ? `level ${u[i]}` : 'built'}!`);
});
$('bp-name').maxLength = NAME_MAX;
$('bp-name').addEventListener('change', () => { const b = boatPanelBoat(); if (b) setBoatLook(b, { ...b.look, n: $('bp-name').value }); $('bp-name').blur(); });
$('bp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('bp-name').blur(); e.stopPropagation(); });
$('bp-close').addEventListener('click', (e) => { e.currentTarget.blur(); toggleBoatPanel(false); });
$('boat-btn').addEventListener('click', (e) => { e.currentTarget.blur(); toggleBoatPanel(); });
$('bp-edit').addEventListener('click', (e) => { e.currentTarget.blur(); setBoatEdit(true); });

// ---------- the key prompt above the hotbar: what F does here (board a nearby boat, take or leave the helm) ----------
// Rebuilt only when its text changes. Clicking it does the same as the key.
let promptKey = '', promptFade = 0, helmAt = 0; // helmAt: when you took the helm (its prompt fades after HELM_PROMPT_MS)
const HELM_PROMPT_MS = 5000;
function nearestBoat(max = 4.5) { // the boat whose hull is nearest you, within `max`
  const c = game.ctrl;
  let best = null, bd = max;
  for (const b of game.boats.list.values()) {
    const [lx, lz] = toLocal(b, c.pos.x, c.pos.z);
    const hl = b.hull, d = Math.hypot(Math.max(0, Math.abs(lx) - hl.W), Math.max(0, lz - hl.TIP, hl.STERN - lz));
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
function updatePrompt() {
  let key = '', text = '', more = '';
  const busy = game.mode === 'menu' || !game.ctrl || !game.boats || inventory.isOpen || !$('boat-panel').hidden || game.boatEdit;
  if (!busy) {
    const r = game.ride;
    const name = (b) => (b?.look?.n ? `“${b.look.n}”` : (b?.hull?.name ?? 'boat').toLowerCase());
    if (!r?.steer) helmAt = 0;
    else if (!helmAt) helmAt = performance.now();
    if (r?.steer) { // shown for the first few seconds at the helm, then out of the way
      if (performance.now() - helmAt < HELM_PROMPT_MS) { key = 'F'; text = 'Leave the helm'; more = '<kbd>W</kbd><kbd>S</kbd>throttle <kbd>A</kbd><kbd>D</kbd>steer'; }
    }
    else if (r) { key = 'F'; text = 'Take the helm'; more = '<kbd>B</kbd>boat'; }
    else {
      const b = nearestBoat();
      if (b) { key = 'F'; text = `Board the ${name(b)}`; }
    }
  }
  const sig = key + text + more;
  if (sig === promptKey) return;
  promptKey = sig;
  const el = $('key-prompt');
  clearTimeout(promptFade);
  if (!key) { // fade out (keeping the old text while it goes), then hide
    if (el.hidden) return;
    el.classList.add('out');
    promptFade = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 600);
    return;
  }
  el.classList.remove('out');
  el.hidden = false;
  $('kp-key').textContent = key;
  $('kp-text').innerHTML = text + (more ? ` <span class="kp-more">${more}</span>` : '');
}
$('key-prompt').addEventListener('click', (e) => { e.currentTarget.blur(); boatKey(); });

// ---------- boat edit mode: hover a part of your boat to outline it, click it to change it ----------
// game.boatEdit = the boat's id while editing. Parts are found by raycasting the boat's meshes (boat.js tags each
// with userData.part / slot). The part menu (#part-menu) shows the part's variants as little pictures (boaticons.js)
// and, where the part takes one, a row of colours. Parts that are switched off (no cabin, no mast...) are reached
// from the buttons in the edit banner.
const PART_TITLES = { hull: 'Hull', cabin: 'Cabin', roof: 'Roof', top: 'On the roof', mast: 'Mast', figure: 'Figurehead', flag: 'Flag', lanterns: 'Stern lanterns' };
const PIRATE_LABELS = { cabin: 'Castle', roof: 'Castle top', mast: 'Sails' }; // the edit banner's buttons on the pirate ship
const PIRATE_ONLY = ['figure', 'flag', 'lanterns'];
function setBoatEdit(on) {
  const b = boatPanelBoat();
  if (on && !b) return toast('Board your boat first');
  if (game.boatEdit && game.boats?.list.has(game.boatEdit)) game.boats.setEditing(game.boatEdit, false);
  game.boatEdit = on ? b.id : null;
  if (on) {
    if (game.ride.steer) toggleHelm();
    toggleBoatPanel(false);
    game.boats.setEditing(b.id, true);
  }
  $('edit-banner').hidden = !on;
  if (on) for (const btn of $('edit-banner').querySelectorAll('button[data-part]')) { // only parts this kind of boat has
    const part = btn.dataset.part, t = b.look.t;
    btn.dataset.label ??= btn.textContent;
    btn.textContent = (t === 2 && PIRATE_LABELS[part]) || btn.dataset.label; // the pirate ship's castle, castle top and sails
    if (t === 2) btn.hidden = part === 'top';
    else btn.hidden = PIRATE_ONLY.includes(part) || (!!t && (part === 'top' || ((part === 'cabin' || part === 'roof' || part === 'mast') && !b.tm[part === 'mast' ? 'sail' : part].visible)));
  }
  hidePartMenu();
  game.scene?.setHighlight(null, 0, 0);
}
// the boat part under the screen point, or null: { part, slot }
const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function editPick(px, py) {
  const b = game.boats?.list.get(game.boatEdit);
  if (!b) return null;
  _ndc.set((px / pixel.cssW) * 2 - 1, -(py / pixel.cssH) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  const hits = _ray.intersectObjects(b.group.children.filter((o) => o.visible && o.userData.part), false);
  const h = hits[0]?.object;
  return h ? { part: h.userData.part, slot: h.userData.slot } : null;
}
function editHover() {
  const b = game.boats?.list.get(game.boatEdit), hover = input.hover;
  const hit = b && hover && !game.partMenu?.pinned ? editPick(hover[0], hover[1]) : null;
  const sel = hit ?? game.partMenu; // keep the part you're editing outlined while its menu is open
  const m = b && sel && game.boats.partMesh(b, sel.part, sel.slot);
  game.scene.setHighlight(m ? { kind: 'mesh', obj: m } : null, clock.elapsedTime, game.cam.dist);
  $('view').style.cursor = hit ? 'pointer' : '';
}
function editClick(px, py) {
  const hit = editPick(px, py);
  if (hit) openPartMenu(hit, px, py); else hidePartMenu();
}
function hidePartMenu() { $('part-menu').hidden = true; game.partMenu = null; }
function openPartMenu(hit, px, py) {
  game.partMenu = hit;
  const el = $('part-menu');
  el.hidden = false;
  renderPartMenu();
  // next to the click, kept on screen
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, px + 14))}px`;
  el.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, py - h / 2))}px`;
}
function renderPartMenu() {
  const b = game.boats?.list.get(game.boatEdit), pm = game.partMenu;
  if (!b || !pm) return hidePartMenu();
  const L = b.look, lay = layoutOf(L);
  let title = PART_TITLES[pm.part], styles = [], colour = null, colourLabel = 'Colour';
  const opt = (kind, names, cur) => names.map((n, v) => ({ v, name: n, icon: partIcon(pixel.renderer, kind, v, L), on: cur === v }));
  if (pm.part === 'hull') colour = 0;
  else if (pm.part === 'slot') { // a deck spot: the props that fit there (the cabin boat's or the pirate ship's spots)
    const sl = slotsOf(L)[pm.slot];
    title = sl.name;
    styles = PROPS.map((pr, t) => ({ v: t, name: pr.name, ok: pr.r <= sl.maxR })).filter((o) => o.ok)
      .map((o) => ({ ...o, icon: partIcon(pixel.renderer, 'prop', o.v, L), on: propAt(L, pm.slot) === o.v }));
  } else if (L.t === 2) { // the pirate ship: castle and castle-top colours, and its swappable parts
    if (pm.part === 'cabin') { title = 'Castle'; colour = 1; }
    else if (pm.part === 'roof') { title = 'Castle top'; colour = 2; }
    else if (pm.part === 'mast') { title = 'Sails'; styles = opt('sails', PIRATE_PARTS.sails, L.p[1]); colour = 3; colourLabel = 'Sail colour'; }
    else if (PIRATE_ONLY.includes(pm.part)) styles = opt(pm.part, PIRATE_PARTS[pm.part], L.p[PIRATE_PART_INDEX[pm.part]]);
  } else if (L.t) { // a fixed model: just its colours
    title = `${HULLS[L.t].name}: ${PART_TITLES[pm.part].toLowerCase()}`;
    colour = pm.part === 'cabin' && b.tm.cabin.visible ? 1 : pm.part === 'roof' && b.tm.roof.visible ? 2 : pm.part === 'mast' && b.tm.sail.visible ? 3 : null;
    if (colour === 3) { title = `${HULLS[L.t].name}: sails`; colourLabel = 'Sail colour'; }
    if (colour === null) title += ' (not on this boat)';
  } else if (pm.part === 'cabin') { styles = opt('cabin', CABINS.map((c) => c.name), L.p[0]); colour = lay.cab ? 1 : null; }
  else if (pm.part === 'roof') {
    styles = lay.cab ? opt('roof', ROOFS, L.p[1]) : [];
    if (!lay.cab) title += ' (needs a cabin)';
    colour = lay.cab ? (lay.roof === 2 ? 3 : 2) : null;
    if (lay.roof === 2) colourLabel = 'Canvas colour';
  } else if (pm.part === 'top') {
    styles = lay.cab && lay.roof !== 2 ? opt('top', TOPS, L.p[2]) : [];
    if (!lay.cab) title += ' (needs a cabin)'; else if (lay.roof === 2) title += ' (not on a canvas roof)';
  } else if (pm.part === 'mast') { styles = opt('mast', MASTS, L.p[3]); colour = 3; colourLabel = 'Flag & sail colour'; }
  // the cabin boat's size: length and height steppers on the hull's menu
  const sizeRow = (i, label, value) => `<div class="pm-size"><span>${label}</span><button class="pm-step" data-sz="${i}" data-d="-1" tabindex="-1" ${L.s[i] > 0 ? '' : 'disabled'}>−</button><b>${value}</b><button class="pm-step" data-sz="${i}" data-d="1" tabindex="-1" ${L.s[i] < SIZE_COUNTS[i] - 1 ? '' : 'disabled'}>+</button></div>`;
  const size = pm.part === 'hull' && !L.t ? `<div class="pm-sub">Size</div>${sizeRow(0, 'Length', `${(6.3 + SIZE_LEN[L.s[0]]).toFixed(2).replace(/0$/, '')} tiles`)}${sizeRow(1, 'Height', L.s[1] ? `+${SIZE_H[L.s[1]].toFixed(1)}` : 'Standard')}` : '';
  $('part-menu').innerHTML = `<div class="pm-head"><b>${title}</b><button class="pm-x" tabindex="-1" title="Close">×</button></div>`
    + size
    + (styles.length ? `<div class="pm-styles">${styles.map((o) => `<button class="pm-style${o.on ? ' on' : ''}" data-v="${o.v}" tabindex="-1" title="${o.name}"><img alt="" src="${o.icon}" /><span>${o.name}</span></button>`).join('')}</div>` : '')
    + (colour !== null ? `<div class="pm-sub">${colourLabel}</div><div class="pm-colours">${BOAT_PALETTE.map((hex, ci) =>
      `<button class="bp-swatch${L.c[colour] === ci ? ' on' : ''}" data-c="${ci}" style="background:#${hex.toString(16).padStart(6, '0')}" tabindex="-1"></button>`).join('')}</div>` : '');
  $('part-menu').dataset.colour = colour ?? '';
}
$('part-menu').addEventListener('click', (e) => {
  const b = game.boats?.list.get(game.boatEdit), pm = game.partMenu;
  if (!b || !pm) return;
  if (e.target.closest('.pm-x')) return hidePartMenu();
  const st = e.target.closest('.pm-style'), sw = e.target.closest('.bp-swatch'), step = e.target.closest('.pm-step');
  if (step) {
    const s = b.look.s.slice(), i = Number(step.dataset.sz);
    s[i] = Math.max(0, Math.min(SIZE_COUNTS[i] - 1, s[i] + Number(step.dataset.d)));
    resizeBoat(b, s[0], s[1]);
  } else if (st) {
    const v = Number(st.dataset.v);
    if (pm.part === 'slot') { const d = b.look.d.slice(); d[pm.slot] = v; setBoatLook(b, { ...b.look, d }); }
    else {
      const k = b.look.t === 2 ? PIRATE_PART_INDEX[pm.part] : { cabin: 0, roof: 1, top: 2, mast: 3 }[pm.part];
      if (k === undefined) return;
      const p = b.look.p.slice(); p[k] = v; setBoatLook(b, { ...b.look, p });
    }
  } else if (sw) {
    const c = b.look.c.slice();
    c[Number($('part-menu').dataset.colour)] = Number(sw.dataset.c);
    setBoatLook(b, { ...b.look, c });
  } else return;
  renderPartMenu();
});
// make the boat longer or taller: the bow (and whatever stands on the foredeck) moves forward, the deck rises
function resizeBoat(b, li, hi) {
  const nl = resizeLook(b.look, li, hi);
  if (!nl) return toast('Clear the foredeck first: something there would no longer fit');
  const hl = hullOf(nl), dE = hl.E ?? 0, longer = (hl.E ?? 0) > (b.hull.E ?? 0);
  if (longer && (!hullClear(game.world, b.x, b.z, b.yaw, hl) || boatHit(game.boats, b.id, b.x, b.z, b.yaw, hl))) return toast('Not enough open water ahead to make it longer');
  const r = game.ride;
  if (r?.id === b.id && !r.steer && r.lz > SPLIT) r.lz += dE - (b.hull.E ?? 0); // you're on the foredeck: it carries you forward
  setBoatLook(b, nl);
}
// the banner's part buttons open a part's menu even when that part is switched off (no cabin, no mast...)
$('edit-banner').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  if (btn.dataset.part) { const r = btn.getBoundingClientRect(); openPartMenu({ part: btn.dataset.part }, r.left, r.bottom + 120); }
  else if (btn.id === 'eb-panel') { setBoatEdit(false); toggleBoatPanel(true); }
  else if (btn.id === 'eb-done') setBoatEdit(false);
});
// the throttle lever: click a gear's name, or drag the lever up and down its track
{
  const helmBoat = () => (game.ride?.steer ? game.boats?.list.get(game.ride.id) : null);
  $('throttle').querySelector('.th-labels').addEventListener('click', (e) => {
    const span = e.target.closest('[data-t]'), b = helmBoat();
    if (span && b) setThrottle(b, Number(span.dataset.t));
  });
  const track = $('throttle').querySelector('.th-track');
  const fromY = (e) => { // the notch nearest the pointer
    const b = helmBoat();
    if (!b) return;
    const y = e.clientY - track.getBoundingClientRect().top - 7;
    setThrottle(b, THROTTLE.length - 2 - Math.round(Math.max(0, Math.min(THROTTLE.length - 1, y / GEAR_PX))));
  };
  track.addEventListener('pointerdown', (e) => { e.preventDefault(); track.setPointerCapture(e.pointerId); fromY(e); });
  track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) fromY(e); });
}
// creative mode: every item in the inventory screen and free building. A saved singleplayer world
// has its own game mode (Survival / Creative, picked in Create world, kept in its details as
// `mode`); while it's open the top-left button and the setting switch that world's mode.
// Elsewhere (multiplayer, unsaved or older worlds) it's the browser-wide debug toggle:
// `?creative` turns it on, remembered per browser.
const CREATIVE_KEY = 'settleon.creative';
function setCreative(on, quiet = false) {
  inventory.setCreative(on);
  const worldMode = settings?.local.has('creative') && game.mode === 'single' && game.saveName;
  if (worldMode) setMeta(game.saveName, { mode: on ? 'creative' : 'survival' });
  else { try { localStorage.setItem(CREATIVE_KEY, on ? '1' : '0'); } catch {} }
  if (!quiet) toast(on ? 'Creative mode: every item in your inventory (I), building is free' : (worldMode ? 'Survival mode' : 'Creative mode off'));
}

// ---------- settings (settings.js): from the title screen and the pause menu ----------
const settings = (() => {
  let creative = new URLSearchParams(location.search).has('creative');
  try { creative ||= localStorage.getItem(CREATIVE_KEY) === '1'; } catch {}
  return new Settings({ initial: { creative }, onChange: (k, v, quiet) => applySetting(k, v, quiet) });
})();
function applySetting(k, v, quiet = false) {
  if (k === 'creative') setCreative(v, quiet);
  if (k === 'pixel') { PIXEL_PREF.size = v; pixel.resize(); }
  if (k === 'minimap') document.body.classList.toggle('no-minimap', !v);
  if (k === 'labels') document.body.classList.toggle('no-labels', !v);
  // shadows and tilt-shift are read every frame
}
for (const [k, v] of Object.entries(settings.v)) applySetting(k, v, true);
// the controls card: the "?" button or H toggles it, Esc closes it first
function toggleHelp(open = $('help').hidden) {
  $('help').hidden = !open;
  $('help-btn').setAttribute('aria-expanded', String(open));
}
$('help-btn').addEventListener('click', (e) => { e.currentTarget.blur(); toggleHelp(); });
window.addEventListener('keydown', (e) => {
  const playing = (game.mode === 'single' || game.mode === 'multi') && !editor.active;
  if (e.code === 'Escape' && settings.isOpen) { settings.close(); return; }
  if (menu.active) { if (e.code === 'Escape') menu.back(); else if (menu.key(e)) e.preventDefault(); return; }
  if (e.code === 'Escape' && playing) { if (game.boatEdit) { if (game.partMenu) hidePartMenu(); else setBoatEdit(false); } else if (!$('boat-panel').hidden) toggleBoatPanel(false); else if (!$('help').hidden) toggleHelp(false); else if (inventory.isOpen) inventory.close(); else togglePause(); return; }
  if (e.target.closest?.('input, select, textarea') || !playing || game.paused) return;
  if (e.code === 'KeyH') { toggleHelp(); return; }
  if (e.code === 'KeyB' && !inventory.isOpen) { if (game.boatEdit) setBoatEdit(false); else toggleBoatPanel(); return; }
  if (e.code === 'KeyF' && !inventory.isOpen) { boatKey(); return; }
  if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); hideCtx(); inventory.toggle(); return; }
  if (e.code === 'KeyC' && inventory.isOpen) { inventory.toggleCraft(); return; } // show / hide the crafting panel
  if (e.code === 'KeyR' && !inventory.isOpen) { rotateKey(); return; }
  const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) - 1 : -1;
  if (n >= 0 && n < HOTBAR) inventory.select(n);
});
$('open-editor').addEventListener('click', (e) => {
  e.currentTarget.blur();
  openEditor();
});
// the map editor edits islands; endless worlds come from their seed and can't be edited
function openEditor() {
  if (!game.world) return;
  if (game.world.endless) return toast("Endless worlds can't be edited. Create an island world to use the map editor.");
  editor.open(game.world.base, game.mapName);
}


// ---------- boot ----------

(async () => {
  try {
    identity = await identify();
  } catch (err) {
    console.error(err);
    $('loading').textContent = `Couldn't sign in with Discord: ${err.message ?? err}`;
    return;
  }
  pixel.renderer.setAnimationLoop(frame);
  if (import.meta.env.DEV) window.__dbg = { game, pixel, camera, inventory, vitals, actAt, useWorkbench, launchAt, launchPlan, boatKey, editPick }; // dev only: lets headless tests inspect the renderer and act
  // ?room=... jumps straight into multiplayer (handy for testing); otherwise the main menu
  if (new URLSearchParams(location.search).has('room')) startMulti(identity.room);
  else toMenu();
})();
