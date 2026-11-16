import {
  BUILDINGS, BUILD_ORDER, RESOURCES, TERRAIN, TRADE_RATE, WIN_RENOWN, TICK_MS,
  idx, costFor, canAfford, canBuild, hasTown, productionFor, renownFor, standings,
} from '../shared/game.js';
import { identify } from './discord.js';
import { Board3D } from './board3d.js';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';

const $ = (id) => document.getElementById(id);
const RES_ICON = { wood: '🪵', stone: '🪨', food: '🌾' };

const ui = {
  state: null,
  online: [],
  me: null,
  selected: null, // building type
  hover: null,
  clockOffset: 0,
};

let socket;
let identity;
const board = new Board3D($('board'));
board.ui = ui;

// ---------- networking ----------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', room: identity.room, ...identity.hello }));
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'welcome') {
      ui.me = msg.you;
      $('loading').hidden = true;
    } else if (msg.type === 'state') {
      ui.state = msg.state;
      ui.online = msg.online;
      ui.clockOffset = msg.now - Date.now();
      onState();
    } else if (msg.type === 'error') {
      toast(msg.message);
    }
  };
  socket.onclose = () => {
    $('loading').hidden = false;
    $('loading').textContent = 'Reconnecting…';
    setTimeout(connect, 1500);
  };
}

const send = (obj) => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(obj));

// ---------- state -> UI ----------

function onState() {
  const { state, me } = ui;
  if (!state || !me) return;
  // Steer new players to the Town Hall; drop selections that no longer make sense.
  if (!hasTown(state, me) && state.phase !== 'ended') ui.selected = 'town';
  else if (ui.selected === 'town') ui.selected = null;
  board.setState(state);
  renderAll();
}

function renderAll() {
  renderHud();
  renderPalette();
  renderMarket();
  renderPlayers();
  renderOverlay();
  renderTileInfo();
}

function renderHud() {
  const { state, me } = ui;
  const p = state.players[me];
  const prod = productionFor(state, me);
  $('resources').innerHTML = RESOURCES.map((r) => `
    <span class="res" title="${r}">${RES_ICON[r]} <b>${p.res[r]}</b><small>+${prod[r]}</small></span>
  `).join('') + `<span class="res" title="Renown (first to ${WIN_RENOWN} wins)">⭐ <b>${renownFor(state, me)}</b><small>/${WIN_RENOWN}</small></span>`;
  updateClock();
}

function updateClock() {
  const { state } = ui;
  if (!state) return;
  let text = '';
  if (state.phase === 'lobby') text = 'Lobby';
  else if (state.phase === 'ended') text = 'Match over';
  else {
    const left = Math.max(0, state.endsAt - (Date.now() + ui.clockOffset));
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    text = `⏳ ${m}:${String(s).padStart(2, '0')}`;
  }
  $('status').textContent = text;
}

function costText(cost) {
  const parts = Object.entries(cost).map(([r, v]) => `${v}${RES_ICON[r]}`);
  return parts.length ? parts.join(' ') : 'Free';
}

function renderPalette() {
  const { state, me } = ui;
  const types = hasTown(state, me) ? BUILD_ORDER : ['town'];
  const res = state.players[me].res;
  $('palette').innerHTML = '';
  for (const type of types) {
    const b = BUILDINGS[type];
    const cost = costFor(state, me, type);
    const btn = document.createElement('button');
    btn.className = 'build' + (ui.selected === type ? ' selected' : '');
    btn.disabled = state.phase === 'ended' || (type !== 'town' && (state.phase !== 'playing' || !canAfford(res, cost)));
    btn.title = b.desc;
    const src = board.icon(type, state.players[me].color, b.terrain[0]);
    const icon = document.createElement('canvas');
    icon.width = src.width;
    icon.height = src.height;
    icon.getContext('2d').drawImage(src, 0, 0);
    btn.append(icon);
    const label = document.createElement('span');
    label.innerHTML = `<b>${b.name}</b><small>${costText(cost)}</small><small class="desc">${b.desc}</small>`;
    btn.append(label);
    btn.onclick = () => {
      ui.selected = ui.selected === type ? null : type;
      renderPalette();
      renderTileInfo();
    };
    $('palette').append(btn);
  }
}

function renderMarket() {
  const el = $('market');
  if (el.dataset.ready) {
    el.querySelector('button').disabled = ui.state.phase !== 'playing';
    return;
  }
  el.dataset.ready = '1';
  const opts = (sel) => RESOURCES.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${RES_ICON[r]} ${r}</option>`).join('');
  el.innerHTML = `
    <div class="trade">
      <span>Give ${TRADE_RATE}</span><select id="give">${opts('wood')}</select>
      <span>for 1</span><select id="get">${opts('stone')}</select>
      <button id="trade-btn">Trade</button>
    </div>`;
  $('trade-btn').onclick = () => send({ type: 'trade', give: $('give').value, get: $('get').value });
  el.querySelector('button').disabled = ui.state.phase !== 'playing';
}

function renderPlayers() {
  const { state, online, me } = ui;
  $('players').innerHTML = standings(state).map((s) => `
    <li class="${online.includes(s.id) ? '' : 'offline'}">
      <i style="background:${s.color}"></i>
      <span class="name">${esc(s.name)}${s.id === me ? ' (you)' : ''}</span>
      <span class="score">⭐ ${s.renown}</span>
    </li>`).join('');
  $('log').innerHTML = [...state.log].reverse().map((l) => `<li>${esc(l)}</li>`).join('');
}

function renderOverlay() {
  const { state, me } = ui;
  const el = $('overlay');
  if (state.phase === 'playing') { el.hidden = true; return; }
  el.hidden = false;
  if (state.phase === 'lobby') {
    const ready = Object.keys(state.players).filter((id) => hasTown(state, id)).length;
    el.innerHTML = `
      <div class="card">
        <h1>Welcome to SettleOn</h1>
        <p>${hasTown(state, me)
          ? 'Your Town Hall is placed. Start when everyone is ready.'
          : 'Click a highlighted tile on the map to place your <b>Town Hall</b>.'}</p>
        <p class="muted">Grow your settlement and earn ⭐ renown from houses, monuments and land.
          First to ${WIN_RENOWN} renown wins. Resources arrive every ${TICK_MS / 1000}s.</p>
        <button id="start" ${hasTown(state, me) ? '' : 'disabled'}>Start match (${ready} ready)</button>
      </div>`;
    el.classList.add('peek');
    $('start').onclick = () => send({ type: 'start' });
  } else {
    el.classList.remove('peek');
    const top = standings(state);
    const winner = state.players[state.winner];
    el.innerHTML = `
      <div class="card">
        <h1>${winner ? `${esc(winner.name)} wins!` : 'Match over'}</h1>
        <ol class="final">${top.map((s) => `<li><i style="background:${s.color}"></i>${esc(s.name)} <span>⭐ ${s.renown}</span></li>`).join('')}</ol>
        <button id="again">New map</button>
      </div>`;
    $('again').onclick = () => send({ type: 'newMap' });
  }
}

function renderTileInfo() {
  const { state, me, hover, selected } = ui;
  const el = $('tile-info');
  if (!state || !hover) { el.hidden = true; return; }
  const i = idx(hover.x, hover.y);
  const cell = state.cells[i];
  let html = `<b>${TERRAIN[state.tiles[i]].name}</b>`;
  if (cell) html += ` · ${BUILDINGS[cell.t].name} (${esc(state.players[cell.o]?.name ?? '?')})`;
  if (selected && !cell) {
    const check = canBuild(state, me, selected, hover.x, hover.y);
    html += check.ok ? ` · <span class="ok">Click to build ${BUILDINGS[selected].name}</span>` : ` · <span class="bad">${check.reason}</span>`;
  }
  el.innerHTML = html;
  el.hidden = false;
}

// ---------- input ----------
// Click/tap builds; dragging pans; wheel or +/- zooms; Q/E or the arrow buttons rotate.

const canvas = board.canvas;
let drag = null; // { x, y, lastX, lastY, moved }

function tileAt(e) {
  const rect = canvas.getBoundingClientRect();
  return board.pick(e.clientX - rect.left, e.clientY - rect.top);
}

function setHover(t) {
  if (t?.x === ui.hover?.x && t?.y === ui.hover?.y) return;
  ui.hover = t;
  renderTileInfo();
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
  setHover(tileAt(e));
});
canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    if (drag.moved) {
      board.pan(e.clientX - drag.lastX, e.clientY - drag.lastY);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      return;
    }
  }
  setHover(tileAt(e));
});
canvas.addEventListener('pointerup', (e) => {
  const wasClick = drag && !drag.moved;
  drag = null;
  if (!wasClick) return;
  const t = tileAt(e);
  setHover(t);
  if (!t || !ui.selected || !ui.state) return;
  const check = canBuild(ui.state, ui.me, ui.selected, t.x, t.y);
  if (!check.ok) return toast(check.reason);
  send({ type: 'build', building: ui.selected, x: t.x, y: t.y });
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  board.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.querySelectorAll('#cam-controls button').forEach((btn) => {
  btn.onclick = () => {
    const a = btn.dataset.cam;
    if (a === 'left') board.rotate(-1);
    else if (a === 'right') board.rotate(1);
    else if (a === 'in') board.zoomBy(1.25);
    else if (a === 'out') board.zoomBy(1 / 1.25);
  };
});

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('select, input')) return;
  if (e.key === 'Escape') { ui.selected = null; if (ui.state) renderAll(); }
  else if (e.key === 'q' || e.key === 'Q') board.rotate(-1);
  else if (e.key === 'e' || e.key === 'E') board.rotate(1);
});
window.addEventListener('resize', () => board.resize());

// ---------- misc ----------

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

setInterval(updateClock, 500);

// ---------- boot ----------

(async () => {
  board.resize();
  try {
    identity = await identify();
  } catch (err) {
    console.error(err);
    $('loading').textContent = `Couldn't sign in with Discord: ${err.message ?? err}`;
    return;
  }
  connect();
})();
