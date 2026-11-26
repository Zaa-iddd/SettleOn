// Settings: a small list of options, remembered per browser (localStorage['settleon.settings']).
// The panel (#settings) opens from the title screen and from the pause menu. Each option is a
// Minecraft-style button ("Shadows: On") that cycles through its choices on click.
// main.js applies the values (`settings.v`) and gets told about changes through `onChange`.

import { esc } from './saves.js';

const KEY = 'settleon.settings';
const $ = (id) => document.getElementById(id);

/** [key, label, [[value, text]...]]; the first choice is the default. */
export const OPTIONS = [
  ['shadows', 'Shadows', [[true, 'On'], [false, 'Off']]],
  ['tilt', 'Tilt-shift blur', [[true, 'On'], [false, 'Off']]],
  ['pixel', 'Pixel size', [[0, 'Auto'], [3, 'Large'], [2, 'Small']]],
  ['minimap', 'Minimap', [[true, 'Shown'], [false, 'Hidden']]],
  ['labels', 'Name tags', [[true, 'Shown'], [false, 'Hidden']]],
  ['creative', 'Creative mode', [[false, 'Off'], [true, 'On']]],
];

export class Settings {
  /** @param {{ onChange: (key: string, value: any) => void, initial?: object }} opts */
  constructor({ onChange, initial = {} }) {
    this.onChange = onChange;
    this.v = Object.fromEntries(OPTIONS.map(([k, , ch]) => [k, ch[0][0]]));
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
    for (const [k, , ch] of OPTIONS) {
      const val = k in initial ? initial[k] : stored[k];
      if (ch.some((c) => c[0] === val)) this.v[k] = val;
    }
    this.onClose = null;
    $('settings-done').onclick = () => this.close();
  }

  get isOpen() { return !$('settings').hidden; }

  /** Open the panel; `onClose` runs when it's closed (Done or Esc). */
  open(onClose = null) {
    this.onClose = onClose;
    this.render();
    $('settings').hidden = false;
  }

  close() {
    if (!this.isOpen) return;
    $('settings').hidden = true;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  /** Set an option from code (e.g. the HUD's Creative button); stores it and tells main.js. */
  set(key, value) {
    this.v[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(this.v)); } catch {}
    this.onChange(key, value);
    if (this.isOpen) this.render();
  }

  render() {
    const box = $('settings-list');
    box.innerHTML = OPTIONS.map(([k, label, ch]) => {
      const cur = ch.find((c) => c[0] === this.v[k]) ?? ch[0];
      return `<button class="btn set-opt" data-k="${k}">${esc(label)}: <b>${esc(cur[1])}</b></button>`;
    }).join('');
    for (const b of box.querySelectorAll('.set-opt')) {
      b.onclick = () => {
        const [k, , ch] = OPTIONS.find((o) => o[0] === b.dataset.k);
        const i = ch.findIndex((c) => c[0] === this.v[k]);
        this.set(k, ch[(i + 1) % ch.length][0]);
      };
    }
  }
}
