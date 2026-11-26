// Health and hunger (client-only, not synced): two rows of 10 pixel-art icons above the hotbar,
// each icon worth 2 points (so halves show). Hunger drains slowly, faster when running or
// swimming; a full belly heals you, an empty one hurts. Falls from 2.5+ hurt a little. At 0
// health you faint and wake up at the campfire (main.js `faint`), keeping your things.
export const MAX_HP = 20, MAX_FOOD = 20;
const DRAIN = 1 / 72;        // hunger points a second standing still (a full bar lasts about 24 minutes)
const EFFORT = { idle: 1, walk: 1.4, run: 2.6, swim: 2.2, row: 1.6 };
const REGEN_FOOD = 16;       // at or above this much food, health comes back...
const REGEN_EVERY = 3;       // ...one point every 3 s...
const REGEN_COST = 0.4;      // ...for a little food each
const STARVE_EVERY = 5;      // with no food left, lose a point every 5 s
const SAVE_KEY = 'settleon.vitals.';

// 9x9 pixel icons: K outline, then fills; '.' is clear
const HEART = [
  '.KK...KK.',
  'KRRK.KRRK',
  'KRWRKRRRK',
  'KRRRRRRDK',
  'KRRRRRRDK',
  '.KRRRRDK.',
  '..KRRDK..',
  '...KRK...',
  '....K....',
];
const MEAT = [
  '....KKKK.',
  '...KMHMMK',
  '..KMHMMMK',
  '..KMMMMDK',
  '..KMMMDDK',
  '.KBKDDKK.',
  'KBBBKK...',
  'KBBK.....',
  '.KK......',
];
const FULL = { heart: { K: '#1b0f14', R: '#e8403f', W: '#ffd0c8', D: '#a8222e' }, meat: { K: '#1e120a', M: '#c8743a', H: '#f2b878', D: '#8a4a22', B: '#f4ead6' } };
const EMPTY = { K: '#14100f', fill: '#3b3036' };
const SCALE = 2;

function draw(grid, pal, full) { // full(x): is this column filled in (half icons fill one side)
  const cv = document.createElement('canvas');
  cv.width = cv.height = 9 * SCALE;
  const g = cv.getContext('2d');
  grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const empty = !full(x);
    g.fillStyle = ch === 'K' ? (empty ? EMPTY.K : pal.K) : empty ? EMPTY.fill : pal[ch];
    g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  }));
  return cv.toDataURL();
}
let ART = null;
function art() {
  ART ??= {
    heart: [draw(HEART, FULL.heart, () => false), draw(HEART, FULL.heart, (x) => x < 5), draw(HEART, FULL.heart, () => true)], // empty, half, full
    meat: [draw(MEAT, FULL.meat, () => false), draw(MEAT, FULL.meat, (x) => x >= 4), draw(MEAT, FULL.meat, () => true)], // hunger empties from the left
  };
  return ART;
}

export class Vitals {
  constructor({ el, hurtEl, onFaint }) {
    this.onFaint = onFaint;
    this.hurtEl = hurtEl;
    this.hp = MAX_HP;
    this.food = MAX_FOOD;
    this.regenT = 0;
    this.starveT = 0;
    this.key = null;
    this.dirty = false;
    this.saveT = 0;
    this.shown = '';
    el.innerHTML = '<div class="vit-row vit-hp"></div><div class="vit-row vit-food"></div>';
    this.rows = { heart: el.querySelector('.vit-hp'), meat: el.querySelector('.vit-food') };
    this.icons = {};
    for (const k of ['heart', 'meat']) {
      this.icons[k] = [];
      for (let i = 0; i < 10; i++) {
        const img = document.createElement('img');
        img.alt = '';
        this.rows[k].appendChild(img);
        this.icons[k].push(img);
      }
    }
    this.render(true);
  }

  /** Load this world's (or room's) health and hunger; a new world starts full. */
  load(key) {
    this.key = key;
    this.hp = MAX_HP;
    this.food = MAX_FOOD;
    this.regenT = this.starveT = 0;
    try {
      const v = key && JSON.parse(localStorage.getItem(SAVE_KEY + key));
      if (v && Number.isFinite(v.hp) && Number.isFinite(v.food)) {
        this.hp = Math.min(MAX_HP, Math.max(1, Math.round(v.hp)));
        this.food = Math.min(MAX_FOOD, Math.max(0, v.food));
      }
    } catch {}
    this.render(true);
  }
  save() {
    this.dirty = false;
    if (!this.key) return;
    try { localStorage.setItem(SAVE_KEY + this.key, JSON.stringify({ hp: this.hp, food: Math.round(this.food * 100) / 100 })); } catch {}
  }

  /** effort: 'idle' | 'walk' | 'run' | 'swim' | 'row'. Creative mode pauses everything. */
  update(dt, effort, creative) {
    if (!creative) {
      this.food = Math.max(0, this.food - DRAIN * (EFFORT[effort] ?? 1) * dt);
      if (this.food >= REGEN_FOOD && this.hp < MAX_HP) {
        if ((this.regenT += dt) >= REGEN_EVERY) { this.regenT = 0; this.hp++; this.food -= REGEN_COST; }
      } else this.regenT = 0;
      if (this.food <= 0) {
        if ((this.starveT += dt) >= STARVE_EVERY) { this.starveT = 0; this.hurt(1, 'hunger'); }
      } else this.starveT = 0;
      this.dirty = true;
    }
    if (this.dirty && (this.saveT += dt) > 3) { this.saveT = 0; this.save(); }
    this.render();
  }

  /** Lose n health (half hearts). At 0 you faint. */
  hurt(n, why) {
    if (n <= 0 || this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - n);
    this.dirty = true;
    this.flash();
    this.render();
    if (this.hp === 0) this.onFaint?.(why);
  }
  /** Eat something worth n food points; false when you're already full. */
  eat(n) {
    if (this.food >= MAX_FOOD - 0.5) return false;
    this.food = Math.min(MAX_FOOD, this.food + n);
    this.dirty = true;
    this.pop(this.rows.meat);
    this.render();
    return true;
  }
  /** Back on your feet after fainting: full health, at least half a belly. */
  revive() {
    this.hp = MAX_HP;
    this.food = Math.max(this.food, MAX_FOOD / 2);
    this.regenT = this.starveT = 0;
    this.save();
    this.render(true);
  }

  flash() {
    const h = this.hurtEl;
    h.classList.remove('on');
    void h.offsetWidth; // restart the animation
    h.classList.add('on');
    this.pop(this.rows.heart, 'shake');
  }
  pop(row, cls = 'pop') {
    row.classList.remove(cls);
    void row.offsetWidth;
    row.classList.add(cls);
  }

  render(force = false) {
    const food = Math.ceil(this.food - 1e-6);
    const sig = `${this.hp},${food}`;
    if (!force && sig === this.shown) return;
    this.shown = sig;
    const a = art();
    const fill = (k, v) => this.icons[k].forEach((img, i) => {
      const s = v >= 2 * i + 2 ? 2 : v === 2 * i + 1 ? 1 : 0;
      if (img.dataset.s !== String(s)) { img.dataset.s = s; img.src = a[k][s]; }
    });
    fill('heart', this.hp);
    fill('meat', food);
    this.rows.heart.classList.toggle('low', this.hp <= 4);
    this.rows.meat.classList.toggle('low', food <= 4);
  }
}
