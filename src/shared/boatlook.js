// A boat's look: its name, paint and upgrades. Shared by the client (boat.js, the boat panel),
// the server (it keeps each room's boats) and saves, so everyone validates it the same way.
//
//   { n: name, c: [hull, cabin, roof, canvas] palette indices, u: upgrade levels (UPGRADE_KEYS order),
//     p: chosen parts (PART_KEYS order: which cabin, roof, top and mast), d: the prop on each deck spot (0 = none) }

export const BOAT_PALETTE = [
  0xc8643a, // terracotta
  0xb0463a, // brick red
  0xe0b040, // sunny yellow
  0xf0a030, // orange
  0xece0c4, // cream
  0x8fb09a, // sage
  0x2f7f6a, // sea green
  0x3a6aa0, // harbour blue
  0x7a4a8a, // plum
  0x3c3c44, // charcoal
  0x8a5a36, // varnished wood
  0xa08a70, // driftwood
  0x6a4428, // dark oak
];
export const PAINT_SLOTS = ['Hull', 'Cabin', 'Roof', 'Canvas'];
export const UPGRADE_KEYS = ['engine', 'rudder', 'awning', 'lights', 'bunting', 'trim', 'gear'];
export const UPGRADE_MAX = [3, 2, 1, 1, 1, 1, 1];
export const NAME_MAX = 16;
// Swappable parts (their models and names are in boat.js: CABINS, ROOFS, TOPS, MASTS) and deck props (PROPS on DECK_SLOTS)
export const PART_KEYS = ['cabin', 'roof', 'top', 'mast'];
export const PART_COUNTS = [3, 3, 3, 3];
export const PROP_COUNT = 7; // including 0 = nothing
export const DECK_SLOT_COUNT = 6;

/** A new boat is plain wood (rustic, at the user's request): a dark oak hull, a varnished cabin, a driftwood
 * shingle roof and cream canvas; no upgrades, no name. */
// The default parts and props are the original layout: plank cabin, shingles, wheelhouse, pennant mast; crates,
// a barrel, a chest and a rope coil.
export const defaultLook = () => ({ n: '', c: [12, 10, 11, 4], u: UPGRADE_KEYS.map(() => 0), p: [0, 0, 0, 0], d: [1, 2, 0, 0, 3, 4] });

/** Validate a look from the network or a save; anything odd falls back to the default. */
export function cleanLook(o) {
  const d = defaultLook();
  if (!o || typeof o !== 'object') return d;
  const n = String(o.n ?? '').replace(/[^\p{L}\p{N} '.!?&-]/gu, '').trim().slice(0, NAME_MAX);
  const c = Array.isArray(o.c) && o.c.length === PAINT_SLOTS.length && o.c.every((v) => Number.isInteger(v) && v >= 0 && v < BOAT_PALETTE.length) ? o.c.slice() : d.c;
  const u = UPGRADE_KEYS.map((_, i) => {
    const v = Array.isArray(o.u) ? o.u[i] : 0;
    return Number.isInteger(v) ? Math.max(0, Math.min(UPGRADE_MAX[i], v)) : 0;
  });
  const p = Array.isArray(o.p) && o.p.length === PART_KEYS.length && o.p.every((v, i) => Number.isInteger(v) && v >= 0 && v < PART_COUNTS[i]) ? o.p.slice() : d.p;
  const dk = Array.isArray(o.d) && o.d.length === DECK_SLOT_COUNT && o.d.every((v) => Number.isInteger(v) && v >= 0 && v < PROP_COUNT) ? o.d.slice() : d.d;
  return { n, c, u, p, d: dk };
}
