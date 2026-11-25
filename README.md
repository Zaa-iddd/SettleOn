# SettleOn

A multiplayer 3D exploration game with a pixel-art look that runs as a **Discord Activity**.
Everyone in a voice channel spawns at a campfire on the same procedurally generated island, then wanders off together
through meadows, forests, mountains and snowy peaks to find the ancient ruins hidden around it.

## Controls

- **Click or tap** a tile to walk there. Movement is tile-based: your character always stops in the middle of a tile. It finds a path around trees, rocks and cliffs, hops up ledges, and swims if it has to.
- **Hold and drag** to keep walking toward your finger or cursor.
- On desktop, **WASD** or the arrow keys step one tile at a time, and keep going while held. **Shift** runs and **Space** hops.
- **Scroll** or **pinch** to zoom. The camera angle stays fixed.

## Project layout

```
index.html                 page shell and HUD
src/shared/world.js        seeded island generator (terrain, trees, ruins, campfire)
src/client/main.js         game loop, camera, multiplayer, HUD and minimap
src/client/world3d.js      3D island scene (Three.js)
src/client/character.js    cute chibi character model and animation
src/client/controller.js   movement and collision
src/client/pathfind.js     tap-to-go pathfinding (A*)
src/client/input.js        keyboard, mouse and touch input
src/client/pixelfx.js      pixel-art filter (low-res render, outlines, dithering)
src/client/discord.js      Discord sign-in (or browser dev mode)
worker/index.js            Cloudflare Worker: static files, /api/token, routes rooms to PartyKit
worker/room.js             PartyKit room (Durable Object): roster, position relay, the room's saved world
wrangler.jsonc             Cloudflare config (assets, Durable Object binding)
archive/                   the old settlement-builder mode, kept for later
```

Each Discord activity instance (everyone who joins the activity in the same voice channel) gets its own room and island.
Each room is a PartyKit server (a Cloudflare Durable Object) that relays player positions and remembers the room's world changes. Every client generates the world from the room's seed.

## 1. Run it locally in a browser (no Discord needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173 in two or more tabs. Each tab is a separate player.
Each tab gets its own character, so you can watch them see each other.
Use `?room=abc&name=Alice` to choose the room and player name.

## 2. Create the Discord application

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Under **OAuth2**:
   - Copy the **Client ID**.
   - Click **Reset Secret** and copy the **Client Secret**.
   - Add the redirect URL `https://127.0.0.1`. Discord requires one, but this app doesn't use it.
3. Copy `.env.example` to `.env` and fill in the two values. **Never commit `.env` or share the secret.**
4. Under **Activities → Settings**, turn on **Enable Activities**.

## 3. Run it inside Discord

Discord loads Activities over HTTPS, so expose your local dev server through a tunnel:

```bash
npm run dev
# in a second terminal (install cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
cloudflared tunnel --url http://localhost:5173
```

1. Copy the `https://….trycloudflare.com` URL the tunnel prints.
2. In the Developer Portal, go to **Activities → URL Mappings** and set prefix `/` to target `….trycloudflare.com` (without `https://`).
3. In Discord, turn on **User Settings → Advanced → Developer Mode**.
4. Join a voice channel in a small test server. Click the **Activities** (rocket) button and pick your app.

> Quick tunnels get a new URL every time you start them, so update the URL mapping each time.
> Until your app is verified, only you and members of your app's team can launch it.

## 4. Deploy to Cloudflare

The game deploys as one Cloudflare Worker: it serves the built client, swaps Discord sign-in codes at `/api/token`,
and hosts each multiplayer room as a PartyKit server (a Durable Object) at `/parties/room/<instanceId>`.
The free Workers plan is enough to start (SQLite-backed Durable Objects are included).

1. Sign in once: `npx wrangler login`.
2. Make sure `.env` has your `VITE_DISCORD_CLIENT_ID`. It's baked into the build.
3. Store the client secret on Cloudflare (it never goes in a file):
   ```bash
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
   Wrangler prints the Worker's URL, e.g. `https://settleon.<your-subdomain>.workers.dev`.
5. In the Developer Portal, go to **Activities → URL Mappings** and set prefix `/` to target `settleon.<your-subdomain>.workers.dev` (without `https://`).
   The game page, `/api/token` and the room WebSockets all go through that one mapping.
6. Launch the activity from a voice channel as in step 3.

Run `npm run deploy` again after each change. Rooms keep their world across deploys; players reconnect automatically.
Logs: `npx wrangler tail`, or the Worker's **Observability** tab in the Cloudflare dashboard.
On the deployed Worker, browser dev-mode logins are off, so only real Discord users can join.
To allow plain-browser testers anyway, add `"vars": { "ALLOW_DEV_LOGIN": "true" }` to `wrangler.jsonc`.

## Notes

- Each room saves its world (seed, digging, chopped trees, furniture, boats, time of day) in its Durable Object, so deploys don't reset it. A room is forgotten 30 minutes after the last player leaves.
- Anyone who knows a room's instance ID could join it. That's fine for a casual game.
