import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { cleanLook } from '../src/shared/boatlook.js';
import { WORLD, WORLD_LIMIT, MAX_PLAYERS, PLAYER_COLORS, MAX_KIND, MAX_FURNITURE, MIN_LEVEL, cellKey, clockHour } from '../src/shared/world.js';
import { decodeMap, isEndlessMap, decodeEndless } from '../src/shared/mapfile.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ID = process.env.VITE_DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// Browser-only "dev mode" logins (no Discord). Off in production unless explicitly enabled.
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN
  ? process.env.ALLOW_DEV_LOGIN === 'true'
  : process.env.NODE_ENV !== 'production';
const SNAPSHOT_MS = 80; // ~12 position updates per second

const app = express();
app.use(express.json());

// The client gets an OAuth code from Discord and sends it here; we swap it for
// an access token using the client secret, which must never reach the browser.
app.post('/api/token', async (req, res) => {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'missing code' });
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'server is missing Discord credentials' });
  try {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(401).json({ error: data.error_description ?? 'token exchange failed' });
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('token exchange error', err);
    res.status(502).json({ error: 'could not reach Discord' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// In production, serve the built client from the same origin.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) app.use(express.static(dist));

const server = http.createServer(app);
const MAX_MAP_BYTES = 600_000; // an island map is ~35 KB of JSON; an endless save with many digs can be bigger
const MAX_ROOM_EDITS = 50_000; // player digging kept per room
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MAP_BYTES + 4096 });

// ---------- rooms ----------
// One room per Discord activity instance (everyone who launched the activity in the
// same voice channel shares an instanceId). Each room has its own seed: with no custom map it
// plays the endless world generated from that seed.

/**
 * @typedef {{ id: string, name: string, color: string, x: number, y: number, z: number, ry: number, a: number, conns: number }} Player
 * @type {Map<string, { seed: number, map: object|null, players: Map<string, Player>, sockets: Set<any>, dirty: boolean, emptySince: number|null }>}
 */
const rooms = new Map();

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = { seed: Math.floor(Math.random() * 2 ** 31), map: null, edits: new Map(), chops: new Map(), benches: new Map(), picks: new Map(), piles: new Map(), boats: new Map(), players: new Map(), sockets: new Set(), dirty: false, emptySince: null, clock: { h: 8, at: Date.now() } }; // clock: the room's time of day (a new room starts at 8:00)
    rooms.set(id, room);
  }
  return room;
}

const roster = (room) => [...room.players.values()].map(({ id, name, color }) => ({ id, name, color }));
const round2 = (v) => Math.round(v * 100) / 100;

function sendAll(room, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of room.sockets) if (ws.readyState === ws.OPEN) ws.send(msg);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.sockets.size === 0) {
      room.emptySince ??= now;
      if (now - room.emptySince > 30 * 60 * 1000) rooms.delete(id);
      continue;
    }
    room.emptySince = null;
    if (!room.dirty) continue;
    room.dirty = false;
    sendAll(room, {
      type: 'snap',
      p: [...room.players.values()].map((p) => (p.rb ? [p.id, round2(p.x), round2(p.y), round2(p.z), round2(p.ry), p.a, p.rb] : [p.id, round2(p.x), round2(p.y), round2(p.z), round2(p.ry), p.a])),
    });
  }
}, SNAPSHOT_MS);

async function discordUser(accessToken) {
  const r = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error('invalid Discord token');
  const u = await r.json();
  return { id: `d:${u.id}`, name: u.global_name || u.username };
}

const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Explorer';
const cleanRoom = (s) => String(s ?? '').replace(/[^\w-]/g, '').slice(0, 64);
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

wss.on('connection', (ws) => {
  let room = null;
  let player = null;
  let msgs = 0;
  const rate = setInterval(() => { msgs = 0; }, 1000);
  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
  const fail = (reason) => send({ type: 'error', message: reason });

  let lastMapAt = 0;
  ws.on('message', async (raw, isBinary) => {
    if (++msgs > 60) return; // simple flood guard
    // only map messages may be big
    if (raw.length > 4096 && !String(raw.subarray(0, 40)).includes('"type":"map"')) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'hello') {
      if (room) return;
      const roomId = cleanRoom(msg.room);
      if (!roomId) return fail('Missing room');
      let user;
      try {
        if (msg.accessToken) user = await discordUser(msg.accessToken);
        else if (ALLOW_DEV_LOGIN && msg.dev) user = { id: `dev:${cleanRoom(msg.dev.id)}`, name: cleanName(msg.dev.name) };
        else return fail('Not signed in');
      } catch {
        return fail('Discord sign-in failed');
      }
      const r = getRoom(roomId);
      let p = r.players.get(user.id);
      if (!p) {
        if (r.players.size >= MAX_PLAYERS) return fail('This island is full');
        const used = new Set([...r.players.values()].map((q) => q.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[r.players.size % PLAYER_COLORS.length];
        p = { id: user.id, name: cleanName(user.name), color, x: 0, y: -100, z: 0, ry: 0, a: 0, conns: 0 };
        r.players.set(user.id, p);
      }
      p.conns++;
      room = r;
      player = p;
      room.sockets.add(ws);
      send({ type: 'welcome', you: p.id, seed: room.seed, map: room.map, edits: [...room.edits.values()], chops: [...room.chops.values()], benches: [...room.benches.values()], picks: [...room.picks.values()], piles: [...room.piles.values()], boats: [...room.boats.values()], time: clockHour(room.clock.h, Date.now() - room.clock.at) });
      sendAll(room, { type: 'roster', players: roster(room) });
      room.dirty = true;
      return;
    }

    if (!room) return;
    // play a world in this room: an island map (from the map editor), a saved endless world, or a
    // new random endless world (map: null)
    if (msg.type === 'map') {
      const now = Date.now();
      if (now - lastMapAt < 3000) return fail('Wait a moment before loading another map');
      lastMapAt = now;
      if (msg.map === null) {
        room.map = null;
        room.seed = Math.floor(Math.random() * 2 ** 31);
      } else {
        try {
          if (isEndlessMap(msg.map)) msg.map = decodeEndless(msg.map);
          else decodeMap(msg.map);
        } catch (err) { return fail(`That map can't be loaded: ${err.message}`); }
        room.map = msg.map;
      }
      room.edits.clear(); // a new world starts undug, with all its trees
      room.chops.clear();
      room.benches.clear();
      room.piles.clear();
      room.boats.clear();
      room.picks.clear();
      sendAll(room, { type: 'map', map: room.map, seed: room.seed, by: player.name });
      return;
    }
    // a player dug a block: remember it for late joiners and tell everyone else
    if (msg.type === 'dig') {
      const lim = WORLD_LIMIT + WORLD;
      const { ix, iz, lvl, k, ulvl = -1, uk = 0 } = msg; // ulvl/uk: the ground under placed blocks (-1: none)
      if (![ix, iz, lvl, k, ulvl, uk].every(Number.isInteger) || Math.abs(ix) > lim || Math.abs(iz) > lim || lvl < MIN_LEVEL || lvl > 48 || k < 0 || k > MAX_KIND) return;
      if (ulvl > 48 || uk < 0 || uk > MAX_KIND) return;
      const key = cellKey(ix, iz);
      room.edits.delete(key);
      room.edits.set(key, ulvl >= 0 ? [ix, iz, lvl, k, ulvl, uk] : [ix, iz, lvl, k]);
      if (room.edits.size > MAX_ROOM_EDITS) room.edits.delete(room.edits.keys().next().value);
      const out = JSON.stringify({ type: 'dig', id: player.id, ix, iz, lvl, k, ulvl, uk });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a log pile on cell (ix, iz) changed: n logs (0 = gone), lying along x (r 0) or z (r 1)
    if (msg.type === 'pile') {
      const lim = WORLD_LIMIT + WORLD, { ix, iz, r, n } = msg;
      if (![ix, iz, r, n].every(Number.isInteger) || Math.abs(ix) > lim || Math.abs(iz) > lim || r < 0 || r > 1 || n < 0 || n > 6) return;
      if (n) room.piles.set(cellKey(ix, iz), [ix, iz, r, n]); else room.piles.delete(cellKey(ix, iz));
      if (room.piles.size > MAX_ROOM_EDITS) room.piles.delete(room.piles.keys().next().value);
      const out = JSON.stringify({ type: 'pile', id: player.id, ix, iz, r, n });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a player set the time of day (the slider): it's the room's clock, so everyone gets it
    if (msg.type === 'time') {
      const h = Number(msg.h);
      if (!Number.isFinite(h) || h < 0 || h > 24) return;
      room.clock = { h: h % 24, at: Date.now() };
      const out = JSON.stringify({ type: 'time', id: player.id, by: player.name, h: h % 24 });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a boat was launched or moved (on), or taken out of the water (on false). Kept per room.
    if (msg.type === 'boat') {
      const lim = WORLD_LIMIT + WORLD, id = msg.id;
      const x = num(msg.x, -lim, lim), z = num(msg.z, -lim, lim), yaw = num(msg.yaw, -100, 100);
      if (!Number.isInteger(id) || id <= 0 || id >= 2 ** 31 || x === null || z === null || yaw === null) return;
      if (msg.on) {
        if (!room.boats.has(id) && room.boats.size >= 200) return;
        // a launch carries the boat's look; moves keep the one it has
        const look = msg.look ? cleanLook(msg.look) : room.boats.get(id)?.[4] ?? cleanLook(null);
        room.boats.set(id, [id, round2(x), round2(z), Math.round(yaw * 1000) / 1000, look]);
      } else room.boats.delete(id);
      const out = JSON.stringify({ type: 'boat', by: player.id, id, x, z, yaw, on: !!msg.on, ...(msg.on && msg.look ? { look: room.boats.get(id)[4] } : {}) });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a boat was repainted, renamed or upgraded: keep its look and tell everyone else
    if (msg.type === 'boatlook') {
      const b = room.boats.get(msg.id);
      if (!b) return;
      b[4] = cleanLook(msg.look);
      const out = JSON.stringify({ type: 'boatlook', by: player.id, id: msg.id, look: b[4] });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a player put down (on) or picked up a piece of furniture (type t, see FURNITURE) on cell (ix, iz), facing r (0..3)
    if (msg.type === 'bench') {
      const lim = WORLD_LIMIT + WORLD, { ix, iz, on } = msg, r = msg.r | 0, t = msg.t | 0;
      if (![ix, iz].every(Number.isInteger) || Math.abs(ix) > lim || Math.abs(iz) > lim || r < 0 || r > 3 || t < 0 || t > MAX_FURNITURE) return;
      if (on) room.benches.set(cellKey(ix, iz), [ix, iz, r, t]); else room.benches.delete(cellKey(ix, iz));
      if (room.benches.size > MAX_ROOM_EDITS) room.benches.delete(room.benches.keys().next().value);
      const out = JSON.stringify({ type: 'bench', id: player.id, ix, iz, r, t, on: !!on });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a player broke a bush (t 0), picked its berries (1) or picked up a pebble (2) on cell (ix, iz)
    if (msg.type === 'pick') {
      const lim = WORLD_LIMIT + WORLD, { ix, iz, t } = msg;
      if (![ix, iz, t].every(Number.isInteger) || Math.abs(ix) > lim || Math.abs(iz) > lim || t < 0 || t > 2) return;
      room.picks.set(cellKey(ix, iz) * 4 + t, [ix, iz, t]);
      if (room.picks.size > MAX_ROOM_EDITS) room.picks.delete(room.picks.keys().next().value);
      const out = JSON.stringify({ type: 'pick', id: player.id, ix, iz, t });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    // a player chopped down the tree growing from cell (ix, iz)
    if (msg.type === 'chop') {
      const lim = WORLD_LIMIT + WORLD, { ix, iz } = msg;
      if (![ix, iz].every(Number.isInteger) || Math.abs(ix) > lim || Math.abs(iz) > lim) return;
      room.chops.set(cellKey(ix, iz), [ix, iz]);
      if (room.chops.size > MAX_ROOM_EDITS) room.chops.delete(room.chops.keys().next().value);
      const out = JSON.stringify({ type: 'chop', id: player.id, ix, iz });
      for (const s of room.sockets) if (s !== ws && s.readyState === s.OPEN) s.send(out);
      return;
    }
    if (msg.type === 'move') {
      const lim = WORLD_LIMIT + WORLD; // endless worlds reach out to the world border
      const x = num(msg.x, -lim, lim), y = num(msg.y, -10, 50), z = num(msg.z, -lim, lim), ry = num(msg.ry, -1e4, 1e4);
      if (x === null || y === null || z === null || ry === null) return;
      Object.assign(player, { x, y, z, ry, a: Math.min(299, Math.max(0, msg.a | 0)) }); // a = anim + 10 × tool (tools 0..29)
      // riding a boat: [boat id, deck x, deck z], so others draw them glued to the deck
      const rb = msg.b;
      player.rb = Array.isArray(rb) && rb.length === 3 && Number.isInteger(rb[0]) && Math.abs(rb[1]) < 5 && Math.abs(rb[2]) < 5 ? [rb[0], round2(rb[1]), round2(rb[2])] : null;
      room.dirty = true;
    }
  });

  ws.on('close', () => {
    clearInterval(rate);
    if (!room) return;
    room.sockets.delete(ws);
    if (--player.conns <= 0) {
      room.players.delete(player.id);
      sendAll(room, { type: 'roster', players: roster(room) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`SettleOn server on http://localhost:${PORT}`);
  if (!CLIENT_ID || !CLIENT_SECRET) console.log('  (Discord credentials not set: only browser dev mode will work)');
});
