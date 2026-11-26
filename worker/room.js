// One multiplayer room = one PartyKit server (a Cloudflare Durable Object).
// Every Discord activity instance (everyone who launched the activity in the same voice channel)
// gets its own room, addressed as /parties/room/<instanceId>. Each room has its own seed: with no
// custom map it plays the endless world generated from that seed.
//
// The room's world (seed, map, clock, digging, chopped trees, furniture, picks, log piles, boats)
// is kept in memory and written through to the Durable Object's SQLite storage, so a deploy or a
// Cloudflare restart doesn't swap everyone onto a new world. Player positions are only in memory.
// 30 minutes after the last player leaves, the room's storage is wiped (a cleanup alarm).

import { Server } from 'partyserver';
import { cleanLook } from '../src/shared/boatlook.js';
import { WORLD, WORLD_LIMIT, MAX_PLAYERS, PLAYER_COLORS, MAX_KIND, MAX_FURNITURE, MIN_LEVEL, cellKey, clockHour } from '../src/shared/world.js';
import { decodeMap, isEndlessMap, decodeEndless } from '../src/shared/mapfile.js';

const SNAPSHOT_MS = 80; // ~12 position updates per second
const BOAT_FLUSH_MS = 5000; // boat moves are saved at most this often
const EMPTY_TTL_MS = 30 * 60 * 1000; // an empty room is forgotten after this long
const MAX_MSG = 4096; // only map messages may be bigger
const MSGS_PER_SEC = 60; // simple flood guard
const LIM = WORLD_LIMIT + WORLD; // endless worlds reach out to the world border
// What the room remembers for late joiners, and how many of each (oldest dropped first; boats refuse).
const LIMITS = { edits: 50_000, chops: 50_000, benches: 50_000, picks: 50_000, piles: 50_000, boats: 200 };

const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const round2 = (v) => Math.round(v * 100) / 100;
const num = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Explorer';
const cleanId = (s) => String(s ?? '').replace(/[^\w-]/g, '').slice(0, 64);
const inLim = (ix, iz) => Math.abs(ix) <= LIM && Math.abs(iz) <= LIM;
const decoder = new TextDecoder();

async function discordUser(accessToken) {
  const r = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('invalid Discord token');
  const u = await r.json();
  return { id: `d:${u.id}`, name: u.global_name || u.username };
}

export class Room extends Server {
  // Keep the object awake while people are connected: the snapshot timer needs it.
  static options = { hibernate: false };

  /** @type {Map<string, { id: string, name: string, color: string, x: number, y: number, z: number, ry: number, a: number, rb?: number[]|null, conns: number }>} */
  players = new Map();
  /** connection id -> { conn, player, msgs, windowAt, lastMapAt, authing, closed, local } */
  conns = new Map();
  dirty = false;
  timer = null;
  boatsDirty = new Set();
  boatsFlushedAt = 0;
  loaded = false;

  onStart() {
    this.load();
  }

  // ---------- storage ----------

  load() {
    this.sql`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`;
    // rowid order = insertion order (INSERT OR REPLACE moves a row to the end), like a JS Map
    this.sql`CREATE TABLE IF NOT EXISTS items (kind TEXT NOT NULL, key TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (kind, key))`;
    const meta = Object.fromEntries(this.sql`SELECT k, v FROM meta`.map((r) => [r.k, JSON.parse(r.v)]));
    this.seed = Number.isInteger(meta.seed) ? meta.seed : newSeed();
    this.map = meta.map ?? null;
    this.clock = meta.clock ?? { h: 8, at: Date.now() }; // a new room starts at 8:00
    if (!Number.isInteger(meta.seed)) { this.saveMeta('seed', this.seed); this.saveMeta('clock', this.clock); }
    this.items = Object.fromEntries(Object.keys(LIMITS).map((k) => [k, new Map()]));
    for (const r of this.sql`SELECT kind, key, v FROM items ORDER BY rowid`) {
      this.items[r.kind]?.set(Number(r.key), JSON.parse(r.v));
    }
    this.loaded = true;
  }

  saveMeta(k, v) {
    const s = JSON.stringify(v);
    this.sql`INSERT OR REPLACE INTO meta (k, v) VALUES (${k}, ${s})`;
  }

  /** Remember a world change (in memory and in storage). Returns false if the room is full of them. */
  put(kind, key, value, persist = true) {
    const m = this.items[kind];
    if (!m.has(key) && m.size >= LIMITS[kind]) {
      if (kind === 'boats') return false;
      this.del(kind, m.keys().next().value);
    }
    m.delete(key); // re-inserting moves it to the end, like the old server
    m.set(key, value);
    if (persist) {
      const k = String(key), v = JSON.stringify(value);
      this.sql`INSERT OR REPLACE INTO items (kind, key, v) VALUES (${kind}, ${k}, ${v})`;
    }
    return true;
  }

  del(kind, key) {
    this.items[kind].delete(key);
    if (kind === 'boats') this.boatsDirty.delete(key);
    const k = String(key);
    this.sql`DELETE FROM items WHERE kind = ${kind} AND key = ${k}`;
  }

  flushBoats() {
    for (const id of this.boatsDirty) {
      const b = this.items.boats.get(id);
      if (b) { const k = String(id), v = JSON.stringify(b); this.sql`INSERT OR REPLACE INTO items (kind, key, v) VALUES ('boats', ${k}, ${v})`; }
    }
    this.boatsDirty.clear();
    this.boatsFlushedAt = Date.now();
  }

  // ---------- sending ----------

  roster() {
    return [...this.players.values()].map(({ id, name, color }) => ({ id, name, color }));
  }

  /** Send to everyone who has joined (said hello), except one connection. */
  sendAll(obj, except = null) {
    const msg = JSON.stringify(obj);
    for (const c of this.conns.values()) {
      if (c.player && c.conn !== except) {
        try { c.conn.send(msg); } catch {}
      }
    }
  }

  tick() {
    if (!this.dirty) return;
    this.dirty = false;
    this.sendAll({
      type: 'snap',
      p: [...this.players.values()].map((p) => (p.rb ? [p.id, round2(p.x), round2(p.y), round2(p.z), round2(p.ry), p.a, p.rb] : [p.id, round2(p.x), round2(p.y), round2(p.z), round2(p.ry), p.a])),
    });
    if (this.boatsDirty.size && Date.now() - this.boatsFlushedAt > BOAT_FLUSH_MS) this.flushBoats();
  }

  // ---------- connections ----------

  async onConnect(conn, ctx) {
    if (!this.loaded) this.load();
    await this.ctx.storage.deleteAlarm(); // someone's here: don't forget the room
    // Browser-only "dev mode" logins (no Discord): on when ALLOW_DEV_LOGIN is "true", or by default
    // when the request comes from localhost (local development). Off on the deployed Worker.
    const host = new URL(ctx.request.url).hostname;
    const flag = this.env.ALLOW_DEV_LOGIN;
    const devLogin = flag ? flag === 'true' : host === 'localhost' || host === '127.0.0.1';
    this.conns.set(conn.id, { conn, player: null, msgs: 0, windowAt: 0, lastMapAt: 0, authing: false, closed: false, devLogin });
    this.timer ??= setInterval(() => this.tick(), SNAPSHOT_MS);
  }

  async onMessage(conn, raw) {
    const c = this.conns.get(conn.id);
    if (!c) return;
    const now = Date.now();
    if (now - c.windowAt >= 1000) { c.windowAt = now; c.msgs = 0; }
    if (++c.msgs > MSGS_PER_SEC) return;
    const text = typeof raw === 'string' ? raw : decoder.decode(raw);
    if (text.length > MAX_MSG && !text.slice(0, 40).includes('"type":"map"')) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const fail = (message) => { try { conn.send(JSON.stringify({ type: 'error', message })); } catch {} };

    if (msg.type === 'hello') return this.hello(c, msg, fail);

    const player = c.player;
    if (!player) return;

    switch (msg.type) {
      // play a world in this room: an island map (from the map editor), a saved endless world, or a
      // new random endless world (map: null)
      case 'map': {
        if (now - c.lastMapAt < 3000) return fail('Wait a moment before loading another map');
        c.lastMapAt = now;
        if (msg.map === null) {
          this.map = null;
          this.seed = newSeed();
        } else {
          try {
            if (isEndlessMap(msg.map)) msg.map = decodeEndless(msg.map);
            else decodeMap(msg.map);
          } catch (err) { return fail(`That map can't be loaded: ${err.message}`); }
          this.map = msg.map;
        }
        // a new world starts undug, with all its trees
        for (const m of Object.values(this.items)) m.clear();
        this.boatsDirty.clear();
        this.sql`DELETE FROM items`;
        this.saveMeta('seed', this.seed);
        this.saveMeta('map', this.map);
        this.sendAll({ type: 'map', map: this.map, seed: this.seed, by: player.name });
        return;
      }
      // a player dug or placed a block: remember it for late joiners and tell everyone else
      case 'dig': {
        const { ix, iz, lvl, k, ulvl = -1, uk = 0 } = msg; // ulvl/uk: the ground under placed blocks (-1: none)
        if (![ix, iz, lvl, k, ulvl, uk].every(Number.isInteger) || !inLim(ix, iz) || lvl < MIN_LEVEL || lvl > 48 || k < 0 || k > MAX_KIND) return;
        if (ulvl > 48 || uk < 0 || uk > MAX_KIND) return;
        this.put('edits', cellKey(ix, iz), ulvl >= 0 ? [ix, iz, lvl, k, ulvl, uk] : [ix, iz, lvl, k]);
        this.sendAll({ type: 'dig', id: player.id, ix, iz, lvl, k, ulvl, uk }, conn);
        return;
      }
      // a log pile on cell (ix, iz) changed: n logs (0 = gone), lying along x (r 0) or z (r 1)
      case 'pile': {
        const { ix, iz, r, n } = msg;
        if (![ix, iz, r, n].every(Number.isInteger) || !inLim(ix, iz) || r < 0 || r > 1 || n < 0 || n > 6) return;
        if (n) this.put('piles', cellKey(ix, iz), [ix, iz, r, n]); else this.del('piles', cellKey(ix, iz));
        this.sendAll({ type: 'pile', id: player.id, ix, iz, r, n }, conn);
        return;
      }
      // a player set the time of day (the slider): it's the room's clock, so everyone gets it
      case 'time': {
        const h = Number(msg.h);
        if (!Number.isFinite(h) || h < 0 || h > 24) return;
        this.clock = { h: h % 24, at: now };
        this.saveMeta('clock', this.clock);
        this.sendAll({ type: 'time', id: player.id, by: player.name, h: h % 24 }, conn);
        return;
      }
      // a boat was launched or moved (on), or taken out of the water (on false)
      case 'boat': {
        const id = msg.id;
        const x = num(msg.x, -LIM, LIM), z = num(msg.z, -LIM, LIM), yaw = num(msg.yaw, -100, 100);
        if (!Number.isInteger(id) || id <= 0 || id >= 2 ** 31 || x === null || z === null || yaw === null) return;
        if (msg.on) {
          const had = this.items.boats.get(id);
          // a launch carries the boat's look; moves keep the one it has
          const look = msg.look ? cleanLook(msg.look) : had?.[4] ?? cleanLook(null);
          const entry = [id, round2(x), round2(z), Math.round(yaw * 1000) / 1000, look];
          if (had && !msg.look) { this.put('boats', id, entry, false); this.boatsDirty.add(id); } // a move: saved later
          else if (!this.put('boats', id, entry)) return;
        } else this.del('boats', id);
        // t: the driver's clock (ms); h, l: its heel and bow lift. Relayed so others replay the path and tilt smoothly.
        const ts = num(msg.t, 0, 1e13), heel = num(msg.h, -1, 1), lean = num(msg.l, -1, 1);
        // g, r: the driver's throttle notch (−1…3) and rudder (−1…1), so the pirate ship's sails furl, fill and swing alike
        const gear = num(msg.g, -1, 3), rud = num(msg.r, -1, 1);
        this.sendAll({ type: 'boat', by: player.id, id, x, z, yaw, on: !!msg.on, ...(ts !== null ? { t: ts } : {}), ...(heel !== null && lean !== null ? { h: heel, l: lean } : {}), ...(gear !== null ? { g: Math.round(gear), r: rud ?? 0 } : {}), ...(msg.on && msg.look ? { look: this.items.boats.get(id)[4] } : {}) }, conn);
        return;
      }
      // a boat was repainted, renamed or upgraded: keep its look and tell everyone else
      case 'boatlook': {
        const b = this.items.boats.get(msg.id);
        if (!b) return;
        b[4] = cleanLook(msg.look);
        this.put('boats', msg.id, b);
        this.sendAll({ type: 'boatlook', by: player.id, id: msg.id, look: b[4] }, conn);
        return;
      }
      // a player put down (on) or picked up a piece of furniture (type t, see FURNITURE) on cell (ix, iz), facing r (0..3)
      case 'bench': {
        const { ix, iz, on } = msg, r = msg.r | 0, t = msg.t | 0;
        if (![ix, iz].every(Number.isInteger) || !inLim(ix, iz) || r < 0 || r > 3 || t < 0 || t > MAX_FURNITURE) return;
        if (on) this.put('benches', cellKey(ix, iz), [ix, iz, r, t]); else this.del('benches', cellKey(ix, iz));
        this.sendAll({ type: 'bench', id: player.id, ix, iz, r, t, on: !!on }, conn);
        return;
      }
      // a player broke a bush (t 0), picked its berries (1), picked up a pebble (2) or mined a rock (3) on cell (ix, iz)
      case 'pick': {
        const { ix, iz, t } = msg;
        if (![ix, iz, t].every(Number.isInteger) || !inLim(ix, iz) || t < 0 || t > 3) return;
        this.put('picks', cellKey(ix, iz) * 4 + t, [ix, iz, t]);
        this.sendAll({ type: 'pick', id: player.id, ix, iz, t }, conn);
        return;
      }
      // a player chopped down the tree growing from cell (ix, iz)
      case 'chop': {
        const { ix, iz } = msg;
        if (![ix, iz].every(Number.isInteger) || !inLim(ix, iz)) return;
        this.put('chops', cellKey(ix, iz), [ix, iz]);
        this.sendAll({ type: 'chop', id: player.id, ix, iz }, conn);
        return;
      }
      case 'move': {
        const x = num(msg.x, -LIM, LIM), y = num(msg.y, -10, 50), z = num(msg.z, -LIM, LIM), ry = num(msg.ry, -1e4, 1e4);
        if (x === null || y === null || z === null || ry === null) return;
        Object.assign(player, { x, y, z, ry, a: Math.min(299, Math.max(0, msg.a | 0)) }); // a = anim + 10 × tool (tools 0..29)
        // riding a boat: [boat id, deck x, deck z], so others draw them glued to the deck
        const rb = msg.b;
        player.rb = Array.isArray(rb) && rb.length === 3 && Number.isInteger(rb[0]) && Math.abs(rb[1]) < 5 && Math.abs(rb[2]) < 5 ? [rb[0], round2(rb[1]), round2(rb[2])] : null;
        this.dirty = true;
      }
    }
  }

  async hello(c, msg, fail) {
    if (c.player || c.authing) return;
    c.authing = true;
    let user;
    try {
      if (msg.accessToken) user = await discordUser(String(msg.accessToken));
      else if (c.devLogin && msg.dev) user = { id: `dev:${cleanId(msg.dev.id)}`, name: cleanName(msg.dev.name) };
      else { c.authing = false; return fail('Not signed in'); }
    } catch {
      c.authing = false;
      return fail('Discord sign-in failed');
    }
    c.authing = false;
    if (c.closed) return; // left while we were asking Discord
    let p = this.players.get(user.id);
    if (!p) {
      if (this.players.size >= MAX_PLAYERS) return fail('This island is full');
      const used = new Set([...this.players.values()].map((q) => q.color));
      const color = PLAYER_COLORS.find((col) => !used.has(col)) ?? PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
      p = { id: user.id, name: cleanName(user.name), color, x: 0, y: -100, z: 0, ry: 0, a: 0, conns: 0 };
      this.players.set(user.id, p);
    }
    p.conns++;
    c.player = p;
    const it = this.items;
    c.conn.send(JSON.stringify({
      type: 'welcome', you: p.id, seed: this.seed, map: this.map,
      edits: [...it.edits.values()], chops: [...it.chops.values()], benches: [...it.benches.values()],
      picks: [...it.picks.values()], piles: [...it.piles.values()], boats: [...it.boats.values()],
      time: clockHour(this.clock.h, Date.now() - this.clock.at),
    }));
    this.sendAll({ type: 'roster', players: this.roster() });
    this.dirty = true;
  }

  async leave(conn) {
    const c = this.conns.get(conn.id);
    if (!c) return;
    this.conns.delete(conn.id);
    c.closed = true;
    const p = c.player;
    if (p && --p.conns <= 0) {
      this.players.delete(p.id);
      this.sendAll({ type: 'roster', players: this.roster() });
    }
    if (this.conns.size === 0) {
      clearInterval(this.timer);
      this.timer = null;
      this.flushBoats();
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_TTL_MS);
    }
  }

  onClose(conn) { return this.leave(conn); }
  onError(conn) { return this.leave(conn); }

  // Nobody came back for 30 minutes: forget this room's world.
  async onAlarm() {
    if (this.conns.size) return;
    await this.ctx.storage.deleteAll();
    this.loaded = false;
  }
}
