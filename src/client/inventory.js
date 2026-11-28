import { FISH, fishArt } from './fishing.js';
import { FLOWERS, DYES, CLOTHES, NATURAL, WEAR_SLOTS, WEAR_LABELS, clothId, parseCloth, cleanWear } from '../shared/outfit.js';

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
  coconut: [
    '................',
    '................',
    '................',
    '......oooo......',
    '....ooBBBBoo....',
    '...oBBLLBBBBo...',
    '..oBBLwLBBBBbo..',
    '..oBBLLBBBBBbo..',
    '..oBBBBBBBpBbo..',
    '..oBBBBBBpppbo..',
    '..oBBBBBBBpbbo..',
    '...oBBBBBbbbo...',
    '....oobbbboo....',
    '......oooo......',
    '................',
    '................',
  ],
  coconut_half: [
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '.oBBBBBBBBBBBBo.',
    '.oBWWWWWWWWWWBo.',
    '.oBWWWWWWWWWWBo.',
    '..oBWWWWWWWWBo..',
    '..oBBWWWWWWBBo..',
    '...oBBBWWBBBo...',
    '....ooBBBBoo....',
    '......oooo......',
    '................',
    '................',
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
  planks: [ // three boards stacked, seen from above the front-left corner, with dark gaps between them
    '................',
    '................',
    '...oooooooooooo.',
    '..oRLRRRLRRRRRo.',
    '.olRRlRRLRRRRho.',
    'oRRRRRRRRRRRhBo.',
    'oLLLLLLLLLLoBoo.',
    'orrrlrrrrlrooho.',
    'oooooooooooohBo.',
    'oLLLLLLLLLLoBoo.',
    'orrrrrlrlrrooho.',
    'oooooooooooohBo.',
    'oLLLLLLLLLLoBo..',
    'orrlrrrrrrroo...',
    'oooooooooooo....',
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
  rowboat: [ // a little rowboat with an oar
    '................',
    '................',
    '................',
    '................',
    '..........o.....',
    '.........oLo....',
    '........oLo.....',
    '.......oLo......',
    'oo....oLo.....oo',
    'oHooooooooooooHo',
    'oRHLLLLLLLLLLHRo',
    '.oRRRRRRRRRRRRo.',
    '..oHhHhHhHhHHo..',
    '...oooooooooo...',
    '................',
    '................',
  ],
  pirate: [ // a pirate ship: black flag, two masts of cream sails, a raised stern castle, gold trim and gunports
    '.....hpwpp......',
    '.....hpppp..h...',
    '..ooooooo.ooooo.',
    '..occccco.occco.',
    '..occccco.occco.',
    '..occccco.occco.',
    '..ooooooo.ooooo.',
    'oooo.h......h...',
    'oRuo.h......h.oo',
    'oRRooooooooooooo',
    'oYYYYYYYYYYYYYo.',
    '.oBpBBpBBpBBpBo.',
    '.obbbbbbbbbbbo..',
    '..ooooooooooo...',
    '................',
    '................',
  ],
  rod: [ // a fishing rod with its line and a red-and-white bobber
    '..............oo',
    '.............oLo',
    '............oLo.',
    '...........oLo.m',
    '..........oLo..m',
    '.........olo...m',
    '........olo....m',
    '.......oHo.....m',
    '......oHo......m',
    '.....oHo......oo',
    '...ooHo.......oe',
    '..oddo........ow',
    '..oddo.........o',
    '.oHo............',
    'oHo.............',
    'oo..............',
  ],
  crate: [
    '................',
    '................',
    '..oooooooooooo..',
    '..oLLLLLLLLLLo..',
    '..oRhRRRRRRhRo..',
    '..oRRhRRRRhRRo..',
    '..oRRRhRRhRRRo..',
    '..oRRRRhhRRRRo..',
    '..oRRRRhhRRRRo..',
    '..oRRRhRRhRRRo..',
    '..oRRhRRRRhRRo..',
    '..oRhRRRRRRhRo..',
    '..oLLLLLLLLLLo..',
    '..oooooooooooo..',
    '................',
    '................',
  ],
  barrel: [
    '................',
    '....oooooooo....',
    '...oHHHHHHHHo...',
    '..oRRRRRRRRRRo..',
    '..oddddddddddo..',
    '.oRRHRRRRRRHRRo.',
    '.oRRHRRRRRRHRRo.',
    '.oRRHRRRRRRHRRo.',
    '.oRRHRRRRRRHRRo.',
    '.oRRHRRRRRRHRRo.',
    '..oddddddddddo..',
    '..oRRRRRRRRRRo..',
    '...ohhhhhhhho...',
    '....oooooooo....',
    '................',
    '................',
  ],
  planter: [
    '................',
    '.....oooooo.....',
    '....onnGGnno....',
    '...onGGnnGGno...',
    '..ongnnGGnngno..',
    '..onnGgnnGnnno..',
    '...ongnnnngno...',
    '....onnggnno....',
    '.....oohhoo.....',
    '....oRRRRRRo....',
    '....olRRRRlo....',
    '.....oRRRRo.....',
    '.....oRRRRo.....',
    '.....ollllo.....',
    '......oooo......',
    '................',
  ],
  flowerbox: [
    '................',
    '................',
    '................',
    '...e....Y...e...',
    '..eYe..YeY.eYe..',
    '...e.n..Y...e...',
    '...n.n..n.n.n...',
    '..nnGnnGnnGnnn..',
    '.oooooooooooooo.',
    '.oRRRRRRRRRRRRo.',
    '.oRhRRRRRRRRhRo.',
    '.oRRRRRRRRRRRRo.',
    '.oooooooooooooo.',
    '..oo........oo..',
    '................',
    '................',
  ],
  seat: [
    '................',
    '................',
    '..oooooooooooo..',
    '..oLLLLLLLLLLo..',
    '..oooooooooooo..',
    '..oLLLLLLLLLLo..',
    '..oooooooooooo..',
    '.oooooooooooooo.',
    '.oLLLLLLLLLLLLo.',
    '.oRRRRRRRRRRRRo.',
    '.oooooooooooooo.',
    '..oho......oho..',
    '..oho......oho..',
    '..oho......oho..',
    '..ooo......ooo..',
    '................',
  ],
  pennant: [
    '..oo............',
    '..oYo...........',
    '..oho...........',
    '..ohoooooo......',
    '..oheeeeeeoo....',
    '..oheeeeeeeeoo..',
    '..oheWWeeeeeeo..',
    '..oheeeeeeeoo...',
    '..ohoooooooo....',
    '..oho...........',
    '..oho...........',
    '..oho...........',
    '..oho...........',
    '.ooHoo..........',
    'oHHHHHo.........',
    'ooooooo.........',
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

// ---------- cotton, flowers, dyes and clothes (outfit.js): icons drawn from small masks ----------
// A mask is a few rows of letters (centred on the 16×16 icon); an outline is drawn around whatever is filled.
const mixHex = (a, b, k) => {
  const ch = (s) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const cssHex = (n) => `#${n.toString(16).padStart(6, '0')}`;
function maskArt(rows, pal) {
  const oy = Math.floor((16 - rows.length) / 2);
  const grid = Array.from({ length: 16 }, () => new Array(16).fill(null));
  rows.forEach((r, y) => { const rx = Math.floor((16 - r.length) / 2); [...r].forEach((ch, x) => { if (pal[ch]) grid[oy + y][rx + x] = pal[ch]; }); });
  const out = grid.map((r) => r.slice());
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (grid[y][x]) continue;
      if ((y > 0 && grid[y - 1][x]) || (y < 15 && grid[y + 1][x]) || (x > 0 && grid[y][x - 1]) || (x < 15 && grid[y][x + 1])) out[y][x] = '#1e1612';
    }
  }
  return out;
}
const CLOTH_MASKS = {
  cap: ['....######......', '..##llllll##....', '.##llllll####...', '.###########d...', '.###########dd..', '.dddddddddddddd.', '........dddddddd'],
  beanie: ['......aa......', '.....aaaa.....', '......##......', '....######....', '..##llll####..', '.###lll######.', '.############.', '.aaaaaaaaaaaa.', '.aaaaaaaaaaaa.'],
  sunhat: ['.....######.....', '....##llll##....', '....########....', '....aaaaaaaa....', '.llllllllllllll.', 'llllllllllllllll', '.dddddddddddddd.'],
  tee: ['..###......###..', '.####.dddd.####.', '#####......#####', '####.######.####', '###..######..###', '.....######.....', '.....######.....', '.....#l####.....', '.....######.....', '.....dddddd.....'],
  sweater: ['..###......###..', '.####.aaaa.####.', '#####......#####', '#####.####.#####', '####..####..####', '####..#l##..####', '####..####..####', 'aaaa..####..aaaa', '......####......', '......aaaa......'],
  dress: ['...##....##...', '...##dddd##...', '...########...', '....######....', '....aaaaaa....', '...########...', '..##########..', '.############.', '##############', 'dddddddddddddd'],
  pants: ['..aaaaaaaaaa..', '..##########..', '..##########..', '..####..####..', '..####..####..', '..####..####..', '..####..####..', '..dddd..dddd..'],
  shorts: ['..aaaaaaaaaa..', '..##########..', '..##########..', '..####..####..', '..####..####..', '..dddd..dddd..'],
  skirt: ['...aaaaaaaa...', '...########...', '..##########..', '..##########..', '.############.', '.############.', '##############', 'dddddddddddddd'],
  shoes: ['.####....####.', '.####....####.', '.#l##....#l##.', '######..######', '######..######', 'ssssss..ssssss'],
  boots: ['.aaaa....aaaa.', '.####....####.', '.####....####.', '.####....####.', '.#l##....#l##.', '######..######', 'dddddd..dddddd', 'ssssss..ssssss'],
  scarf: ['..############..', '.##aa##aa##aa##.', '.##############.', '..####....####..', '......####......', '......#aa#......', '......####......', '......#aa#......', '.....######.....'],
};
const clothArt = (type, hex) => maskArt(CLOTH_MASKS[type], {
  '#': cssHex(hex), l: cssHex(mixHex(hex, 0xffffff, 0.3)), d: cssHex(mixHex(hex, 0, 0.3)), a: cssHex(mixHex(hex, 0xffffff, 0.5)), s: '#4a3222',
});
const flowerArt = (hex) => maskArt([
  '.....ppp.....', '...pppPppp...', '..pppPcccPpp.', '...ppPcccPp..', '....pppPppp..', '.....ppp.g...', '.......g.....', '.......gg....', '....gg.g.....', '.....ggg.....', '.......g.....',
], { p: cssHex(hex), P: cssHex(mixHex(hex, 0xffffff, 0.45)), c: '#f2b632', g: '#4f9a3a' });
const dyeArt = (hex) => maskArt([
  '....kkkk....', '....kkkk....', '.....gg.....', '....gggg....', '...gllllg...', '..gl####lg..', '..g######g..', '..g##dd###g..', '..gddddddg..', '...gggggg...',
], { k: '#8a5a34', g: '#cfe3ea', '#': cssHex(hex), l: cssHex(mixHex(hex, 0xffffff, 0.45)), d: cssHex(mixHex(hex, 0, 0.3)) });
const COTTON_ART = maskArt([
  '....ww.ww....', '...wwwwwww...', '..wwwWwwwww..', '..wwwwwwwWw..', '...wwnwwwww..', '....bbbbbb...', '.....bbbb....',
], { w: '#fbfbf6', W: '#ffffff', n: '#dcd8c8', b: '#7a4a2a' });

const WEAR_ITEMS = {};
for (const c of CLOTHES) {
  for (const dye of [null, ...DYES]) {
    const hex = dye ? dye.hex : NATURAL;
    WEAR_ITEMS[clothId(c.type, dye?.key)] = {
      name: `${dye ? `${dye.name} ` : ''}${c.name}`, stack: 1, cloth: true, slot: c.slot, variant: !!dye,
      get art() { return clothArt(c.type, hex); }, // drawn once: iconURL caches it
    };
  }
}
const DYE_ITEMS = Object.fromEntries([
  ['cotton', { name: 'Cotton Ball', stack: 64, art: COTTON_ART }], // harvested from cotton plants; what clothes are made of
  ...FLOWERS.map((f) => [`flower_${f.key}`, { name: f.name, stack: 64, flower: f.key, art: flowerArt(f.hex) }]),
  ...DYES.map((d) => [`dye_${d.key}`, { name: `${d.name} Dye`, stack: 64, dye: d.key, art: dyeArt(d.hex) }]),
]);

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
  coconut: { name: 'Coconut', stack: 16, throwable: 'nut', art: TOOL_ART.coconut }, // shaken down from palms; click to throw it: it splits in two
  coconut_half: { name: 'Coconut Half', stack: 16, food: 3, art: TOOL_ART.coconut_half }, // what's left after a throw; edible
  berries: { name: 'Berries', stack: 64, food: 2, art: TOOL_ART.berries }, // found on bushes; edible (food = hunger points, vitals.js)
  // furniture (`furn`): placed on a tile, see FURNITURE in world.js and main.js
  workbench: { name: 'Workbench', stack: 16, place: true, furn: true, art: TOOL_ART.workbench },
  chair: { name: 'Chair', stack: 16, place: true, furn: true, art: TOOL_ART.chair },
  table: { name: 'Table', stack: 16, place: true, furn: true, art: TOOL_ART.table },
  bed: { name: 'Bed', stack: 4, place: true, furn: true, art: TOOL_ART.bed },
  lamp: { name: 'Lamp', stack: 16, place: true, furn: true, art: TOOL_ART.lamp },
  shelf: { name: 'Bookshelf', stack: 16, place: true, furn: true, art: TOOL_ART.shelf },
  // decorations: placed like furniture, on land or on your boat's deck
  crate: { name: 'Crate', stack: 16, place: true, furn: true, art: TOOL_ART.crate },
  barrel: { name: 'Barrel', stack: 16, place: true, furn: true, art: TOOL_ART.barrel },
  planter: { name: 'Potted Plant', stack: 16, place: true, furn: true, art: TOOL_ART.planter },
  flowerbox: { name: 'Flower Box', stack: 16, place: true, furn: true, art: TOOL_ART.flowerbox },
  seat: { name: 'Bench', stack: 16, place: true, furn: true, art: TOOL_ART.seat },
  pennant: { name: 'Pennant Pole', stack: 16, place: true, furn: true, art: TOOL_ART.pennant },
  boat: { name: 'Cabin Boat', stack: 1, boat: true, hull: 0, art: TOOL_ART.boat }, // launched on open water (main.js), then walked on and sailed
  rod: { name: 'Fishing Rod', stack: 1, tool: 'rod', art: TOOL_ART.rod }, // cast, wait for the bite, reel in (fishing.js)
  ...Object.fromEntries(FISH.map((f) => [f.id, { name: f.name, stack: 16, fish: true, food: f.food, art: fishArt(f) }])), // what you catch
  rowboat: { name: 'Rowboat', stack: 1, boat: true, hull: 1, tool: 'boat', art: TOOL_ART.rowboat }, // the other kinds of boat (boat.js HULLS)
  pirate: { name: 'Pirate Ship', stack: 1, boat: true, hull: 2, tool: 'boat', art: TOOL_ART.pirate },
  pickaxe: { name: 'Pickaxe', stack: 1, tool: 'pickaxe', art: TOOL_ART.pickaxe },
  dirt: { name: 'Dirt', stack: 64, block: true, art: blockArt({ base: '#8d5c3a', light: '#a8724c', dark: '#6a4329', speck: '#6f472c', speck2: '#a97a52', top: ['#8fd04f', '#5fa32f'] }) },
  stone: { name: 'Stone', stack: 64, block: true, art: blockArt({ base: '#8e8c88', light: '#aaa8a3', dark: '#696763', speck: '#74726e', speck2: '#a3a19c' }) },
  sand: { name: 'Sand', stack: 64, block: true, art: blockArt({ base: '#e2cf92', light: '#f1e2ae', dark: '#bfa86c', speck: '#cdb877', speck2: '#f3e6bd' }) },
  wood: { name: 'Planks', stack: 64, art: TOOL_ART.planks }, // a crafting material (not placeable); the id stays 'wood' for old saves
  wall: { name: 'Wooden Wall', stack: 64, block: true, art: wallArt() },
  snow: { name: 'Snow', stack: 64, block: true, art: blockArt({ base: '#eef3f8', light: '#ffffff', dark: '#c3cfdc', speck: '#d7e1ec', speck2: '#ffffff' }) },
  ...DYE_ITEMS,
  ...WEAR_ITEMS,
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
  { out: 'crate', n: 1, at: 'bench', cost: { wood: 3 } },
  { out: 'barrel', n: 1, at: 'bench', cost: { wood: 4, stone: 1 } },
  { out: 'planter', n: 1, at: 'bench', cost: { dirt: 2, leaves: 4, pebble: 1 } },
  { out: 'flowerbox', n: 1, at: 'bench', cost: { wood: 2, dirt: 1, berries: 2 } },
  { out: 'seat', n: 1, at: 'bench', cost: { wood: 4, stick: 2 } },
  { out: 'pennant', n: 1, at: 'bench', cost: { stick: 3, leaves: 4, berries: 1 } },
  { out: 'rod', n: 1, at: 'bench', cost: { stick: 3, leaves: 2, pebble: 1 } },
  { out: 'rowboat', n: 1, at: 'bench', cost: { wood: 6, stick: 4 } },
  { out: 'boat', n: 1, at: 'bench', cost: { wood: 12, log: 4, leaves: 4 } },
  { out: 'pirate', n: 1, at: 'bench', cost: { wood: 24, log: 8, leaves: 16, stone: 6 } }, // stone for the cannons
  // clothes, from Cotton Balls (outfit.js CLOTHES). Dyes and dyeing are worked out from what you carry (Inventory.dyeRecipes)
  ...CLOTHES.map((c) => ({ out: c.type, n: 1, at: 'bench', cost: c.cost })),
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

const WEAR_HINT = { hat: 'cap', top: 'tee', bottom: 'pants', shoes: 'shoes', neck: 'scarf' }; // empty wardrobe slots show these, faded
const CRAFT_KEY = 'settleon.craftpanel'; // is the crafting panel shown beside the inventory ('0' = hidden)

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
    this.wear = cleanWear(null); // what's worn, slot -> clothing item id (see outfit.js)
    this.list = []; // the recipes shown now (buildCraft)
    this.isOpen = false;
    this.page = 'bag'; // the tab shown on the left: 'bag', 'wear' or 'creative'
    this.buildDOM();
    this.reset();
  }

  /** You start with nothing and no bag: everything is gathered and crafted (see RECIPES). */
  reset() {
    this.slots.fill(null);
    this.hasBag = false;
    this.selected = 0;
    this.cursor = null;
    this.wear = cleanWear(null);
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
  recipes() { return [...RECIPES.filter((r) => (r.at === 'hand' || this.station === 'bench') && !(ITEMS[r.out].unlock && this.hasBag)), ...this.dyeRecipes()]; }
  /**
   * Recipes that depend on what you carry, so the list stays short: grind a flower you hold into two dyes of its
   * colour (leaves make green), and, at a workbench, dye a piece of clothing you hold with a dye you hold.
   */
  dyeRecipes() {
    const out = [], held = new Set(this.slots.filter(Boolean).map((s) => s.id));
    for (const f of FLOWERS) if (held.has(`flower_${f.key}`)) out.push({ out: `dye_${f.key}`, n: 2, at: 'hand', dyn: true, cost: { [`flower_${f.key}`]: 1 } });
    if (held.has('leaves')) out.push({ out: 'dye_green', n: 2, at: 'hand', dyn: true, cost: { leaves: 3 } });
    if (this.station === 'bench') {
      for (const id of held) {
        const c = parseCloth(id);
        if (!c) continue;
        for (const d of DYES) if (d.key !== c.dye && held.has(`dye_${d.key}`)) out.push({ out: clothId(c.type, d.key), n: 1, at: 'bench', dyn: true, cost: { [id]: 1, [`dye_${d.key}`]: 1 } });
      }
    }
    return out;
  }
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

  // ---------- clothes ----------
  /** Put on the clothing in slot i of the inventory; what was worn there takes its place. Returns false if it isn't clothing. */
  wearFrom(i) {
    const s = this.slots[i], c = s && parseCloth(s.id);
    if (!c) return false;
    const old = this.wear[c.slot];
    this.wear[c.slot] = s.id;
    this.slots[i] = old ? { id: old, count: 1 } : null;
    this.render();
    this.onChange();
    return true;
  }
  /** Take off what's worn in `slot` and put it back in the inventory. */
  unwear(slot) {
    const id = this.wear[slot];
    if (!id) return;
    if (this.add(id, 1) > 0) return this.toast('Your inventory is full');
    this.wear[slot] = null;
    this.render();
    this.onChange();
  }
  /** Click on a wardrobe slot with the mouse: put the stack on the cursor on, or pick what's worn up. */
  clickWear(slot) {
    const cur = this.cursor, c = cur && parseCloth(cur.id);
    if (cur && (!c || c.slot !== slot)) return this.toast(c ? `That goes in the ${WEAR_LABELS[c.slot].toLowerCase()} slot` : "That can't be worn");
    if (cur) {
      const old = this.wear[slot];
      this.wear[slot] = cur.id;
      this.cursor = cur.count > 1 ? { id: cur.id, count: cur.count - 1 } : null;
      if (old) { if (this.cursor) { if (this.add(old, 1) > 0) this.toast('Your inventory is full'); } else this.cursor = { id: old, count: 1 }; }
    } else if (this.wear[slot]) {
      this.cursor = { id: this.wear[slot], count: 1 };
      this.wear[slot] = null;
    }
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
    document.body.classList.add('inv-open'); // the regular hotbar, bars and held name step aside
    $('inv-craft-title').textContent = station === 'bench' ? 'Workbench' : 'Crafting';
    this.showCraft(station === 'bench' || this.craftOpen()); // a workbench always shows its recipes
    this.showPage();
    this.buildCraft();
    this.render();
  }
  // the crafting panel beside the inventory: toggled with its tab or C, remembered per browser
  craftOpen() { try { return localStorage.getItem(CRAFT_KEY) !== '0'; } catch { return true; } }
  showCraft(on) {
    $('inv-craft-box').hidden = !on;
    $('inv-craft-toggle').classList.toggle('on', on);
    $('inv-craft-toggle').title = on ? 'Hide crafting (C)' : 'Crafting (C)';
  }
  // the page tabs on the left of the panel: which page is shown, its title, and whether the Creative tab exists
  showPage() {
    if (this.page === 'creative' && !this.creative) this.page = 'bag';
    for (const el of document.querySelectorAll('.inv-page')) el.hidden = el.dataset.page !== this.page;
    for (const el of document.querySelectorAll('#inv-tabs-left .inv-sidetab')) {
      el.classList.toggle('on', el.dataset.page === this.page);
      if (el.dataset.page === 'creative') el.hidden = !this.creative;
    }
    $('inv-title').textContent = { bag: 'Backpack', wear: 'Wardrobe', creative: 'Creative' }[this.page];
  }
  toggleCraft() {
    if (!this.isOpen) return;
    const on = $('inv-craft-box').hidden;
    this.showCraft(on);
    try { localStorage.setItem(CRAFT_KEY, on ? '1' : '0'); } catch {}
  }
  close() {
    if (this.cursor) { const left = this.add(this.cursor.id, this.cursor.count); this.cursor = left ? { ...this.cursor, count: left } : null; }
    this.cursor = null;
    this.isOpen = false;
    $('inventory').hidden = true;
    document.body.classList.remove('inv-open');
    this.render();
  }

  // ---------- saving ----------
  toJSON() { return { v: 2, sel: this.selected, bag: this.hasBag, wear: this.wear, slots: this.slots.map((s) => (s ? [s.id, s.count] : 0)) }; }
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
    this.wear = cleanWear(o.wear);
    this.render();
    return true;
  }

  // ---------- clicks (inventory screen) ----------
  clickSlot(i, button, shift) {
    const s = this.slots[i], max = (id) => ITEMS[id].stack;
    if (i >= this.size) return; // the bag needs a backpack
    if (shift && s && !this.cursor && parseCloth(s.id)) return void this.wearFrom(i); // shift-click clothes to put them on
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
      if ((el || !e.target.closest?.('.craft')) && !el?.classList.contains('wear-slot')) $('inv-name').textContent = s ? ITEMS[s.id].name : '';
    });
    // the wardrobe: one slot per kind of clothing (click with clothes on the cursor to put them on, shift-click to take off)
    // Laid out like a dressing doll: head and neck slots on the left of a live preview of you (main.js draws it in
    // #inv-doll), body and feet on the right. Empty slots show a faint picture of what goes there.
    const wear = $('inv-wear');
    const cell = (slot) => `<div class="wear-cell"><div class="inv-slot wear-slot" data-wear="${slot}"><img alt="" draggable="false" /><span class="count"></span></div><span>${WEAR_LABELS[slot]}</span></div>`;
    wear.innerHTML = `<div class="wear-col">${['hat', 'neck', 'top'].map(cell).join('')}</div>`
      + '<canvas id="inv-doll" width="110" height="140" title="Drag to turn"></canvas>'
      + `<div class="wear-col">${['bottom', 'shoes'].map(cell).join('')}</div>`;
    wear.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.wear-slot');
      if (!el) return;
      e.preventDefault();
      if (e.shiftKey && !this.cursor) this.unwear(el.dataset.wear); else this.clickWear(el.dataset.wear);
    });
    wear.addEventListener('contextmenu', (e) => e.preventDefault());
    wear.addEventListener('mousemove', (e) => {
      const el = e.target.closest?.('.wear-slot');
      const id = el && this.wear[el.dataset.wear];
      $('inv-name').textContent = id ? ITEMS[id].name : '';
    });
    this.buildCraft();
    // creative mode: every item as a button (click: a full stack, right click: one), and a way to start over
    const all = $('inv-all');
    all.innerHTML = '';
    for (const [id, it] of Object.entries(ITEMS)) {
      if (it.unlock || it.variant) continue; // the backpack isn't carried (creative opens the bag anyway); dyed clothes are made by dyeing
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
    // tabs with icons: pages on the left, Crafting on the right
    const tabs = $('inv-tabs-left');
    tabs.innerHTML = '';
    for (const [page, icon, label] of [['bag', 'bag', 'Backpack'], ['wear', 'tee', 'Wardrobe'], ['creative', 'crate', 'Creative']]) {
      const b = document.createElement('button');
      b.className = 'inv-sidetab';
      b.tabIndex = -1;
      b.dataset.page = page;
      b.title = label;
      b.innerHTML = `<img alt="${label}" draggable="false" src="${iconURL(icon)}" />`;
      b.addEventListener('click', () => { b.blur(); this.page = page; this.showPage(); });
      tabs.append(b);
    }
    $('inv-craft-toggle').innerHTML = `<img alt="Crafting" draggable="false" src="${iconURL('workbench')}" />`;
    $('inv-craft-toggle').addEventListener('click', (e) => { e.currentTarget.blur(); this.toggleCraft(); });
    $('inv-bar').title = 'Click: pick up / drop · Right-click: half / one · Shift-click: quick move';
    $('inv-close').addEventListener('click', (e) => { e.currentTarget.blur(); this.close(); });
    $('inv-clear').addEventListener('click', (e) => { e.currentTarget.blur(); this.slots.fill(null); this.cursor = null; this.render(); this.onChange(); });
  }

  // crafting: one row per recipe on offer (the result, its name, and the ingredients), lit when you have them
  buildCraft() {
    const craft = $('inv-craft'), scroll = craft.scrollTop;
    craft.innerHTML = '';
    this.list = this.recipes().map((r, i) => ({ r, i, ok: this.canCraft(r) })).sort((a, b) => (b.ok - a.ok) || (a.i - b.i)).map((x) => x.r); // what you can make now comes first
    this.dynSig = this.list.filter((r) => r.dyn).map((r) => r.out + Object.keys(r.cost)).join();
    this.list.forEach((r, i) => {
      const el = document.createElement('button');
      el.className = 'craft';
      el.tabIndex = -1;
      el.dataset.recipe = i;
      const cost = Object.entries(r.cost).map(([id, n]) => `<span class="craft-item" data-id="${id}" data-n="${n}" title="${ITEMS[id].name}"><img alt="" src="${iconURL(id)}" /><b>${n}</b></span>`).join('');
      el.innerHTML = `<span class="craft-out"><img alt="" src="${iconURL(r.out)}" /><b>${r.n > 1 ? r.n : ''}</b></span>`
        + `<span class="craft-info"><span class="craft-name">${ITEMS[r.out].name}</span><span class="craft-cost">${cost}</span></span>`;
      el.title = `${ITEMS[r.out].name}${r.n > 1 ? ` ×${r.n}` : ''}: ${Object.entries(r.cost).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ')}`;
      el.addEventListener('click', () => { el.blur(); this.craft(r); });
      el.addEventListener('mouseenter', () => { $('inv-name').textContent = el.title; });
      craft.append(el);
    });
    craft.scrollTop = scroll;
    $('inv-craft-hint').textContent = this.station === 'bench' ? '' : 'More recipes at a workbench';
  }

  render() {
    const paint = (el, s) => {
      const img = el.querySelector('img'), count = el.querySelector('.count');
      if (s) { img.src = iconURL(s.id); img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
      count.textContent = s && s.count > 1 ? s.count : '';
      el.title = s ? ITEMS[s.id].name : '';
    };
    $('inv-bag').hidden = !this.hasBag;
    this.showPage();
    $('inv-nobag').hidden = this.hasBag;
    document.querySelectorAll('.wear-slot').forEach((el) => {
      const slot = el.dataset.wear, id = this.wear[slot];
      paint(el, id ? { id, count: 1 } : null);
      el.title = id ? `${ITEMS[id].name} (shift-click to take off)` : WEAR_LABELS[slot];
      el.classList.toggle('empty', !id);
      if (!id) { const img = el.querySelector('img'); img.src = iconURL(WEAR_HINT[slot]); img.hidden = false; } // a faint picture of what goes here
    });
    if (this.isOpen && this.dyeRecipes().map((r) => r.out + Object.keys(r.cost)).join() !== this.dynSig) this.buildCraft(); // what you carry changed what can be made
    document.querySelectorAll('.inv-slot[data-slot]').forEach((el) => {
      const i = Number(el.dataset.slot);
      paint(el, this.slots[i]);
      el.classList.toggle('selected', i === this.selected && i < HOTBAR);
    });
    document.querySelectorAll('#inv-craft .craft').forEach((el) => el.classList.toggle('off', !this.canCraft(this.list[Number(el.dataset.recipe)])));
    document.querySelectorAll('#inv-craft .craft-item').forEach((el) => el.classList.toggle('short', this.count(el.dataset.id) < Number(el.dataset.n)));
    paint($('inv-cursor'), this.cursor);
    $('inv-cursor').hidden = !this.cursor;
  }
}
