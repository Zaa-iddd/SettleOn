// Minecraft-style inventory: a 9-slot hotbar (keys 1-9) plus a 27-slot bag, opened with I or Tab.
// Items are flat 2D pixel-art icons drawn here in code (original art), shown as <img>s scaled with
// `image-rendering: pixelated`. Slot clicks work like the classic inventory screen:
//  - left click: pick up a stack / put it down / merge into the same item / swap
//  - right click: pick up half a stack / put down one item
//  - shift + click: move a stack between the hotbar and the bag
// The selected hotbar slot is what you hold (a shovel or pickaxe works as the tool, see main.js).

export const HOTBAR = 9, SLOTS = 36; // slots 0-8 are the hotbar, 9-35 the bag

// 16×16 icons. Tools are drawn from strings; blocks are generated from a few colours.
const TOOL_PALETTE = { o: '#1e1612', H: '#b07a48', h: '#7a4f2c', m: '#dfe5ea', M: '#9aa4ad', d: '#6b737c',
  G: '#6fbe46', g: '#4a8f30', k: '#1f3a17', w: '#ffffff', p: '#1a1a22', y: '#dbe8a0', // + frog colours
  B: '#6e4a30', b: '#523522', L: '#e3c08a', l: '#c79a62', r: '#a87444', R: '#c08a56', u: '#4f8fd0', W: '#eef3f8', n: '#5fa83a', // + log and workbench colours
  e: '#e0334a', E: '#a81f38' }; // + berry reds
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

export const ITEMS = {
  // `block`: this item can be placed (main.js turns it into a ground kind)
  shovel: { name: 'Shovel', stack: 1, tool: 'shovel', art: TOOL_ART.shovel },
  frog: { name: 'Frog', stack: 8, throwable: true, art: TOOL_ART.frog }, // caught at ponds; click to throw it
  axe: { name: 'Axe', stack: 1, tool: 'axe', art: TOOL_ART.axe }, // chops trees, breaks wood blocks
  log: { name: 'Log', stack: 64, place: true, art: TOOL_ART.log }, // from chopped trees; a crafting material, and stacks into log piles (main.js)
  stick: { name: 'Stick', stack: 64, art: TOOL_ART.stick }, // from broken bushes; for crafting tools
  pebble: { name: 'Pebble', stack: 64, art: TOOL_ART.pebble }, // picked up off the ground; for crafting tools
  berries: { name: 'Berries', stack: 64, art: TOOL_ART.berries }, // found on bushes
  workbench: { name: 'Workbench', stack: 16, place: true, art: TOOL_ART.workbench }, // placed on a tile as furniture (main.js)
  pickaxe: { name: 'Pickaxe', stack: 1, tool: 'pickaxe', art: TOOL_ART.pickaxe },
  dirt: { name: 'Dirt', stack: 64, block: true, art: blockArt({ base: '#8d5c3a', light: '#a8724c', dark: '#6a4329', speck: '#6f472c', speck2: '#a97a52', top: ['#8fd04f', '#5fa32f'] }) },
  stone: { name: 'Stone', stack: 64, block: true, art: blockArt({ base: '#8e8c88', light: '#aaa8a3', dark: '#696763', speck: '#74726e', speck2: '#a3a19c' }) },
  sand: { name: 'Sand', stack: 64, block: true, art: blockArt({ base: '#e2cf92', light: '#f1e2ae', dark: '#bfa86c', speck: '#cdb877', speck2: '#f3e6bd' }) },
  wood: { name: 'Wood', stack: 64, block: true, art: blockArt({ base: '#a87444', light: '#c08a56', dark: '#7a4f2c', speck: '#9a683c', speck2: '#b47e4c', planks: true }) },
  snow: { name: 'Snow', stack: 64, block: true, art: blockArt({ base: '#eef3f8', light: '#ffffff', dark: '#c3cfdc', speck: '#d7e1ec', speck2: '#ffffff' }) },
};

// What can be crafted in the inventory screen: `n` of `out` for the items in `cost`.
export const RECIPES = [
  { out: 'shovel', n: 1, cost: { stick: 2, pebble: 1 } },
  { out: 'axe', n: 1, cost: { stick: 2, pebble: 2 } },
  { out: 'pickaxe', n: 1, cost: { stick: 2, pebble: 3 } },
  { out: 'wood', n: 2, cost: { log: 1 } },
  { out: 'workbench', n: 1, cost: { log: 4 } },
];

// draw each icon once into a data URL
const iconCache = new Map();
function iconURL(id) {
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
    this.selected = 0;
    this.cursor = null; // stack held by the mouse while the inventory is open
    this.isOpen = false;
    this.buildDOM();
    this.reset();
  }

  /** You start with nothing: tools are crafted from sticks and pebbles (see RECIPES). */
  reset() {
    this.slots.fill(null);
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

  /** Add items (hotbar first, then the bag), merging into stacks. Returns how many didn't fit. */
  add(id, n = 1) {
    const max = ITEMS[id].stack;
    for (let i = 0; i < SLOTS && n > 0; i++) {
      const s = this.slots[i];
      if (s?.id === id && s.count < max) { const k = Math.min(n, max - s.count); s.count += k; n -= k; }
    }
    for (let i = 0; i < SLOTS && n > 0; i++) {
      if (!this.slots[i]) { const k = Math.min(n, max); this.slots[i] = { id, count: k }; n -= k; }
    }
    this.render();
    this.onChange();
    return n;
  }

  /** Use up n of the held item (placing a block). Returns false if there weren't enough. */
  takeHeld(n = 1) {
    const s = this.held;
    if (!s || s.count < n) return false;
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
  /** Craft a recipe once, if the ingredients are there and the result fits. */
  craft(r) {
    if (!this.canCraft(r)) return;
    const before = this.slots.map((s) => (s ? { ...s } : null));
    for (const [id, n] of Object.entries(r.cost)) this.remove(id, n);
    if (this.add(r.out, r.n) > 0) { this.slots = before; this.render(); this.toast('Your inventory is full'); }
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() { this.isOpen = true; $('inventory').hidden = false; this.render(); }
  close() {
    if (this.cursor) { const left = this.add(this.cursor.id, this.cursor.count); this.cursor = left ? { ...this.cursor, count: left } : null; }
    this.cursor = null;
    this.isOpen = false;
    $('inventory').hidden = true;
    this.render();
  }

  // ---------- saving ----------
  toJSON() { return { sel: this.selected, slots: this.slots.map((s) => (s ? [s.id, s.count] : 0)) }; }
  fromJSON(o) {
    if (!o || !Array.isArray(o.slots)) return false;
    this.slots = new Array(SLOTS).fill(null).map((_, i) => {
      const e = o.slots[i];
      if (!Array.isArray(e) || !ITEMS[e[0]] || !Number.isInteger(e[1]) || e[1] < 1) return null;
      return { id: e[0], count: Math.min(e[1], ITEMS[e[0]].stack) };
    });
    this.selected = Number.isInteger(o.sel) ? Math.max(0, Math.min(HOTBAR - 1, o.sel)) : 0;
    this.render();
    return true;
  }

  // ---------- clicks (inventory screen) ----------
  clickSlot(i, button, shift) {
    const s = this.slots[i], max = (id) => ITEMS[id].stack;
    if (shift && s && !this.cursor) { // quick-move between hotbar and bag
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
    // crafting: one button per recipe (ingredients → result), lit when you have the ingredients
    const craft = $('inv-craft');
    craft.innerHTML = '';
    RECIPES.forEach((r, i) => {
      const el = document.createElement('button');
      el.className = 'craft';
      el.tabIndex = -1;
      el.dataset.recipe = i;
      const cost = Object.entries(r.cost).map(([id, n]) => `<span class="craft-item"><img alt="" src="${iconURL(id)}" /><b>${n}</b></span>`).join('');
      el.innerHTML = `${cost}<span class="craft-arrow">→</span><span class="craft-item"><img alt="" src="${iconURL(r.out)}" /><b>${r.n > 1 ? r.n : ''}</b></span>`;
      el.title = `${ITEMS[r.out].name}: ${Object.entries(r.cost).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ')}`;
      el.addEventListener('click', () => { el.blur(); this.craft(r); });
      el.addEventListener('mouseenter', () => { $('inv-name').textContent = el.title; });
      craft.append(el);
    });
    // the stack held by the mouse follows the pointer
    $('inventory').addEventListener('mousemove', (e) => {
      const c = $('inv-cursor');
      c.style.left = `${e.clientX}px`;
      c.style.top = `${e.clientY}px`;
      const el = e.target.closest?.('.inv-slot');
      const s = el ? this.slots[Number(el.dataset.slot)] : null;
      $('inv-name').textContent = s ? ITEMS[s.id].name : '';
    });
  }

  render() {
    const paint = (el, s) => {
      const img = el.querySelector('img'), count = el.querySelector('.count');
      if (s) { img.src = iconURL(s.id); img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
      count.textContent = s && s.count > 1 ? s.count : '';
      el.title = s ? ITEMS[s.id].name : '';
    };
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
