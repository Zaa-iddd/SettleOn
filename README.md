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
server/server.js           Express (/api/token) + WebSocket server (/ws)
archive/                   the old settlement-builder mode, kept for later
```

Each Discord activity instance (everyone who joins the activity in the same voice channel) gets its own room and island.
The server relays player positions. Every client generates the island from the room's seed.

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

## 4. Deploy

```bash
npm run build      # builds the client into dist/
npm start          # serves dist/, /api/token and /ws on $PORT (default 3001)
```

Deploy it to any Node host that supports WebSockets, such as Render, Railway, Fly.io or a VPS.
Set `VITE_DISCORD_CLIENT_ID` **before** you run `npm run build`, and set `DISCORD_CLIENT_SECRET` and `NODE_ENV=production` at runtime.
Then point the Activity's `/` URL mapping at your server's domain.
In production, browser dev-mode logins are turned off, so only real Discord users can join.

## Notes

- Rooms live in memory. If you restart the server, everyone gets a new island.
- Anyone who knows a room's instance ID could join it. That's fine for a casual game.
