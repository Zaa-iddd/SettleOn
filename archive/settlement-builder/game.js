// SettleOn game rules. Shared by the server (authoritative) and the client
// (for previews and button states). Everything here is plain data + pure-ish
// functions on a JSON-serializable state object.

export const MAP_W = 18;
export const MAP_H = 12;
export const TICK_MS = 5000; // one production "season"
export const MATCH_MS = 12 * 60 * 1000;
export const WIN_RENOWN = 50;
export const TRADE_RATE = 3; // give 3 of one resource for 1 of another
export const TOWN_SPACING = 4; // min distance from other players' land for a new Town Hall
export const LAND_PER_RENOWN = 5; // every 5 owned tiles = 1 renown
export const MAX_PLAYERS = 8;

export const RESOURCES = ['wood', 'stone', 'food'];
export const START_RES = { wood: 6, stone: 2, food: 4 };

export const TERRAIN = {
  p: { name: 'Plains' },
  f: { name: 'Forest' },
  m: { name: 'Mountains' },
  w: { name: 'Lake' },
};

export const PLAYER_COLORS = [
  '#e8554e', '#3d8bfd', '#f2b632', '#a463f2',
  '#2bb5a3', '#f2795c', '#ec5fa8', '#e6e6e6',
];

// cost: base cost; scale: each one you already own raises the cost by this fraction.
export const BUILDINGS = {
  town: {
    name: 'Town Hall', terrain: ['p'], cost: {}, scale: 0,
    produces: { wood: 1, stone: 1, food: 1 }, renown: 0,
    desc: 'Your first building. Place it anywhere with room to grow.',
  },
  road: {
    name: 'Road', terrain: ['p', 'f'], cost: { wood: 1 }, scale: 0.1,
    produces: {}, renown: 0,
    desc: 'Cheap way to reach new land.',
  },
  farm: {
    name: 'Farm', terrain: ['p'], cost: { wood: 2 }, scale: 0.4,
    produces: { food: 1 }, renown: 0,
    desc: '+1 food. +1 more if next to a lake.',
  },
  mill: {
    name: 'Lumber Mill', terrain: ['f'], cost: { wood: 2, food: 1 }, scale: 0.4,
    produces: { wood: 1 }, renown: 0,
    desc: '+1 wood. Build on forest.',
  },
  quarry: {
    name: 'Quarry', terrain: ['m'], cost: { wood: 3, food: 1 }, scale: 0.4,
    produces: { stone: 1 }, renown: 0,
    desc: '+1 stone. Build on mountains.',
  },
  dock: {
    name: 'Fishing Dock', terrain: ['w'], cost: { wood: 3, stone: 1 }, scale: 0.45,
    produces: { food: 2 }, renown: 0,
    desc: '+2 food. Build on a lake.',
  },
  house: {
    name: 'House', terrain: ['p'], cost: { wood: 4, stone: 3, food: 4 }, scale: 0.35,
    produces: {}, renown: 2,
    desc: '+2 renown.',
  },
  monument: {
    name: 'Monument', terrain: ['p', 'm'], cost: { wood: 8, stone: 12, food: 8 }, scale: 0.6,
    produces: {}, renown: 8,
    desc: '+8 renown.',
  },
};

export const BUILD_ORDER = ['road', 'farm', 'mill', 'quarry', 'dock', 'house', 'monument'];

// ---------- helpers ----------

export const idx = (x, y) => y * MAP_W + x;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function neighbors(x, y) {
  return DIRS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => inBounds(nx, ny));
}

export function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateMap(seed) {
  const rand = rng(seed);
  const tiles = new Array(MAP_W * MAP_H).fill('p');
  const blob = (kind, size) => {
    const cells = [[Math.floor(rand() * MAP_W), Math.floor(rand() * MAP_H)]];
    tiles[idx(...cells[0])] = kind;
    let guard = 0;
    while (cells.length < size && guard++ < size * 20) {
      const [cx, cy] = cells[Math.floor(rand() * cells.length)];
      const opts = neighbors(cx, cy);
      const [nx, ny] = opts[Math.floor(rand() * opts.length)];
      if (tiles[idx(nx, ny)] === 'p') {
        tiles[idx(nx, ny)] = kind;
        cells.push([nx, ny]);
      }
    }
  };
  for (let i = 0; i < 7; i++) blob('f', 6 + Math.floor(rand() * 9));
  for (let i = 0; i < 5; i++) blob('m', 4 + Math.floor(rand() * 6));
  for (let i = 0; i < 4; i++) blob('w', 4 + Math.floor(rand() * 8));
  return tiles.join('');
}

// ---------- state ----------

export function createGame(seed = Math.floor(Math.random() * 2 ** 31)) {
  return {
    seed,
    tiles: generateMap(seed),
    cells: new Array(MAP_W * MAP_H).fill(null), // null | { t: buildingType, o: ownerId }
    players: {},
    phase: 'lobby', // lobby | playing | ended
    endsAt: null,
    winner: null,
    log: [],
  };
}

export function addPlayer(state, id, name) {
  if (state.players[id]) {
    state.players[id].name = name;
    return state.players[id];
  }
  if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
  const used = new Set(Object.values(state.players).map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  state.players[id] = { id, name, color, res: { ...START_RES }, counts: {} };
  return state.players[id];
}

export function hasTown(state, pid) {
  return (state.players[pid]?.counts.town ?? 0) > 0;
}

export function costFor(state, pid, type) {
  const b = BUILDINGS[type];
  const owned = state.players[pid]?.counts[type] ?? 0;
  const cost = {};
  for (const [r, v] of Object.entries(b.cost)) cost[r] = Math.ceil(v * (1 + b.scale * owned));
  return cost;
}

export function canAfford(res, cost) {
  return Object.entries(cost).every(([r, v]) => (res[r] ?? 0) >= v);
}

export function canBuild(state, pid, type, x, y) {
  const p = state.players[pid];
  const b = BUILDINGS[type];
  if (!p || !b) return { ok: false, reason: 'Unknown building' };
  if (state.phase === 'ended') return { ok: false, reason: 'The match is over' };
  if (!inBounds(x, y)) return { ok: false, reason: 'Off the map' };
  if (type !== 'town' && !hasTown(state, pid)) return { ok: false, reason: 'Place your Town Hall first' };
  const i = idx(x, y);
  if (state.cells[i]) return { ok: false, reason: 'Tile already taken' };
  if (!b.terrain.includes(state.tiles[i])) {
    return { ok: false, reason: `${b.name} can't go on ${TERRAIN[state.tiles[i]].name.toLowerCase()}` };
  }

  if (type === 'town') {
    if (hasTown(state, pid)) return { ok: false, reason: 'You already have a Town Hall' };
    for (let j = 0; j < state.cells.length; j++) {
      const c = state.cells[j];
      if (!c || c.o === pid) continue;
      const cx = j % MAP_W, cy = Math.floor(j / MAP_W);
      if (Math.abs(cx - x) + Math.abs(cy - y) < TOWN_SPACING) {
        return { ok: false, reason: 'Too close to another settlement' };
      }
    }
    return { ok: true };
  }

  if (state.phase !== 'playing') return { ok: false, reason: 'Wait for the match to start' };
  if (!neighbors(x, y).some(([nx, ny]) => state.cells[idx(nx, ny)]?.o === pid)) {
    return { ok: false, reason: 'Must be next to your land' };
  }
  if (!canAfford(p.res, costFor(state, pid, type))) return { ok: false, reason: 'Not enough resources' };
  return { ok: true };
}

export function build(state, pid, type, x, y) {
  const check = canBuild(state, pid, type, x, y);
  if (!check.ok) return check;
  const p = state.players[pid];
  for (const [r, v] of Object.entries(costFor(state, pid, type))) p.res[r] -= v;
  state.cells[idx(x, y)] = { t: type, o: pid };
  p.counts[type] = (p.counts[type] ?? 0) + 1;
  if (type === 'monument' || type === 'town') pushLog(state, `${p.name} built a ${BUILDINGS[type].name}`);
  checkWin(state);
  return { ok: true };
}

export function trade(state, pid, give, get) {
  const p = state.players[pid];
  if (!p || state.phase !== 'playing') return { ok: false, reason: 'Trading opens when the match starts' };
  if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) {
    return { ok: false, reason: 'Pick two different resources' };
  }
  if (p.res[give] < TRADE_RATE) return { ok: false, reason: `You need ${TRADE_RATE} ${give}` };
  p.res[give] -= TRADE_RATE;
  p.res[get] += 1;
  return { ok: true };
}

export function productionFor(state, pid) {
  const out = { wood: 0, stone: 0, food: 0 };
  state.cells.forEach((c, i) => {
    if (!c || c.o !== pid) return;
    for (const [r, v] of Object.entries(BUILDINGS[c.t].produces)) out[r] += v;
    if (c.t === 'farm') {
      const x = i % MAP_W, y = Math.floor(i / MAP_W);
      if (neighbors(x, y).some(([nx, ny]) => state.tiles[idx(nx, ny)] === 'w')) out.food += 1;
    }
  });
  return out;
}

export function landFor(state, pid) {
  return state.cells.reduce((n, c) => n + (c?.o === pid ? 1 : 0), 0);
}

export function renownFor(state, pid) {
  const p = state.players[pid];
  if (!p) return 0;
  let r = Math.floor(landFor(state, pid) / LAND_PER_RENOWN);
  for (const [t, n] of Object.entries(p.counts)) r += BUILDINGS[t].renown * n;
  return r;
}

export function standings(state) {
  return Object.values(state.players)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, renown: renownFor(state, p.id), land: landFor(state, p.id) }))
    .sort((a, b) => b.renown - a.renown || b.land - a.land);
}

export function startMatch(state, now) {
  if (state.phase !== 'lobby') return { ok: false, reason: 'Match already started' };
  if (!Object.keys(state.players).some((id) => hasTown(state, id))) {
    return { ok: false, reason: 'Someone needs to place a Town Hall first' };
  }
  state.phase = 'playing';
  state.endsAt = now + MATCH_MS;
  pushLog(state, 'The match has begun!');
  return { ok: true };
}

export function tick(state, now) {
  if (state.phase !== 'playing') return;
  for (const id of Object.keys(state.players)) {
    const prod = productionFor(state, id);
    for (const r of RESOURCES) state.players[id].res[r] += prod[r];
  }
  if (now >= state.endsAt) endMatch(state);
  else checkWin(state);
}

export function checkTimer(state, now) {
  if (state.phase === 'playing' && now >= state.endsAt) endMatch(state);
}

function checkWin(state) {
  if (state.phase !== 'playing') return;
  const top = standings(state)[0];
  if (top && top.renown >= WIN_RENOWN) endMatch(state);
}

function endMatch(state) {
  const top = standings(state)[0];
  state.phase = 'ended';
  state.winner = top?.id ?? null;
  pushLog(state, top ? `${top.name} wins with ${top.renown} renown!` : 'The match ended');
}

export function newMap(state) {
  const fresh = createGame();
  for (const p of Object.values(state.players)) {
    fresh.players[p.id] = { id: p.id, name: p.name, color: p.color, res: { ...START_RES }, counts: {} };
  }
  return fresh;
}

function pushLog(state, text) {
  state.log.push(text);
  if (state.log.length > 8) state.log.shift();
}
