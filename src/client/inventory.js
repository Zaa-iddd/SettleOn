// Minecraft-style inventory: an 8-slot hotbar (keys 1-8). The 24-slot bag only exists once you've
// crafted a Backpack (sticks and leaves). I or Tab opens the inventory screen with hand crafting;
// clicking a placed workbench opens it with the workbench recipes (tools, walls, furniture).
// Items are flat 2D pixel-art icons drawn here in code (original art), shown as <img>s scaled with
// `image-rendering: pixelated`. Slot clicks work like the classic inventory screen:
//  - left click: pick up a stack / put it down / merge into the same item / swap
//  - right click: pick up half a stack / put down one item
//  - shift + click: move a stack between the hotbar and the bag
// The selected hotbar slot is what you hold (a shovel or pickaxe works as the tool, see main.js).

export const HOTBAR = 8, BAG = 24, SLOTS = HOTBAR + BAG; // slots 0-7 are the hotbar, 8-31 the bag (needs a backpack)

// 16×16 icons. Tools are drawn from strings; blocks are generated from a few colours.
const TOOL_PALETTE = { o: '#1e1612', H: '#b07a48', h: '#7a4f2c', m: '#dfe5ea', M: '#9aa4ad', d: '#6b737c',
  G: '#6fbe46', g: '#4a8f30', k: '#1f3a17', w: '#ffffff', p: '#1a1a22', y: '#dbe8a0', // + frog colours
  B: '#6e4a30', b: '#523522', L: '#e3c08a', l: '#c79a62', r: '#a87444', R: '#c08a56', u: '#4f8fd0', W: '#eef3f8', n: '#5fa83a', // + log and workbench colours
  e: '#e0334a', E: '#a81f38', // + berry reds
  c: '#f3e6c8', Y: '#ffd860', O: '#ffa63a' }; // + bed linen and lamp glow
const TOOL_ART = {
  shovel: [
    '................',
    '.............oo.',
    '............oHho',
    '...........oHho.',
    '..........oHho..',
    '.........oHho...',
    '........oHho....',
    '...ooo.oHho.....',
    '..ommmoHho......',
    '.ommmmMho.......',
    'ommmmmMMo.......',
    'ommmmmMdo.......',
    'ommmmMdo........',
    '.ommMMo.........',
    '..oooo..........',
    '................',
  ],
  pickaxe: [
    '................',
    '....ooooooo.....',
    '..oommmmmmmoo...',
    '.ommMMMMMMmmmo..',
    'omMdoooooHoMmmo.',
    'oMdo....oHho.oMo',
    '.oo....oHho...oo',
    '......oHho......',
    '.....oHho.......',
    '....oHho........',
    '...oHho.........',
    '..oHho..........',
    '.oHho...........',
    'oHho............',
    'oho.............',
    '.o..............',
  ],
  axe: [
    '................',
    '.....oooo.......',
    '...oommmmo......',
    '..ommmmmMMo.....',
    '.ommmmmoHho.....',
    '.ommmMo.oHho....',
    '..oMMo...oHho...',
    '...oo.....oHho..',
    '...........oHho.',
    '............oHho',
    '.............oho',
    '..............o.',
    '................',
    '................',
    '................',
    '................',
  ],
  stick: [
    '................',
    '.............oo.',
    '............oHho',
    '...........oHho.',
    '..........oHho..',
    '.....oo..oHho...',
    '....oHhooHho....',
    '.....oHhHho.....',
    '......oHho......',
    '.....oHho.......',
    '....oHho........',
    '...oHho.........',
    '..oHho..........',
    '.oHho...........',
    '.oho............',
    '..o.............',
  ],
  pebble: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....ooooo......',
    '...oommmmmoo....',
    '..ommmmmmMMMo...',
    '.ommmmmMMMMMMo..',
    '.ommmMMMMMMMdo..',
    '.oMMMMMMMMdddo..',
    '..oMMMMMddddo...',
    '...oooddddoo....',
    '......oooo......',
    '................',
    '................',
  ],
  berries: [
    '................',
    '.......kk.......',
    '......knnk......',
    '.....knnk.......',
    '....oknko.......',
    '...oeekeeoo.....',
    '..oeweeoeeeo....',
    '..oeeeeoeweEo...',
    '..oeeeEoeeeEo...',
    '...oEEooeeEEo...',
    '....oooeooEo....',
    '.....oeweeo.....',
    '.....oeeeEo.....',
    '.....oeEEEo.....',
    '......oooo......',
    '................',
  ],
  bag: [ // the inventory button
    '................',
    '.....oooooo.....',
    '....oh....ho....',
    '....oh....ho....',
    '...oooooooooo...',
    '..oHHHHHHHHHHo..',
    '.oHHHhhhhhhHHHo.',
    '.oHHhHHyyHHhHHo.',
    '.oHHhHHyyHHhHHo.',
    '.oHHHhhhhhhHHHo.',
    '.oHHHHHHHHHHHHo.',
    '.oHHHHHHHHHHHHo.',
    '.ohHHHHHHHHHHho.',
    '..ohhhhhhhhhho..',
    '...oooooooooo...',
    '................',
  ],
  log: [ // a log lying down: bark, with the pale ringed cut end on the right
    '................',
    '................',
    '................',
    '..ooooooooooo...',
    '.oBBBBBBBBBoLLo.',
    'oBBbBBBBBBoLLLLo',
    'oBBBBBbBBBoLllLo',
    'oBBBBBBBBBoLlhlo',
    'oBbBBBBBBBoLlllo',
    'oBBBBbBBBBoLLLLo',
    'obBBBBBBbBoLLLLo',
    '.obbbbbbbbboLLo.',
    '..ooooooooooo...',
    '................',
    '................',
    '................',
  ],
  workbench: [ // a desk with a back board, pinned notes, drawers and a shelf
    '................',
    '.oooooooooooooo.',
    '.oRRRRRRRRRRRRo.',
    '.ohuuhhWhhuuhho.',
    '.ohuuhhWhhuuhho.',
    '.ohhhhhhhhhhhho.',
    'oooooooooooooooo',
    'oRRRRRnnRRRuRRRo',
    'orrrrrrrrrrrrrro',
    'oooooooooooooooo',
    '.oh.....ohrrrho.',
    '.oh.....ohrhhro.',
    '.ohnnuu.ohrrrho.',
    '.ohrrrrrohrhhro.',
    '.oh.....ohrrrho.',
    '.oo.....ooooooo.',
  ],
  leaves: [
    '................',
    '.........kkk....',
    '.......kkGGGk...',
    '......kGGGnGGk..',
    '.....kGGGnGGGk..',
    '..kk.kGGnGGGgk..',
    '.kGGkkGnGGGgk...',
    'kGGGGknGGggkk...',
    'kGnnGGkggkkGGk..',
    'kGGGnGGkkGGGGGk.',
    '.kgGGnGkGGnnGGk.',
    '..kggGkGnGGGggk.',
    '...kkkhkgggggk..',
    '.....h..kkkkk...',
    '....h...........',
    '................',
  ],
  backpack: [ // woven leaves on a stick frame
    '................',
    '......oooo......',
    '.....oHooHo.....',
    '....oooooooo....',
    '...oGGGGGGGGo...',
    '..oGGnGGGGnGGo..',
    '..oGgGGGGGGgGo..',
    '..oHHHHHHHHHHo..',
    '..oGGGkkkkGGGo..',
    '..oGGkGnGGkGGo..',
    '..oGGkGGGgkGGo..',
    '..oGgkkkkkkgGo..',
    '..oGGGGGGGGGGo..',
    '..oggggggggggo..',
    '...oooooooooo...',
    '................',
  ],
  chair: [
    '................',
    '...oo...........',
    '...oRo..........',
    '...oRo..........',
    '...oRo..........',
    '...oRo..........',
    '...oRo..........',
    '...oRoooooooo...',
    '...oRRRRRRRRRo..',
    '...ohhhhhhhhho..',
    '...oho.....oho..',
    '...oho.....oho..',
    '...oho.....oho..',
    '...oho.....oho..',
    '...ooo.....ooo..',
    '................',
  ],
  table: [
    '................',
    '................',
    '.......G........',
    '......GeG.......',
    '.......u........',
    '......ouo.......',
    'oooooooooooooooo',
    'oRRRRRRRRRRRRRRo',
    'ohhhhhhhhhhhhhho',
    'oooooooooooooooo',
    '.oho........oho.',
    '.oho........oho.',
    '.oho........oho.',
    '.oho........oho.',
    '.ooo........ooo.',
    '................',
  ],
  bed: [
    '................',
    '................',
    '.oo.............',
    '.oRo............',
    '.oRo............',
    '.oRoWWWo........',
    '.oRoWWWoooooooo.',
    '.oRoWWWGGGGGGGGo',
    '.oRoooooGGnGGGGo',
    '.oRcccccgggggggo',
    '.oRRRRRRRRRRRRRo',
    '.ohhhhhhhhhhhhho',
    '.oho.........oho',
    '.ooo.........ooo',
    '................',
    '................',
  ],
  lamp: [
    '......oooo......',
    '.....ohhhho.....',
    '....oooooooo....',
    '....ohYYYYho....',
    '....oYYwwYYo....',
    '....oYYwYYOo....',
    '....ohYYYYho....',
    '....oooooooo....',
    '......ohHo......',
    '......ohHo......',
    '......ohHo......',
    '......ohHo......',
    '......ohHo......',
    '....oooooooo....',
    '....ohhhhhho....',
    '....oooooooo....',
  ],
  shelf: [
    'oooooooooooooooo',
    'oRRRRRRRRRRRRRRo',
    'ohuuebGGyubeGbho',
    'ohuueGGGyueeGyho',
    'ohuueGGGyueeGyho',
    'ohuueGGGyueeGyho',
    'oRRRRRRRRRRRRRRo',
    'ohbebuyybbGGubho',
    'ohbeeuyyGbGGuuho',
    'oheeeuyyGGGGuuho',
    'oheeeuyyGGGGuuho',
    'oRRRRRRRRRRRRRRo',
    'ohbbbbbbbbbbbbho',
    'ohbbbbbbbbbbbbho',
    'oRRRRRRRRRRRRRRo',
    'oooooooooooooooo',
  ],
  boat: [ // a little ship: plank hull, orange-roofed cabin, flag
    '................',
    '.........OO.....',
    '.........OOOO...',
    '.........oO.....',
    '.....oooooooo...',
    '.....oOOOOOOo...',
    '.....oRuuRuRo...',
    '.....oRRRRRRo...',
    'o..ooooooooooooo',
    'oHoLLLLLLLLLLLo.',
    '.oHHHHHHHHHHHHo.',
    '.ohHhHHhHHhHHho.',
    '..ohhhhhhhhhho..',
    '...oooooooooo...',
    '................',
    '................',
  ],
  frog: [
    '................',
    '................',
    '...kkk....kkk...',
    '..kwwpk..kpwwk..',
    '..kwwwkkkkwwwk..',
    '...kGGGGGGGGk...',
    '..kGGgGGGGgGGk..',
    '..kGGGGGGGGGGk..',
    '.kGGkkkkkkkkGGk.',
    '.kGGkyyyyyykGGk.',
    'kgGGGyyyyyyGGGgk',
    'kggkGGyyyyGGkggk',
    'kgk.kkGGGGkk.kgk',
    'kkk...kkkk...kkk',
    '................',
    '................',
  ],
};

// flat pixel block: 1px dark outline, lit top-left edge, shaded bottom-right edge, speckles
function blockArt({ base, light, dark, speck, speck2, top, planks }) {
  const rows = [];
  let h = 7;
  const rnd = () => { h = (h * 1103515245 + 12345) & 0x7fffffff; return h / 0x7fffffff; };
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 16; x++) {
      if (x < 1 || y < 1 || x > 14 || y > 14) { row.push(x === 0 && y === 0 || x === 15 && y === 0 || x === 0 && y === 15 || x === 15 && y === 15 ? null : '#1e1612'); continue; }
      let c = base;
      const r = rnd();
      if (r < 0.12) c = speck; else if (r < 0.2) c = speck2;
      if (top && y <= 4 - (x % 3 === 0 ? 1 : 0)) c = y === 1 ? top[0] : top[1]; // a band on top (e.g. grass)
      if (planks && (y % 5 === 0 || (x === (y < 5 ? 9 : y < 10 ? 4 : 11) && y % 5 !== 0))) c = dark; // plank seams and joints
      if (x <= 2 || y <= 1) c = c === base ? light : c;
      if (x >= 13 || y >= 13) c = dark;
      row.push(c);
    }
    rows.push(row);
  }
  return rows;
}

// a log-cabin wall block: round logs stacked, with pale cut ends on the right
function wallArt() {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 16; x++) {
      if (x < 1 || y < 1 || x > 14 || y > 14) { row.push((x === 0 || x === 15) && (y === 0 || y === 15) ? null : '#1e1612'); continue; }
      const ly = (y - 1) % 5, end = x >= 12;
      let c = end ? ['#5a3418', '#e6bf78', '#b98842', '#e0b46a', '#5a3418'][ly] : ['#4f3220', '#c08a56', '#9a6336', (x * 7 + y) % 5 === 0 ? '#74492a' : '#8a5730', '#6a4024'][ly];
      if (end && x === 12) c = '#4f3220';
      row.push(c);
    }
    rows.push(row);
  }
  return rows;
}

export const ITEMS = {
  // `block`: this item can be placed (main.js turns it into a ground kind)
  shovel: { name: 'Shovel', stack: 1, tool: 'shovel', art: TOOL_ART.shovel },
  frog: { name: 'Frog', stack: 8, throwable: true, art: TOOL_ART.frog }, // caught at ponds; click to throw it
  axe: { name: 'Axe', stack: 1, tool: 'axe', art: TOOL_ART.axe }, // chops trees, breaks wood blocks
  log: { name: 'Log', stack: 64, place: true, art: TOOL_ART.log }, // from chopped trees; a crafting material, and stacks into log piles (main.js)
  stick: { name: 'Stick', stack: 64, art: TOOL_ART.stick }, // from broken bushes; for crafting tools
  leaves: { name: 'Leaves', stack: 64, art: TOOL_ART.leaves }, // from broken bushes and chopped trees
  backpack: { name: 'Backpack', stack: 1, unlock: true, art: TOOL_ART.backpack }, // never held: crafting it unlocks the bag
  pebble: { name: 'Pebble', stack: 64, art: TOOL_ART.pebble }, // picked up off the ground; for crafting tools
  berries: { name: 'Berries', stack: 64, art: TOOL_ART.berries }, // found on bushes
  // furniture (`furn`): placed on a tile, see FURNITURE in world.js and main.js
  workbench: { name: 'Workbench', stack: 16, place: true, furn: true, art: TOOL_ART.workbench },
  chair: { name: 'Chair', stack: 16, place: true, furn: true, art: TOOL_ART.chair },
  table: { name: 'Table', stack: 16, place: true, furn: true, art: TOOL_ART.table },
  bed: { name: 'Bed', stack: 4, place: true, furn: true, art: TOOL_ART.bed },
  lamp: { name: 'Lamp', stack: 16, place: true, furn: true, art: TOOL_ART.lamp },
  shelf: { name: 'Bookshelf', stack: 16, place: true, furn: true, art: TOOL_ART.shelf },
  boat: { name: 'Boat', stack: 1, boat: true, art: TOOL_ART.boat }, // launched on open water (main.js), then walked on and sailed
  pickaxe: { name: 'Pickaxe', stack: 1, tool: 'pickaxe', art: TOOL_ART.pickaxe },
  dirt: { name: 'Dirt', stack: 64, block: true, art: blockArt({ base: '#8d5c3a', light: '#a8724c', dark: '#6a4329', speck: '#6f472c', speck2: '#a97a52', top: ['#8fd04f', '#5fa32f'] }) },
  stone: { name: 'Stone', stack: 64, block: true, art: blockArt({ base: '#8e8c88', light: '#aaa8a3', dark: '#696763', speck: '#74726e', speck2: '#a3a19c' }) },
  sand: { name: 'Sand', stack: 64, block: true, art: blockArt({ base: '#e2cf92', light: '#f1e2ae', dark: '#bfa86c', speck: '#cdb877', speck2: '#f3e6bd' }) },
  wood: { name: 'Wood', stack: 64, block: true, art: blockArt({ base: '#a87444', light: '#c08a56', dark: '#7a4f2c', speck: '#9a683c', speck2: '#b47e4c', planks: true }) },
  wall: { name: 'Wooden Wall', stack: 64, block: true, art: wallArt() },
  snow: { name: 'Snow', stack: 64, block: true, art: blockArt({ base: '#eef3f8', light: '#ffffff', dark: '#c3cfdc', speck: '#d7e1ec', speck2: '#ffffff' }) },
};

// What can be crafted: `n` of `out` for the items in `cost`. `at` 'hand' recipes are in the
// inventory screen; 'bench' recipes only at a placed workbench (which also lists the hand ones).
// Progress: sticks, leaves and pebbles → backpack and workbench by hand → tools at the workbench →
// the axe gets logs → wood, walls and furniture.
export const RECIPES = [
  { out: 'backpack', n: 1, at: 'hand', cost: { stick: 4, leaves: 6 } },
  { out: 'workbench', n: 1, at: 'hand', cost: { stick: 6, pebble: 2 } },
  { out: 'wood', n: 2, at: 'hand', cost: { log: 1 } },
  { out: 'shovel', n: 1, at: 'bench', cost: { stick: 2, pebble: 1 } },
  { out: 'axe', n: 1, at: 'bench', cost: { stick: 2, pebble: 2 } },
  { out: 'pickaxe', n: 1, at: 'bench', cost: { stick: 2, pebble: 3 } },
  { out: 'wall', n: 2, at: 'bench', cost: { log: 1 } },
  { out: 'chair', n: 1, at: 'bench', cost: { wood: 3, stick: 2 } },
  { out: 'table', n: 1, at: 'bench', cost: { wood: 4, stick: 2 } },
  { out: 'bed', n: 1, at: 'bench', cost: { wood: 4, leaves: 8 } },
  { out: 'lamp', n: 1, at: 'bench', cost: { wood: 1, stick: 2, pebble: 1 } },
  { out: 'shelf', n: 1, at: 'bench', cost: { wood: 5 } },
  { out: 'boat', n: 1, at: 'bench', cost: { wood: 12, log: 4, leaves: 4 } },
];

// draw each icon once into a data URL
const iconCache = new Map();
export function iconURL(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const art = ITEMS[id]?.art ?? TOOL_ART[id], cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = art[y][x], col = typeof px === 'string' && px.length === 1 ? (px === '.' ? null : TOOL_PALETTE[px]) : px;
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = cv.toDataURL();
  iconCache.set(id, url);
  return url;
}

const $ = (id) => document.getElementById(id);

export class Inventory {
  /** @param {{ onChange?: () => void, toast?: (s: string) => void }} opts */
  constructor(opts = {}) {
    this.onChange = opts.onChange ?? (() => {});
    this.toast = opts.toast ?? (() => {});
    this.slots = new Array(SLOTS).fill(null); // { id, count } | null
    this.hasBag = false; // the bag slots (HOTBAR..SLOTS-1) only work with a crafted backpack
    this.creative = false; // debug: every item on offer (#inv-creative), and placing doesn't use items up
    this.station = 'hand'; // where the inventory screen was opened: 'hand' or 'bench'
    this.selected = 0;
    this.cursor = null; // stack held by the mouse while the inventory is open
    this.isOpen = false;
    this.buildDOM();
    this.reset();
  }

  /** You start with nothing and no bag: everything is gathered and crafted (see RECIPES). */
  reset() {
    this.slots.fill(null);
    this.hasBag = false;
    this.selected = 0;
    this.cursor = null;
    this.render();
  }

  /** What's in the selected hotbar slot (or null). */
  get held() { return this.slots[this.selected]; }

  select(i) {
    this.selected = Math.max(0, Math.min(HOTBAR - 1, i));
    this.render();
    this.onChange();
  }

  /** How many slots can hold things: the hotbar, plus the bag once you have a backpack. */
  get size() { return this.hasBag ? SLOTS : HOTBAR; }

  /** Add items (hotbar first, then the bag), merging into stacks. Returns how many didn't fit. */
  add(id, n = 1) {
    const max = ITEMS[id].stack, size = this.size;
    for (let i = 0; i < size && n > 0; i++) {
      const s = this.slots[i];
      if (s?.id === id && s.count < max) { const k = Math.min(n, max - s.count); s.count += k; n -= k; }
    }
    for (let i = 0; i < size && n > 0; i++) {
      if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { id, count: k }; n -= k; }
    }
    this.render();
    this.onChange();
    return n;
  }

  /** Use up n of the held item (placing a block). Returns false if there weren't enough. In creative mode nothing is used up. */
  takeHeld(n = 1) {
    const s = this.held;
    if (!s || s.count < n) return false;
    if (this.creative) return true;
    s.count -= n;
    if (!s.count) this.slots[this.selected] = null;
    this.render();
    this.onChange();
    return true;
  }

  /** How many of an item there are in all slots. */
  count(id) { return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0); }
  /** Take n of an item out (from the bag first, then the hotbar). */
  remove(id, n) {
    for (let i = SLOTS - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const k = Math.min(n, s.count);
      s.count -= k; n -= k;
      if (!s.count) this.slots[i] = null;
    }
  }
  canCraft(r) { return Object.entries(r.cost).every(([id, n]) => this.count(id) >= n); }
  /** The recipes on offer where the screen was opened (the backpack drops out once you have one). */
  recipes() { return RECIPES.filter((r) => (r.at === 'hand' || this.station === 'bench') && !(ITEMS[r.out].unlock && this.hasBag)); }
  /** Craft a recipe once, if the ingredients are there and the result fits. */
  craft(r) {
    if (!this.canCraft(r)) return;
    const before = this.slots.map((s) => (s ? { ...s } : null));
    for (const [id, n] of Object.entries(r.cost)) this.remove(id, n);
    if (ITEMS[r.out].unlock) { // the backpack: worn, not carried
      this.hasBag = true;
      this.buildCraft();
      this.toast('You made a backpack: 24 more slots!');
    } else if (this.add(r.out, r.n) > 0) { this.slots = before; this.toast('Your inventory is full'); }
    this.render();
    this.onChange();
  }

  /** Creative mode (debug): the inventory screen offers every item, the bag is open, and placing is free. */
  setCreative(on) {
    this.creative = !!on;
    if (on) this.hasBag = true;
    this.render();
    this.onChange();
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  /** Open the inventory screen: `station` 'hand' (I key) or 'bench' (at a workbench). */
  open(station = 'hand') {
    this.station = station;
    this.isOpen = true;
    $('inventory').hidden = false;
    $('inv-title').textContent = station === 'bench' ? 'Workbench' : 'Inventory';
    this.buildCraft();
    this.render();
  }
  close() {
    if (this.cursor) { const left = this.add(this.cursor.id, this.cursor.count); this.cursor = left ? { ...this.cursor, count: left } : null; }
    this.cursor = null;
    this.isOpen = false;
    $('inventory').hidden = true;
    this.render();
  }

  // ---------- saving ----------
  toJSON() { return { v: 2, sel: this.selected, bag: this.hasBag, slots: this.slots.map((s) => (s ? [s.id, s.count] : 0)) }; }
  fromJSON(o) {
    if (!o || !Array.isArray(o.slots)) return false;
    const ok = (e) => Array.isArray(e) && ITEMS[e[0]] && !ITEMS[e[0]].unlock && Number.isInteger(e[1]) && e[1] >= 1;
    this.slots.fill(null);
    if (o.v === 2) {
      this.hasBag = !!o.bag;
      for (let i = 0; i < this.size; i++) { const e = o.slots[i]; if (ok(e)) this.slots[i] = { id: e[0], count: Math.min(e[1], ITEMS[e[0]].stack) }; }
    } else { // saved before backpacks (9 + 27 slots): keep the bag if it was used, re-add everything in order
      this.hasBag = o.slots.slice(9).some(ok);
      for (const e of o.slots) if (ok(e)) this.add(e[0], Math.min(e[1], ITEMS[e[0]].stack));
    }
    this.selected = Number.isInteger(o.sel) ? Math.max(0, Math.min(HOTBAR - 1, o.sel)) : 0;
    this.render();
    return true;
  }

  // ---------- clicks (inventory screen) ----------
  clickSlot(i, button, shift) {
    const s = this.slots[i], max = (id) => ITEMS[id].stack;
    if (i >= this.size) return; // the bag needs a backpack
    if (shift && s && !this.cursor) { // quick-move between hotbar and bag
      if (!this.hasBag) return;
      const range = i < HOTBAR ? [HOTBAR, SLOTS] : [0, HOTBAR];
      let n = s.count;
      for (let j = range[0]; j < range[1] && n > 0; j++) { const t = this.slots[j]; if (t?.id === s.id && t.count < max(s.id)) { const k = Math.min(n, max(s.id) - t.count); t.count += k; n -= k; } }
      for (let j = range[0]; j < range[1] && n > 0; j++) if (!this.slots[j]) { this.slots[j] = { id: s.id, count: n }; n = 0; }
      this.slots[i] = n ? { id: s.id, count: n } : null;
    } else if (button === 2) { // right click: half / one
      if (!this.cursor && s) {
        const k = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: k };
        this.slots[i] = s.count - k ? { id: s.id, count: s.count - k } : null;
      } else if (this.cursor && (!s || (s.id === this.cursor.id && s.count < max(s.id)))) {
        this.slots[i] = { id: this.cursor.id, count: (s?.count ?? 0) + 1 };
        this.cursor = this.cursor.count > 1 ? { ...this.cursor, count: this.cursor.count - 1 } : null;
      }
    } else if (!this.cursor) { // left click: pick up
      this.cursor = s;
      this.slots[i] = null;
    } else if (!s) { // put down
      this.slots[i] = this.cursor;
      this.cursor = null;
    } else if (s.id === this.cursor.id && s.count < max(s.id)) { // merge
      const k = Math.min(this.cursor.count, max(s.id) - s.count);
      s.count += k;
      this.cursor = this.cursor.count - k ? { ...this.cursor, count: this.cursor.count - k } : null;
    } else { // swap
      [this.slots[i], this.cursor] = [this.cursor, s];
    }
    this.render();
    this.onChange();
  }

  // ---------- DOM ----------
  buildDOM() {
    const slotEl = (i) => {
      const el = document.createElement('div');
      el.className = 'inv-slot';
      el.dataset.slot = i;
      el.innerHTML = '<img alt="" draggable="false" /><span class="count"></span>';
      return el;
    };
    const hotbar = $('hotbar');
    hotbar.innerHTML = '';
    for (let i = 0; i < HOTBAR; i++) {
      const el = slotEl(i);
      el.insertAdjacentHTML('afterbegin', `<span class="key">${i + 1}</span>`);
      el.addEventListener('click', () => this.select(i));
      hotbar.append(el);
    }
    // a clickable bag icon at the end of the hotbar opens the inventory (same as I)
    const open = document.createElement('button');
    open.id = 'inv-open';
    open.tabIndex = -1;
    open.title = 'Inventory (I)';
    open.innerHTML = `<img alt="Inventory" draggable="false" src="${iconURL('bag')}" />`;
    open.addEventListener('click', () => { open.blur(); this.toggle(); });
    hotbar.append(open);
    const bag = $('inv-bag'), bar = $('inv-bar');
    bag.innerHTML = bar.innerHTML = '';
    for (let i = HOTBAR; i < SLOTS; i++) bag.append(slotEl(i));
    for (let i = 0; i < HOTBAR; i++) bar.append(slotEl(i));
    for (const grid of [bag, bar]) {
      grid.addEventListener('mousedown', (e) => {
        const el = e.target.closest('.inv-slot');
        if (!el) return;
        e.preventDefault();
        this.clickSlot(Number(el.dataset.slot), e.button, e.shiftKey);
      });
      grid.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // the stack held by the mouse follows the pointer
    $('inventory').addEventListener('mousemove', (e) => {
      const c = $('inv-cursor');
      c.style.left = `${e.clientX}px`;
      c.style.top = `${e.clientY}px`;
      const el = e.target.closest?.('.inv-slot');
      const s = el ? this.slots[Number(el.dataset.slot)] : null;
      if (el || !e.target.closest?.('.craft')) $('inv-name').textContent = s ? ITEMS[s.id].name : '';
    });
    this.buildCraft();
    // creative mode: every item as a button (click: a full stack, right click: one), and a way to start over
    const all = $('inv-all');
    all.innerHTML = '';
    for (const [id, it] of Object.entries(ITEMS)) {
      if (it.unlock) continue; // the backpack isn't carried (creative opens the bag anyway)
      const el = document.createElement('button');
      el.className = 'inv-pick';
      el.tabIndex = -1;
      el.title = `${it.name} (click: ${it.stack > 1 ? `a stack of ${it.stack}` : 'one'}, right-click: one)`;
      el.innerHTML = `<img alt="" draggable="false" src="${iconURL(id)}" />`;
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (this.add(id, e.button === 2 ? 1 : it.stack) > 0) this.toast('Your inventory is full');
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('mouseenter', () => { $('inv-name').textContent = it.name; });
      all.append(el);
    }
    $('inv-clear').addEventListener('click', (e) => { e.currentTarget.blur(); this.slots.fill(null); this.cursor = null; this.render(); this.onChange(); });
  }

  // crafting: one button per recipe on offer (ingredients → result), lit when you have the ingredients
  buildCraft() {
    const craft = $('inv-craft');
    craft.innerHTML = '';
    this.recipes().forEach((r) => {
      const i = RECIPES.indexOf(r);
      const el = document.createElement('button');
      el.className = 'craft';
      el.tabIndex = -1;
      el.dataset.recipe = i;
      const cost = Object.entries(r.cost).map(([id, n]) => `<span class="craft-item"><img alt="" src="${iconURL(id)}" /><b>${n}</b></span>`).join('');
      el.innerHTML = `${cost}<span class="craft-arrow">→</span><span class="craft-item"><img alt="" src="${iconURL(r.out)}" /><b>${r.n > 1 ? r.n : ''}</b></span>`;
      el.title = `${ITEMS[r.out].name}${r.n > 1 ? ` ×${r.n}` : ''}: ${Object.entries(r.cost).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ')}`;
      el.addEventListener('click', () => { el.blur(); this.craft(r); });
      el.addEventListener('mouseenter', () => { $('inv-name').textContent = el.title; });
      craft.append(el);
    });
    $('inv-craft-hint').textContent = this.station === 'bench' ? '' : 'Tools, walls and furniture are made at a workbench: place one and click it.';
  }

  render() {
    const paint = (el, s) => {
      const img = el.querySelector('img'), count = el.querySelector('.count');
      if (s) { img.src = iconURL(s.id); img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
      count.textContent = s && s.count > 1 ? s.count : '';
      el.title = s ? ITEMS[s.id].name : '';
    };
    $('inv-bag').hidden = !this.hasBag;
    $('inv-creative').hidden = !this.creative;
    $('inv-nobag').hidden = this.hasBag;
    document.querySelectorAll('.inv-slot').forEach((el) => {
      const i = Number(el.dataset.slot);
      paint(el, this.slots[i]);
      el.classList.toggle('selected', i === this.selected && i < HOTBAR);
    });
    document.querySelectorAll('#inv-craft .craft').forEach((el) => el.classList.toggle('off', !this.canCraft(RECIPES[Number(el.dataset.recipe)])));
    paint($('inv-cursor'), this.cursor);
    $('inv-cursor').hidden = !this.cursor;
  }
}
