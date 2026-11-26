// Saved worlds/maps in this browser (localStorage), shared by the main menu and the map editor.
// Stored as { [name]: encoded map } under one key. Every access is guarded: storage can be
// missing or blocked (private windows, some embedded frames such as Discord activities).
// Per-world details for the world list (created, last played, a small screenshot) live apart,
// under META_KEY, so rewriting a save (digging, building) never loses them.

const KEY = 'settleon.maps';
const META_KEY = 'settleon.maps.meta';
// per-world player state kept under these prefixes + `save:<name>` (main.js inventory, vitals.js)
const PLAYER_KEYS = ['settleon.inv.', 'settleon.vitals.', 'settleon.player.'];

export function allSaves() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export const saveNames = () => Object.keys(allSaves()).sort((a, b) => a.localeCompare(b));
export const getSave = (name) => allSaves()[name] ?? null;

/** Returns false if the browser refused to store it. */
export function putSave(name, map) {
  const all = allSaves();
  const isNew = !(name in all);
  all[name] = map;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { return false; }
  if (isNew && !getMeta(name).created) setMeta(name, { created: Date.now() });
  return true;
}

export function deleteSave(name) {
  const all = allSaves();
  delete all[name];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  const meta = allMeta();
  delete meta[name];
  writeMeta(meta);
  for (const p of PLAYER_KEYS) { try { localStorage.removeItem(`${p}save:${name}`); } catch {} }
}

/** Rename a world (its map, details, inventory and health go with it). Returns an error message or null. */
export function renameSave(from, to) {
  to = String(to ?? '').trim().slice(0, 40);
  if (!to) return 'Give the world a name';
  if (to === from) return null;
  const all = allSaves();
  if (!(from in all)) return 'That world is gone';
  if (to in all) return 'A world with that name already exists';
  all[to] = { ...all[from], name: to };
  delete all[from];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { return "This browser won't store worlds here"; }
  const meta = allMeta();
  if (meta[from]) { meta[to] = meta[from]; delete meta[from]; writeMeta(meta); }
  for (const p of PLAYER_KEYS) {
    try {
      const v = localStorage.getItem(`${p}save:${from}`);
      if (v !== null) { localStorage.setItem(`${p}save:${to}`, v); localStorage.removeItem(`${p}save:${from}`); }
    } catch {}
  }
  return null;
}

/** A name not used by any saved world yet: `base`, `base (2)`, `base (3)`… */
export function freeName(base) {
  const all = allSaves();
  base = String(base).trim().slice(0, 34) || 'World';
  if (!(base in all)) return base;
  for (let i = 2; ; i++) if (!(`${base} (${i})` in all)) return `${base} (${i})`;
}

// ---------- world details: { created, played, thumb } ----------

function allMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
}
function writeMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); return true; } catch { return false; }
}
export const getMeta = (name) => allMeta()[name] ?? {};
/** Merge fields into a world's details (only for worlds that exist). */
export function setMeta(name, patch) {
  if (!(name in allSaves())) return false;
  const meta = allMeta();
  meta[name] = { ...meta[name], ...patch };
  return writeMeta(meta);
}

/** `<option>`s for a <select> of saved worlds (names are escaped). */
export function saveOptions(names = saveNames()) {
  return names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
