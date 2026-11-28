// Cute chibi character: big head, tiny body, stubby limbs, blinking eyes, rosy cheeks.
// The model faces +Z; its origin is between the feet.
//
// Every mesh writes 1 into the stencil buffer. A see-through "silhouette" copy of each
// mesh draws only where the character is hidden behind scenery (greater depth, stencil ≠ 1),
// so you can always see where you are.

import * as THREE from 'three';
import { hashId, cleanLook, cleanWear, parseCloth } from '../shared/outfit.js';

export const ANIM = { IDLE: 0, WALK: 1, RUN: 2, AIR: 3, SWIM: 4, ROW: 5, CLIMB: 6 }; // ROW: at a rowboat's oars (ch.rowPhase)
// what the hand can hold (index 0 = empty): the two tools, then blocks (the network sends this index)
// held-item index → id. Sent to others as the tens of the `a` code (the server allows up to 29).
export const TOOLS = [null, 'shovel', 'pickaxe', 'dirt', 'stone', 'sand', 'snow', 'frog', 'axe', 'wood', 'log', 'workbench', 'stick', 'pebble', 'berries',
  'leaves', 'wall', 'chair', 'table', 'bed', 'lamp', 'shelf', 'boat', 'rod', 'coconut', 'coconut_half'];
const BLOCK_COLORS = { wall: [0x8a5730, 0xc08a56], dirt: [0x8d5c3a, 0x6fb33a], stone: [0x8e8c88, 0x8e8c88], sand: [0xe2cf92, 0xe2cf92], snow: [0xeef3f8, 0xeef3f8] };
export const SWING_SECS = 0.38; // one tool swing: wind up over the head, then chop down

const UNDIES = 0xe9dfc4; // undershorts: what you wear until you craft clothes
const SOLE = 0x4a3222;

// ---------- materials ----------
const solidCache = new Map();
function solid(color) {
  if (!solidCache.has(color)) {
    solidCache.set(color, new THREE.MeshLambertMaterial({
      color,
      stencilWrite: true, stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }));
  }
  return solidCache.get(color);
}
const ghostCache = new Map();
function ghost(color) {
  if (!ghostCache.has(color)) {
    const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.15);
    ghostCache.set(color, new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.75, depthWrite: false,
      depthFunc: THREE.GreaterDepth,
      stencilWrite: true, stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp,
    }));
  }
  return ghostCache.get(color);
}

const geoCache = new Map();
const boxGeo = (w, h, d) => {
  const k = `${w},${h},${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
};

// a box mesh plus its silhouette twin
function box(w, h, d, color, x = 0, y = 0, z = 0, shadow = true) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const m = new THREE.Mesh(boxGeo(w, h, d), solid(color));
  m.castShadow = shadow;
  m.receiveShadow = true;
  const s = new THREE.Mesh(boxGeo(w, h, d), ghost(color));
  s.renderOrder = 20;
  s.userData.ghost = true; // the menu preview hides these (it has no stencil)
  g.add(m, s);
  return g;
}

// limb hanging down from a pivot at its top
function limb(w, h, d, color, tipColor, tipH) {
  const pivot = new THREE.Group();
  pivot.add(box(w, h, d, color, 0, -h / 2, 0));
  if (tipColor != null) pivot.add(box(w + 0.02, tipH, d + 0.03, tipColor, 0, -h - tipH / 2 + 0.01, 0.01));
  return pivot;
}

export function makeCharacter(id, color, look = null, wear = null) {
  const h = hashId(id);
  const L = cleanLook(look, id), W = cleanWear(wear);
  const skin = L.skin, hair = L.hair, girl = L.g === 1;
  const shirt = new THREE.Color(color).getHex(); // the undershirt: your player colour, so you can tell players apart
  const worn = (slot) => parseCloth(W[slot]);
  const tw = girl ? 0.24 : 0.26; // torso width: a little slimmer for girls
  const ax = tw / 2 + 0.035; // where the arms hang

  const root = new THREE.Group();
  const body = new THREE.Group(); // bounces
  root.add(body);

  // bare legs and feet (clothes go over them)
  const legL = limb(0.09, 0.08, 0.1, skin, skin, 0.05);
  const legR = limb(0.09, 0.08, 0.1, skin, skin, 0.05);
  legL.position.set(-0.065, 0.13, 0);
  legR.position.set(0.065, 0.13, 0);

  // torso: a sleeveless undershirt and undershorts
  const torso = new THREE.Group();
  torso.position.y = 0.13;
  torso.add(box(tw, 0.2, 0.18, shirt, 0, 0.1, 0));
  torso.add(box(tw + 0.01, 0.05, 0.19, UNDIES, 0, 0.01, 0));
  torso.add(box(0.14, 0.03, 0.03, 0xffffff, 0, 0.19, 0.09, false));

  // stubby arms with round-ish hands
  const armL = limb(0.07, 0.11, 0.08, skin, skin, 0.05);
  const armR = limb(0.07, 0.11, 0.08, skin, skin, 0.05);
  armL.position.set(-ax, 0.31, 0);
  armR.position.set(ax, 0.31, 0);

  // big head
  const head = new THREE.Group();
  head.position.y = 0.33;
  head.add(box(0.46, 0.4, 0.4, skin, 0, 0.2, 0));
  // eyes (the face style and eye colour), set low on the face
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.15, 0.201);
  buildEyes(eyes, L.face, L.eyes, girl);
  head.add(eyes);
  // rosy cheeks + tiny mouth
  head.add(box(0.07, 0.035, 0.01, 0xff9aa2, -0.16, 0.08, 0.202, false));
  head.add(box(0.07, 0.035, 0.01, 0xff9aa2, 0.16, 0.08, 0.202, false));
  head.add(box(0.04, 0.02, 0.01, 0x9a4a3a, 0, 0.07, 0.202, false));
  const hat = worn('hat');
  buildHair(head, L.hs, hair, shirt, !!hat);
  buildFacialHair(head, L.fh, L.fc, skin);

  // ---- clothes (crafted in game): each piece is drawn over the body parts it covers ----
  const addTop = (c) => {
    const hi = shade(c.hex, 0.22), lo = shade(c.hex, -0.22);
    if (c.type === 'tee') {
      torso.add(box(tw + 0.02, 0.17, 0.2, c.hex, 0, 0.105, 0));
      torso.add(box(tw + 0.025, 0.025, 0.205, lo, 0, 0.035, 0));
      torso.add(box(0.15, 0.03, 0.205, hi, 0, 0.185, 0, false));
      for (const arm of [armL, armR]) arm.add(box(0.088, 0.065, 0.1, c.hex, 0, -0.032, 0));
    } else if (c.type === 'sweater') {
      torso.add(box(tw + 0.03, 0.2, 0.21, c.hex, 0, 0.1, 0));
      torso.add(box(tw + 0.035, 0.035, 0.215, hi, 0, 0.02, 0));
      torso.add(box(tw + 0.035, 0.03, 0.215, hi, 0, 0.12, 0, false));
      torso.add(box(0.18, 0.05, 0.2, lo, 0, 0.205, 0, false));
      for (const arm of [armL, armR]) {
        arm.add(box(0.09, 0.115, 0.1, c.hex, 0, -0.0575, 0));
        arm.add(box(0.092, 0.025, 0.102, hi, 0, -0.105, 0));
      }
    } else { // dress: a bodice, puffed sleeves and a flared skirt
      torso.add(box(tw + 0.02, 0.17, 0.2, c.hex, 0, 0.115, 0));
      torso.add(box(tw + 0.025, 0.03, 0.205, hi, 0, 0.065, 0, false)); // a sash
      torso.add(box(0.15, 0.03, 0.205, lo, 0, 0.185, 0, false));
      torso.add(box(tw + 0.1, 0.1, 0.27, c.hex, 0, 0.0, 0));
      torso.add(box(tw + 0.17, 0.035, 0.34, lo, 0, -0.045, 0));
      for (const arm of [armL, armR]) arm.add(box(0.1, 0.055, 0.115, c.hex, 0, -0.028, 0));
    }
  };
  const addBottom = (c) => {
    const hi = shade(c.hex, 0.22), lo = shade(c.hex, -0.25);
    if (c.type === 'skirt') {
      torso.add(box(tw + 0.02, 0.045, 0.2, lo, 0, 0.04, 0));
      torso.add(box(tw + 0.09, 0.09, 0.26, c.hex, 0, -0.01, 0));
      torso.add(box(tw + 0.15, 0.03, 0.32, hi, 0, -0.055, 0));
      return;
    }
    torso.add(box(tw + 0.02, 0.055, 0.2, lo, 0, 0.025, 0));
    const long = c.type === 'pants';
    for (const leg of [legL, legR]) {
      leg.add(box(0.105, long ? 0.088 : 0.048, 0.115, c.hex, 0, long ? -0.044 : -0.024, 0));
      leg.add(box(0.11, 0.018, 0.12, hi, 0, long ? -0.08 : -0.042, 0, false)); // cuff
    }
  };
  const addShoes = (c) => {
    const lo = shade(c.hex, -0.28);
    for (const leg of [legL, legR]) {
      if (c.type === 'boots') {
        leg.add(box(0.115, 0.115, 0.13, c.hex, 0, -0.065, 0));
        leg.add(box(0.12, 0.025, 0.135, shade(c.hex, 0.25), 0, -0.012, 0, false));
        leg.add(box(0.11, 0.05, 0.16, lo, 0, -0.1, 0.02));
      } else {
        leg.add(box(0.11, 0.06, 0.14, c.hex, 0, -0.1, 0.015));
        leg.add(box(0.06, 0.012, 0.05, 0xffffff, 0, -0.07, 0.045, false)); // laces
      }
      leg.add(box(0.114, 0.015, c.type === 'boots' ? 0.165 : 0.145, SOLE, 0, -0.1275, c.type === 'boots' ? 0.02 : 0.015));
    }
  };
  const addScarf = (c) => {
    torso.add(box(tw + 0.03, 0.05, 0.21, c.hex, 0, 0.18, 0));
    torso.add(box(0.09, 0.07, 0.04, shade(c.hex, -0.25), 0.07, 0.17, 0.105));
    torso.add(box(0.07, 0.15, 0.03, c.hex, 0.07, 0.085, 0.112));
    torso.add(box(0.072, 0.03, 0.032, shade(c.hex, 0.3), 0.07, 0.07, 0.113, false));
  };
  const addHat = (c) => {
    const hi = shade(c.hex, 0.22), lo = shade(c.hex, -0.25);
    if (c.type === 'cap') {
      head.add(box(0.53, 0.11, 0.47, c.hex, 0, 0.5, 0));
      head.add(box(0.34, 0.03, 0.17, lo, 0, 0.455, 0.3));
      head.add(box(0.06, 0.06, 0.06, hi, 0, 0.575, 0, false));
    } else if (c.type === 'beanie') {
      head.add(box(0.53, 0.17, 0.47, c.hex, 0, 0.5, 0));
      head.add(box(0.54, 0.06, 0.48, hi, 0, 0.43, 0));
      head.add(box(0.11, 0.1, 0.11, hi, 0, 0.64, 0));
    } else { // sun hat: a wide brim and a banded crown
      head.add(box(0.8, 0.03, 0.74, c.hex, 0, 0.465, 0));
      head.add(box(0.47, 0.15, 0.43, c.hex, 0, 0.55, 0));
      head.add(box(0.48, 0.04, 0.44, shirt, 0, 0.49, 0, false));
      head.add(box(0.82, 0.015, 0.76, lo, 0, 0.45, 0, false));
    }
  };
  const t = worn('top'), b = worn('bottom'), s = worn('shoes'), n = worn('neck');
  if (b) addBottom(b);
  if (t) addTop(t);
  if (s) addShoes(s);
  if (n) addScarf(n);
  if (hat) addHat(hat);

  body.add(legL, legR, torso, armL, armR, head);

  // a lantern in the left hand, lit at night (see setLantern)
  const lantern = new THREE.Group();
  lantern.position.set(0, -0.2, 0.03);
  lantern.add(box(0.075, 0.015, 0.075, 0x3a2a20, 0, 0.055, 0)); // cap
  lantern.add(box(0.07, 0.015, 0.07, 0x3a2a20, 0, -0.045, 0)); // base
  lantern.add(box(0.02, 0.03, 0.02, 0x3a2a20, 0, 0.075, 0)); // handle
  const flame = new THREE.Mesh(boxGeo(0.05, 0.075, 0.05), LANTERN_GLOW); // HDR, so it blooms
  lantern.add(flame);
  lantern.visible = false;
  armL.add(lantern);
  // the held tool hangs from the right hand, pointing forward (see setTool)
  const toolGrip = new THREE.Group();
  toolGrip.position.set(0, -0.15, 0.01);
  armR.add(toolGrip);
  return {
    toolGrip, tool: 0, swingT: 0, swingHit: true, lantern, lanternOn: false,
    root, body, legL, legR, armL, armR, head, eyes, look: L, wear: W,
    phase: 0, blend: 0, nextBlink: 1 + (h % 300) / 100, blinkT: 0,
    // springs for cartoon follow-through: squash (1 = rest), forward lean, head lag
    sq: 1, sqV: 0, lean: 0, leanV: 0, headX: 0, headXV: 0,
    lastAnim: ANIM.IDLE, lastStep: 0, idleT: 0, hopT: 0, nextHop: 4 + (h % 400) / 100, seed: (h % 1000) / 100,
  };
}

/** A key that changes whenever the look or the clothes do (to know when a character must be rebuilt). */
export const lookKey = (look, wear) => JSON.stringify([look, wear]);

// lighten (k > 0) or darken (k < 0) a colour
function shade(hex, k) {
  const c = new THREE.Color(hex);
  return (k > 0 ? c.lerp(new THREE.Color(0xffffff), k) : c.lerp(new THREE.Color(0x000000), -k)).getHex();
}

// the eyes, by face style: 0 classic (tall), 1 round, 2 sleepy, 3 happy (^ ^), 4 sparkle (big). Girls get lashes.
function buildEyes(eyes, face, iris, girl) {
  const DARK = 0x2a1d1a;
  const spark = (x, y, s = 0.03) => eyes.add(box(s, s, 0.01, 0xffffff, x, y, 0.012, false));
  for (const side of [-1, 1]) {
    const x = side * 0.1;
    if (face === 0) {
      eyes.add(box(0.07, 0.11, 0.015, DARK, x, 0, 0, false));
      eyes.add(box(0.045, 0.065, 0.012, iris, x, -0.015, 0.008, false));
      spark(x - 0.015, 0.03);
    } else if (face === 1) {
      eyes.add(box(0.09, 0.09, 0.015, DARK, x, 0, 0, false));
      eyes.add(box(0.06, 0.06, 0.012, iris, x, -0.008, 0.008, false));
      spark(x - 0.017, 0.02, 0.026);
    } else if (face === 2) {
      eyes.add(box(0.08, 0.045, 0.015, DARK, x, -0.02, 0, false));
      eyes.add(box(0.05, 0.022, 0.012, iris, x, -0.03, 0.008, false));
      eyes.add(box(0.09, 0.018, 0.017, 0x3a2a24, x, 0.006, 0.002, false)); // a heavy lid
    } else if (face === 3) {
      for (const d of [-1, 1]) {
        const bar = box(0.05, 0.02, 0.015, DARK, x + d * 0.021, 0, 0, false);
        bar.rotation.z = -d * 0.75;
        eyes.add(bar);
      }
    } else {
      eyes.add(box(0.085, 0.14, 0.015, DARK, x, 0, 0, false));
      eyes.add(box(0.06, 0.1, 0.012, iris, x, -0.012, 0.008, false));
      spark(x - 0.018, 0.04, 0.036);
      spark(x + 0.014, -0.03, 0.02);
    }
    if (girl) eyes.add(box(0.035, 0.016, 0.016, DARK, side * 0.147, face === 4 ? 0.065 : face === 3 ? 0.03 : 0.052, 0, false)); // a lash flick
  }
}

// hair styles (head-local coordinates: the head box spans x ±0.23, y 0–0.4, z ±0.2). With a hat on, what would poke out
// through it (tufts, spikes, buns, puffs) is left off.
function buildHair(head, style, hair, ribbon, hat) {
  if (style === 9) return; // bald
  const add = (w, h, d, x, y, z, color = hair) => head.add(box(w, h, d, color, x, y, z));
  add(0.5, 0.1, 0.44, 0, 0.42, 0); // cap
  add(0.5, 0.3, 0.08, 0, 0.27, -0.18); // back
  add(0.5, 0.08, 0.06, 0, 0.34, 0.19); // fringe
  add(0.06, 0.22, 0.4, -0.235, 0.27, 0);
  add(0.06, 0.22, 0.4, 0.235, 0.27, 0);
  if (style === 1 && !hat) {
    const tuft = box(0.06, 0.16, 0.06, hair, 0.04, 0.52, 0.02);
    tuft.rotation.z = -0.5;
    head.add(tuft);
  } else if (style === 2 && !hat) {
    for (const [x, lean, hgt] of [[-0.18, 0.5, 0.11], [-0.09, 0.25, 0.15], [0, 0, 0.17], [0.09, -0.25, 0.15], [0.18, -0.5, 0.11]]) {
      const sp = box(0.075, hgt, 0.075, hair, x, 0.5 + hgt / 2 - 0.06, 0);
      sp.rotation.z = lean;
      head.add(sp);
    }
    for (const x of [-0.12, 0.12]) { const sp = box(0.07, 0.1, 0.05, hair, x, 0.4, 0.21); sp.rotation.x = 0.5; head.add(sp); }
  } else if (style === 3) { // bob
    add(0.5, 0.2, 0.08, 0, 0.07, -0.18);
    add(0.06, 0.2, 0.3, -0.235, 0.1, -0.04);
    add(0.06, 0.2, 0.3, 0.235, 0.1, -0.04);
    add(0.5, 0.06, 0.06, 0, 0.31, 0.2); // thicker fringe
  } else if (style === 4) { // long, over the shoulders
    add(0.5, 0.5, 0.1, 0, 0.0, -0.19);
    add(0.065, 0.34, 0.2, -0.245, 0.03, 0.02);
    add(0.065, 0.34, 0.2, 0.245, 0.03, 0.02);
  } else if (style === 5) { // ponytail
    add(0.1, 0.07, 0.1, 0, 0.35, -0.25, ribbon);
    add(0.12, 0.3, 0.1, 0, 0.18, -0.29);
    add(0.09, 0.1, 0.08, 0, -0.01, -0.29);
  } else if (style === 6) { // pigtails
    for (const sx of [-1, 1]) {
      add(0.1, 0.04, 0.1, sx * 0.3, 0.36, -0.02, ribbon);
      add(0.11, 0.26, 0.11, sx * 0.3, 0.2, -0.02);
      add(0.08, 0.08, 0.08, sx * 0.3, 0.04, -0.02);
    }
  } else if (style === 7 && !hat) { // bun
    add(0.17, 0.15, 0.17, 0, 0.55, -0.08);
    add(0.2, 0.03, 0.2, 0, 0.47, -0.08, ribbon);
  } else if (style === 8) { // curly
    if (!hat) add(0.58, 0.14, 0.52, 0, 0.47, 0);
    add(0.1, 0.22, 0.42, -0.275, 0.3, 0);
    add(0.1, 0.22, 0.42, 0.275, 0.3, 0);
    add(0.58, 0.3, 0.12, 0, 0.3, -0.21);
  }
}

// facial hair styles: 0 none, 1 stubble, 2 mustache, 3 goatee, 4 beard, 5 long beard, 6 mutton chops
function buildFacialHair(head, style, color, skin) {
  if (!style) return;
  const add = (w, h, d, x, y, z, c = color, shadow = false) => head.add(box(w, h, d, c, x, y, z, shadow));
  const mustache = () => { add(0.14, 0.03, 0.025, 0, 0.105, 0.205); add(0.03, 0.04, 0.025, -0.065, 0.088, 0.205); add(0.03, 0.04, 0.025, 0.065, 0.088, 0.205); };
  if (style === 1) { // stubble: a darker shadow along the jaw
    const c = new THREE.Color(skin).lerp(new THREE.Color(color), 0.4).getHex();
    add(0.3, 0.055, 0.01, 0, 0.028, 0.203, c);
    add(0.02, 0.12, 0.3, -0.232, 0.06, 0.04, c);
    add(0.02, 0.12, 0.3, 0.232, 0.06, 0.04, c);
  } else if (style === 2) mustache();
  else if (style === 3) { mustache(); add(0.07, 0.065, 0.025, 0, 0.03, 0.205); }
  else if (style === 4 || style === 5) {
    mustache();
    add(0.34, 0.07, 0.03, 0, 0.025, 0.205, color, true);
    add(0.05, 0.16, 0.3, -0.24, 0.07, 0.04);
    add(0.05, 0.16, 0.3, 0.24, 0.07, 0.04);
    if (style === 5) { add(0.28, 0.16, 0.05, 0, -0.06, 0.19, color, true); add(0.16, 0.1, 0.05, 0, -0.17, 0.19, color, true); }
  } else if (style === 6) {
    mustache();
    add(0.06, 0.2, 0.1, -0.21, 0.1, 0.16);
    add(0.06, 0.2, 0.1, 0.21, 0.1, 0.16);
  }
}

const LANTERN_GLOW = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.7, 0.6) });

/** Show or hide the character's lantern (lit at night). */
export function setLantern(ch, on) {
  if (ch.lanternOn === on) return;
  ch.lanternOn = on;
  ch.lantern.visible = on;
}

// ---------- animation ----------
// Cartoon style: everything is exaggerated and springy. A squash spring (sq) gets kicked by
// footsteps, jumps and landings and wobbles back; a lean spring overshoots when starting and
// stopping; the head lags behind the body. Step hops, waddle and hip twist come from the walk phase.

const SQUASH_K = 260, SQUASH_C = 13; // stiff, a few visible wobbles
const LEAN_K = 90, LEAN_C = 6; // softer: overshoots when you stop
const HEAD_K = 140, HEAD_C = 10;

function spring(ch, key, velKey, target, k, c, dt) {
  const a = -k * (ch[key] - target) - c * ch[velKey];
  ch[velKey] += a * dt;
  ch[key] += ch[velKey] * dt;
}

// Advance the animation. `speed` is horizontal speed in units/s.
export function animateCharacter(ch, anim, speed, dt, t) {
  dt = Math.min(dt, 1 / 30); // springs stay stable on slow frames
  const moving = anim === ANIM.WALK || anim === ANIM.RUN;
  const run = anim === ANIM.RUN;
  ch.phase += dt * (moving ? 7 + speed * 2.4 : anim === ANIM.SWIM ? 5.5 : 0);
  const target = moving ? Math.min(1, speed / 2.5) : 0;
  ch.blend += (target - ch.blend) * Math.min(1, dt * 10);
  const b = ch.blend;
  const s = Math.sin(ch.phase);

  // --- events: jump start stretches, landing squashes hard, each footfall squashes a little
  if (anim === ANIM.AIR && ch.lastAnim !== ANIM.AIR) ch.sqV += 5.5;
  if (anim !== ANIM.AIR && ch.lastAnim === ANIM.AIR) ch.sqV -= 9;
  const step = Math.floor(ch.phase / Math.PI);
  if (moving && step !== ch.lastStep) ch.sqV -= run ? 5 : 3.8;
  ch.lastStep = step;
  ch.lastAnim = anim;

  // --- defaults: a bouncy walk/run cycle (b = how much we're moving)
  const swingAmt = run ? 1.35 : 1.05;
  const swing = s * swingAmt * b;
  let legL = swing, legR = -swing;
  let armL = -s * (run ? 1.7 : 1.3) * b, armR = s * (run ? 1.7 : 1.3) * b;
  let armOut = 0.14 + Math.abs(s) * (run ? 0.35 : 0.22) * b;
  // snappy hop each step: fast up, hang, drop
  let bob = Math.pow(Math.abs(s), 0.6) * (run ? 0.17 : 0.12) * b;
  let waddle = s * (run ? 0.09 : 0.14) * b; // side to side
  let twist = s * (run ? 0.22 : 0.16) * b; // hips turn with the legs
  let leanTarget = b * (run ? 0.34 : 0.15);
  let stretch = 1 + Math.abs(s) * 0.07 * b; // a little taller mid-step
  let headTilt = -waddle * 0.8;
  let headYaw = -twist * 0.6;

  if (anim === ANIM.IDLE) {
    ch.idleT += dt;
    const br = Math.sin(t * 2.2 + ch.seed);
    stretch = 1 + br * 0.035; // big, slow breaths
    armL = armR = br * 0.08;
    armOut = 0.14 + (br * 0.5 + 0.5) * 0.06;
    headTilt = Math.sin(t * 0.8 + ch.seed) * 0.09;
    // look around now and then (smooth, layered sines)
    headYaw = (Math.sin(t * 0.37 + ch.seed) + Math.sin(t * 0.83 + ch.seed * 2) * 0.6) * 0.28;
    waddle = Math.sin(t * 1.1 + ch.seed) * 0.03;
    twist = 0;
    bob = 0;
    // a happy little hop every few seconds of standing around
    ch.nextHop -= dt;
    if (ch.nextHop <= 0 && ch.idleT > 1.5) { ch.hopT = 0.42; ch.nextHop = 5 + Math.random() * 5; ch.sqV -= 3; }
    if (ch.hopT > 0) {
      ch.hopT = Math.max(0, ch.hopT - dt);
      const k = 1 - ch.hopT / 0.42;
      bob = Math.sin(k * Math.PI) * 0.14;
      armL = armR = -0.6 * Math.sin(k * Math.PI);
      armOut = 0.5 * Math.sin(k * Math.PI) + 0.14;
      if (ch.hopT === 0) ch.sqV -= 4; // land
    }
  } else {
    ch.idleT = 0;
    ch.hopT = 0;
  }

  if (anim === ANIM.AIR) {
    // tuck the legs, throw the arms up and flail
    legL = 1.1; legR = -0.7;
    armL = -2.7 + Math.sin(t * 22) * 0.35;
    armR = -2.7 - Math.sin(t * 22) * 0.35;
    armOut = 0.75;
    bob = 0; waddle = 0; twist = 0; leanTarget = 0.12;
    headTilt = Math.sin(t * 9) * 0.1;
    headYaw = 0;
    stretch = 1;
  } else if (anim === ANIM.ROW) {
    // rowing, facing the stern, in step with the oars (ch.rowPhase is the boat's stroke clock, boat.js row()):
    // at the catch (0) reach forward with the arms out and lean in; through the drive lean back and pull the
    // handles in to the chest; through the recovery swing forward again
    const p = ch.rowPhase ?? 0, c = Math.cos(p), sn = Math.sin(p);
    leanTarget = 0.1 + 0.3 * c;
    armL = armR = -1.15 - 0.55 * c;
    armOut = 0.38 - 0.12 * c;
    legL = legR = 0.45 + 0.2 * c; // braced feet, knees working with the stroke
    bob = -0.03 * (1 + c) / 2;
    stretch = 1 - 0.03 * (1 + c) / 2;
    waddle = 0; twist = 0;
    headTilt = 0; headYaw = 0;
    // a little effort squash as the blades bite
    const bite = Math.floor((p + 0.3) / (Math.PI * 2));
    if (ch.lastBite !== undefined && bite !== ch.lastBite && sn >= 0) ch.sqV -= 2.2;
    ch.lastBite = bite;
  } else if (anim === ANIM.CLIMB) {
    // cute shimmy up a palm (ch.climbPhase runs while moving, ch.climbMode 'up' | 'shake' | 'down'): an inchworm hug
    // (reach up with alternating hands, squash and stretch on every pull, knees hugging the trunk, the body and
    // head rocking side to side), a happy wiggle with one hand shaking the crown, then a wheee slide down
    if (ch.climbMode === undefined) ch.climbPhase = (ch.climbPhase ?? 0) + dt * 9; // other players: no climb state is synced, just shimmy
    const p = ch.climbPhase ?? 0, sn = Math.sin(p), cs = Math.cos(p), mode = ch.climbMode ?? 'up';
    const half = Math.floor(p / Math.PI);
    if (mode === 'up' && ch.lastClimbHalf !== undefined && half !== ch.lastClimbHalf) ch.sqV -= 3; // a little squash each pull
    ch.lastClimbHalf = half;
    bob = 0; twist = 0; stretch = 1; headYaw = 0;
    if (mode === 'up') {
      armL = -2.75 - sn * 0.4; armR = -2.75 + sn * 0.4;
      armOut = 0.12; // hands wrapped around the trunk
      legL = 0.95 + sn * 0.55; legR = 0.95 - sn * 0.55;
      waddle = sn * 0.1; twist = sn * 0.1;
      leanTarget = 0.1;
      headTilt = -sn * 0.14;
      stretch = 1 + Math.max(0, cs) * 0.09; // stretch up as it reaches
    } else if (mode === 'shake') {
      armL = -2.4; armR = -2.3 + Math.sin(t * 26) * 0.55; // one hand hugs, one shakes the crown
      armOut = 0.2;
      legL = 1.0 + Math.sin(t * 20) * 0.15; legR = 0.9 - Math.sin(t * 20) * 0.15;
      waddle = Math.sin(t * 26) * 0.1;
      leanTarget = 0.05;
      headTilt = Math.sin(t * 13) * 0.16; // a happy head wobble
      stretch = 1 + Math.sin(t * 26) * 0.03;
    } else { // wheee: arms flung out, legs together, a little stretched
      armL = -2.6 + Math.sin(t * 14) * 0.2; armR = -2.6 - Math.sin(t * 14) * 0.2;
      armOut = 0.95;
      legL = 0.25; legR = 0.25;
      waddle = Math.sin(t * 9) * 0.07;
      leanTarget = -0.05;
      headTilt = Math.sin(t * 7) * 0.1;
      stretch = 1.07;
    }
  } else if (anim === ANIM.SWIM) {
    // big doggy paddle with a rolling body
    armL = -1.4 + Math.sin(ch.phase) * 1.0;
    armR = -1.4 - Math.sin(ch.phase) * 1.0;
    armOut = 0.35;
    legL = Math.sin(ch.phase * 2) * 0.7;
    legR = -legL;
    bob = Math.sin(ch.phase * 2) * 0.04;
    waddle = Math.sin(ch.phase) * 0.16;
    twist = 0;
    leanTarget = 0.25;
    headTilt = -waddle * 0.6;
    headYaw = 0;
    stretch = 1;
  }

  // tool: hold it out a little, and play the swing on top of everything else
  if (ch.tool && anim === ANIM.IDLE) armR = -0.45;
  // fishing (fishing.js sets ch.rodPose): rod drawn back over the shoulder while charging a cast, held out while
  // the bobber's out, and cranking the reel during the fight
  if (ch.rodPose === 'charge') { armR = -2.6; leanTarget = -0.12; }
  else if (ch.rodPose === 'hold') armR = -0.85;
  else if (ch.rodPose === 'reel') { armR = -0.7 + Math.sin(t * 16) * 0.12; leanTarget = -0.18; }
  if (ch.lanternOn && anim === ANIM.IDLE) armL = -0.4; // hold the lantern out a little
  let swingArm = null;
  if (ch.swingT > 0) {
    ch.swingT = Math.max(0, ch.swingT - dt);
    const p = 1 - ch.swingT / SWING_SECS;
    swingArm = p < 0.45 ? -3.0 * (p / 0.45) : -3.0 + 3.4 * ((p - 0.45) / 0.55);
    leanTarget = p < 0.45 ? -0.12 : 0.38;
    if (p >= 0.45 && !ch.swingHit) { ch.swingHit = true; ch.sqV -= 4; } // little squash on impact
  }

  // --- springs
  spring(ch, 'sq', 'sqV', 1, SQUASH_K, SQUASH_C, dt);
  ch.sq = Math.min(1.35, Math.max(0.62, ch.sq));
  const prevLean = ch.lean;
  spring(ch, 'lean', 'leanV', leanTarget, LEAN_K, LEAN_C, dt);
  // head lags behind changes in lean (drags back when starting, nods forward when stopping)
  spring(ch, 'headX', 'headXV', -(ch.lean - prevLean) / Math.max(dt, 1e-3) * 0.12, HEAD_K, HEAD_C, dt);

  // --- apply (limbs ease toward their targets so state changes don't snap)
  const k = Math.min(1, dt * 16);
  ch.legL.rotation.x += (legL - ch.legL.rotation.x) * k;
  ch.legR.rotation.x += (legR - ch.legR.rotation.x) * k;
  ch.armL.rotation.x += (armL - ch.armL.rotation.x) * k;
  ch.armR.rotation.x += (armR - ch.armR.rotation.x) * k;
  if (swingArm !== null) ch.armR.rotation.x = swingArm; // the swing is snappy: no easing
  ch.armL.rotation.z += (-armOut - ch.armL.rotation.z) * k;
  ch.armR.rotation.z += (armOut - ch.armR.rotation.z) * k;
  ch.head.rotation.z += (headTilt - ch.head.rotation.z) * k;
  ch.head.rotation.y += (headYaw - ch.head.rotation.y) * k;
  ch.head.rotation.x = THREE.MathUtils.clamp(ch.headX, -0.35, 0.35);

  ch.body.position.y = bob;
  ch.body.rotation.x = ch.lean;
  ch.body.rotation.z += (waddle - ch.body.rotation.z) * k;
  ch.body.rotation.y += (twist - ch.body.rotation.y) * k;
  const sy = ch.sq * stretch, sxz = 1 / Math.sqrt(sy); // keep the volume: squash wide, stretch thin
  ch.body.scale.set(sxz, sy, sxz);

  // blink every few seconds (and squeeze the eyes shut on hard landings)
  ch.nextBlink -= dt;
  if (ch.nextBlink <= 0) { ch.blinkT = 0.12; ch.nextBlink = 2 + Math.random() * 3; }
  ch.blinkT = Math.max(0, ch.blinkT - dt);
  ch.eyes.scale.y = ch.blinkT > 0 || ch.sq < 0.8 ? 0.15 : 1;
}

/** Show what the character holds: 0 = nothing, then the tools and blocks in TOOLS. */
export function setTool(ch, tool) {
  if (ch.tool === tool) return;
  ch.tool = tool;
  ch.toolGrip.clear();
  const HANDLE = 0x8a5a34, METAL = 0xaeb6bf, DARK = 0x6e7680;
  if (TOOLS[tool] === 'shovel') {
    ch.toolGrip.add(box(0.03, 0.03, 0.34, HANDLE, 0, 0, 0.15));
    ch.toolGrip.add(box(0.08, 0.02, 0.03, HANDLE, 0, 0, -0.02)); // grip
    ch.toolGrip.add(box(0.11, 0.02, 0.13, METAL, 0, -0.01, 0.37)); // blade
    ch.toolGrip.add(box(0.11, 0.025, 0.02, DARK, 0, -0.01, 0.305)); // blade collar
  } else if (TOOLS[tool] === 'pickaxe') {
    ch.toolGrip.add(box(0.03, 0.03, 0.36, HANDLE, 0, 0, 0.16));
    ch.toolGrip.add(box(0.04, 0.25, 0.05, METAL, 0, 0.0, 0.34)); // head, across the swing
    ch.toolGrip.add(box(0.03, 0.05, 0.04, DARK, 0, 0.14, 0.355)); // tips
    ch.toolGrip.add(box(0.03, 0.05, 0.04, DARK, 0, -0.14, 0.355));
  } else if (TOOLS[tool] === 'axe') {
    ch.toolGrip.add(box(0.03, 0.03, 0.36, HANDLE, 0, 0, 0.16));
    ch.toolGrip.add(box(0.03, 0.14, 0.1, METAL, 0, 0.05, 0.31)); // blade, across the swing
    ch.toolGrip.add(box(0.032, 0.14, 0.02, 0xe6ebef, 0, 0.05, 0.365)); // bright edge
  } else if (TOOLS[tool] === 'frog') { // a frog sitting in the hand
    ch.toolGrip.add(box(0.11, 0.06, 0.12, 0x5fae3e, 0, 0.02, 0.07));
    ch.toolGrip.add(box(0.09, 0.05, 0.05, 0x5fae3e, 0, 0.05, 0.13));
    ch.toolGrip.add(box(0.035, 0.035, 0.035, 0xffffff, -0.035, 0.085, 0.13));
    ch.toolGrip.add(box(0.035, 0.035, 0.035, 0xffffff, 0.035, 0.085, 0.13));
    ch.toolGrip.add(box(0.02, 0.025, 0.012, 0x1a1a22, -0.035, 0.087, 0.148));
    ch.toolGrip.add(box(0.02, 0.025, 0.012, 0x1a1a22, 0.035, 0.087, 0.148));
  } else if (TOOLS[tool] === 'log') { // a short log, bark outside and pale cut ends
    ch.toolGrip.add(box(0.1, 0.1, 0.2, 0x6e4a30, 0, 0, 0.08));
    ch.toolGrip.add(box(0.08, 0.08, 0.205, 0xd9b27a, 0, 0, 0.08));
  } else if (TOOLS[tool] === 'stick') {
    ch.toolGrip.add(box(0.025, 0.025, 0.3, 0x8a5a34, 0, 0, 0.13));
    ch.toolGrip.add(box(0.02, 0.06, 0.02, 0x8a5a34, 0, 0.03, 0.2)); // a twig
  } else if (TOOLS[tool] === 'pebble') {
    ch.toolGrip.add(box(0.09, 0.06, 0.08, 0xb0aba0, 0, 0, 0.07));
  } else if (TOOLS[tool] === 'berries') {
    ch.toolGrip.add(box(0.05, 0.05, 0.05, 0xe0334a, -0.02, 0, 0.06));
    ch.toolGrip.add(box(0.05, 0.05, 0.05, 0xe0334a, 0.03, 0.01, 0.09));
    ch.toolGrip.add(box(0.03, 0.02, 0.03, 0x4a8f30, 0, 0.04, 0.07));
  } else if (TOOLS[tool] === 'coconut') { // a brown nut with three dark eyes
    ch.toolGrip.add(box(0.11, 0.1, 0.11, 0x6e4a30, 0, 0, 0.08));
    ch.toolGrip.add(box(0.03, 0.03, 0.02, 0x2a1a12, -0.02, 0.02, 0.14));
    ch.toolGrip.add(box(0.03, 0.03, 0.02, 0x2a1a12, 0.02, 0.02, 0.14));
  } else if (TOOLS[tool] === 'coconut_half') { // a brown cup of white flesh
    ch.toolGrip.add(box(0.11, 0.06, 0.11, 0x6e4a30, 0, -0.02, 0.08));
    ch.toolGrip.add(box(0.08, 0.02, 0.08, 0xf4efe2, 0, 0.02, 0.08));
  } else if (TOOLS[tool] === 'workbench') { // a tiny desk
    ch.toolGrip.add(box(0.17, 0.025, 0.11, 0xc08a56, 0, 0.03, 0.08));
    ch.toolGrip.add(box(0.15, 0.07, 0.09, 0x8a5a34, 0, -0.02, 0.08));
    ch.toolGrip.add(box(0.17, 0.08, 0.02, 0x7a4f2c, 0, 0.08, 0.035));
  } else if (TOOLS[tool] === 'leaves') { // a little bundle of leaves
    ch.toolGrip.add(box(0.12, 0.05, 0.1, 0x5fa83a, 0, 0, 0.07));
    ch.toolGrip.add(box(0.08, 0.04, 0.08, 0x8fcf5a, 0.02, 0.035, 0.09));
  } else if (TOOLS[tool] === 'rod') { // a fishing rod: a long tapering pole with a reel; the line is fishing.js's
    ch.toolGrip.add(box(0.035, 0.035, 0.42, HANDLE, 0, 0, 0.17));
    ch.toolGrip.add(box(0.025, 0.025, 0.4, 0xc79a62, 0, 0.01, 0.57));
    ch.toolGrip.add(box(0.016, 0.016, 0.2, 0xe3c08a, 0, 0.02, 0.86));
    ch.toolGrip.add(box(0.05, 0.07, 0.07, DARK, 0, -0.04, 0.05)); // the reel
    ch.toolGrip.add(box(0.06, 0.012, 0.012, METAL, 0.03, -0.04, 0.05));
    ch.toolGrip.add(box(0.03, 0.03, 0.03, METAL, 0, 0.03, 0.98)); // tip ring
  } else if (TOOLS[tool] === 'boat') { // a toy-sized boat
    ch.toolGrip.add(box(0.1, 0.06, 0.22, 0x8a5530, 0, -0.02, 0.09));
    ch.toolGrip.add(box(0.07, 0.06, 0.08, 0xc8643a, 0, 0.04, 0.06));
    ch.toolGrip.add(box(0.08, 0.02, 0.09, 0xd8562c, 0, 0.08, 0.06));
  } else if (TOOLS[tool] === 'chair') { // tiny furniture, carried like a toy
    ch.toolGrip.add(box(0.12, 0.02, 0.12, 0xa87444, 0, 0, 0.08));
    ch.toolGrip.add(box(0.12, 0.12, 0.02, 0x94633a, 0, 0.06, 0.025));
    ch.toolGrip.add(box(0.1, 0.06, 0.1, 0x74492a, 0, -0.04, 0.08));
  } else if (TOOLS[tool] === 'table') {
    ch.toolGrip.add(box(0.18, 0.025, 0.18, 0xc9945c, 0, 0.03, 0.09));
    ch.toolGrip.add(box(0.14, 0.08, 0.14, 0x74492a, 0, -0.02, 0.09));
  } else if (TOOLS[tool] === 'bed') {
    ch.toolGrip.add(box(0.14, 0.05, 0.2, 0x94633a, 0, -0.01, 0.09));
    ch.toolGrip.add(box(0.12, 0.03, 0.12, 0x5fa83a, 0, 0.03, 0.11));
    ch.toolGrip.add(box(0.1, 0.03, 0.05, 0xffffff, 0, 0.03, 0.02));
  } else if (TOOLS[tool] === 'lamp') {
    ch.toolGrip.add(box(0.025, 0.025, 0.2, 0x94633a, 0, 0, 0.08));
    ch.toolGrip.add(box(0.07, 0.08, 0.07, 0x3a3532, 0, 0, 0.2));
    ch.toolGrip.add(box(0.05, 0.06, 0.05, 0xffd860, 0, 0, 0.2));
  } else if (TOOLS[tool] === 'shelf') {
    ch.toolGrip.add(box(0.16, 0.2, 0.07, 0x94633a, 0, 0.03, 0.07));
    ch.toolGrip.add(box(0.12, 0.06, 0.02, 0x4f8fd0, 0, 0.07, 0.11));
    ch.toolGrip.add(box(0.12, 0.06, 0.02, 0xe0334a, 0, -0.01, 0.11));
  } else if (TOOLS[tool] === 'wood') { // planks: three little boards stacked in the hand
    for (let i = 0; i < 3; i++) ch.toolGrip.add(box(0.17, 0.032, 0.09, i % 2 ? 0x9a683c : 0xb07a48, (i - 1) * 0.012, -0.04 + i * 0.04, 0.07));
  } else if (BLOCK_COLORS[TOOLS[tool]]) { // a little block carried in the hand
    const [side, top] = BLOCK_COLORS[TOOLS[tool]];
    ch.toolGrip.add(box(0.13, 0.11, 0.13, side, 0, -0.02, 0.07));
    ch.toolGrip.add(box(0.135, 0.025, 0.135, top, 0, 0.04, 0.07));
  }
}

/** Start a tool swing (the dig lands about halfway through). */
export function swingTool(ch) {
  ch.swingT = SWING_SECS;
  ch.swingHit = false;
}
