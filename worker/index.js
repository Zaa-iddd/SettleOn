// SettleOn on Cloudflare Workers.
//  - Static files (the built client) are served by Workers Static Assets.
//  - POST /api/token swaps a Discord OAuth code for an access token (the client secret stays here).
//  - /parties/room/<roomId> is the multiplayer WebSocket: one PartyKit room (Durable Object) per
//    Discord activity instance. See room.js.

import { routePartykitRequest } from 'partyserver';

export { Room } from './room.js';

// The Discord application id is public: it's baked in at build time from .env, like the client's.
const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;

async function tokenExchange(req, env) {
  let code;
  try { ({ code } = await req.json()); } catch {}
  if (!code) return Response.json({ error: 'missing code' }, { status: 400 });
  const clientId = env.DISCORD_CLIENT_ID || CLIENT_ID;
  if (!clientId || !env.DISCORD_CLIENT_SECRET) return Response.json({ error: 'server is missing Discord credentials' }, { status: 500 });
  try {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: String(code) }),
    });
    const data = await r.json();
    if (!r.ok) return Response.json({ error: data.error_description ?? 'token exchange failed' }, { status: 401 });
    return Response.json({ access_token: data.access_token });
  } catch (err) {
    console.error('token exchange error', err);
    return Response.json({ error: 'could not reach Discord' }, { status: 502 });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/token' && req.method === 'POST') return tokenExchange(req, env);
    if (url.pathname === '/api/health') return Response.json({ ok: true });

    const party = await routePartykitRequest(req, env, {
      // room ids are Discord instance ids or ?room= codes: keep them short and URL-safe
      onBeforeConnect: (_req, lobby) => (/^[\w-]{1,64}$/.test(lobby.name) ? undefined : new Response('Bad room', { status: 400 })),
      onBeforeRequest: () => new Response('Not found', { status: 404 }), // rooms only speak WebSocket
    });
    if (party) return party;

    return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
  },
};
