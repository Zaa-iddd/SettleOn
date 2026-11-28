// Who a player looks like. Shared by the client, the server (validation) and saves.
//
//  - LOOK (chosen in the main menu, kept per browser, sent to the room): gender, skin, face (eyes and eye
//    colour), hair (style and colour) and facial hair (style and colour). Clothes are NOT part of it.
//  - WEAR (crafted in game, worn from the inventory screen, kept with the inventory): one item per slot.
//    A piece of clothing is an item id: `<type>` is undyed cotton, `<type>_<dye>` is dyed (see parseCloth).
//
// Everything is plain numbers and strings, so cleanLook / cleanWear can validate anything off the wire.

export const GENDERS = ['Boy', 'Girl'];
export const SKIN_TONES = [0xffe6d2, 0xffdfc4, 0xf6c9a4, 0xe9b08a, 0xd9a077, 0xc68863, 0xa8714d, 0x8d5a3b, 0x6b4328, 0x4a2e1e];
export const HAIR_COLORS = [0x2b2220, 0x4a3022, 0x5a3a24, 0x8a5a34, 0xa8643a, 0xc9a35a, 0xf0c869, 0xe58a5c,
  0xc83c3c, 0xf2a7c3, 0xc9a6e8, 0x7fb2e5, 0x6fc07a, 0xe8e8e8, 0x9a9a9a];
export const EYE_COLORS = [0x2a1d1a, 0x5a3a24, 0x2f6fd0, 0x3f9a5a, 0x7a8a96, 0xb8892a, 0x8a4fc0, 0xd04a6a];
export const HAIR_STYLES = ['Short', 'Tuft', 'Spiky', 'Bob', 'Long', 'Ponytail', 'Pigtails', 'Bun', 'Curly', 'Bald'];
export const FACIAL_HAIR = ['None', 'Stubble', 'Mustache', 'Goatee', 'Beard', 'Long beard', 'Mutton chops'];
export const FACES = ['Classic', 'Round', 'Sleepy', 'Happy', 'Sparkle'];

export function hashId(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** What a player with no saved look gets (also what everyone started with before the character menu). */
export function defaultLook(id = 'x') {
  const h = hashId(id), g = (h >>> 13) & 1;
  return {
    g,
    skin: SKIN_TONES[[1, 2, 3, 5, 7][h % 5]],
    hair: HAIR_COLORS[(h >>> 4) % 9],
    hs: [0, 1, 2, 3, 7][(h >>> 9) % 5],
    fh: 0,
    fc: HAIR_COLORS[(h >>> 4) % 9],
    face: 0,
    eyes: EYE_COLORS[0],
  };
}

const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);

/** Validate a look (from storage or the network); anything wrong falls back to the default for `id`. */
export function cleanLook(o, id = 'x') {
  const d = defaultLook(id);
  if (!o || typeof o !== 'object') return d;
  return {
    g: int(o.g, 0, 1, d.g),
    skin: int(o.skin, 0, 0xffffff, d.skin),
    hair: int(o.hair, 0, 0xffffff, d.hair),
    hs: int(o.hs, 0, HAIR_STYLES.length - 1, d.hs),
    fh: int(o.fh, 0, FACIAL_HAIR.length - 1, d.fh),
    fc: int(o.fc, 0, 0xffffff, d.fc),
    face: int(o.face, 0, FACES.length - 1, d.face),
    eyes: int(o.eyes, 0, 0xffffff, d.eyes),
  };
}

/** A fresh random look (the Randomize button). */
export function randomLook() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const hair = pick(HAIR_COLORS), g = Math.random() < 0.5 ? 0 : 1;
  return {
    g, skin: pick(SKIN_TONES), hair, hs: Math.floor(Math.random() * HAIR_STYLES.length),
    fh: g === 0 && Math.random() < 0.5 ? 1 + Math.floor(Math.random() * (FACIAL_HAIR.length - 1)) : 0,
    fc: hair, face: Math.floor(Math.random() * FACES.length), eyes: pick(EYE_COLORS),
  };
}

// ---------- flowers and dyes ----------
// Flowers grow wild (world.js / endless.js use FLOWER_COLORS) and can be picked. Each makes two dyes of its
// colour, and leaves make a green one. Dye clothes at a workbench.
export const FLOWERS = [
  { key: 'yellow', name: 'Yellow Flower', hex: 0xf2e15c },
  { key: 'pink', name: 'Pink Flower', hex: 0xf28cc0 },
  { key: 'white', name: 'White Flower', hex: 0xffffff },
  { key: 'blue', name: 'Blue Flower', hex: 0x9fb8ff },
  { key: 'orange', name: 'Orange Flower', hex: 0xff7a59 },
  { key: 'red', name: 'Red Flower', hex: 0xe84a4a },
  { key: 'purple', name: 'Purple Flower', hex: 0xb98cf0 },
];
export const FLOWER_COLORS = FLOWERS.map((f) => f.hex);
export const flowerKey = (hex) => FLOWERS.find((f) => f.hex === hex)?.key ?? 'yellow';

/** The colours cloth can be dyed (the dye item is `dye_<key>`). */
export const DYES = [
  { key: 'red', name: 'Red', hex: 0xd8483f },
  { key: 'orange', name: 'Orange', hex: 0xf08a3a },
  { key: 'yellow', name: 'Yellow', hex: 0xf2d24a },
  { key: 'green', name: 'Green', hex: 0x5aa84a },
  { key: 'blue', name: 'Blue', hex: 0x4a86d8 },
  { key: 'purple', name: 'Purple', hex: 0x9a6ad8 },
  { key: 'pink', name: 'Pink', hex: 0xf08cbc },
  { key: 'white', name: 'White', hex: 0xfafafa },
];
export const NATURAL = 0xe9dfc4; // undyed cotton

// ---------- clothes ----------
// Crafted at a workbench from Cotton Balls (see inventory.js RECIPES). `slot` is where it's worn.
export const WEAR_SLOTS = ['hat', 'top', 'bottom', 'shoes', 'neck'];
export const WEAR_LABELS = { hat: 'Hat', top: 'Top', bottom: 'Bottoms', shoes: 'Shoes', neck: 'Scarf' };
export const CLOTHES = [
  { type: 'cap', slot: 'hat', name: 'Cotton Cap', cost: { cotton: 3 } },
  { type: 'beanie', slot: 'hat', name: 'Beanie', cost: { cotton: 4 } },
  { type: 'sunhat', slot: 'hat', name: 'Sun Hat', cost: { cotton: 4, stick: 2 } },
  { type: 'tee', slot: 'top', name: 'T-Shirt', cost: { cotton: 5 } },
  { type: 'sweater', slot: 'top', name: 'Sweater', cost: { cotton: 8 } },
  { type: 'dress', slot: 'top', name: 'Dress', cost: { cotton: 8 } },
  { type: 'pants', slot: 'bottom', name: 'Pants', cost: { cotton: 6 } },
  { type: 'shorts', slot: 'bottom', name: 'Shorts', cost: { cotton: 4 } },
  { type: 'skirt', slot: 'bottom', name: 'Skirt', cost: { cotton: 4 } },
  { type: 'shoes', slot: 'shoes', name: 'Shoes', cost: { cotton: 4, wood: 1 } },
  { type: 'boots', slot: 'shoes', name: 'Boots', cost: { cotton: 5, wood: 2 } },
  { type: 'scarf', slot: 'neck', name: 'Scarf', cost: { cotton: 3 } },
];
const TYPES = new Map(CLOTHES.map((c) => [c.type, c]));
const DYE_BY_KEY = new Map(DYES.map((d) => [d.key, d]));

export const clothId = (type, dye = null) => (dye ? `${type}_${dye}` : type);

/** `tee_red` → { type: 'tee', slot: 'top', dye: 'red', hex }, or null when it isn't a piece of clothing. */
export function parseCloth(id) {
  if (typeof id !== 'string') return null;
  const [type, dye = null] = id.split('_');
  const c = TYPES.get(type);
  if (!c || (dye !== null && !DYE_BY_KEY.has(dye)) || id.split('_').length > 2) return null;
  return { type, slot: c.slot, dye, hex: dye ? DYE_BY_KEY.get(dye).hex : NATURAL, def: c };
}

/** Validate what's worn: { hat, top, bottom, shoes, neck } → each an item id in the right slot, or null. */
export function cleanWear(w) {
  const out = {};
  for (const slot of WEAR_SLOTS) {
    const c = parseCloth(w?.[slot]);
    out[slot] = c && c.slot === slot ? w[slot] : null;
  }
  return out;
}
