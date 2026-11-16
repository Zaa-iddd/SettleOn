// Saved worlds/maps in this browser (localStorage), shared by the main menu and the map editor.
// Stored as { [name]: encoded map } under one key. Every access is guarded: storage can be
// missing or blocked (private windows, some embedded frames such as Discord activities).

const KEY = 'settleon.maps';

export function allSaves() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

export const saveNames = () => Object.keys(allSaves()).sort((a, b) => a.localeCompare(b));
export const getSave = (name) => allSaves()[name] ?? null;

/** Returns false if the browser refused to store it. */
export function putSave(name, map) {
  const all = allSaves();
  all[name] = map;
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; } catch { return false; }
}

export function deleteSave(name) {
  const all = allSaves();
  delete all[name];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}

/** `<option>`s for a <select> of saved worlds (names are escaped). */
export function saveOptions(names = saveNames()) {
  return names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
