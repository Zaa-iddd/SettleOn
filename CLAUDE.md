# SettleOn: project context

SettleOn is a cozy multiplayer **3D exploration game with a pixel-art look** that runs as a **Discord Activity**: a web app inside a Discord voice channel.
The user wants it to *feel like* Stardew Valley (cozy, fixed ¾ camera, cute characters; movement is WASD/arrows only), but with original art.
They steer the look with reference images. Most recently that was a lush, saturated cozy pixel-art village: stone cottages, terracotta roofs, cobblestone paths, fences, a well, round leafy trees. Match that *feel* with original models and textures.
Everyone in the channel spawns at a campfire in the same procedurally generated world: by default an **endless world** that keeps generating as you explore (Minecraft-style, from a seed), or an island (generated, blank, or hand-made in the map editor). Each player controls a cute chibi character and can see the others walking around.
The game design is original. Don't turn it into a copy of an existing commercial game.

> **Keep this file current.** Whenever game content or rules change (world generation, controls, physics numbers, visuals, protocol, files), update the matching section below in the same change, and add a line to the Changelog.
> If this file and the code disagree, the code wins. Fix this file.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite on :5173 with the Cloudflare plugin: the client plus the Worker (`/api/*`, PartyKit rooms at `/parties/room/<id>`) running locally in workerd, one port. Local room storage lives in `.wrangler/state` |
| `npm run build` | Builds the client into `dist/client` and the Worker into `dist/settleon` |
| `npm run preview` | Build, then serve the production build locally |
| `npm run deploy` | Build, then `wrangler deploy` to Cloudflare (needs `npx wrangler login` once and the `DISCORD_CLIENT_SECRET` secret) |
| *(push to `main`)* | GitHub Actions (`.github/workflows/deploy.yml`) builds and deploys to the Worker `settleon` (https://settleon.kape-dev.workers.dev). Repo secret `CLOUDFLARE_API_TOKEN`, repo variables `CLOUDFLARE_ACCOUNT_ID` and `VITE_DISCORD_CLIENT_ID`. Also runnable by hand ("Run workflow") |

Browser dev mode: open http://localhost:5173 for the main menu. `?room=x&name=y` skips the menu and joins room `x` in multiplayer (each tab is a player).
Discord setup (portal, tunnel, URL mapping) is in [README.md](README.md).

## Files

| File | Role |
|---|---|
| `src/shared/mapfile.js` | Map files: `encodeMap(base, name)` / `decodeMap(obj)` (validates, throws on bad input), `cloneBase`, `blankBase`. Endless saves: `endlessMap(name, seed)`, `isEndlessMap`, `decodeEndless`. See **Map editor** |
| `src/shared/endless.js` | **Endless worlds.** `createEndlessWorld(seed)`: terrain for any cell, in `CH` = 16-cell chunks (`terrain(cx, cz)` heights/kinds, `content(cx, cz)` trees/foliage/obstacles/path tables), `H`/`kind` for any cell, `ruinsNear`. See **Endless worlds** |
| `src/shared/world.js` | **Island generation and constants.** `generateWorld(seed)` = `finishWorld(base)` of a generated base; `world.base` keeps the base. Seeded island heightmap, ground kinds, trees/rocks/flowers, campfire clearing, ruins, collision obstacles, `groundAt`, `spawnPoint`, player colors, `MAX_PLAYERS`. Also the shared noise (`hash2`, `fbm`, `smooth`), `cellKey`/`keyX`/`keyZ` and `WORLD_LIMIT` |
| `src/client/main.js` | Client glue: WebSocket, building the world on `welcome`, local and remote characters, fixed follow camera, tool clicks (screen→ground raycast → dig a neighbouring tile), digging and its sync, name tags, area name, ruin discovery, minimap |
| `src/client/menu.js` | `Menu`: the main menu (Play singleplayer, Multiplayer, Create world, Map editor) over a slowly circling diorama of a random island. Also `seedFrom(text)` |
| `src/client/saves.js` | Saved worlds in `localStorage['settleon.maps']` (`allSaves`, `saveNames`, `getSave`, `putSave`, `deleteSave`, `saveOptions`), shared by the menu and the editor |
| `src/client/inventory.js` | `Inventory`: Minecraft-style hotbar (9) + bag (27), the inventory screen, click rules, and `ITEMS` with their 2D pixel-art icons drawn in code (`iconURL`). See **Inventory** |
| `src/client/editor.js` | `Editor`: the map editor mode (free camera, terrain/ground/object tools, undo, save/load/export/import, play in room) |
| `src/client/pathfind.js` | `PathFinder`: `floorAt`/`waterAt`/`passable(ix, iz)` (island: flat arrays; endless: per-chunk tables), `stepOk(ix, iz, dx, dz)` (the single source of movement rules); `route()`, an 8-way A* in a 193×193 window returning `cellKey`s; `nearestOpen()` |
| `src/client/pixelfx.js` | `PixelRenderer`: low-res render target, then a post shader (outlines + dithered palette), upscaled with CSS `pixelated`. Look settings live here |
| `src/client/world3d.js` | `WorldScene`: builds an island once, or streams endless chunks around the player (`updateChunks`, `preload`). Terrain columns (instanced, textured by `TERRAIN_GLSL`), water plane that follows the player, trees/rocks/flowers, foliage (tufts, ferns, reeds and cattails, bushes and berries, mushrooms, swaying in a shared `wind` uniform), ruins with spinning gems, animated campfire with flickering light, drifting clouds, sun and shadows that follow the player. Also exports the shared `mat()` material cache |
| `src/client/ambient.js` | `Ambient`: client-only ambient life (not synced). Butterflies around flowers, dragonflies over water near reeds, frogs, fly swarms, water striders, bird flocks, and drifting leaves around the player. Exports `WIND`, the shared wind direction |
| `src/client/trees3d.js` | Leafy tree, redwood (`redwoodGeometry(variant)`: ~11.5 tall straight red trunk, buttress roots, 6-tier dense canopy 5.6–11.2 high, `REDWOOD_BANDS`/`REDWOOD_BARK`), conifer (`pineTreeGeometry(variant)`: straight trunk, 5 tiers of flattened clusters in cooler `PINE_BANDS`) and bush models (from the user's tree reference): `leafyTreeGeometry(variant)` (twisting tapered trunk with bark streaks, flared roots, branches to 3–4 side clusters plus a crown) and `leafCluster()` (banded core + rounded single-sided leaf cards). Merged, vertex-colored geometry |
| `src/client/atmosphere.js` | `Atmosphere`: cozy client-only particles (not synced): campfire embers and smoke, and daytime pollen around the player. See **Sky and ambient life** |
| `src/shared/boatlook.js` | A boat's look (name, paint, upgrade levels, size): `BOAT_PALETTE`, `PAINT_SLOTS`, `UPGRADE_KEYS` / `UPGRADE_MAX`, `SIZE_COUNTS`, `defaultLook`, `cleanLook` (shared by the client, server and saves). See **Boats** |
| `src/client/boat.js` | **Boats.** The ship model (`boatGeometry`), deck layout (`halfW`, `walkable`, `onDeck`, `nearestWalkable`), deck ↔ world math (`toLocal`, `toWorldXZ`, `deckY`), `hullClear`, and `Boats` (the boats in a scene: `set`, `remove`, `update`, `at`, `listOut`). See **Boats** |
| `src/client/fishing.js` | **Fishing.** `FISH` (the species), `fishArt` (their icons), and `Fishing`: the cast / bite / reel state machine, the bobber and line, and the fishing HUD. See **Fishing** |
| `src/client/effects.js` | `Effects`: one-shot particles (client-only, not synced). `impact(x, y, z, drop, kind)` bursts a ring of dust puffs (colored by ground kind) and a few ground chips that fall with gravity; `kind` `'water'` is a `splash`. `splash(x, y, z, power, dx, dz)`, `drop(…)` (one droplet) and `foamAt(…)` (a fleck of foam on the surface). Pooled instanced boxes |
| `src/client/character.js` | Cute chibi character (`makeCharacter`) and procedural animation (`animateCharacter`, `ANIM` states). Each mesh has a see-through silhouette twin. What the hand holds: `setTool(ch, i)` (`TOOLS` = none, shovel, pickaxe, dirt, stone, sand, snow, frog, axe, wood, log, workbench, stick, pebble, berries, leaves, wall, chair, table, bed, lamp, shelf, boat, rod) and `swingTool(ch)`. Night lantern: `setLantern(ch, on)` |
| `src/client/controller.js` | `GridController`: grid movement in **half-tile steps** (rests on tile centres or edges), with hops over ledges, swimming and a standing jump |
| `src/client/input.js` | WASD/arrows (the only movement), Space jump, taps/clicks (for tools), wheel and pinch zoom, Q/E camera turns |
| `src/client/discord.js` | `identify()`: Discord SDK auth if the URL has `frame_id`, otherwise dev identity (per-tab id in sessionStorage) |
| `src/client/style.css` | Pixel-style HUD (Pixelify Sans font bundled via `@fontsource`, hard shadows, square borders) |
| `worker/index.js` | **Cloudflare Worker entry.** `POST /api/token` (Discord code → access token; client id baked in from `VITE_DISCORD_CLIENT_ID`, secret from `env.DISCORD_CLIENT_SECRET`), `GET /api/health`, `routePartykitRequest` for `/parties/room/<id>` (room ids `[\w-]{1,64}`), everything else from static assets (`env.ASSETS`) |
| `worker/room.js` | `Room`: the PartyKit server (`partyserver`, a SQLite-backed Durable Object, `hibernate: false`), one per room. Roster, position relay (80 ms snapshot timer while anyone is connected), validation of every message, and the room's world written through to SQLite (`meta`, `items` tables). See **Network protocol** |
| `wrangler.jsonc` | Worker config: entry, static assets (`run_worker_first` for `/api/*`, `/parties/*`), the `Room` Durable Object binding and its `new_sqlite_classes` migration |
| `index.html` | Page shell: canvas, labels layer, HUD panels, time-of-day slider, map editor UI (`#editor`) |
| `archive/village/` | Removed village models (`village3d.js`: cottages, fences, well, props, lanterns) and their pixel textures (`textures.js`). Not imported |
| `archive/settlement-builder/` | The old building/RTS mode, removed "for now". Not imported. See its README |
| `.env` (not committed) | `VITE_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, optional `ALLOW_DEV_LOGIN`. Read by Vite and by the local Worker in `npm run dev`. On Cloudflare the secret is a Worker secret instead |

## Endless worlds (mirror of `src/shared/endless.js`)

- **The default world.** A room with no custom map, "New endless world" in singleplayer, and Create world → "Endless world" all play an endless world from a seed. Same seed, same world. Islands (generated, blank, edited) still exist.
- **Pure per cell:** every cell's terrain and objects are a function of `(seed, ix, iz)`, so chunks line up at their borders and every player generates the same world locally. Cells use the island mapping (`x = ix - WORLD/2 + 0.5`), and `ix`/`iz` may be negative.
- **Taller mountains:** inside mountain ranges (`range = smooth(0.63, 0.78, fbm /120)`; the craggy ridge share also only rises past 0.6–0.76) a broad ridged massif (`fbm /44`, cubed, × 0.62) is added. Levels above `PEAK_EASE` = 34 rise at 45%, so summits are rounded. `MAX_LEVEL` = 48. Typical peaks are about 20–23 units. About 7% of land is mountain (8+ high), all on the big islands (see **Archipelago terrain**). **Mountain zones:** lush lower slopes, a thin rocky band, snowy tops. The snow line is `SNOW_H` 13.5 ± 1.5 (noise `fbm /11`), and rock covers the `ROCK_BAND` = 1.5 below it. In ranges (range > 0.3, height ≥ 5) forest grows where the forest noise is above `MOUNTAIN_FOREST_T` = 0.42 (vs 0.52 elsewhere). Mountain land (8+): about half grass/forest, a quarter snow; ~92% of summits (16+) are snowy. The island keeps rock 6.5 / snow 8.5. Trails get a snow dusting above 12.5 and rock sides above 11.5.
- **Hiking trails (`K.TRAIL` = 8, endless only):** cells on contour bands of two slow noises (`fbm /38` and `/53`, about 2.6 cells wide, using a gradient-scaled threshold) where raw height ≥ `TRAIL_MIN` 4.5 and inside a mountain range (`range ≥ 0.2`), away from the camp.
  - Trail height follows a smooth surface: bilinear interpolation of raw heights sampled every `TRAIL_GRID` = 8 cells, rounded to `STEP`. Fewer than about 1% of neighbouring trail steps exceed the 1.0 climb.
  - About 3% of land is trail. A flood fill from the camp reaches the summits.
  - Look: packed dirt with trodden patches and gravel, dusted with snow above 11.5. Column sides are rock above 7.5, dirt below.
  - No trees or rocks grow on trails. Stone cairns stand beside them (3.5% of neighbouring land cells, decoration only).
  - Area name "Mountain Trail", minimap colour `[204, 166, 112]`.
- **Archipelago terrain (a sea adventure world, at the user's request):** mostly open ocean dotted with islands. The island's height formula without the island falloff, minus `(1 − land) × 0.95`, where `land = max(shelf, islet)`:
  - `shelf = smooth(SHELF_LO 0.5, SHELF_HI 0.61, fbm(/ISLAND_SCALE 150, 4 octaves))` raises the bigger islands;
  - `isle = 0.93 × smooth(ISLE_LO 0.62, ISLE_HI 0.74, fbm(/ISLE_SCALE 55, 3 octaves))` adds mid-sized islands between them (added with "more islands");
  - `islet = 0.9 × smooth(ISLET_LO 0.65, ISLET_HI 0.79, fbm(/22, 3 octaves))` scatters small isles across the open sea.
  - `land = max(shelf, isle, islet)`.
  - Mountains only rise on the big islands: the ridge share is scaled by `0.4 + 0.6 × shelf` and the mountain range by `shelf`, so islets stay low. Levels are capped as before.
  - **Now** (4 seeds, 600×600 cells around the camp): about **60–77% ocean** (70% typical), with 16–21 big islands (400+ cells), 36–41 mid-sized ones and 55–76 islets per window.
  - Before the extra islands, measured over 8 seeds: about **81% ocean** (70–91% by seed). In each window there are 4–9 big islands (400+ cells, largest about 14k–90k), 3–15 mid-sized ones and 24–61 islets. Land is about 36% grass, 34% forest, 11% deep forest and 11% sand; mountains (8+) are about 7% of land.
  - Before this it was continents (`fbm /260`, `smooth(0.35, 0.49)`), about 38% sea.
- **Rivers (at the user's request, endless only):** continuous winding rivers on the big islands.
  - **Where:** the line where a slow, domain-warped noise crosses 0.5 (`riverDist(seed, ix, iz)`: `fbm(/RIVER_SCALE 95)` of the cell warped by ±`RIVER_WARP`/2 = 17 cells with `fbm(/40)`; distance ≈ |n − 0.5| / gradient, or Infinity past |n − 0.5| > 0.3). A level line never breaks, so rivers run on until they reach the sea (or close into a loop around a hill now and then).
  - **Only on big islands, not in the mountains:** strength `rp = smooth(0.25, 0.55, shelf) × (1 − smooth(0.04, 0.18, range))`, so rivers rise at the foot of the mountain ranges (before the hiking trails, which need range 0.2) and islets and mid isles have none.
  - **Shape (wide enough for boats, at the user's request):** the channel's half width is `chW = 2.8 + 0.8 × (1 − smooth(3, 12, level))` (5.6–7 cells across, so a 2.4-wide, 6.3-long boat fits through bends), with a 0.8-deep middle (level 2) and a 0.9-cell wadeable edge at 0.3 (level 3), as SEABED, so the normal water, reeds, lily pads and fish follow. The channel exists wherever `rp > 0.3`, and the valley around it (half width `min(14, chW + 1.5 + 0.75 × level)`, down to a sandy bank at level 4 = 2.0) is fully carved there (`smooth(0, 0.3, rp)`). It only fades, shallower and dry, where `rp` falls toward 0 (the river's source).
  - **Boat test (`boatnav.mjs`-style BFS over cells × 16 headings with the real hull points, from the open sea):** before widening, the boat reached 65–100% of river centre cells over 4 seeds. Not re-measured after widening (interrupted).
  - Trails take their heights from the land before the rivers (`lv0`), so they don't dip into valleys. Unclimbable steps near rivers are as common as elsewhere (measured over 3 seeds). Generation about 0.6 ms per chunk.
- **Ocean depth layers (at the user's request: "more depth to the ocean"):** the seabed is shaped from how far below 0 the raw terrain value is (`eRaw`), plus a little noise (`fbm /9`) for banks and holes. It's `SEABED_TOP 2.0 + eRaw × SEABED_SLOPE 5`, minus a steeper `DROP_SLOPE 10` past `SHELF_EDGE 0.35`, plus noise ±`BED_NOISE`/2 = 0.7, rounded to levels and clamped to `SEABED_MIN` −6 … 3. So there's a gentle shelf around the islands, then a drop-off into deep water.
  - **Fewer shallows (at the user's request: they covered too much):** in the "almost land" band around every island (`eRaw > 0`, but too low to break the surface) the seabed used to clamp straight to the shallowest level, so with the extra islands about 28% of all water was ankle-deep. Now it rises with the land's level there (`SEABED_TOP + lv × SHORE_RISE 0.7`), and the land formula's own coast levels shelve off `COAST_STEEP` = 2.2× steeper under water. The shallows are now about 15% of the water (rivers' wadeable edges included), a beach band instead of wide flats.
  - Measured over 4 seeds (400×400 around the camp, share of water): shallows 15%, reef 24%, mid 10%, deep 33%, abyss 18%.
  - Where the land formula only gives its floor (level 1) the shelf decides; right at the coast the higher of the two wins.
  - Before the extra islands (4 seeds, share of ocean cells): sandy shallows (depth 0.3, wadeable) ~15%, reef flats (0.8–1.3) ~15%, mid water (1.8) ~10%, deep (2.3–3.3) ~43%, abyss (3.8–4.8) ~17%.
  - Heights can now go below 0, down to `MIN_LEVEL` −8 (`world.js`). Terrain columns start at `COL_BASE` (`MIN_LEVEL × STEP − 1` = −5, was −1), and edit validation accepts levels from `MIN_LEVEL` (`cleanEdits`, the server's `dig`). Swimmers still float at `SWIM_FLOOR` whatever the depth.
- **Campfire:** the flat grass/forest spot nearest the origin (spiral search up to 700 cells) on a proper island: at least 60% of a 13×13 sample grid over the 37×37 around it must be land (`roomy`), so you never start on an islet. Camp islands measured 3.5k–90k cells. The clearing is applied inside the per-cell function, like the island.
- **Deep forest:** lowland grass/forest with `fbm(/13) ≥ DEEP_T` (0.647, ~16% like the island), then the island's two smoothing passes, computed on a 2-cell margin so chunk borders match.
- **Redwoods:** 2.1-cell spacing decided locally in two rounds (lowest `hash2(seed+913)` among close candidates wins; then again among the rest). About 0.15 redwoods per deep cell, like the island.
- **Walk-under corners:** the earliest tree in row-major order around a vertex wins it (same result as the island's scan).
- **Ruins:** at most one per 48×48-cell region (80% chance, up to 12 tries, 8-cell region margin, ≥ 16 from the camp). Discoveries count up without a total (`Ruins found: N`).
- **Chunks:** `CH` = 16. `terrain()` is cached (LRU 2500) and `content()` is cached (LRU 220), at about 1 ms per chunk. `content()` also holds the path tables (`floor`, `water`, `blocked`) and claimed `corners`.
- **World border:** `WORLD_LIMIT` = 30000 cells from the origin are blocked (keeps GPU float precision fine). The server clamps positions to it.
- **Streaming (`WorldScene`):** chunks within `LOAD_R` = 50 units (more when zoomed out past 34 aboard a boat: + 1.3 per unit, about 68 at 48; still well inside the 256-cell height ring buffer) of the player load (nearest first, up to `LOAD_BUDGET_MS` = 5 ms per frame), and unload past `UNLOAD_R` = 74. `preload()` builds the spawn area before the first frame. About 45–60 chunks are loaded, comparable to one island. Each chunk is a `Group` with its terrain mesh and per-chunk instanced meshes. Fireflies use one global mesh (`MOTE_CAP` = 4096, `setMotes`). `WorldScene.live` lists the loaded flowers/reeds/trees for ambient life.
- **Terrain height ring buffer** (`HT` = 256, cells indexed mod 256), read by terrain AO and the water shader (depth, shore foam). Each chunk writes itself plus a 1-cell margin. It must be wider than everything loaded at once: up to ~164 cells across (UNLOAD_R on both sides). At 128, chunks on opposite sides overwrote each other, so after walking away and back about 35% of nearby cells read another place's height, drawing shore foam on every tile edge (a white grid over the water) and wrong AO.
- **Minimap:** a 96×96 window around the player, redrawn when you're 12 cells off its centre. Water is shaded by depth like the water itself: turquoise shallows, reef teal, blue, darker blue, deep navy. Other players beyond the window's edge show as an edge marker in their colour (`edgePointer` in `main.js`): a 3×3 dot pinned 3 pixels inside the edge, on the line from you to them, with a tip pixel pointing their way (snapped to 8 directions).
- **Not editable:** the map editor works on islands only. It says so for endless worlds, and "Create & edit" is disabled for them.

## Islands (mirror of `src/shared/world.js`)

- **Two stages:** `generateWorld(seed)` builds a **base**, then calls `finishWorld(base)`.
  - The base holds only what's hand-editable: `seed`, `heights`, `kinds`, the `camp` cell, `ruins` cells, `trees` (`{ix, iz, type: 'leafy'|'pine'|'redwood', s}`) and `rocks` (`{ix, iz, s}`).
  - `finishWorld` derives everything else deterministically from `base.seed`: jittered positions, ruin pillars (seeded per spot), flowers (GRASS cells with hash in [0.07, 0.42) that are free of objects), walk-under trees, all foliage, and obstacles.
  - It keeps `base.heights` and `base.kinds` by reference (no copy), which the editor relies on.
  - Custom maps go through the same `finishWorld`, so they get the same lush detail.

| Constant | Value | Meaning |
|---|---|---|
| `WORLD` | 96 | Island columns per side. One column = 1×1 world units. Column (ix,iz) is centered at `ix - 48 + 0.5` (endless worlds use the same mapping) |
| `STEP` | 0.5 | Terrain heights are multiples of this (terraced look) |
| `SEA` | 1.8 | Water surface height. Columns at 1.5 or below are underwater |
| `TREE_SCALE` | 1.5 | Every tree's scale `s` is multiplied by this at generation, so models, trunk collision and leaf drops all grow together |
| `MAX_PLAYERS` | 16 | Per room. 12 player colors, reused if needed |

- **Height:** fbm value noise plus ridge noise, minus a radial island falloff (0.62–1.0 of the radius), then `pow(e, 1.6)` and rounded to `level × STEP` (max about 10). About 40% of the map is land.
- **Ground kinds (`K`):** SEABED (height < SEA), SAND (≤ SEA + 0.3), GRASS, FOREST (pine woods: `isForest` = `fbm(/FOREST_SCALE 20, 3 octaves) > FOREST_T 0.52`, about 45% of lowland in big patches, avg ~1200 cells), ROCK (≥ 6.5), SNOW (≥ 8.5), and **PATH (6)** for cobblestones (still rendered by the terrain shader, but nothing generates it now), and **DEEP (7)** for deep redwood forest. The rock and snow thresholds were raised to make the island grassier.
- **Campfire / spawn:** the grassy spot nearest the island center whose 5×5 area varies by no more than one step. Players spawn on a 1.6-unit circle around it, at an angle from a hash of their id.
- **Campfire clearing:** the terrain within `VILLAGE_RADIUS` = 7 of the campfire is flattened to the camp height and set to GRASS. The next 2 cells blend back to the natural height in `STEP`s. Flower beds go on 22% of its grass cells. Trees, rocks and normal flowers are kept outside radius 8. There are no structures (the village was removed).
- **Deep forest (`K.DEEP`):** after the camp clearing, lowland GRASS/FOREST cells (height ≤ 6, at least `VILLAGE_RADIUS + 6` from the camp) are ranked by `fbm(ix/13, iz/13)`.
  - The top `DEEP_SHARE` = 16% become DEEP, so every island gets some. Two smoothing passes follow: cells with fewer than 3 deep neighbours revert to FOREST, and cells with 6 or more join.
  - A typical island gets about 350–450 DEEP cells and about 55–65 redwoods.
  - **Redwoods** (`world.redwoods`, separate from `trees`): 42% of DEEP cells try one, kept at least 2.1 cells apart, with ±0.1 jitter and scale `s` 0.82–1.06. A thick trunk obstacle (r 0.42·s) blocks its tile. 4% of DEEP cells get a mossy rock.
  - No normal trees, flowers or tall grass grow there. Instead: 1–2 tufts per cell, ferns (70%, plus 30% extra), mushrooms (18%), bushes (4%) and fireflies (9%).
  - Ruins may also sit in deep forest.
- **Ruins:** no longer generated (removed at the user's request) on islands or in endless worlds. Ruins placed in the map editor still render and can be discovered (a ring of 8 pillars with an altar and spinning gem), and the "Ruins found" counter shows only on such maps.
- **Exposed dirt (`K.DIRT` = 9):** meadow tiles where `fbm(/6, seed+404) > DIRT_T` (0.68) and a hash < 0.7 become dirt tiles, about 8–12% of meadow tiles in small clusters. The shader (`dirtPatch`) draws an irregular, texel-stepped blob of earth with a darker rim, pebbles and sprouts in the middle of the tile, with grass around it. No trees, rocks or flowers grow there, only a stray tuft at the edge (50%). Area name "Meadow". Map files accept kinds up to `MAX_KIND` = 13 (10 = `K.SOIL`, dug earth; 11 = `K.WOOD`, placed planks; 12 = `K.WOOD2`, planks turned 90°; 13 = `K.WALL`, log-cabin wall blocks; `isWood(k)` covers all three).
- **Decor:**
  - Forest cells: 70% of cells are pine candidates, which grow a pine when the tree roll is below `PINE_CHANCE` = 0.28; the other 30% grow a leafy tree when the roll is below 0.5 (spacing rule below).
  - **Pines are `PINE_SCALE` = 1.4× bigger** than other trees, and **keep `PINE_SPACING` = 2.2 cells apart**: a pine candidate (pine woods, and the small pines on rock) is kept only if no closer pine candidate has a lower `hash2(seed+915)`. Same in endless worlds.
  - **Leafy (round) trees keep `LEAFY_SPACING` = 3.2 cells apart:** a leafy candidate is kept only if no closer leafy candidate has a lower `hash2(seed+914)`; a losing cell stays empty. Pine woods stay dense. Same rule in endless worlds.
  - Grass: 5% tree, 7% rock.
  - Rock cells: 3% small pine (below height 8, 0.8× the pine size, spaced like other pines), 14% rock.
  - Sand: 7% rock.
  - Grass and forest: 42% chance of 1–3 flowers.
  - No decor within 4 cells of the camp or ruins.
- **Foliage** (decorative, walk-through, none within 1.5 cells of the camp). A typical island has about 10–13k tufts and 3–4k tall-grass clumps.
  - Grass tufts: 1–3 per grass cell (thinned at the user's request), 2–4 per forest cell, 30% of rock cells, and 35% of dry sand cells.
  - Tall grass: 2–3 clumps per grass cell where `fbm(ix/7, iz/7)` > `TALL_GRASS_T` (0.63), which makes smaller meadow patches. Banks (`bankLife`) add tall grass on 35% of grassy waterside cells.
  - Bushes: 3.5% of grass cells and 8% of forest cells. 35% of bushes have red berries.
  - Ferns: 35% of forest cells.
  - Mushrooms: 7% of forest cells, in clusters of 1–3.
  - Reeds: 55% of sand or grass cells next to water. Half of them have a cattail.
  - Fireflies (`motes`): 2.5% of grass cells and 5% of forest cells, floating 0.4–1.2 above ground.
  - Each item is `{x, y, z, r}`, where `r` is a random number from 0 to 1 used for scale, rotation and tint.
- **Walk-under trees:** after placement, each tree tries to move its trunk onto a random corner of its tile (±0.06 jitter). This works when the 4 tiles around that corner are inside the world, at or above `SEA`, rock-free, outside the camp clearing, within 2 × `STEP` of each other, and the corner isn't taken. The tree then gets `corner: true`, `y` = the lowest of the 4 heights, and its corner goes into `world.cornerBlocks` (vertex key `cellKey(vx, vz)`).
  - Those 4 tiles stay walkable, so the player walks under the canopy. `PathFinder.stepOk` blocks only the diagonal step through that corner.
  - Roughly 75% of trees end up walk-under. The rest stay centred on their tile and block it as before.
- **Collision obstacles:** circles bucketed by cell, covering tile-centred trees only (r 0.18·scale), rocks (0.9·size), pillars (0.32), altars (0.55) and the campfire (0.45).

## Tools and digging (mirror of `main.js` digging section, `character.js`)

- **What's in hand is the selected hotbar slot** (see **Inventory**). `syncTool()` sets `game.tool`, an index into `TOOLS` (0 nothing, 1 shovel, 2 pickaxe, 3 dirt, 4 stone, 5 sand, 6 snow, 7 frog, 8 axe, 9 wood, 10 log, 11 workbench, 12 stick, 13 pebble, 14 berries, 15 leaves, 16 wall, 17–21 chair, table, bed, lamp, shelf, 22 boat), from `ITEMS[held].tool` or the block's id. It shows in the character's right hand (`toolGrip` on `armR`): tool models, or a small block in the block's colours. With an empty slot, clicks do nothing. `actAt` picks digging (tool) or placing (block).
- **Using a tool:** with a tool selected, a click on a tile next to you (one of the 8 neighbours) digs it.
  - A tile further away: the character walks (A* route, `setPath`) to the last tile before it, then digs (`pendingDig`, checked in `frame`). This is the only time a click moves the character.
  - A movement key or switching tools cancels the walk's dig. An unreachable tile flashes the red marker with "Can't get there from here".
  - Your own tile says "Step aside to dig here". With the empty hand or a block in hand, clicks do nothing.
- **Hover outline** (`makeOutline` / `updateOutline`, mouse only): with a tool or block in hand, the tile under the cursor gets a box outline (`EdgesGeometry`, 2% inflated).
  - Tool: the top block that would be dug.
  - Block or workbench: a **see-through preview** (opacity 0.55, `ghostParts` in `main.js`) of what will be placed, turned the way R set it: Wood shows its planks (texture turned 90° for odd turns, like `K.WOOD2`), other blocks their colour, and the Workbench its model (`benchGeometry` from `world3d.js`) facing the way it will face. Where it can't go, a red box (fill opacity 0.18) instead.
  - White when it works, red (`0xff6a5a`) when `digProblem` / `placeProblem` (the same checks the actions use) give a reason. Hidden over your own tile, with an empty hand, or while the inventory is open.
  - The ray re-marches only when the mouse, camera or terrain (`digVersion`) changed. `Input.hover` tracks the mouse position (cleared on `pointerleave`).
- **Hover highlight** (`hoverTarget` in `main.js`, `WorldScene.setHighlight` in `world3d.js`): whatever a click would act on, in the same order as `onTap`, gets a cream outline and a soft pulsing glow, and the cursor becomes a hand. That's frogs, bushes, pebbles and workbenches with any non-placing item, plus any furniture and log piles with the axe. Trees under the axe keep the white trunk box instead.
  - **How it's drawn:** the hovered model is redrawn with its own transform (bush and pebble like `addFoliage`, furniture like `setBenches`, every log of a pile like `setPiles`, frogs from the frog mesh's instance matrix). The glow pass (additive, opacity 0.05 ± 0.035, renderOrder 9) also writes stencil 2 where the object is visible. The hull (the same model, both sides, pushed out along its normals by `max(0.035, camDist × 0.0052)`, about 2 art pixels; renderOrder 10) draws only where the stencil isn't 2. So the outline is a solid band around the silhouette, even for the bush's one-sided leaf cards, and things in front still hide it. Both meshes are transparent so the order holds.
- **The swing** (`SWING_SECS` = 0.38): the arm winds up over the head and chops down, with a forward lean and a small squash on impact. The block comes out about 45% into the swing, with an `effects.impact` burst in the ground's colours.
- **Rules (`digAt`):**
  - **Shovel:** grass, forest, deep forest, dirt, soil, sand, trail, snow and path.
  - **Axe:** wood blocks (and trees, see below).
  - **Pickaxe:** rock, 2 hits per block (the first only cracks it; `digHits`).
  - A wrong tool gets a hint ("That's stone: use the pickaxe (3)").
  - You can't dig underwater, under a tile with an obstacle (tree trunk, rock, campfire), next to a walk-under tree's trunk corner, or below height 0.5. So trees never float or move.
- **A dig** lowers the tile by one `STEP` (0.5).
  - The new kind is `K.SOIL` (10, bare earth in the shader; area "Dug Soil"). Sand, snow and rock stay what they were.
  - Below `SEA` the tile becomes SEABED and fills with water.
- **Edit layer:** `world.setEdit(ix, iz, h, k, uh = -1, uk = 0)`, `world.under(ix, iz)` and `world.editsList()` → `[[ix, iz, level, kind]...]`, or 6 long with the under layer.
  - **Under layer (two-layer columns):** placing blocks remembers the ground below them (`uh`, `uk`: its top height and kind). The terrain mesh carries it as the `aUnder` instance attribute, and the shader draws a column's sides below `uh` as that kind (with its own lip), so placing Wood on grass no longer turns the whole column to wood.
    - **Placing:** keeps the existing under layer when stacking the same material. A different material on top makes the old top the new under layer, so deeper layers then show as it (only two layers are stored).
    - **Digging:** taking the last placed block off restores the old ground kind (grass stays grass) and clears the under layer.
    - Island saves (`encodeMap`) don't store it, so a reloaded island shows placed columns in one material.
  - **Endless:** edits live per chunk (`editsByChunk`, attached to terrain chunks as `t.edits`). `H`/`kind` include them, while `content()` keeps placing objects and plants from the generated terrain (`HG`/`kindG`), so digging never makes trees or bushes pop up nearby. Dug cells simply have no plants, and the path tables use the dug heights. Only the dug cell's chunk content is invalidated.
  - **Island:** edits write straight into `base.heights`/`kinds`.
- **Refresh (`applyDig`):**
  - `WorldScene.refreshCell`: endless rebuilds that chunk; the island updates one terrain column and hides plant instances standing on the cell.
  - `PathFinder.refresh`.
  - A minimap redraw (`miniDirty`).
- **Placing blocks (`placeAt`):** with a block in hand, a click on a neighbouring tile (or a far one, walked to like digging) raises it one `STEP` and uses one item (`inventory.takeHeld`).
  - Dirt places as `K.SOIL`, Stone as ROCK, Sand as SAND, Snow as SNOW. Below `SEA` it stays SEABED, so placing into water builds up the bottom (fill ponds, make bridges).
  - Not on a tile with an obstacle, next to a walk-under trunk corner, where another player stands, or above `MAX_BUILD_H` = 24.
  - Same swing, and the same edit layer, `dig` message and saving as digging.
- **Chopping trees (axe):** with the axe in hand, a click near a tree's trunk on screen (`treeAt`: distance to the projected trunk segment, threshold `max(18, 260 / camDist)` px) chops it. Hover shows a white box around the trunk.
  - Within `CHOP_REACH` = 1.95 of the trunk; otherwise the character walks over first (`pendingChop`).
  - Hits: round trees and pines 3, redwoods 6 (`TREE_HITS`). Each swing bursts wood chips; the last one bursts leaves at the canopy, removes the tree, and gives **Logs** (`TREE_WOOD`: 3 round / 4 pine / 8 redwood) and **Leaves** (`TREE_LEAVES`: 3 / 2 / 4). Logs are a crafting material (see **Inventory**) and stack into log piles (below).
  - **Removal (`world.removeTree(ix, iz)`, keyed by the tree's own cell):**
    - **Endless:** `choppedByChunk`. `content()` still decides everything from the generated world and only leaves the chopped tree out when emitting it (its obstacle and walk-under corner go with it), so neighbours never move or pop in. Its chunk is rebuilt.
    - **Island:** the tree leaves `base.trees` (so saves keep it gone), `world.trees`/`redwoods`, its obstacle and corner. `WorldScene.hideTree` zeroes its instances, and `PathFinder.refresh` also recomputes the cell's blocked flag.
  - `applyChop` refreshes the scene, paths and outline. Synced with the `chop` message and `welcome.chops`; endless saves store `chops`.
- **Rotating with R (`rotateKey`, `game.rot` = quarter turns):**
  - Holding **Wood**: R switches the plank direction. Odd turns place `K.WOOD2` (12), the same plank block with its texture turned 90° (`p.yx` in the shader; vertical boards on the sides). The held label shows "planks east-west / north-south (R)".
  - Holding a **Workbench**: R adds quarter turns to its facing (it still starts facing you).
  - Hovering a **placed workbench** (anything in hand): R turns it in place, synced with a `bench` message (`applyBench` updates an existing bench when the rotation differs).
- **Gathering: bushes and pebbles** (`main.js` "bushes and pebbles" section):
  - **Bush, left click (`breakBush`):** with anything (or nothing) in hand, a swing breaks the bush with a leaf burst and gives 1–2 Sticks and 1–2 Leaves, plus 1–2 Berries if it still had berries.
  - **Bush, right click (`onRight` → `#ctx-menu`):** a small menu with "Search for berries" (`searchBush`). A berry bush gives 1–3 Berries and loses its berries; others say "No berries on this bush". `Input.onRight` gets right clicks (they no longer count as taps).
  - **Pebbles (`pickPebble`):** loose pebbles lie on 3% of grass, forest, deep forest and dirt cells and 6% of sand, rock and trail cells (`pebbleChance`, `world.pebbles` / chunk `pebbles`; a flat stone with a smaller one beside it, LOD "small"). A click picks one up as a Pebble.
  - **Reach:** `GATHER_REACH` = 1.9; further away the character walks next to it first (`inReach`, `game.pendingAct`, cancelled by movement keys or another click). The cursor turns into a hand over bushes and pebbles.
  - **Picks:** all three are "picks" `[ix, iz, t]` (`PICK`: 0 bush broken, 1 berries picked, 2 pebble taken; `pickKey = cellKey × 4 + t`). `world.setPick` / `pickList`; `applyPicks` leaves picked things out of the generated lists (endless: per chunk in `content()`, then the chunk is rebuilt; island: lists are edited and `WorldScene.hideTree` / `hideBerries` hide the instances). Synced with the `pick` message and `welcome.picks`; saved as `picks` (endless saves, or an extra field on island saves).
- **Log piles** (`placeLog` / `takeLog` / `applyPile` in `main.js`, from the user's log-stack reference): a Log (`place: true`) is placed on a neighbouring tile as a lying log; more Logs on the same tile stack up 3 on the ground, 2 in the dips above, 1 on top (`PILE_MAX` = 6, then "That pile is full").
  - **Data:** `world.piles`: Map(`cellKey` → `[ix, iz, r, n]`), r 0 = logs lying along x (east-west), 1 = along z. **Walkable:** you stand on top of a pile (`PathFinder.floorAt` adds `pileTop(n)` from `world.js`: 0.33 for 1–3 logs, 0.62 for 4–5, 0.90 for 6), so you step or hop onto it like a block. Blocks and digging are refused on a pile's tile ("Take the logs off first"). A new pile can't start in water or where a block couldn't go (`logProblem`).
  - **Look (`WorldScene.setPiles`, `logGeometry`, `LOG_SLOTS`, `logOffset` in `world3d.js`):** one instanced mesh of logs rebuilt on every change. A log is an 8-sided trunk (radius 0.165, 0.96 long) with streaky bark facets and pale cut ends with a darker growth ring. A full pile is about 0.9 high. Casts shadows.
  - **R:** sets the direction of a new pile (`game.rot` % 2); with the mouse over a placed pile, R turns that pile.
  - **Preview:** the hover box is 1 unit high with a see-through log where the next one will lie.
  - **Taking back:** an axe click on a pile (`pileAt`, within 1.6 units) takes the top log off in one swing. Axe clicks check benches, then piles, then trees.
  - **Sync and saves:** the `pile {ix, iz, r, n}` message (n 0 = gone) and `welcome.piles`. Endless saves store `piles`; island saves get an extra `piles` field (`cleanPiles`).
- **Furniture** (`placeBench` / `takeBench` / `applyBench` / `useWorkbench` in `main.js`): Workbench, Chair, Table, Bed, Lamp and Bookshelf items (`place: true, furn: true`) are put on a neighbouring tile (far tiles are walked to, like digging), front facing you (+ R turns).
  - **Data:** `world.benches`: Map(`cellKey` → `[ix, iz, rot 0..3, type]`), `type` = index in `FURNITURE` (`world.js`: workbench 0, chair 1, table 2, bed 3, lamp 4, shelf 5, and the decorations crate 6, barrel 7, planter 8, flowerbox 9, seat 10, pennant 11; also the item ids). Entries without a type (older saves) are workbenches. `PathFinder.passable` treats every furniture tile as blocked, so you can't walk, dig or build there.
  - **Rules (`benchProblem`):** not in water, plus the block-placing checks (`placeProblem`). The hover outline is a 1-unit-high box with a see-through preview of the held piece (`furnitureGeometry(type)`).
  - **Look (`WorldScene.setBenches`, `furnitureGeometry(t)` in `world3d.js`):** one instanced mesh per type, rebuilt on every change. Original vertex-coloured box models (`boxModel`), each fitting one tile and casting shadows:
    - Workbench (after the user's reference): a desk with a plank back board and pinned blue and white notes, a two-drawer cabinet, an open shelf, and tools and tins on top.
    - Chair: slatted back, leaf-green cushion. Table: plank top with a runner, a potted flower, a mug and a book. Bed: headboard and footboard, cream mattress, white pillow, a leaf quilt. Bookshelf (against the back of its tile): two rows of coloured books and a top shelf with a plant and a jar.
    - **Decorations** (also placeable on a boat's deck): Crate (braced, with a smaller crate on top), Barrel (an octagonal body with a bulge, iron hoops and a lid; `boxModel`'s `add` now takes a y rotation), Potted Plant (a terracotta pot with a little leafy tree), Flower Box (a planter of six coloured flowers), Bench (a garden bench with a backrest and armrests; item id `seat`) and Pennant Pole (a pole with a red pennant and a brass finial).
    - Lamp: a post with a dark iron lantern; its panes are a separate unlit amber HDR mesh (`lampGlowGeometry`, `Color(1.9, 1.05, 0.32)`) that blooms. No real light (lights cost every lit pixel).
  - **Workbench crafting:** clicking a workbench (left click unless you hold a block or furniture, or right click with anything) walks next to it (`inReach`) and opens the inventory screen as the **Workbench** (`inventory.open('bench')`), which adds the workbench recipes (see **Inventory**).
  - **Picking up:** an axe click on any piece (`benchAt`, within 1.6 units) takes it back as its item in one swing. Axe clicks check furniture before log piles and trees.
  - **Sync and saves:** the `bench` message (with `t`) and `welcome.benches`. Endless saves store `benches`; island saves get an extra `benches` field next to the encoded map (`cleanBenches`, which accepts 3 or 4 numbers).
- **Wood blocks:** Wood places as `K.WOOD` (11, plank texture in `TERRAIN_GLSL`: 4-texel planks with seams, staggered end joints, lit edges and the odd nail; area "Wooden Floor"). Only the axe breaks it (one hit, gives Wood back); the shovel and pickaxe say "That's wood: use the axe".
- **Wooden wall blocks:** the Wooden Wall item (2 per Log at a workbench) places as `K.WALL` (13), one `STEP` per block like any block, so three stacked (1.5) are too tall to climb. The shader draws a log cabin: one horizontal round log per block (8 texels, shaded round, dark gaps, lit tops, bark streaks) with pale ringed cut ends at tile corners; the top shows the logs from above. `isWood` includes it: only the axe breaks it (gives the Wall back). Area "Log Cabin", minimap `[122, 78, 44]`.
- **Saving:** singleplayer on a saved world (`game.saveName`) writes the digging back to the save at most every 1.5 s. Endless saves get `edits` (`endlessMap(name, seed, edits)`, `cleanEdits`, max `MAX_EDITS` = 20000); island saves are re-encoded from the dug base.
- **Multiplayer:** see the `dig` message. Other players see the swing (from the `dig` broadcast) and the held tool (the tens digit of the `a` code).

## Boats (mirror of `src/client/boat.js`, the boats section of `main.js`)

A sea adventure needs a ship. A boat is a moving platform with its own deck: you walk around on it while it bobs and sails, and you steer it from the wheel. Original model after the user's reference.

- **Kinds of boat (`HULLS` in `boat.js`, `look.t`, at the user's request after a reference sheet of fishing boats; original designs). A Fishing Skiff and a Trawler were added too, then removed at the user's request; looks with their `t` (2, 3) now load as cabin boats:**

  | t | Item | Size (L × W) | Deck | Top speed | Turn | Accel / glide | What's on it |
  |---|---|---|---|---|---|---|---|
  | 0 | `boat` (Cabin Boat) | 6.3 × 2.4 | 0.45 | 6.5 | 0.85 | 0.9 / 0.45 | the original: swappable cabin, roof, top, mast, deck props and every upgrade |
  | 1 | `rowboat` | 2.4 × 1.04 (shrunk a quarter at the user's request) | 0.18 | 3.4 | 1.5 | 1.4 / 0.8 | two thwarts (walk over them), animated oars, a bow line and a crate; at the helm you row, facing the stern |

  - **Rowing (at the user's request):** the rowboat's oars are their own meshes (`oarGeometry`: grip, loom, collar and blade), each on a pivot at its rowlock (`OAR`; `b.oars`). `Boats.row(b, dt)` runs a stroke clock `b.rowPhase` while the boat moves or turns, from its drawn motion (so it works the same for other players' boats): 0.25 + 0.55 × effort strokes a second, backwards going astern, still when it isn't moving. Catch (phase 0): both blades forward (sweep ±0.55 rad) and in the water; drive (0–π): they sweep aft dipped deep (tilt −0.42); recovery (π–2π): lifted clear (−0.18) and swung forward.
    - At the rowboat's helm the rider faces the stern (`c.ry = yaw + π`) and plays `ANIM.ROW` (5, `character.js`), posed from the same clock (`ch.rowPhase`, set from the boat in `main.js` for you and for remote riders): a forward lean and arms reaching out at the catch, leaning back and pulling the handles in through the drive, braced knees, and a small effort squash as the blades bite. It goes over the network in the `a` code like any animation.
  - Each hull has its own outline (`W`, `BOW0`, `TIP`, `STERN`), deck height, `HELM` (where you stand to steer), `WHEEL` (what you click), `KEEL_DEPTH` (riding up over shallows), handling, and deck obstacles (`obs`). Its hull points (`pts`, for `hullClear`) and collision circles (`circles`, for `boatHit`) come from the outline; `reach` bounds it for the quick distance check.
  - Every hull-dependent function takes the hull (`halfW(z, hl)`, `walkable(…, obs, hl)`, `onDeck(lx, lz, hl)`, `nearestWalkable(…, obs, hl)`, `hullClear(…, hl)`, `boatHit(…, hl)`, `outline(inset, hl)`), defaulting to the cabin boat; a boat carries `b.hull` (set in `setLook`), and `deckY` uses its deck height. Driving uses the hull's speed, turn rate, acceleration and glide; the engine and rudder upgrades still add 15% / 20% a level.
  - **Models (`TYPE_BUILD`, `typeGeometry(t)`):** a shared clinker shell (`hullShell`: keel, three tapering planks, waterline stripe, rail, cap, posts, stem, sternpost, plank deck), a tinted band (`hullBand`, hull colour), plus each kind's fittings. `typeGeometry` also takes optional cabin, roof and glow geometry for future kinds. The sheer scales with the hull (`SH`, `sheerAt(z, hl)`). Each boat object has meshes for these (`b.tm`: base, paint, cabin, roof, glow); the cabin boat's own meshes (`b.sloopMeshes`) are hidden on the other kinds. The hover outline uses the boat's own model (`boatGeometry(b)`).
  - **Fixed models:** the other kinds have no swappable parts, deck props or decorative upgrades (`layoutOf` returns their fixed layout). Customize shows only the colours they take (the rowboat: hull), the banner hides the part buttons they don't have, and the boat panel lists only Engine and Rudder (`UPGRADES[i].all`).
  - Launching uses the held item's kind (`ITEMS[id].hull`), searching further out for big boats; taking a boat out gives back its own item (`HULL_ITEMS[t]`). The boat locker keeps paint, name and upgrades across kinds. Hand model: the toy boat for every kind.
  - **Checked:** in Node, each kind builds (about 2.4k triangles for the rowboat, 7k for the cabin boat) and a flood fill from the helm reaches its whole deck. Headless in game: they render, board at the helm with F and pick up speed, no errors.
- **Getting one:** craft a boat at a workbench: Rowboat (6 Wood + 4 Sticks) or Cabin Boat (12 Wood + 4 Logs + 4 Leaves; item `boat`). Both stack 1; hand index 22. With it in hand, click water within 5 tiles (`launchBoat` / `launchAt`): the boat is put down stern toward you, pointing away from you (yaw snapped to 45°), moved 1.5–4 tiles out until the whole hull floats (`hullClear`). It goes up to 10 tiles out when the water right there is too narrow for the hull. Otherwise "Not enough open water here".
  - **Launch blueprint (at the user's request):** with a boat in hand, a see-through blue copy of it (`updateLaunchBlueprint` in `main.js`) bobs on the water where a click would put it in, facing the way it will. It's the boat's main shapes merged (`blueprintGeometry(look)`: hull, cabin, roofs, top, mast) at opacity 0.42, framed by a few pale lines (`blueprintLines(look)`: the waterline, the rail, ribs, the stern, the stem, boxes for the cabin and wheelhouse, a line for the mast), both shared per look. It uses the look the boat will get (`lockerLook`: the boat locker, so the right size, kind and parts). Where it can't go (too far, land, not enough open water) it turns red with its stern on the clicked spot, drawn over the terrain (no depth test) at 0.28. The click and the blueprint share one plan (`launchPlan(ix, iz, t)`: `{x, z, y, yaw, look, hl, why}`), re-planned only when the mouse, camera, your tile, the terrain or the number of boats changes. Tested headless: the boat launched exactly where the blueprint showed it.
  - An axe click on an empty boat, or right-click → **Put boat in inventory** (the bush menu, `#ctx-menu`, relabelled), takes it back as an item ("Someone is aboard" if a remote player rides it).
- **Model (about 6.3 × 2.4 tiles, after the user's references; made cozier, then rustic and wooden, at their request):** built once and shared by every boat. Every plank, board and shingle gets its own weathered tone from a stable hash (`hrand` / `tone`).
  - `baseGeometry`: everything with fixed colours.
    - **Sheer (`sheerAt(z)`, `sheerGeo`):** the hull sides, rail, rubbing strake, posts, portholes, bowsprit, anchor, lantern posts, the tinted band and the trim sweep up toward the bow (+0.3 at the tip) and a little at the stern (+0.12). Each vertex rises by `sheerAt(z) × sheerW(y)` (0 at the waterline, full at the rail), so the planks stretch smoothly. The **deck, wheel and props stay flat**, so walking (`deckY`) is unchanged. In `parts()` builders, `sheer(true / false)` switches it on for the pieces added after it.
    - Hull: a narrow dark keel, then four clinker-built strakes tapering in toward it (insets 0.17 / 0.1 / 0.05 / 0.015, a rounder bottom), a cream waterline stripe, a proud dark rubbing strake under the rail, a curved stem post rising above the bow and a sternpost; the strakes (`LOW_STRAKES`: each plank band tucked under the one above, weathered grey-browns, grime on the lowest), rows of nail rivets along the upper strakes, brass portholes, a bowsprit and an anchor on the port bow.
    - Deck: planks of uneven tone with dark seams between them and a butt joint with two nail heads on each; a rail with a weathered cap and wooden posts along it.
    - Cabin: a dark base, corner posts, dark battens on every wall and eaves; wood-framed windows with flower boxes on the walkway side; a door with a round brass window.
    - Wheelhouse and mast: the wheelhouse window, and a mast with a yard, a brass cap and standing rigging (a forestay to the bowsprit end, `BOWSPRIT_END`, and two backstays to the stern quarters).
    - Fittings: the ship's wheel, a barrel, roped crates, a chest with a potted plant, a coil of rope and four lantern posts.
  - **Tinted parts** use pale grey vertex colours times a per-boat material colour (the boat's look): `hullPaintGeometry` (three clinker strakes along the top of the hull, `BAND_STRAKES`, each with a shaded lower edge), `cabinGeometry` (board walls of uneven tone on the cabin and wheelhouse) and `roofGeometry` (shallow gables of wooden shingles stepping down from the ridge, staggered course by course). The canvas colour also tints the flag, the awning and half the bunting.
  - Lantern panes glow amber (unlit HDR). `boatGeometry()` (base + band + cabin + roofs) is the hover highlight's outline.
  - `outline(inset)` keeps its ends inside the hull's length for negative (outward) insets. Collapsed end points broke the triangulation of the band's hole and painted the whole deck.
  - **Cutaway:** every boat material is `seeThroughMaterial(…, { minY: SEA + DECK + 0.32 })`, so the cabin, roof and cargo open up in a dithered circle around you when they'd hide you, while the deck and rail stay solid.
  - **Bobbing:** `bobY` (±0.045) plus a small roll and pitch per boat; riders use the same `deckY`.
- **Look: name, paint, parts, props and upgrades (`boatlook.js`, `b.look`).** The format is `{ n: name (up to 16 letters, numbers, spaces and a little punctuation), c: [hull, cabin, roof, canvas] indices into BOAT_PALETTE, u: upgrade levels, p: [cabin, roof, top, mast] choices (PART_KEYS / PART_COUNTS), d: the prop on each of the 6 deck spots, t: the kind of boat (`HULL_ITEMS`; older looks are 0, the cabin boat), f: furniture and decorations on the deck, `[type, x cm, z cm, quarter turns]` (up to `MAX_DECO` 24), s: `[length level, height level]` (`SIZE_COUNTS` [5, 4]; cabin boat only, others are `[0, 0]`) }`. Looks saved before parts existed get the default parts and props, which are the original layout.
  - The palette (17): terracotta, brick red, sunny yellow, orange, cream, sage, sea green, harbour blue, plum, charcoal, varnished wood, driftwood, dark oak, and (added with deck decorations) rose, mint, navy and white. A new boat is plain wood: a dark oak hull, a varnished cabin, a driftwood roof and cream canvas, with no name. Boats already launched keep the colours they had.
  - `Boats.setLook` tints the materials, shows the built upgrades and draws the name plates.
- **Length and height (at the user's request, cabin boat only):** the hull's part menu in edit mode has a **Size** section with − / + for **Length** (`SIZE_LEN`: +0 / 0.75 / 1.5 / 2.25 / 3, so 6.3 to 9.3 tiles) and **Height** (`SIZE_H`: +0 / 0.2 / 0.4 / 0.6 of freeboard).
  - **How it's built:** every model piece is built for the original boat and then fitted to the size while merging (`parts()` → `sizeGeo`, size set by `useDims(look)`; the geometry cache key gets `@E,H`). Forward of `SPLIT` = 0.62 (just ahead of the plank cabin) everything moves E toward the bow (`zAt`); pieces reaching well across the split (hull, rail, deck planks and seams, rigging) stretch instead, over the hull's straight middle. Heights rise by H above the deck, and the hull's upper planks between `RAMP0` 0.14 and `RAMP1` 0.39 stretch to meet it (`mapY`). Small pieces move whole (nails, posts, windows, shingles; `userData.rigid` forces it, e.g. the life rings). Rail posts and nails are added across the new gap (`fillGap`), and the string lights and bunting are laid out for the size (`lightRun`, `buntingPoints`, built with `fixed(true)`).
  - **The hull (`hullOf(look)`, cached per size):** `BOW0` / `TIP` + E, `DECK` + H, hull points every ≤ 2 tiles along the longer sides, extra keel circles, `reach`. A longer boat is 3.5% faster per tile and turns a bit slower (× √(6.3 / (6.3 + E))). Deck spots, the deck obstacles (`layoutOf`, keyed with E) and props move with the bow. The cutaway's `minY` follows the deck height (materials per H: `baseMat`, `tintMats`, swapped in `setLook`).
  - **Changing it (`resizeBoat` in `main.js`, `resizeLook` in `boat.js`):** furniture forward of the split moves with the bow, and a rider on the foredeck is carried along. Refused when a placed piece would no longer fit ("Clear the foredeck first…") or a longer hull wouldn't float clear of land and other boats. Synced, saved and kept in the boat locker like the rest of the look. Icons stay at the original size.
  - **Checked:** in Node every size builds (about 9.6k → 10.2k triangles fully upgraded) and the deck stays connected from the helm for every cabin × mast at the longest size. Headless in game: screenshots at four sizes, and the edit-mode buttons lengthen, raise and shorten the boat with the rider moving with the foredeck. No errors.
- **Furniture and decorations on the deck (at the user's request: "place items and decorations on it"):** aboard any boat, a click on the deck with a furniture or decoration item in hand puts it there (`placeOnDeck` in `main.js`): where the click meets the deck plane (`deckPoint`), snapped to 0.125, facing you plus R's quarter turns. It's drawn at `DECO_SCALE` 0.6 of its land size, standing on the deck (`b.deco` meshes, rebuilt in `setLook` when `look.f` changes; lamps get their glowing panes, `furnitureGlowGeometry`), and riders walk around its real **footprint** (`decoFoot(t, r, lx, lz)`: the model's bounding box at `DECO_SCALE`, turned with it, as a rectangle; `withDeco` adds them to `b.obs.rects`).
  - **Refused:** if its footprint pokes past the rail or overlaps the cabin, the wheel post, a prop or another piece (touching is fine; "There's no room for that there", `decoFits`); if it would cover the helm or where you stand; past 24 things; or if it would cut a real part of the deck off from the wheel (`deckReach`, a flood fill on a 0.1 grid from the helm, may lose its own footprint plus a small dead-end nook: 80 + 12% of the reachable deck).
  - **Fixed at the user's report ("there is clearly space yet I can't place it"):** pieces used to be 0.3-radius circles checked with a whole person's clearance (0.52 from the rail, 0.6 apart), and closing any dead-end nook counted as blocking the deck. On the cabin boat with a crate in front of the cabin, the spots a bench fits went from 16 to 26–33 (by its turn); the starboard walkway (the only way from the wheel to the foredeck) and the helmsman's way out of the aft deck stay protected.
  - **Blueprint preview (at the user's request):** while aboard with a furniture or decoration item in hand, a see-through blue copy of it (`updateDeckBlueprint`: the model at opacity 0.55 in `0x3a9cff` plus its edges in a deeper blue, `EdgesGeometry` cached per type, renderOrder 8) sits where a click would put it, turned the way it will face (R turns it live). It's a child of the boat's group, so it bobs and rolls with the deck. It turns red (`0xff4a3a`, darker red edges) wherever placing would be refused. The preview and the click share one plan (`decoPlan`: spot, rotation and the reason it can't go), and the flood-fill check is cached until the spot or the deck changes.
  - An axe click on a placed piece (within 0.55) takes it back as its item (`takeFromDeck`). Both go through `setBoatLook`, so they sync (`boatlook`), save with the boat and move riders out of the way (`unstickRider`).
  - Tested headless: a Potted Plant, Pennant Pole, Flower Box and Crate placed on the cabin boat's foredeck; a Bench at the helm and a Lamp on the narrow side walkway were refused; the axe took a Barrel back into the inventory. No errors.
- **Swappable parts and deck props (at the user's request; free to change, in the panel's Build and Deck props sections):**
  - **Cabin (`CABINS`):** Plank cabin (1.3 × 1.8, the original), Small cabin (1.3 × 1.1, further aft, leaving the foredeck open), or No cabin (an open deck). Trim (windows, door, flower boxes, battens) and board walls are built from the cabin's size (`cabinTrimGeometry`, `cabinWallsGeometry`).
  - **Roof (`ROOFS`):** Shingles (stepped gables), Roof deck (flat planks with a low railing all round), or Canvas (an arched canvas over the cabin, tinted by the canvas colour, not the roof colour). It needs a cabin.
  - **Top (`TOPS`):** Wheelhouse, Lookout (a planked platform with posts, a rail and a short ladder), or None. It needs a cabin, and nothing stands on a canvas roof.
  - **Mast (`MASTS`):** Pennant (a pole with a yard and the waving flag), Sail (a square sail of four cloths bellying forward, tinted canvas, on a longer yard with a boom), or None. It goes up through the wheelhouse, from the cabin roof, or, with no cabin, is stepped on deck at (−0.55, −0.6) as a small obstacle. Bunting runs from wherever the masthead is and needs a mast.
  - **Deck props (`PROPS` on `DECK_SLOTS`):** 6 spots (port foredeck, port bow, starboard bow, bow tip, port stern, starboard stern) each hold Nothing, Crates, Barrel, Chest (with a little plant), Rope coil (walk over it), Potted plant or Lantern (its pane glows). Each spot has a `maxR` for the biggest prop it takes: the starboard stern only small things and the port stern up to a chest. Big props on both sides boxed the helmsman in. `propAt` treats a too-big prop as nothing.
  - **Layout (`layoutOf(look)`, cached per parts and props):** decides the cabin, which roof, top and mast actually show, the wheelhouse spot and the mast, and `obs`, what blocks walking (the cabin's footprint, the wheel post, a deck mast, each prop's radius). `walkable(lx, lz, r, obs)` and `nearestWalkable(lx, lz, obs)` use the boat's own `b.obs`. After a change, `unstickRider` moves anyone now standing inside something to the nearest free spot.
  - **Checked:** a flood fill from the helm over all 576 combinations of cabin × mast × each spot empty or holding its biggest allowed prop. The helm is never blocked, and the worst cut-off is a 66-spot sliver (of 1552) against the port rail near the bow, with props on both bow spots.
  - `Boats.setLook` swaps each part mesh's shared geometry (built once per variant and kept in the geometry cache).
- **Upgrades (`UPGRADES` in `boat.js`, levels in `UPGRADE_MAX`), paid from the inventory (free in creative mode):**
  - **Engine** (3 levels: 6 Wood + 4 Stone; 10 Wood + 4 Logs + 8 Stone; 16 Wood + 8 Logs + 14 Stone): top speed +15% a level (`engineFactor`), and a stove-pipe chimney on the cabin roof that grows taller each level.
  - **Rudder** (2: 4 Wood + 4 Pebbles; 8 Wood + 4 Stone): turning +20% a level (`rudderFactor`).
  - **Canvas awning** (6 Sticks + 12 Leaves): a gabled canvas in folds on four poles over the foredeck (above head height, so you walk under it), in the canvas colour.
  - **String lights** (6 Sticks + 2 Wood + 4 Berries): a sagging wire around the deck on the lantern posts with warm glowing bulbs.
  - **Bunting** (4 Sticks + 8 Leaves + 4 Berries): lines from the masthead to the bowsprit and to the stern, with pennants alternating canvas colour and white.
  - **Life rings & fenders** (4 Wood + 2 Logs): red-and-white life rings on the cabin and the stern, tyre fenders on ropes along both sides, and a boarding ladder over the port quarter.
  - **Fishing gear** (8 Sticks + 2 Pebbles + 4 Leaves): a rod with its line over the starboard quarter, a net drying on the rail, and a bucket of fish.
- **Edit mode (at the user's request: the panel's rows were confusing):** **Customize** in the boat panel (`setBoatEdit`, `game.boatEdit` = the boat's id) freezes walking and switches off the canopy/cabin cutaway (`setSeeThrough(camera, null)`; it painted the hover outline over the cutaway pixels).
  - A banner across the top (`#edit-banner`) has Hull / Cabin / Roof / Top / Mast buttons (to reach parts that are switched off and can't be clicked), Name & upgrades (back to the panel) and Done. **B** or **Esc** also finish; Esc closes an open part menu first.
  - Hovering the boat outlines the part under the cursor (`editPick`: a raycast against the boat's meshes, which carry `userData.part` / `slot`; `Boats.partMesh` picks the mesh to outline; `setHighlight` kind `'mesh'`). Empty deck spots show a faint ring so they can be clicked (`Boats.setEditing`).
  - Clicking opens the **part menu** (`#part-menu`, `renderPartMenu`) beside the cursor: the part's styles as pictures, with the current one framed in gold, and a colour row where the part takes one. Hull: colour. Cabin: style and cabin colour. Roof: style and roof colour (canvas colour for the canvas roof). Top: style. Mast: style and the flag and sail colour. A deck spot: the props that fit there.
  - **Pictures (`boaticons.js`, `partIcon`):** each variant is rendered once in the boat's own colours (`partPieces` in `boat.js` lists its shapes and which colour tints each) into a 48×48 transparent target. It's read back, converted to sRGB, given a dark pixel outline, and cached per part, variant, parts and colours. "None" options get a dashed square with a cross.
- **The boat panel (`#boat-panel`, `renderBoatPanel` in `main.js`):** **B** while aboard, or the **Boat** button that appears next to "?" while aboard; **B / Esc / Close** close it, and movement keys are ignored while it's open.
  - It has a name field (applied on Enter or leaving the field), a big **Customize** button (edit mode, above) and the upgrades. Paint, parts and props live in edit mode now, not in the panel.
  - Each upgrade row shows level pips, the next level's cost (counts you're short of in red) and Build / Upgrade (gold when you can pay; "Done" at the top level).
  - Every change goes through `setBoatLook`, which applies it, sends `boatlook` and saves.
- **The boat locker:** taking a boat out of the water (axe, or right-click → Put boat in inventory) keeps its look in `localStorage['settleon.boatlook']`, and your next launch gets it back, so paint and upgrades aren't lost when the boat goes into your inventory.
- **Deck coordinates:** local +z is the bow, +x starboard. `halfW(z)` is the hull's half width (1.2, curving to the bow tip at 3.3; stern at −3.0); the deck is 0.45 above the sea (`BOAT.DECK`). `walkable(lx, lz, r, obs)` keeps riders (radius 0.2) inside the rail and out of whatever the boat's layout puts on deck (see **Swappable parts and deck props**). After changing any deck layout, flood-fill from `BOAT.HELM` to check it stays connected. `toLocal` / `toWorldXZ` convert using the boat's shown pose.
- **Boarding (`tryBoard`):** walking or swimming toward a boat climbs aboard when the spot 1.25 ahead is over its deck (`onDeck`), from land at most 1.4 below the deck or 3 above it. It also works mid-step, since holding a key chains steps. **F** near a boat (within 4.5 of its hull) boards it straight at the wheel and takes the helm.
- **On deck (`walkOnDeck`):** free movement (not tile-locked) in the same 8 screen directions at walking or running speed, sliding along obstacles. Pushing against the rail for 0.25 s steps off (`leaveBoat`): onto land within 1.3 up / 3 down of the deck, or into the water to swim ("Can't step off here" otherwise). Clicks while aboard only work the wheel (click it, or **F**, to take or leave the helm).
- **Sailing (`driveBoat`):** a **throttle** and screen-relative steering (at the user's request):
  - **Throttle (`THROTTLE` in `boat.js`, a ship's telegraph):** each press of **W / S** (or the up / down arrows) moves it one notch: Astern (−25% of `MAX_SPEED`), Stop, Slow (30%), Half (62%), Full (100%). Holding a key repeats a notch every 0.3 s after 0.4 s. The boat holds the setting with no key held. Presses are counted as key events (`Input.takeThrottle`), so a quick tap between two frames still counts. The **throttle lever** (`#throttle`, bottom-left above the "?" button, `throttleHud`, at the user's request a wooden gear shift) shows at the helm. It's a plank panel with a dark groove and a notch per gear (Full at the top, Astern at the bottom, `GEAR_PX` 26 apart) and an iron lever with a brass knob (orange in Astern) that clunks to its notch with a little overshoot (CSS `cubic-bezier` transition). The current gear's name is lit, and the forward speed shows below. Drag the lever, or click a gear's name, to set it. Letting go of the wheel (F) rings Stop, so the boat glides to a halt.
  - **Steering is relative to the boat, not the camera (at the user's request):** the camera is fixed at 45° steps, so camera-based steering couldn't turn the boat a full 360° without moving the camera. **D** puts the rudder over to the boat's own right and **A** to its left (the heading `yaw` decreases / increases), from any heading, and also going astern (the turn isn't reversed like a real rudder). When the boat points toward the camera the keys therefore look swapped on screen. Q / E still turn the camera as usual.
  - The sail fills and slackens gradually toward the throttle's share (`SAIL_RATE` 1.6/s), and forward speed eases toward `sail × MAX_SPEED` (6.5): `ACCEL` 0.9/s when building speed, 1.4× that when backing the sail against your way, and `GLIDE` 0.45/s with no sail, so it carries its way a long time.
  - Velocity is kept in the world and split into forward and sideways each frame. The keel damps sideways slip (`KEEL` 2.2/s), so the hull drifts out a little in turns.
  - The rudder swings over at `RUDDER_RATE` 3.5/s and springs back to centre 1.8× faster. It only bites with water flowing past: the turn rate is `rudder × TURN (0.85 rad/s) × min(1, |speed| / FULL_TURN_SPEED 3)`, at least `IDLE_TURN` 15% at a standstill.
  - Boats sail anywhere there's water (`hullClear`: every hull point over a cell below `SEA`), the sandy shallows included (at the user's request). Over shallows the boat rides up (`lift`, eased at 3/s, up to the keel depth 0.62) so its keel clears the highest seabed under its bow, middle and stern; riders rise with it (`deckY`). The sand drags: top speed falls by up to `SHALLOW_SLOW` 65% (in full once it has ridden up `SHALLOW_LIFT` 0.3, about 2.3 tiles/s at Full instead of 6.5), and running onto a sandbank sheds speed at `SAND_DRAG` 1.5/s instead of gliding.
  - Against land the hull bounces back (velocity × −0.25), the sail spills, and above 1.2 tiles/s it splashes and says "Bump! Land ahead".
  - **Against other boats (at the user's request; `boatHit` in `boat.js`):** each hull is four circles along its keel (`HULL_CIRCLES`: z −2.2 / −0.75 / 0.75 / 2.2, radius 1.1 / 1.2 / 1.2 / 0.95), tested against every other boat's drawn pose (`sx`, `sz`, `syaw`) within 7.2. After each move `driveBoat` pushes the sailed boat out of the deepest overlap (if that spot floats), reflects 30% of its speed into the other boat and keeps 80% of the rest (scraping hulls), and halves the sail. Above 1 tile/s into it there's a splash at the contact point and a toast ("Bump! Mind the other boat", or the other boat's name), at most every 1.5 s. Turning can't swing the hull deeper into another boat. Only the sailor's own boat moves: parked and other players' boats don't budge (whoever sails a boat moves it). Launching skips spots that overlap a boat.
  - Tested: in Node, head-on and 45° rams at 6.5 tiles/s bounce once with at most 0.04 overlap in a frame. Headless in game, ramming a parked boat at full throttle bounced, pushed in again under sail, and came to rest against it with no overlap and no errors.
  - Measured headless: three taps of W (Full) reach about 4.5 tiles/s within 6 s with no key held. Hard over at 6 tiles/s turns about 25°/s, sliding up to 1.8 tiles/s sideways. Backing the sail stops it from 3.6 in about 3 s.
  - After letting go of the wheel you stay the driver until it has glided to a stop.
- **Body motion (`Boats.update`, for every boat, from how its shown pose moves):** it bobs, rolls more at speed, heels out of turns (`−turn rate × forward speed × 0.035`, up to 0.12 rad), and lifts its bow when picking up speed and slightly at speed. A jump of over 2.5 tiles in a frame counts as a teleport (no speed, no wake).
- **Wake (`Wake` in `boat.js`):** pooled flat foam squares on the water (`WAKE_MAX` 520, additive, fading by darkening, snapped to a 1/8 grid so they stay pixel-crisp, renderOrder 7 after the water). A moving boat sheds 8 sets per tile travelled. Each set is two bow-wave pieces from both sides of the bow, pushed outward (0.5 + 1.1 × speed share) and falling behind into a V, plus one churned stern piece that lingers 2–3 s. Brighter the faster it goes; from the stern end when going astern.
- **Splashes and bow spray (at the user's request: "improve water splash of boat"):** water splashes are their own effect now (`Effects.splash`, used for every `impact(…, 'water')`: boats, fish leaps, the fishing bobber), not the landing dust.
  - **A splash:** a crown of 8–42 droplets (unlit boxes, pale blue to white, about 12% slightly HDR so they glint in the bloom) flung up and out, a column of bigger drops in the middle, and a ring of foam flecks spreading on the surface with churned foam in the middle. Droplets fall with gravity (11), stretch as they fall, and leave a fleck of foam where they hit the water (60%). Foam is additive, snapped to a 1/8 grid like the wake (`MAX_DROPS` 320, `MAX_FOAM` 200).
  - **Boats:** launching (0.9), taking out (0.8), running aground (at the bow or stern end that hit, thrown forward, 0.55–1 by speed) and boat-on-boat bumps (between the hulls) all use it.
  - **Bow spray (`Boats.spray`, given `effects` from `main.js`):** above 1.1 tiles/s, droplets are thrown up and out from both sides of the bow (`150 × (k − 0.12)^1.4` a second per side, k = speed share), in rhythmic slaps as the bow meets a wave (`sin(2.3 t)³`), heavier on the side it heels toward, plus white foam peeling away along the hull. At speed the stern throws a little churn; going astern the stern sprays instead, more weakly. Scaled down for the rowboat.
  - Measured headless at Full (5.4 tiles/s): about 85 droplets and 145 foam flecks alive. No errors.
- **Who moves it:** `game.driving` is the boat you're sailing (also while it coasts). The driver sets the pose directly and sends it at most every `BOAT_SEND_MS` = 100, stamped with its own clock (`t`, ms).
  - **Everyone else replays the driver's path** (fixed at the user's request: other players saw the boat twitch while sailing). Easing toward each update made the boat surge after every message and stall before the next, and the bow-pitch and heel, which come from the drawn speed, amplified it.
  - `Boats.sample` keeps the last 24 timestamped poses (yaw unwrapped). `netPose` draws the boat `NET_DELAY` = 0.12 s behind the driver's clock, interpolating between the two samples around that moment, or carrying on along the last motion for up to 0.25 s if none has arrived yet. `Boats.update` follows it at rate 25/s.
  - **Clock offset `b.off`:** the quickest delivery seen. It drifts up slowly (2% a sample), or faster (15%) when samples keep arriving later than the delay allows, so a laggy connection gets more slack.
  - Taking the helm drops the old samples. Without timestamps (an older server) it falls back to extrapolating from arrival times.
  - **The tilt is synced too** (it still twitched): heel out of turns (`b.heel`) and bow lift (`b.lean`) are worked out from the drawn motion only on the driver's screen, where it's smooth, and sent as `h` / `l` with every update. Other players interpolate them with the pose (`netPose`), because deriving them from a replayed path (a derivative of a derivative) amplified every small bump. The gentle wave bob and roll stay local. Without `h` / `l` (an older client) it falls back to the local estimate, whose acceleration term is smoothed at 1.5/s.
  - **Simulated** (6 tiles/s with turns, updates every 100 ms with 50–130 ms latency, 60 fps): the average frame-to-frame change in drawn speed went from 1.77 to 0.06 tiles/s (29× smoother). Arrival-time extrapolation alone reached 0.53. Checked with a `ws` bot driver and a headless watcher that the timestamps arrive and the playback interpolates.
- **Riders in multiplayer:** `move` carries `b: [boat id, deck x, deck z]` while aboard. The server keeps it as `player.rb` and adds it as a 7th element to that player's `snap` entry. Clients ease the deck position and place the rider on the deck as it's drawn, so riders stay glued to the boat instead of lagging behind it.
- **Sync and saves:** the `boat {id, x, z, yaw, on}` message (`on` false = taken out), kept in `room.boats` (max 200, cleared with the world) and sent in `welcome.boats`. Endless saves store `boats: [[id, x, z, yaw]...]` (`cleanBoats`, max `MAX_BOATS` 200); island saves get an extra `boats` field. The minimap shows boats as orange dots.
- **Tested headless (DevTools protocol, plus `ws` bots):** launch, F to the helm, 10 s at full sail, letting go and coasting to a stop, walking on deck, stepping off into the sea, swimming back aboard. A second client saw the boat moves and the rider's deck position, and a late joiner got the boat in `welcome`. `__dbg.launchAt(ix, iz)` and `__dbg.boatKey()` help scripts.

## Fishing (mirror of `src/client/fishing.js`)

At the user's request, after a reference of a cozy pixel fishing game: time your cast, wait for the bite, then reel. The mechanics are our own (the reference's look only inspired the HUD). Client-only: other players see you holding the rod, not the line.

- **The rod:** the **Fishing Rod** (`rod`, a tool, hand index 23) is crafted at a workbench from 3 Sticks + 2 Leaves + 1 Pebble. In hand it's a long tapering pole with a reel (`setTool`); the line runs from its tip ring (`toolGrip` local (0, 0.02, 0.98)).
- **Cast:** with the rod in hand, press on the screen (on land or aboard a boat, not on the wheel): the **cast power** meter (`#fish-power`, right edge) swings from empty to full and back every `POWER_PERIOD` 1.1 s while you hold. Let go to cast (`input.onUp`, `Input.pressed`): the bobber arcs out 0.55 s toward where you pressed, `CAST_MIN` 1.3 + power × 5.7 tiles away (up to `CAST_MAX` 7), and you turn to face it. 90%+ is a **Perfect cast** (shorter wait, a longer bite window, rarer fish twice as likely). Landing on land snags ("Snagged on the shore") and reels back.
- **Wait and bite:** the bobber floats 2–7 s (×0.6 after a perfect cast) with a nibble or two (small dips and ripples), then a fish bites: a splash, the bobber pulled under, and a bouncing **"!"** over it (`#fish-bang`). Click within `BITE_WINDOW` 0.85 s (+0.15 perfect) to hook it; too late "It got away", and clicking before the bite scares it off ("Too early").
- **Which fish (`FISH`, `weightAt`), chosen at the hook by the water depth under the bobber:** Minnow (str 0.2, mostly shallows), Sunny Perch (0.4), Spotted Koi (0.5, shallow), Silver Mackerel (0.62, 1.3+ deep), Reef Tang (0.55, 0.5–1.6 deep), Golden Carp (0.8, rare anywhere), Moonfish (1.0, 2.2+ deep, much likelier at night). Each has a size range in cm.
- **Reel (`#fish-reel`, above the hotbar):** hold to reel. The **tension** needle rises 0.75/s while holding and falls 0.65/s when you let go; the fish **surges** every 0.6–2 s for 0.25–0.6 s, adding (0.7 + 1.1 × strength)/s, plus a little noise. Keep it in the green zone (centre 0.55, half width 0.22 − 0.09 × strength) and the **catch bar** fills at (0.24 − 0.1 × strength)/s, from 30%. Below the zone it drains 0.16/s ("It slipped the hook" at 0); above it 0.05/s, and 0.45 s at full tension snaps the line. The bobber comes in toward you as the bar fills, thrashing in surges.
- **Catch:** the fish goes in your inventory (fish items, stack 16, `fish: true`, original 16×16 icons coloured per species by `fishArt`), with a splash and a **FISH GET!** pop-up (`#fish-get`) showing its icon, name and size.
- **Poses (`ch.rodPose` in `character.js`):** the rod drawn back over the shoulder while charging, held out while the bobber's out, and cranking the reel (leaning back) during the fight. The cast plays the tool swing.
- **Stopping:** moving (except at a helm), putting the rod away or leaving the world reels the line in. One `Fishing` per world scene (`game.fishing`), updated every frame after your character (`fishCtx()` in `main.js` gives it the world, your position and facing, effects, toast, inventory and a projection for the "!").
- **Tested headless:** with a rod on a shore, a press on the water charged the meter, the release cast it, the bobber landed and floated, the bite showed the "!", a click hooked a fish and showed the reel bars, holding raised the tension (and kept at full it snapped the line, as designed), and filling the catch bar landed a 56 cm Golden Carp into the inventory with the pop-up. No errors.

## Inventory (mirror of `src/client/inventory.js`)

- **Layout:** `HOTBAR` = 8 slots (`#hotbar`, bottom centre, keys **1–8** or click) are all you can carry at first. The 24-slot bag (`BAG`, slots 8–31, a 3×8 grid) only exists once you've crafted a **Backpack** (`inventory.hasBag`; `size` is 8 or 32, and `add` only fills that many). The held item's name shows above the hotbar (`#held-name`).
- **Inventory screen:** **I** or **Tab** opens it (`#inventory` overlay: the bag above the hotbar row, or without a backpack a dashed note, `#inv-nobag`, saying to craft one). **I** or **Esc** closes it (Esc closes the inventory before it would open the menu). Movement keys are ignored while it's open. Clicking a workbench opens the same screen titled "Workbench" (`open('bench')`, `#inv-title`).
  - Left click: pick up a stack, put it down, merge into the same item (up to the stack size), or swap.
  - Right click: pick up half a stack, or put down one item.
  - Shift-click: move a stack between the hotbar and the bag (topping up matching stacks first). Needs the bag.
  - The stack held by the mouse follows the pointer (`#inv-cursor`). Closing puts it back.
- **Items (`ITEMS`):** `shovel`, `pickaxe` and `axe` (stack 1, have `tool`), `log` (stack 64, from trees, crafting material, placeable as log piles), `stick` (from bushes), `leaves` (from bushes and trees), `pebble` (picked up) and `berries` (from bushes), all stack 64, furniture `workbench`, `chair`, `table`, `lamp`, `shelf` (stack 16) and `bed` (stack 4) (`place`, `furn`), `backpack` (`unlock`: never carried, crafting it gives the bag), `wood` (stack 64, `block`, plank icon via `blockArt({ planks })`, crafted from logs), `wall` (stack 64, `block`, log-cabin icon from `wallArt`), `frog` (stack 8, `throwable`; see frogs in **Sky and ambient life**), and blocks `dirt`, `stone`, `sand`, `snow` (stack 64). Icons are original 16×16 pixel art: the tools are drawn from string grids (`TOOL_PALETTE`), the blocks are generated by `blockArt` (outline, lit and shaded edges, speckles; dirt has a grass band). Each is drawn once to a data URL and shown at 32 px with `image-rendering: pixelated`.
- **Crafting (`RECIPES`, each with `at: 'hand' | 'bench'`):** a "Crafting" row in the inventory screen (`#inv-craft`, rebuilt by `buildCraft` on open) has one button per recipe on offer (`recipes()`), showing ingredients → result, dimmed when you lack the ingredients. A click crafts once (`Inventory.craft`: takes ingredients from the bag first, undone with "Your inventory is full" if the result doesn't fit).
  - **By hand (I):** 4 Sticks + 6 Leaves → Backpack (only until you have one); 6 Sticks + 2 Pebbles → Workbench; 1 Log → 2 Wood. A hint (`#inv-craft-hint`) says tools, walls and furniture are made at a workbench.
  - **At a workbench (the hand recipes too):** 2 Sticks + 1/2/3 Pebbles → Shovel / Axe / Pickaxe; 1 Log → 2 Wooden Walls; 3 Wood + 2 Sticks → Chair; 4 Wood + 2 Sticks → Table; 4 Wood + 8 Leaves → Bed; 1 Wood + 2 Sticks + 1 Pebble → Lamp; 5 Wood → Bookshelf; 3 Sticks + 2 Leaves + 1 Pebble → Fishing Rod; 3 Wood → Crate; 4 Wood + 1 Stone → Barrel; 2 Dirt + 4 Leaves + 1 Pebble → Potted Plant; 2 Wood + 1 Dirt + 2 Berries → Flower Box; 4 Wood + 2 Sticks → Bench; 3 Sticks + 4 Leaves + 1 Berries → Pennant Pole; 6 Wood + 4 Sticks → Rowboat; 12 Wood + 4 Logs + 4 Leaves → Cabin Boat.
  - The workbench is a stick recipe on purpose: tools need a workbench and logs need the axe, so a log recipe would lock you out.
- **Starting kit:** nothing, and no bag. An empty inventory shows the hint "Break bushes for sticks and leaves, pick up pebbles, then craft (I)".
- **Creative mode (debug, to try new things instantly):** the **Creative: off/on** button under Menu / Map editor (`#creative-btn`, `setCreative` in `main.js`) or `?creative` in the URL turns it on; it's remembered per browser (`localStorage['settleon.creative']`).
  - While on (`inventory.creative`): the inventory screen shows every item (`#inv-creative` / `#inv-all`: click gives a full stack, right-click one) and an **Empty inventory** button; the bag is open (`hasBag`); and `takeHeld` uses nothing up, so placing blocks, furniture, logs and boats is free.
  - It's local only (other players aren't told), and items you take are saved in your normal inventory.
- **Bag button (`#inv-open`):** a pixel-art bag at the end of the hotbar toggles the inventory screen, same as I.
- **Drops:** each broken block goes into the inventory (`DROPS`: sand → Sand, rock → Stone, snow → Snow, wood → Wood, everything else the shovel digs → Dirt; wall → Wooden Wall; trees give Logs and Leaves (`TREE_LEAVES`: 3 round / 2 pine / 4 redwood); a broken bush gives 1–2 Sticks and 1–2 Leaves), hotbar first. When it's full: "Your inventory is full" (the block still breaks).
- **Saving:** `localStorage['settleon.inv.<key>']`, where the key is `save:<name>` for a saved singleplayer world or `room:<room>` in multiplayer (a new unsaved world starts fresh). Saved at most every 0.8 s as `{v: 2, sel, bag, slots: [[id, count] | 0, ...]}` and validated on load (`fromJSON`). Saves from before backpacks (9 + 27 slots, no `v`) are re-added in order, and keep a bag if anything was in it.
- Blocks have `block: true` and can be placed (see **Tools and digging**).

## Player movement: half-tile steps (mirror of `src/client/controller.js`)

The character rests on **a tile's centre or its edge** (or corner) and moves **half a tile** at a time (at the user's request, so you can walk right up to the edge of a block).

- **Positions** are kept in half tiles (`qx`, `qz`): odd = a tile's centre, even = the edge between two tiles. A centre touches one tile, an edge two, a corner four (`PathFinder.halfTiles`).
- **On an edge you stand on the highest tile it touches** (`halfFloor`), so you can stand at a block's rim and look over. Edges are only reachable from the high side, or from below when the climb is within the step-up limit. Swimming only when every touched tile is water (`halfWater`). Every touched tile must be open, and corners with a walk-under trunk are refused (`halfOpen`). `halfStepOk` applies the same climb and drop limits as whole tiles, with no corner cutting.
- `ctrl.ix, iz` is the tile the character stands on (the highest one it touches); digging, placing, routes and tool reach still use it. `ctrl.touching()` lists the touched tiles, and you can't place a block on any of them ("You're standing there").
- **Routes** (`setPath`, walking to dig, chop or gather) go to the current tile's centre first when on an edge, then centre to centre in half steps, and still end exactly on a tile centre.

| Setting | Value |
|---|---|
| Walk / run / swim speed | 3.2 / 5.6 / 1.8 tiles/s (a half step takes half as long). Diagonals take √2 longer |
| Allowed step | 8 directions, using `PathFinder.stepOk`: up ≤ 1.25 (`MAX_UP`, raised a quarter from 1.0 at the user's request), down ≤ 3.0, target not blocked. Diagonals need both side tiles passable and steppable (no corner cutting) |
| Height change | Steps within `STEP` ease smoothly. Bigger ones take 60% longer (per half step) with a hop arc of 0.3 + 0.6 × rise |
| Landing impact | Finishing a step that dropped ≥ `IMPACT_DROP` (2 × `STEP` = 1.0) onto dry ground calls `ctrl.onLand(drop, cell)`, which spawns `effects.impact`. More drop gives more and faster puffs. Other players' impacts are detected from snapshots: an AIR state that ends 1.0+ below where it started |
| Swimming | Water tiles (ground below `SEA - 0.55`) put the character at that floor height, swimming at swim speed |
| Standing jump | Space while idle: a 0.45s hop, 0.55 high. Not available while swimming |
| Run | While Shift is held |

- **Keyboard:** WASD/arrows step in **screen** directions and keep stepping while held. `screenToGrid()` turns them by the camera yaw and snaps them to the nearest of the 8 grid directions (at yaw 0, W = north, −z).
  - Two keys give a diagonal. If the diagonal is blocked, it tries each straight direction.
  - A blocked step just turns the character to face that way.
- **No tap-to-go for the player** any more. `setPath(cells)` (`cellKey`s, decoded with `keyX`/`keyZ`) is still there for tests.
- **Spawn:** the nearest open tile to `spawnPoint()`.
- **Network:** position is sent as continuous `x, y, z` (mid-step positions included), so remote players interpolate smoothly. Animation states (`ANIM`): IDLE 0, WALK 1, RUN 2, AIR 3 (hops), SWIM 4, ROW 5 (at a rowboat's oars).

## Camera and controls

- **Camera:** ¾ view like a cozy farming game, at **fixed angles** around the player (8 directions, 45° apart).
  - Perspective, FOV 35. `CAM_PITCH` = 0.66 rad (~38°) above the horizon. `cam.yaw` 0 looks north (−z); `placeCamera()` puts the camera at `(sin yaw, cos yaw) × cos(pitch) × dist` from the focus.
  - **Turning:** Q/E (`Input.takeRotate()`) turn 45°, easing `yaw` toward `yawTarget` at rate 10/s. There's no free rotation: the user wants fixed angles only, so there's no drag or twist.
  - The minimap draws a short tick from the player in the view direction.
  - Default distance 9.5, zoomable 6–34 (`MAX_ZOOM`), or up to `BOAT_ZOOM` = 48 while aboard a boat. Stepping ashore eases the camera back inside 34. The camera's far plane follows the fog (`max(110, 70 + 1.3 × dist)`), and endless chunks load further out past 34 (`LOAD_R` = 50 + 1.3 × (dist − 34), unload 24 beyond), so the corners aren't empty. Zooming out also pushes the fog back, widens shadow coverage (±22 to ±46) and fades in the cloud layer.
  - The camera follows the player smoothly. **Aboard a boat it follows the boat instead:** the boat's middle at deck height, at a faster rate (10/s instead of 6/s) so it keeps up at full speed. Walking around the deck no longer moves the view. It never moves around obstacles: when the player is hidden, the silhouette shows instead.
- **No click-to-move** (removed at the user's request: movement is WASD/arrows only). Clicks only use the held tool (`onTap` → `useToolAt`). The ground point comes from marching a ray from the camera to the ground or water surface. The one exception: clicking a far block with a tool walks there to dig it (see **Tools and digging**), using `PathFinder.route` and `GridController.setPath`.
- **Keyboard:** WASD/arrows step tile by tile in screen directions (relative to the camera rotation). Shift runs, Space hops, Q/E turn the camera to the next fixed angle, 1–8 pick a hotbar slot, I/Tab (or the bag button at the end of the hotbar) open the inventory, a click on a workbench opens its crafting, R rotates Wood planks and furniture, right-click a bush for its menu.
- **Zoom:** wheel or two-finger pinch. There is no on-screen joystick or jump button any more.
- **B:** the boat panel (name, paint, upgrades) while aboard.
- **F:** board a nearby boat at its wheel, or take / leave the helm when aboard. At the helm W/S move the throttle a notch and A/D turn the boat left / right of its own heading, whatever the camera does (see **Boats**).
- **Controls card:** there's no always-on controls bar. A small "?" button bottom-left (`#help-btn`), or **H**, opens a card listing the keys (`#help` in `index.html`, `toggleHelp` in `main.js`); the button turns gold while it's open, and **Esc** closes the card before anything else. Hidden in the menu and the editor. Update the card when controls change.

## Character (mirror of `src/client/character.js`)

- **Proportions:** chibi, about 0.95 tall. The head is 0.46×0.4×0.4 on a 0.26-wide torso, with stubby arms and legs.
- **Face:** tall dark eyes with a white sparkle, set low on the face, plus pink blush and a tiny mouth.
- **Blinking:** every 2–5 seconds.
- **Look, picked from an FNV hash of the player id:**
  - skin: 5 tones
  - hair color: 8 options
  - style: `bangs`, `tuft`, `bow` (player color), `strawhat`, `beanie` (player color)
  - The shirt is the player color.
- **Animation** (cartoon style, deliberately **exaggerated**; the user asked for it):
  - **Springs:**
    - A squash spring (`sq`, k 260, c 13) is kicked by every footfall (−3.8 walking, −5 running), a jump start (+5.5, stretch), a landing (−9, a big squash) and idle hops. Squash is clamped to 0.62–1.35.
    - The body keeps its volume: y = sq × stretch, x and z = 1/√y. The eyes squeeze shut when sq < 0.8.
    - A lean spring (k 90, c 6) tilts forward 0.15 walking and 0.34 running, and overshoots backwards when you stop.
    - The head lags behind lean changes (`headX` spring).
  - **Walk/run cycle:**
    - A snappy hop each step (`|sin|^0.6`, 0.12 walking, 0.17 running).
    - A waddle (roll 0.14 / 0.09) and hip twist (yaw 0.16 / 0.22). The head counter-tilts and counter-turns.
    - Legs swing ±1.05 / ±1.35 and arms ±1.3 / ±1.7, with arms flaring out on each swing.
    - Phase speed is 7 + 2.4 × speed.
  - **Idle:** big slow breaths (±3.5%), looking around (layered sines on the head's yaw, ±0.28+), a slight sway, and a happy little hop with arms up every 5–10s.
  - **Air:** legs tucked, arms thrown up and flailing (sin 22 Hz), a light lean and a wobbly head.
  - **Swim:** a big doggy paddle (arms −1.4 ± 1.0), kicking legs, body roll ±0.16, forward lean 0.25.
  - dt is capped at 1/30 so the springs stay stable. Remote players animate the same way from their network `a` state.
- **See-through canopies:** tree canopies open up around the local player.
  - Trees use `seeThroughMaterial` (`world3d.js`). Its fragments in front of the character (view depth < player depth − 0.25) and within a screen circle of about 0.95 world units around it are discarded. The circle is fully open in the middle, with a 4×4 Bayer-dithered edge (smoothstep 0.55–1.0 of the radius).
  - `setSeeThrough(camera, pos, rtW, rtH)` updates the uniforms every frame from `main.js`.
  - Shadows use the depth material, so tree shadows stay whole.
  - Only the local player opens canopies.
- **Silhouette** (for hills, ruins and anything else that isn't a tree): visible meshes write stencil = 1. A twin `MeshBasicMaterial` (opacity 0.75, color 15% toward white, `depthFunc: GreaterDepth`, stencil ≠ 1, renderOrder 20) draws only where the character is hidden behind scenery.
  - This needs the depth-stencil render target in `pixelfx.js` (`DepthStencilFormat`, `UnsignedInt248Type`).

## Visual style (`pixelfx.js` + `world3d.js`)

**Render pipeline (`PixelRenderer.render`):**

1. The scene renders into a low-res HDR target (HalfFloat, depth-stencil). 1 art pixel = 3 CSS px, or 2 below 700px wide, when close up.
   - **Zoom-dependent pixel size:** `PixelRenderer.setZoom(dist)` (called every frame) shrinks the art pixel by 1 past camera distance 15 (`ZOOM_PIXEL_STEPS` = [15], minimum 1, ±1 hysteresis), so zooming out eases the pixel filter from 3 to 2. The second step down to full resolution (size 1, past 25) was removed for performance. The targets are rebuilt only when the level changes. Bloom spread is scaled so the glow stays the same size on screen.
   - Pixel size 1 (full canvas resolution) now only happens on narrow screens zoomed out.
2. **Bloom:** a bright-pass with a 4-tap downsample to half resolution (threshold 1.1, soft knee 0.35), then two separable 9-tap gaussian blur iterations (radius 1.4, then 2.8), with linear filtering.
3. **Final pass:**
   - **Tilt-shift** (`TILT`): a sharp band of ±0.16 screen height around the centre (where the player is), then a blur that ramps in over the next 0.32. It's a 12-tap golden-angle disc of up to `radius` 1.8 low-res texels × strength, scaled so it looks the same at any pixel size. Outlines fade out where it's blurred.
     - Strength is `TILT.strength` (0.6) × 0.7 up close, rising to × 1.3 when zoomed out (`pixel.setTiltShift` from `main.js`). The user wants it **subtle**.
   - Outlines: the second derivative of 1/viewZ, darkening by ×0.7 (`OUTLINE_DARKEN`, soft) when the relative jump is above 0.03. The sky is skipped.
   - Bloom is added at strength 0.55.
   - ACES filmic tone map.
   - Grading (cozy and calm): exposure 0.94, saturation 0.93, warmth 0.03, a soft lavender shadow tint (0.03), vignette 0.3.
     - This is lusher than the brief "toned down" pass (0.88/0.88), to match the vibrant village reference.
   - Convert to sRGB, then quantize to 26 levels per channel (`COLOR_LEVELS`) with 4×4 Bayer dithering. 26 levels keeps the dither grain subtle. The sky is not dithered.
4. CSS upscales the canvas with `image-rendering: pixelated`.

- **Tuning knobs:** `BLOOM`, `TILT`, `GRADE`, `PIXEL_SIZE`, `ZOOM_PIXEL_STEPS`, `COLOR_LEVELS`, `OUTLINE_*` in `pixelfx.js`. `SKY`, fog (38–75) and the light settings in `world3d.js`.
  - If the image looks washed-out or too yellow, lower `exposure`, `saturation` or `warmth` first.
- **Lighting:**
  - The sunlight is split across two lights:
    - The main sun (`0xffe4bd`, 1.5) casts all shadows except clouds.
    - A **cloud sun** (1.6, same direction) casts only cloud shadows. The total stays 3.1, so sunny ground is unchanged, and a cloud shadow removes about half the direct light: clearly visible but not black. Raise the cloud sun's share for darker cloud shadows.
    - **Layers** (Three.js uses a shadow camera's own layers whenever a non-zero layer is set):
      - 0: normal scenery. Seen, and casts through the main sun.
      - 2: clouds. The main camera enables layer 2 to see them; they cast only through the cloud sun (shadow camera layers 1 + 2).
      - 31: shadow-only casters for the main sun (shadow camera layers 0 + 31): the low-detail tree twins.
      - 1: shadow-only casters for the cloud sun: the low-detail redwood twins, so the deep forest stays dark.
  - The sun offset (16, 21, 11) is a bit low, for longer shadows.
  - A cool hemisphere fill (`0xbcd7ff` sky, `0x6b5a48` ground, 1.35), so shadows read slightly blue.
  - Hard `BasicShadowMap` shadows, `SHADOW_MAP` = 1024² (cloud sun 512²), covering ±22 units around the player (up to ±46 zoomed out), snapped to texels. 2048² filled about 40× more pixels than the scene itself, and 1024² still gives more shadow texels per unit than art pixels at normal zoom.
- **Things that bloom:**
  - HDR colors: campfire flames (MeshBasic ×2.2 to ×1.4), fireflies (`Color(2.6, 2.4, 0.9)`), ruin gems (emissive ×3.5).
  - Brightly lit snow and sand, and water sparkles.
  - The campfire point light runs at about 4.5 with flicker.
- **Terrain texture (`TERRAIN_GLSL`):** detail is generated procedurally from world position at 16 texels per unit. Each column carries `aKind` and `aTop` as instanced attributes.
  - Grass and forest (`grassTop`): matches the user's reference grass tile.
    - A softer mid-green base (sRGB 0.43, 0.61, 0.27; toned down at the user's request from 0.42, 0.67, 0.21) with soft, **blocky blotches**. Two octaves of value noise, sampled at texel-snapped positions (16 per unit), are banded into 4 tones: brightest (n > 0.68, ×1.18), light (> 0.57, ×1.08), base, and darker (< 0.29, ×0.88).
    - The blotches flow across tile borders, with no per-tile checker.
    - Keep it low-contrast and clean. The user found earlier per-texel noise "rough".
    - Forest tiles use a slightly deeper green.
    - Sides (`grassSide`): grass hangs over the edge as uneven strands 1–2 texels wide.
      - Strands are 2–4 texels long; 22% get +2–4 texel drips.
      - The top row is sunlit (×1.14), the body is mid green, the tips are darker (×0.7), with a few highlight pixels.
      - Each tip has a dark shadow texel under it, and a few green sprouts dot the dirt below.
      - The dirt is flat with sparse 2-texel pebbles on a 6×6 grid.
  - Every column gets a ±1.5% tint.
  - Rock: strata bands, with mossy patches on top.
  - Snow: a snow lip over rock.
  - Sand: speckled.
  - Colors are written in sRGB and converted with `pow(2.2)`.
- **Terrain AO (`terrainAO`):** reads a WORLD×WORLD float `DataTexture` of column heights.
  - Tops darken (up to −38%) near the edges and corners of taller neighbours.
  - Walls darken (−22%, within 0.3 of the bottom) where they meet lower ground. Stronger values turned short 0.5 walls into dark slivers.
  - Both are stepped at 1/16 texel for a pixel-art look.
- **Water:** `MeshPhongMaterial`, a 400×400 plane that follows the player. Its normals are perturbed (×0.05) by sine ripples snapped to an 8-per-unit grid, which gives pixel sparkles that catch the sun.
  - **Subtle sun glints (at the user's request):** dim specular `0x8f8a80`, shininess 240, the reflected sun capped at 0.14 and faded by up to 70% from 12 to 36 units away. Before (`0xfff3d6`, 70, ×0.09, no cap) a low sun lit a huge checkered glare across the sea.
  - **Colour and transparency from depth:** the shader reads the terrain height ring buffer (`uHeights`) under each pixel. Shallow water is light turquoise and see-through (alpha 0.52); deep water is blue and more solid (0.74).
  - **Depth** is blended between cell centres (texel-snapped), so shallows fade into deep water without tile edges.
  - **Open water:** where depth > 0.45 (full at 0.9) the water turns deep blue (alpha 0.88) and the same caustic ripples are toned down to 32% strength. The user found separate ocean wave bands weird, so don't bring them back.
  - **Pixel caustics** everywhere (full strength in shallows), from the user's water reference: drifting cellular (Voronoi) noise snapped to 10 texels per unit, with slightly wobbly borders. Cell borders are bright light-blue lines (F2−F1 < 0.085) with a softer band inside (< 0.19), and each cell's interior is one of three blue shades.
  - **Shore foam:** a stepped white line along edges that touch land, ebbing in and out.
  - **Depth layers** (`depth` 0–6, read from the height ring buffer): clear turquoise shallows (alpha 0.38, you see the sand) → teal lagoon over the reefs (0.5, the coral shows) → open blue (0.74) → deep blue (0.86) → a dark navy abyss (0.93). These are smooth steps at 0.2–0.75, 0.9–1.7, 1.8–2.9 and 3.2–4.6. Caustics fade out over depth 0.9–2.
  - The seabed (`k == 0` in `TERRAIN_GLSL`) goes from pale sand in the shallows through reef teal (by depth 1.4) to a dark blue-green in the deep (by 4.6), with drop-off walls in between.
- **Underwater and ponds (`waterLife` in `world.js`, shared by islands and endless worlds), per SEABED cell:**
  - **Seagrass meadows (`seagrass`):** where `fbm(/12, seed + 717)` passes 0.44–0.56 and the water is 0.25–2.8 deep (less on reefs), 45–95% of cells grow 1–5 clumps of nine slim swaying blades (`seagrassGeometry`, `swayMaterial` 0.16, tinted `0x4f9a48` ± 40%), 0.22 + 0.32 × depth tall. Elsewhere 8% of cells get a stray clump.
  - **Sea pickles (`pickles`, `{…spot, n}`):** clusters of 1–4 stubby pale-olive tubes (`pickleGeometry(n)`, one mesh per cluster size, scale 1.7–2.4) on 3.5% of cells 0.3–2.4 deep (+5% in meadows, +5% on reefs). **They glow at night:** `applyDarkness` sets the shared material's emissive to `(0.45, 2.3, 0.6) × night` (HDR, so it blooms green through the water; also in the dark deep forest's night share). **Fainter deep down and far away** (at the user's request): `pickleMaterial` scales the glow per pixel by depth (full to 0.5 deep, down to 8% by 1.9 deep) times distance from the player (full within 6, down to 6% by 18; `uFocus` set every frame), and the lights use the same falloff (`pickleFade`). **They light their surroundings** (at the user's request): a pool of `PICKLE_LIGHTS` = 4 green point lights (`0x6dff8e`, `PICKLE_LIGHT_I` 1.6 × night, range `PICKLE_RANGE` 3.2, decay 1.6, a slow ±15% pulse) sits 0.4 above the clusters nearest the player (within 24, re-picked every 0.5 s, fading in over 0.5 s; `updatePickleLights`, from `live.pickles`), lighting the seabed, seagrass and water. Like the firefly lights they exist only at night by the clock (switched with them).
  - Seaweed (42% of cells, 18% on reefs, 1–3 clumps): three ribbons scaled to 55–95% of the depth, swaying gently.
  - Mossy seabed rocks (7%): decoration only, no collision.
  - Reeds and cattails standing in the shallows (50% of shore cells with depth ≤ 0.45, 1–2 clumps), with their own scale `s` so they poke out of the water.
  - Lily pads (32% of cells with depth < 1.1 and land within 2 cells, 1–3 pads): notched discs that bob with the water (`bobMaterial`). 25% have a pink or cream flower.
  - **Lush banks (`bankLife`):** dry land within 2 cells of water gets a second reed clump at the very edge (45%), and on grass/forest 2–3 tall grass clumps (60%), ferns (25%) and the odd bush (6%).
  - **Coral reefs (`waterLife(…, seed)`):** in water `REEF_MIN` 0.25 to `REEF_MAX` 1.6 deep, where a slow reef noise (`fbm /15`, seed + 515) passes `REEF_T` 0.56. There, 35–95% of cells grow 1–4 corals.
    - Kinds (`CORAL_TYPES`): branching staghorn, brain coral, sea fan, tube coral and anemone. No fans in water under 0.6 deep. Each is scaled to the depth (`s`).
    - Reef cells get fewer seaweed ribbons (12% instead of 30%). Starfish (type 5) lie on the sand of 4.5% of cells under 0.9 deep.
    - Models (`coralParts` in `world3d.js`): pale-grey vertex-coloured shapes with darker bases, tinted per instance from `CORAL_COLORS` (pink, coral orange, violet, yellow, teal, red) or `STAR_COLORS`. Fans and anemones sway (`coralSway`). About 45 corals per endless chunk near the spawn.
  - Lists: `world.lilies`, `seaweed`, `seaRocks`, `corals` (also in endless `content()`; the scene's `live.corals` lists the loaded ones). All are LOD "small" stuff.
- **Leafy trees and bushes (`trees3d.js`)**, modeled on the user's pixel-art tree reference:
  - Trunk: an S-curved tapered tube (radius 0.16 → 0.075, 0.95 × `LEAFY_TALL` (1.6) ≈ 1.5 tall in base units; the canopy is lifted by `LEAFY_LIFT`, and falling leaves start that much higher), purplish-brown bark (`BARK`) with spiral dark streaks and sunlit highlights, plus 3–4 flared roots.
  - Foliage in separate clusters: a crown (radius ~0.5) on top and 3–4 side clusters (~0.3) on branches at 0.7–1.0 height.
  - Each cluster is an icosahedron core (detail 1 for performance, one band per facet) covered with **rounded** leaf cards (~480 × rx² per cluster). Each card is a 6-point oval (width 0.8 × length), slightly cupped, drooping a little like shingles. Cards have a single outward face (a 4-triangle fan) and normals tilted up. The user found pointed diamond leaves too sharp.
  - Hard color bands (`LEAF_BANDS`): deep teal underneath → greens → pale yellow-green only on sunlit tops. Keep the top band rare, or the canopies wash out and bloom.
  - 4 seeded shape variants (`TREE_VARIANTS` in `world3d.js`), each an instanced mesh with random yaw and a ±8% tint. Bushes use the same cluster style. Pines (`PINE_VARIANTS` = 3) are conifers: a straight trunk with roots and 5 tiers of flattened rounded-leaf clusters (radius 0.5 → 0.12, from height 0.54 up to 1.45), in slightly cooler bands.
- **Cobblestones (`cobble` in `TERRAIN_GLSL`):** staggered pale stones with grass gaps, for PATH cells. Unused since the village was removed.
- **Grass clumps (`leafClumpGeometry`):** fluffy mounds of pointed triangle leaves leaning outward, with a few upright inner leaves.
  - Vertex colors go from deep green at the base (`LEAF_DARK` 0x24501c) to a soft yellow-green at the tips (`LEAF_TIP` 0xa9c862, toned down from lime). Inner leaves stay darker, which gives each clump depth.
  - All normals point up, so the lighting is flat and the painted gradient reads like pixel art.
  - Each leaf is emitted with both windings and `FrontSide`. Using `DoubleSide` would flip the up-normal on back faces and render them almost black.
  - Tufts: 10 leaves, 0.2 tall. Tall grass: 16 leaves, 0.34 tall.
- **Wind:** tufts, tall grass, ferns, reeds and flowers use `swayMaterial`, which offsets vertices by their height times a sine of time and instance position.
  - **Calm rustle plus rolling gusts:** the base sway is slow (1.6 and 2.9 rad/s). On top, a gust wave travels along `WIND` (wavelength about 26 units, 0.85 rad/s; only the top of the wave counts, `smoothstep(0.15, 1)`, × 1.5), varied by a very slow patchy term, so meadows ripple in bands instead of every clump wobbling alike.
  - `swayMaterial` also writes stencil = 1, so foliage covering the character does **not** trigger the see-through silhouette. Grass just hides the legs naturally.

## Deep forest darkness

- **Real shade:** redwood instances are also on **layer 1**, so their canopy blocks the cloud sun as well as the main sun. Under the canopy only the sky fill reaches the ground, so it's dark even at noon.
  - The sun sits 70 units from its target and both shadow cameras reach `far` 200, so 20+ high canopies still cast shadows.
- **Mood while inside:** `WorldScene.deep` is the share of DEEP cells in the 7×7 around the player (full at 30), smoothed over ~0.7s. `applyDarkness()` then:
  - dims the hemisphere fill by up to `DEEP_DIM` = 45%;
  - treats firefly glow and firefly lights as night (`max(timeNight, deep × 0.85)`).
- **Cutaway** (`redwoodMaterial`, `CUTAWAY`): redwood fragments higher than 2.4 above the player inside a 3-unit-wide corridor from the player to the camera are discarded. Outside the corridor the allowed height rises 1.6 per unit, with a 1-unit Bayer-dithered edge.
  - So only trees between the camera and the player open up, and the forest beyond stays tall. Shadows use the depth material, so they keep the full canopy.
  - `setSeeThrough()` also sets the corridor uniforms each frame.
- **Ground:** the `deepTop` shader gives dark moss blotches with patches of red needle litter. Sides use a darkened `grassSide`.
- Area name "Deep Forest". Minimap colour `[34, 74, 40]`.
- **Clouds were raised** to y 16.5–18 (above the redwood tops) and fade in for zoom 23–30.

## Performance

- **Chunked instancing:** `WorldScene.chunkInstances()` runs after the world is built. It splits every static `InstancedMesh` with 64+ instances (trees, grass, flowers, rocks, bushes...) into `CHUNK` = 16×16-cell pieces with their own bounding spheres. The camera and the shadow pass then skip chunks outside their view. The terrain, fireflies, and ambient and effect meshes (which update every frame) are not chunked.
  - Anything added later that animates its instance matrices must be built after `chunkInstances()` or added to its skip list.
- **Shadow casters:** trees, rocks, ruins, bushes, terrain and characters cast shadows. Grass tufts, tall grass, ferns, reeds and flowers don't.
  - **Trees cast from their low-detail twins only** (islands and endless worlds): the detailed mesh has `castShadow = false`, and the twin sits on shadow-only layer 31 (+1 for redwoods). In far endless chunks `updateLod` also adds layer 0 to show the twin and hides the detailed mesh. Shadow-pass triangles went from about 1.06M to 0.48M per frame at normal zoom.
  - **Measured (headless SwiftShader, so relative only):** normal zoom 726 → 578 ms/frame and 1.63M → 1.05M triangles. The zoomed-out view went from not finishing a measurement to about 1.1 s/frame.
- **Level of detail (endless worlds):** each chunk's tree meshes have hidden low-detail twins (`leafyTreeGeometry(v, true)` etc. in `trees3d.js`: 18% of the leaf cards, icosahedron detail 0 cores, coarser trunk tubes, about 80% fewer triangles, same shapes because leaves use their own seeded stream). `WorldScene.updateLod` shows them in chunks more than `TREE_LOD_R` = 20 units from the player, and hides grass, flowers, ferns, reeds, berries and mushrooms past `SMALL_R` = 30. Zoomed out this draws about 57% fewer triangles (e.g. 3.8M → 1.65M, shadow casters 2.9M → 1.3M). Islands don't use it yet.
- **Budget:** a tree is about 1.7–1.85k triangles, and an island has about 500–700 trees. Leaf cards are now most of that, so lower `leafCluster` density first if trees get too heavy.
- **Zoomed all the way out** (pixel size 1) is the most expensive view.

## Time of day

- **Day/night cycle:** time runs on its own, one full day every `DAY_SECONDS` = 1440 (24 real minutes: one game hour per real minute, so about 12 minutes of day and 12 of night). `clockHour(h0, ms)` in `world.js` is the one formula, shared by client and server.
  - **The clock** (`game.clock = { h, at }` in `main.js`) is a start hour plus the wall-clock time since, so it never drifts and a background tab is right as soon as it returns. `tickClock()` runs every frame (also in the menu and editor) and calls `applyTime` only when the in-game minute changes (once a real second), so the sun and shadows move in small steps instead of crawling.
  - **Multiplayer:** each room has one clock on the server (`room.clock`, a new room starts at 8:00), sent as `welcome.time`. Dragging the slider sets it for the whole room (the `time` message on release; others get a toast "<name> set the time to HH:MM").
  - **Alone:** the time is remembered per browser in `localStorage` (`settleon.time`, written every 5 s and on slider release), so a session continues where the last one stopped. The first default is 10:00 (`DEFAULT_TIME`).
  - `?time=N` in the URL sets the hour and **stops the clock** (`FROZEN`), for screenshots and tests.
- **Slider:** a bottom-right HUD panel (`#time-panel` in `index.html`) shows the clock and a slider from 0 to 24 h in 15-minute steps, over a night → dawn → day → sunset → night gradient track. It follows the clock, except while being dragged (`game.dragTime`); on release the clock carries on from the new hour.
  - The slider gives up focus after use and ignores keys, so WASD and arrows keep moving the character.
- **`WorldScene.setTimeOfDay(h)`** blends the `DAY_KEYS` keyframes (0, 4.5, 6, 8, 10, 15.5, 17.5, 19, 20.5, 24): sky and fog colour, sun colour and total intensity (split 1.5 : 1.6 between the main sun and the cloud sun), hemisphere sky, ground and intensity, and a cloud tint (`uTint`).
- **Shadow depth (`SHADOW_DEPTH` = 0.25):** this share of the hemisphere fill is moved into the main sun (× 1.2), so sunlit areas keep their brightness and shaded areas get darker. Raise it for darker shadows.
- **Sun path:** the sun rises in the east (+x) at 6:00, crosses the south (toward the camera) and sets in the west at 18:00. Direction is `(cos a, max(0.18, sin a), 0.45)`.
  - At night (before 5:45 or after 18:15) the same lights become a cool moon (`0x8ea6ff`) on its own arc, with a minimum height of 0.35.
  - **Nights are dark on purpose** (the user wants players to rely on lights): the moon is 0.22, the hemisphere fill 0.26 (`0x36426e` sky, `0x0e0e16` ground), and the sky is `0x05070f`–`0x0a0d1e`. Shapes stay faintly visible; lanterns, the campfire and fireflies do the rest.
- **Lanterns:** at night every character carries a lantern in the left hand (`setLantern` in `character.js`: dark cap and base around an HDR glow `Color(2.6, 1.7, 0.6)` that blooms, held out a little when idle).
  - Real light comes from a fixed pool of `LANTERN_LIGHTS` = 4 warm point lights (`0xffc477`, `LANTERN_I` 2.2 × night, `LANTERN_RANGE` 8, decay 1.1, gentle flicker): yours, plus the 3 nearest other players (`WorldScene.setLanterns`).
  - Each light sits 1.6 above the player and 0.2 ahead of them. Lower placements glared on the face or head.
  - They switch on and off with the firefly lights (by the clock, `timeNight > 0.02`, one recompile).
- **Campfire beacon:** its light grows at night to intensity 4.5 + 3 × night and reaches 8 + 7 × night units.
- **Firefly glow:** `night = clamp((2.4 − total sun) / 1.6)`.
  - At night each firefly gets a soft halo (`moteGlow`): an additive `Points` disc 0.55 world units wide, with a squared falloff stepped into 5 bands, strength `night × 0.45`, twinkling with the firefly. It's hidden when `night` = 0.
  - The firefly cubes get up to 1.5× brighter at night.
- **Firefly light:** a fixed pool of `FIREFLY_LIGHTS` = 4 soft warm point lights (8 before; each light costs every lit pixel) (`0xfff0c0`, distance 2.0, decay 2) lights the ground and plants around the fireflies nearest the player (within 22 units).
  - The nearest fireflies are re-picked every 0.4s. A light that moves to a new firefly fades in over 0.4s, so nothing pops.
  - Intensity is `FIREFLY_LIGHT_I` (0.4) × night × twinkle. All lights are 0 by day. The user wants this **subtle**: 2.2 read as neon green pools on the grass.
  - **The lights exist only at night by the clock** (`timeNight > 0.02`): by day they're `visible = false`, because even at intensity 0 they cost every lit pixel. The switch recompiles materials once, so it follows the time of day only, not the deep forest (which keeps its glow halos without extra light). Otherwise, set intensity to 0 instead of toggling `visible`.

## Sky and ambient life

- **Clouds** (`buildClouds`): 34 **boxy** cumulus clumps, using the user's pixel-sky reference palette but blocky at the user's request.
  - Each clump merges box puffs: a big central block, 4–7 lower blocks around it and 1–2 top blocks. Each block is sized like a sphere of radius R (1.8R × 1.5R × 1.6R), and the clump is flattened to 0.8 in y.
  - Custom banded `ShaderMaterial` (unlit), driven by the sun direction and normal.y, in 5 bands: warm cream tops → peach → pink-lilac → lilac → lavender undersides.
  - They sit at y 16.5–18 (above the redwoods) and are scattered ±60 with the seeded `rng`. Never use `jitter` for 2D scatter: it is too correlated.
  - They drift along `WIND` and wrap around within ±60 of the player.
  - Opacity fades in for zoom 23–30 (max 0.9). They fade out near the screen center in an **oval shaped like the screen** (measured in screen fractions, so it's as wide as the screen is: wider on wide screens): fully clear within 0.2 of the centre, then a long soft fade, `smoothstep(0.2, 0.8)` squared, that is still thinning the clouds at the screen edges. Widened, softened and made oval at the user's request (it was a 0.16–0.38 circle) and within 3–7 units of the camera.
  - They cast gentle shadows through the cloud sun (layer 1).
- **God rays were removed** at the user's request. Don't re-add them unless asked.
- **Butterflies:** 30 (`BUTTERFLIES`, was 80), each looping around a random flower 0.45 above the ground, with flapping wings (instanced left and right wings). In endless worlds butterflies and dragonflies whose home is over 36 units away move to a loaded flower/reed within 30 of the player (a few per frame), or hide if there's none.
- **Dragonflies:** 16 near reeds. They hover, then dart between points over the water.
- **Frogs:** 20 boxy original frogs (`frogGeometry` in `ambient.js`, 1.5× scale) sit on lily pads, breathe, and every 2–7 s hop (0.45 s arc, stretch, landing squash) to a pad within 2.8 units, or hop in place. In endless worlds they move to pads near the player (within 14, else 30) when theirs falls behind.
- **Catching and throwing frogs** (`main.js` `onTap` → `frogAt` / `catchFrog` / `throwAt`; frog modes in `ambient.js`):
  - **Catch:** a click within `max(16, 240 / camDist)` px of a frog's projected position catches it, with any item in hand. It needs to be within `CATCH_REACH` = 2.2 units; otherwise the character walks over first (`pendingCatch`, cancelled by movement keys) and catches it if it's still close, or says "The frog hopped away!".
    - A caught frog becomes a **Frog** item (stack 8, `throwable`, its own pixel-art icon), held as hand index 7 (a little frog model in the hand). The world frog goes `'gone'`, and after `FROG_RESPAWN` = 15 s a new frog appears on a pad near the player.
  - **Throw:** with a Frog in hand, a click throws it at the clicked point, clamped to `THROW_RANGE` = 7 units. It's let go 40% into the swing (`ambient.throwFrog`) and flies a somersaulting arc (0.35 + 0.06 × distance s, arc 0.8 + 0.18 × distance). It reuses a caught frog slot if there is one, otherwise the frog farthest away.
  - **Landing (`settleFrog`):** onto a pad → `'pad'`; open water → `'swim'` (paddles toward the nearest pad within 18 in short hops); land → `'ground'` (hops of up to 1.3 toward the nearest pad, never up more than 1.0, wandering if there's none). The last hop lands on the pad.
  - Frogs are client-only: others see the frog in your hand (hand index in the `a` code), not the throw.
- **Insects:** 14 fly swarms (7 tiny dark flies each, buzzing on quick jittery loops 0.4–0.7 above reeds and lily pads) and 16 water striders (thin bodies with splayed legs, resting then dashing 0.55 around a lily pad on the surface). In endless worlds they move near the player, like the frogs.
- **Birds:** `FLOCKS` = 4 flocks of 3–7 small boxy birds (body + head + tail, hinged wings; gulls, swifts and sparrows by colour), `BIRD_SIZE` 1.8, casting small shadows.
  - A flock enters at the edge of `BIRD_RANGE` = 46 units, crosses near the player on a gently wandering heading at 3.6–5.6 units/s, leaves, rests 6–20 s, then another comes by.
  - Loose V formation, with flapping (13–15 Hz) and glides now and then.
  - **Height above the ground:** `BIRD_ALT` 3.8 over open land (the camera looks down, so higher birds would only show as shadows up close), 6 over woods, 14 over redwood forest. They look ahead 4 and 8 units to climb before rises and sink slowly.
- **Fish:** `SCHOOLS` = 6 schools of 3 (`FISH_COLORS`: koi orange, silver, gold, olive), `FISH_SIZE` 2, in water at least 0.3 deep within `FISH_RANGE` = 24 of the player. One school per half-second is re-homed to random water near the player when it falls behind; with no water nearby it hides.
  - They weave, stay near their school, dart now and then (3× speed, faster tail), and turn back before the shore (checked 0.9 ahead).
  - **Drawn as soft surface silhouettes:** swimming fish are flattened (0.3 in y), tinted 35% toward water blue (`FISH_TINT`), `MeshBasicMaterial` at opacity 0.62 without depth write, drawn after the water (renderOrder 6) just on the surface. Real underwater fish were invisible under deep (nearly opaque) water.
  - **Leaps:** about once every 25 s per fish, if there's water 1.4 ahead: a 0.75 s arc 0.55–0.8 high, nose up then down, drawn with separate solid Lambert meshes (`jumpBody` / `jumpTail`, casting shadows), with an `effects.impact(…, 'water')` splash (pale blue puffs and droplets) going in and out.
- **Cozy atmosphere (`atmosphere.js`, built and updated by `WorldScene`):** pooled instanced boxes, like `Effects`.
  - **Campfire embers:** `EMBERS` = 22 tiny HDR sparks (`Color(2.8, 1.25, 0.35)`, so they bloom) rise 0.55–1.25 units/s from the flames, slow down, wobble, flicker and shrink away over 1.2–2.5 s.
  - **Campfire smoke:** `SMOKE` = 12 soft translucent puffs (opacity 0.3, no depth write) rise at about 0.5 units/s, swell, lean with the wind and thin out over 3.6–5 s. **Unlit on purpose:** lit by the fire's point light they bloomed into a white blob. Their grey follows daylight (0.52 by day, 0.1 at night).
  - **Pollen:** `POLLEN` = 70 warm specks (slightly HDR) float 0.35–2 above the ground within `POLLEN_RANGE` = 9 of the player, drifting slowly along `WIND`, bobbing and twinkling. New ones enter upwind. They fade out as `WorldScene.night` rises (dusk, or inside the deep forest), where fireflies take over.
- **Reef fish:** `REEF_SCHOOLS` = 12 schools of 3–6 bright fish (`REEF_COLORS`: clownfish orange, blue tang, yellow tang, violet, pink, teal, silver; `REEF_FISH_SIZE` 1.35). Each school picks a coral within `REEF_RANGE` = 26 of the player (one school re-homed per 1/3 s when its coral falls behind). Its fish circle it at their own radius, height and speed, with wagging tails. They're solid Lambert meshes really underwater, between 0.12 above the coral and just under the surface; reef water is clear enough to see them.
- **Leaves:** 60. They drop from canopies of trees within 16 units of the player (or occasionally blow in), tumble and drift with the wind, rest on the ground for about 2.5s, then shrink away.
- All of these are instanced meshes with per-frame matrix updates, and `frustumCulled = false`.

## Main menu and modes (mirror of `src/client/menu.js`, `main.js`)

- **Startup:** after sign-in, `main.js` shows the menu (`game.mode = 'menu'`). With `?room=` in the URL it skips the menu and calls `startMulti(room)`, which keeps the test setups working.
- **Modes** (`game.mode`):
  - `'menu'`: the menu's own scene renders and there's no game world.
  - `'single'`: offline, with no server and no socket. `game.me = 'solo'` and a one-player roster.
  - `'multi'`: connected to a room. The socket only reconnects in this mode, and `game.leaving` stops it.
- **Play singleplayer:** pick "New endless world" (`startSingle(null)`), "Random island" (encoded on the fly) or a saved world.
- **Multiplayer:** a room code (prefilled from `identity.room`; fixed to the voice channel's instance in Discord, with a "New" button for a random private code) and an optional **Bring a world**. Then `startMulti(room, map)`. A brought world is sent as a `map` message right after `welcome`.
- **Create world:**
  - Fields: name, seed (text; digits are used as-is, other text is hashed; a dice button rolls one), and the world type: endless (default), generated island, or blank island.
  - The world is saved to the browser's world list, then **Create & play** (singleplayer) or **Create & edit** (map editor).
- **Map editor:** from the menu it opens on a fresh random island, and exiting returns to the menu.
  - The editor's **Play this map** sends the map to the room in multiplayer. Otherwise it starts singleplayer on that map.
- **In game:** the **Menu** button (top-left, next to Map editor) or **Esc** calls `toMenu()`, which leaves the room and disposes the world (`resetSession()`).
- **Background:** the menu diorama uses pixel size 3 and full tilt-shift, and orbits at distance 46, turning at 0.05 rad/s.

## Map editor (mirror of `src/client/editor.js`, `src/shared/mapfile.js`)

- **Opening it:** the **Map editor** button in the top-left panel, or `?editor` in the URL, opens a separate mode on a copy of the current island's base.
  - The game HUD is hidden (`body.editing`) and the game loop hands each frame to `editor.frame()`. The game's scene and connection stay alive.
- **Camera:** same ¾ pitch. WASD/arrows and right-drag pan in screen directions, Q/E turn (fixed 45° angles), and zoom is 8–80 (camera `far` 320 while editing). No clouds, no tilt-shift, no see-through or redwood cutaway (`setEditorView`).
- **Tools** (left panel; brush 1–8 = a square of `2b−1` cells; `[`/`]` change it):
  - Raise / Lower: one `STEP` per new cell, repeating every 0.16s while held. Flatten: to the height of the first cell.
  - Heights are clamped to 0–`MAX_LEVEL` × STEP (20). `fixKind` keeps the water line consistent: below `SEA` becomes SEABED, and land raised out of the sea becomes SAND or GRASS.
  - Ground paint: grass, forest, deep forest, sand, rock, snow, path. Underwater cells are skipped.
  - Objects: Tree, Pine, Redwood and Rock. Brush 1 places on one cell. Bigger brushes scatter (30%, or 22% for redwoods, which keep 2.1 cells apart).
  - Ruin (up to `MAX_RUINS` = 8, at least 7 apart, clears objects within 3.5), Campfire (moves the spawn and clears within 2), and Erase (objects in the brush; ruins within brush + 1).
- **Live updates:** terrain edits update the terrain mesh immediately (`WorldScene.updateTerrain()`). The full scene (foliage, objects) is rebuilt when a stroke ends, or right away for single object clicks.
  - Rebuilds dispose the old scene (`WorldScene.dispose()`). Tree and bush geometries are cached and shared (`userData.shared`).
- **Undo/redo:** Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) and toolbar buttons. Up to 40 whole-base snapshots, one per stroke.
- **Files:**
  - **Save/Load/Delete** use `localStorage['settleon.maps']` (per browser).
  - **Export** downloads `<name>.settleon.json`. **Import** reads one.
  - **New blank**: a round grass plateau (radius 30, height 2.5) with a beach ring. **New random**: a fresh procedural island.
- **Endless save:** `{v: 1, type: 'endless', name, seed, edits?, chops?, benches?, picks?, piles?, boats?}` (`boats` = `[[id, x, z, yaw, look]...]`, `cleanBoats`: older 4-number entries get the default look) (`piles` = `[[ix, iz, r, n]...]`, `cleanPiles`) (`picks` = `[[ix, iz, t]...]`, `cleanPicks`) (`benches` = furniture `[[ix, iz, rot, type]...]`) (`edits` = digging, `[[ix, iz, level, kind]...]`; `chops` = chopped trees, `[[ix, iz]...]`; each max 20000, validated by `cleanEdits` / `cleanChops`). `decodeMap` refuses it (island only); use `decodeEndless`.
- **Map format v1** (~20–35 KB): `{v, name, seed, h, k, camp, ruins, trees, rocks}`.
  - `h` is one char per column, `'0'` + height level. `k` is one digit per column, the ground kind.
  - Trees are `[ix, iz, type 0 leafy / 1 pine / 2 redwood, s×100]`; rocks are `[ix, iz, s×100]`.
  - `decodeMap` validates sizes and ranges, and caps trees and rocks at 6000.
- **Play this map:** sends `map` to the server, and the whole room switches to it.
  - The editor closes only when that broadcast comes back (`editor.playPending`). If someone else loads a map while you're editing, the game world changes in the background and your edits stay.

## Network protocol (PartyKit room, `/parties/room/<room>`)

- **Transport:** the client connects with `PartySocket` (`partysocket`, in `connect()` in `main.js`) to `/parties/room/<room>` on the same origin, so inside Discord it goes through the activity's `/` URL mapping. PartySocket reconnects on its own with backoff; each `open` sends `hello` again, and the loading screen says "Reconnecting…" meanwhile. The server is `Room` in `worker/room.js`, one Durable Object per room.
- **Client → server:**
  - `hello {room, accessToken | dev:{id,name}}`
  - `move {x,y,z,ry,a, b?}`, sent about every 80ms, only when something changed. `b` = `[boat id, deck x, deck z]` while riding a boat. `a` = animation + 10 × held tool (the server allows 0–299)
    - `bench {ix, iz, r, t, on}`: a player put down (`on`), turned or picked up a piece of furniture of type `t` (`FURNITURE` index, 0–`MAX_FURNITURE` 15). Kept in `room.benches` as `[ix, iz, r, t]` (max 50k, cleared with the world) and relayed as `bench {id, ix, iz, r, t, on}`
  - `boat {id, x, z, yaw, on, t, h, l}`: a boat was launched or moved (`on`), or taken out of the water. `t` is the driver's clock in ms and `h` / `l` its heel and bow lift (−1…1), relayed so others can replay its path and tilt smoothly. Kept in `room.boats` (max 200, cleared with the world) and relayed as `boat {by, id, x, z, yaw, on, t, h, l}`. See **Boats**
  - `boatlook {id, look}`: a player renamed, repainted or upgraded a boat. The server checks it with `cleanLook`, keeps it as the 5th element of the room's boat, and relays `boatlook {by, id, look}`. A `boat` launch may carry `look` (moves keep the one the boat has)
  - `time {h}`: a player set the time of day (0–24) with the slider. The server restarts the room's clock (`room.clock`) from it and relays `time {id, by, h}` to everyone else
  - `pile {ix, iz, r, n}`: the log pile on a cell is now n logs (0 = gone) lying along x (r 0) or z (r 1). Kept in `room.piles` (max 50k, cleared with the world) and relayed as `pile {id, ix, iz, r, n}`
  - `pick {ix, iz, t}`: a player broke a bush (t 0), picked its berries (1) or picked up a pebble (2). Kept in `room.picks` (max 50k, cleared with the world) and relayed as `pick {id, ix, iz, t}`
  - `chop {ix, iz}`: a player chopped down the tree growing from cell (ix, iz). Kept in `room.chops` (max 50k, cleared with the world) and relayed as `chop {id, ix, iz}`
  - `dig {ix, iz, lvl, k, ulvl, uk}`: a player dug or placed a block (new height level `MIN_LEVEL`…48 and kind; `ulvl`/`uk` = the ground under placed blocks, `ulvl` −1 when none). The server validates it, keeps it in `room.edits` (max 50k, cleared when the room's world changes), and relays `dig {id, ix, iz, lvl, k}` to everyone else
  - `map {map}`: play an island map or a saved endless world in the room, or `map: null` for a new random endless world. Limited to one every 3s per socket, and validated with `decodeMap`.
- **Server → client:**
  - `welcome {you, seed, map, edits, chops, benches, picks, piles, boats, time}`: `time` is the room clock's current hour. With `map: null` the client generates the endless world from `seed`; otherwise it plays the room's `map`. `edits` is the room's digging so far (`[[ix, iz, lvl, k]...]`), applied after any edits saved in the map.
  - `map {map, seed, by}`: the room's map changed. Everyone rebuilds the world and respawns at its campfire.
  - `roster {players:[{id,name,color}]}`: sent on join and leave.
  - `snap {p:[[id,x,y,z,ry,a, rb?],…]}`: every 80ms when anything moved. `rb` (only while riding) = `[boat id, deck x, deck z]`.
  - `error {message}`
- Messages over 4 KB are dropped unless they're `map` messages (endless saves with many digs can be large; Cloudflare's own WebSocket message limit applies to those).
- The server relays positions and validates world changes. It clamps x/z to ±(`WORLD_LIMIT` + `WORLD`) and y to −10…50, and allows 60 messages per second per socket. Movement is client-authoritative, so there is no anti-cheat. Only sockets that have said `hello` get broadcasts.
- **Rooms:** `discordSdk.instanceId`, or `?room=` (default `dev`), cleaned to `[\w-]`, max 64. Each room picks a random seed.
- **Room storage (`worker/room.js`):** the seed, map and clock (`meta` table) and the edits, chops, benches, picks, piles and boats (`items` table, rowid order = insertion order, so the oldest is dropped first past 50k) are written through to the Durable Object's SQLite storage, so a deploy or a Cloudflare restart keeps the room's world. Boat moves are kept in memory and saved at most every 5 s (`BOAT_FLUSH_MS`) and when the room empties. Player positions are memory only. When the last socket leaves, an alarm 30 minutes out wipes the room's storage (`deleteAll`); anyone connecting cancels it.
- **Players:** a player is removed when their last connection closes. Ids are `d:<discordId>` (verified via `GET /users/@me`) or `dev:<id>`. Dev logins: `ALLOW_DEV_LOGIN` "true"/"false" if set (Worker var), otherwise allowed only when the socket's URL host is `localhost` / `127.0.0.1` (so on for `npm run dev`, off when deployed).

## Testing tips

- **`?creative`** turns on creative mode (every item, free building; see **Inventory**).
- **`?zoom=N`** in the URL sets the starting camera distance, for close-up screenshots. N=6 is close.
- **`?editor`** (together with `?room=`) opens the map editor once the room's world has loaded.
- **Driving the UI headlessly:** launch Edge with `--remote-debugging-port`, connect over the DevTools protocol with the `ws` package, and use `Input.dispatchMouseEvent` and `Page.captureScreenshot`. This was used to test the editor end to end.
- **`?spawn=trail`** spawns on the mountain trail nearest the camp (endless worlds).
- **`?spawn=deep`** spawns in the middle of the biggest deep forest near the camp. **`?spawn=shore`** spawns on the shore nearest the camp with shallow water beside it. **`?time=N`** sets the hour and stops the day/night clock.
- **Headless screenshots:** use Edge with `--use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=10000`. Windows enforces about 500px minimum width, so test narrow layouts at about 540px.
- **Bot player:** a Node `ws` client (devDependency) on `ws://localhost:5173/parties/room/<room>` that sends `hello` with a `dev` identity, generates the world from the `welcome` seed, and sends `move` messages. The PartyKit port was checked this way: 17 relay/late-join/validation checks, a room keeping its seed and edits across a dev-server restart, and a headless Edge client joining the room alongside a bot.
- **Movement:** `GridController` and `PathFinder` import cleanly in Node.
  - A headless test can route to random tiles, `setPath`, and step with `update(1/60, keys)` until `!moving`, then check that the position is exactly on the tile center.
  - The last run: island 40/40 targets, all exactly centered (0.7 ms average route); endless 60/60 (5 ms, including chunk generation), plus a 2000-tile trek east with no blocked legs.
- **`window.__dbg`** (dev builds only) exposes `{ game, pixel, camera }`. A DevTools-protocol script can set `pixel.renderer.info.autoReset = false` and time frames while toggling shadows, lights, trees and foliage to find render costs.
- **Streaming in Node:** `WorldScene` builds without a renderer, so a script can create an endless scene, `preload`, then call `update()` while moving the focus. The last run streamed 3000 units: 43–61 chunks loaded, 0.35 ms average update, worst 20 ms (CPU only).

## Status

- Working: endless worlds (generation, chunk streaming, saves, multiplayer), island generation, tile-locked movement (WASD stepping, hops, swimming), digging with tools, fixed ¾ camera, chibi characters, silhouettes, multiplayer presence with name tags, minimap, ruin discovery. Verified with a bot player, headless path and physics runs, and screenshots.
- Not yet verified: touch input on a real device. (The silhouette and see-through canopies were checked on a headless test render.)
- Map editor: verified end to end (headless clicks: blank island, raise, paint, redwoods, trees, ruin, campfire, save, play). The map round trip is exact, and the room broadcast and late-join tested with bots.
- Digging with the shovel and pickaxe: verified end to end in a headless browser (shovel digs grass to soil, pickaxe refuses soil with a hint), world-level tests (dig survives cache churn, plants removed, trees unchanged, digging below sea makes water), and multiplayer bots (relay, no echo, late-join edits, cleared on a new world).
- Not done yet: tested inside real Discord (the user hasn't created the Discord app yet), saved player position, placing blocks back, Discord avatars, rich presence (`setActivity`), sound. Building is archived.

## Changelog
- 2026-11-25: **Launch blueprint:** holding a boat shows a see-through blue blueprint of it on the water where it will go in (its real size and parts), and red where it can't.
- 2026-11-25: **Better boat splashes:** splashes are now real water: droplets fly up in a crown and fall back leaving foam, and a ring of foam spreads on the water (also for fish leaps and the fishing bobber). A sailing boat throws spray off its bow in slaps as it meets the waves, with white water peeling along the hull, more the faster it goes.
- 2026-11-25: **Longer and taller boats:** in Customize, click the hull: its menu has Length (6.3 up to 9.3 tiles) and Height (+0.2 to +0.6) steppers. The bow moves forward with the foredeck and anything placed there, the hull and deck stretch to fill the gap, and the sides rise. Longer boats are a little faster and turn a little slower.
- 2026-11-25: **Fit more on deck:** placed pieces now use their real footprint (a long thin bench is long and thin), can touch each other, the cabin and the rail, may close off a small dead-end nook, and snap to a finer grid. Things that visibly fit now go where you put them.
- 2026-11-25: **Blueprint when placing on a boat:** holding furniture or a decoration aboard shows a see-through blue blueprint of it on the deck where it would go, turned the way it will face, and red where it can't go.
- 2026-11-25: **Decorate your boat:** aboard, click the deck with furniture or a decoration to place it anywhere (R turns it; the axe takes it back). It syncs and saves with the boat, and riders walk around it. New decorations, crafted at the workbench and placeable on land too: Crate, Barrel, Potted Plant, Flower Box, Bench and Pennant Pole. Four more paint colours: rose, mint, navy and white.
- 2026-11-25: **Fishing:** craft a Fishing Rod at a workbench. Hold on the water and let go as the cast power meter swings by, wait for the nibble and the bite, click on the "!" to hook it, then hold to reel while keeping the line's tension in the green until the catch bar fills. Seven fish to catch (Minnow, Sunny Perch, Spotted Koi, Silver Mackerel, Reef Tang, Golden Carp, Moonfish), depending on how deep the water is and the time of day, each with its own icon and size.
- 2026-11-25: **Removed the Fishing Skiff and the Trawler** at the user's request. The Rowboat and the Cabin Boat stay; skiffs and trawlers already in a world come back as cabin boats.
- 2026-11-25: **Rowing:** the rowboat's oars sweep through real strokes, dipping in, pulling back and lifting clear, while your character faces the stern and rows in step: reaching forward, leaning back and pulling. Other players see it too.
- 2026-11-25: **Smaller rowboat:** about a quarter smaller (2.4 × 1 tiles), with its benches, oars, bow line and crate scaled to match.
- 2026-11-25: **More kinds of boat:** craft a Rowboat (small, cheap and nimble, with oars), a Fishing Skiff (a little wheelhouse and a net boom) or a big Trawler (tall wheelhouse, trawl booms and nets, fast but heavy to turn) alongside the Cabin Boat. Each has its own size, deck, wheel, speed and handling, its own icon and recipe, and takes your paint colours.
- 2026-11-25: **Less shallow water:** the ankle-deep shallows are now a band along the beaches instead of wide flats around every island (about 15% of the water instead of 28%); the reef depths and open water take their place.
- 2026-11-25: **Boats collide with each other:** sailing into another boat bumps you back with a splash instead of passing through it, and boats can't be launched on top of each other.
- 2026-11-25: **Off-map players on the minimap:** a player too far away for the minimap shows as a small marker at its edge in their colour, pointing the way to them.
- 2026-11-25: **Boat tilt synced:** other players now see the driver's own heel and bow lift (sent with each boat update) instead of working them out from the replayed motion, which made the tilt twitch.
- 2026-11-25: **Smooth boats for other players:** a sailing boat no longer twitches on other players' screens. The driver timestamps its updates, and everyone else replays its path a moment behind, interpolating between them (about 29× smoother in a simulated test).
- 2026-11-25: **Deploy on push:** every push to `main` on GitHub builds the game and deploys it to Cloudflare (GitHub Actions).
- 2026-11-25: **Runs on Cloudflare Workers with PartyKit:** the Node/Express server is gone. A Worker serves the game, swaps Discord sign-in codes, and hosts each room as a PartyKit server (a Durable Object). Rooms now keep their world (seed, digging, trees, furniture, boats, clock) across deploys and restarts, and are forgotten 30 minutes after everyone leaves. `npm run dev` is one port; `npm run deploy` publishes it.
- 2026-11-25: **Sea pickles fade with depth and distance:** deep ones glow faintly and far ones fade out, so only the shallow pickles near you stand out.
- 2026-11-25: **Sea pickles light up the water:** at night the glowing sea pickles nearest you cast soft green light on the seabed, seagrass and water around them.
- 2026-11-25: **Seagrass meadows and glowing sea pickles:** patches of short swaying seagrass carpet the seabed, there's more seaweed, and little clusters of sea pickles glow soft green at night. Rivers were also widened (5.6–7 tiles) so boats fit through them.
- 2026-11-25: **Rivers and more islands:** big islands now have continuous winding rivers in walkable valleys, rising at the foot of the mountains and widening toward the sea, with sandy banks and a wadeable edge. There are more islands too: a new layer of mid-sized islands and more islets, so the endless sea is about 70% ocean instead of 81%.
- 2026-11-25: **Shapelier boat:** the hull now sweeps up to a raised bow (and a little at the stern) with a stem post, tapers in toward a narrower keel, and has a cream waterline stripe and a rubbing strake under the rail. The mast is rigged with a forestay to the bowsprit and backstays to the stern. The deck stays flat to walk on.
- 2026-11-25: **Zoom out further on a boat:** aboard, the camera zooms out to 48 instead of 34, and more of the world loads to fill the view. Stepping ashore eases it back.
- 2026-11-25: **Cloud hole fades further out:** the clear middle is a little bigger and the clouds keep thinning right out to the screen edges.
- 2026-11-25: **Oval cloud hole:** the clear area in the clouds follows the screen's shape, so it's wider on wide screens.
- 2026-11-25: **Softer cloud hole edge:** clouds fade in gradually from the clear middle out to the screen edges instead of in a narrow ring.
- 2026-11-25: **Bigger clear view through clouds:** the hole clouds open around the middle of the screen is about twice as wide, so a cloud no longer hides most of the view around you.
- 2026-11-25: **Subtler sun reflection on the water:** the low sun no longer paints a big checkered glare across the sea, just a soft shimmer.
- 2026-11-25: **Boat edit mode with pictures:** Customize in the boat panel lets you hover a part of your boat to outline it and click it to change it. A menu opens with every option as a little rendered picture in your boat's colours, plus a colour row. Empty deck spots show rings to click, and a banner reaches parts that are switched off. The panel is down to the name, Customize and upgrades.
- 2026-11-25: **Swappable boat parts and deck props:** in the boat panel (B) choose the cabin (plank, small, none), roof (shingles, roof deck, canvas), what stands on top (wheelhouse, lookout, none) and the mast (pennant, square sail, none), and what stands on each of 6 deck spots (crates, barrel, chest, rope coil, potted plant, lantern or nothing). Walking on deck follows the layout, and every combination keeps the deck connected to the wheel.
- 2026-11-25: **Camera centred on the boat:** while you're aboard, the camera follows the boat's middle instead of you, so walking around the deck doesn't shift the view.
- 2026-11-25: **The whole deck is walkable again:** the barrel moved from the starboard walkway up to the port bow beside the crates. It used to cut the foredeck off from the wheel.
- 2026-11-25: **Rustic wooden boats:** clinker-built planks with rivets, a weathered deck with seams, joints and nails, uneven plank walls with dark battens, wood-framed windows, rail posts, and a stepped wooden shingle roof. New boats are plain wood (dark oak, varnished, driftwood, cream canvas), and the palette gained driftwood and dark oak.
- 2026-11-25: **Cozier, customizable, upgradable boats:** the boat was rebuilt after the user's references: a painted band over weathered planks, board-walled cabin with white windows and flower boxes, potted plant, rope coil, anchor and portholes. Press B aboard to name it (shown on brass name plates), paint the hull, cabin, roof and canvas from 11 colours, and build upgrades from materials: Engine (faster, with a chimney), Rudder (quicker turns), Canvas awning, String lights, Bunting, Life rings & fenders, Fishing gear. Looks sync, save, and come back when you relaunch a boat you picked up.
- 2026-11-25: **Boats are slower over the shallows:** the sand drags on the hull, so top speed drops by up to 65% on a sandbank and the boat slows quickly as it runs onto one.
- 2026-11-25: **Boats sail over the shallows:** boats can go over the sandy shallows again, riding up a little so the keel clears the sand.
- 2026-11-25: **Ocean depth layers, coral reefs and reef fish:** the endless ocean now falls away in layers: wadeable sandy shallows, a reef shelf, then a drop-off into deep blue water and a dark abyss far out. The water's colour and clarity follow the depth. Coral reefs (branching, brain, fan and tube corals, anemones, starfish) grow on the shelf, with colourful schools of reef fish circling them, and the minimap shows the depths. Boats run aground on the sandbanks and launch past them.
- 2026-11-25: **Boat steering ignores the camera:** A / D turn the boat to its own left / right, so it can do a full 360° without moving the camera (this replaces the screen-relative steering from the throttle change).
- 2026-11-25: **Throttle on the left:** the boat's throttle lever moved from the bottom-right (above the clock) to the bottom-left, above the "?" button.
- 2026-11-25: **Wooden gear-shift throttle:** the throttle gauge is now a wooden panel with a lever that slides up and down a notched groove (drag it, click a gear, or W / S), clunking into each gear.
- 2026-11-25: **Boat throttle and un-inverted steering:** W / S now step a throttle (Astern, Stop, Slow, Half, Full) that the boat holds on its own, shown on a clickable gauge at the helm. A / D always swing the bow toward screen-left / right, whichever way the boat faces or moves.
- 2026-11-25: **Creative mode for testing:** a Creative toggle (top-left, or `?creative`) puts every item in the inventory screen (click for a stack, right-click for one, plus Empty inventory), opens the bag, and makes placing free. A boat can also go back into the inventory with right-click → Put boat in inventory.
- 2026-11-25: **Boats handle like boats, with a wake:** the helm is now boat-relative (W sail, S back the sail, A/D rudder, Shift full sail). The boat builds speed gradually, glides on when you ease off, turns only with way on, drifts a little in turns, heels and lifts its bow, and bounces off land. Moving boats leave pixel foam: bow waves fanning out in a V and a churned trail astern.
- 2026-11-25: **Rideable boats:** craft a Boat at the workbench and launch it on open water. Walk aboard from the shore or swim up to it, stroll around the deck, and press F (or click the wheel) to take the helm and sail with WASD (Shift for full sail). Step off over the rail onto land or into the sea. A cozy original ship after the user's reference: plank hull, orange-roofed cabin with teal windows, wheelhouse, waving pennant, lanterns, barrel and crates. The cabin opens up around you when it would hide you. Boats and their riders sync in multiplayer and save with the world.
- 2026-11-25: **Sea adventure archipelago:** endless worlds are now about 81% ocean, with big islands, mid-sized ones and small islets scattered across open water instead of continents. Mountains only rise on the big islands, and the campfire always starts on a proper island.
- 2026-11-25: **Controls behind a "?" button:** the always-on controls bar at the bottom is gone; a "?" button (or H) opens a controls card instead.
- 2026-11-25: **Day length 24 minutes:** `DAY_SECONDS` 600 → 1440, one game hour per real minute.
- 2026-11-25: **Day/night cycle:** time now runs on its own, a full day every 10 minutes (about 5 minutes of day, 5 of night). Everyone in a room shares the server's clock, and the time slider sets it for the whole room. Alone, the time carries over between sessions. `?time=N` stops the clock for screenshots.
- 2026-11-25: **Hover highlight:** bushes, pebbles, frogs and workbenches (and furniture and log piles with the axe) get a cream pixel outline and a soft glow when the cursor is over them, with a hand cursor.
- 2026-11-16: **Wooden walls, furniture and a backpack:** the inventory is just the 8-slot hotbar until you craft a Backpack from sticks and leaves (bushes and trees now drop Leaves), which adds 24 slots. Tools are crafted at a placed workbench (click it), and so are log-cabin Wooden Wall blocks and furniture: Chair, Table, Bed, Lamp (a glowing lantern post) and Bookshelf, placed, turned and picked up like the workbench. The workbench itself is now 6 Sticks + 2 Pebbles, by hand.
- 2026-11-16: **Cozier atmosphere:** the campfire throws glowing embers and a soft column of smoke, warm pollen specks drift in the daylight around you, and grass and flowers sway more calmly with slow gusts rolling across the meadows.
- 2026-11-16: **Half-tile movement:** the character moves half a tile per step and can stop on a tile's edge, standing on the higher side, so you can walk to the very edge of a block.
- 2026-11-16: **Climb a quarter higher and stand on log piles:** the step-up limit went from 1.0 to 1.25, and log piles are walkable on top (at their stack height) instead of blocking their tile.
- 2026-11-16: **Log piles:** Logs can be placed on a tile and stack 3, 2, 1 into a pile with ringed cut ends (from the user's reference). R turns the pile, the axe takes logs back off, and piles block the tile, sync and save.
- 2026-11-16: **See-through placement preview:** holding a block or workbench shows a translucent copy of it on the hovered tile, turned the way R set it.
- 2026-11-16: **Start with nothing, gather and craft:** the starting tools are gone; Shovel, Axe and Pickaxe are crafted from Sticks and Pebbles. Bushes break into sticks (and berries) on a left click and have a right-click "Search for berries" menu. Pebbles lie on the ground to pick up. R rotates Wood planks and workbenches. A bag button on the hotbar opens the inventory.
- 2026-11-16: **Logs, crafting and workbenches:** trees now drop Logs instead of Wood. The inventory screen has a Crafting row (1 Log → 2 Wood, 4 Logs → 1 Workbench). A Workbench is placed on a tile as furniture (modelled on the user's reference), blocks the tile, is picked up with the axe, and syncs and saves.
- 2026-11-16: **Removed wooden walls** at the user's request: no more R rotation, wall placing, previews, `wall` message or saved walls. Wood places only as blocks.
- 2026-11-16: **Wooden walls:** with Wood in hand, R rotates between a block and an upright plank panel on the north, east, south or west side of a tile. Walls block movement across their edge (and diagonals around their ends), preview when hovered, come down with the axe, and sync and save.
- 2026-11-16: **Placed blocks no longer recolour the ground below:** columns remember the ground under placed blocks (the under layer, `aUnder`), so their lower sides keep showing grass, dirt and so on. Digging the placed blocks off restores the original ground.
- 2026-11-16: **Axe and wood:** a new axe (starting slot 3) chops trees (3 swings, 6 for redwoods) with wood chips and a leaf burst, giving Wood (3/4/8). Wood places as plank blocks that only the axe breaks. Felled trees stay gone (neighbours never shift), sync in multiplayer (`chop`) and are saved.
- 2026-11-16: **Fish:** small schools of koi, silver, gold and olive fish swim in ponds, lakes and the sea near you as soft silhouettes under the surface, darting and turning at the shore, and now and then leaping out with a splash.
- 2026-11-16: **Fixed white grid lines over water** after walking away and back: the terrain height ring buffer grew from 128² to 256², so loaded chunks no longer overwrite each other's heights (which made the water draw shore foam on every tile edge).
- 2026-11-16: **Catch and throw frogs:** click a frog to catch it (walking over if needed) as a Frog item with its own icon. Hold it and click to throw it up to 7 tiles in a spinning arc. On land it hops back to a pond; in water it paddles to a lily pad. Caught frogs are replaced after 15 s.
- 2026-11-15: **Bigger, spaced-out pines:** pines are 1.4× bigger and keep at least 2.2 tiles apart (pine woods and rocky slopes).
- 2026-11-15: **Dark nights and lanterns:** much darker nights (moon 0.8 → 0.22, sky fill 0.95 → 0.26, near-black sky). Every character carries a glowing lantern at night, with real light for you and the 3 nearest players, and the campfire becomes a brighter, wider beacon.
- 2026-11-15: **Hover outlines:** holding a tool outlines the block it would dig, and holding a block shows a ghost outline where it would go (red when it can't). Dig and place checks are shared (`digProblem` / `placeProblem`), and the toasts no longer name slot numbers.
- 2026-11-15: **Birds:** small flocks of gulls, swifts and sparrows fly across in loose V formations, flapping and gliding, casting little shadows, and rising over woods and redwood canopies.
- 2026-11-15: **Placing blocks:** hold Dirt, Stone, Sand or Snow and click a tile (next to you, or walk there) to raise it one block. The character holds the block in hand. Placing into water builds up the bottom. Synced and saved like digging.
- 2026-11-15: **Walk to dig:** clicking a far block with a shovel or pickaxe walks the character next to it and digs, instead of saying "Too far".
- 2026-11-15: **Minecraft-style inventory with 2D items:** a 9-slot hotbar (1–9) and a 27-slot bag (I/Tab) with pick-up, place, merge, split, swap and shift-move, and original pixel-art icons. The held slot is your tool. Digging now collects Dirt, Stone, Sand and Snow blocks (stacks of 64). The inventory is saved per saved world or room.
- 2026-11-15: **WASD-only movement:** click/tap-to-go removed. Clicks only use the held tool on a neighbouring tile. The help bar was updated.
- 2026-11-15: **Shovel and pickaxe:** a 3-slot hotbar (Hand, Shovel, Pickaxe; keys 1–3). Tap a tile next to you to dig it down one block (stone takes 2 pickaxe hits), with a swing animation and debris. Dug tiles are bare soil (`K.SOIL`) or flood below sea level. Digs sync in multiplayer (`dig` message, `welcome.edits`) and are saved in singleplayer saves.
- 2026-11-15: **Fewer butterflies:** 80 → 30.
- 2026-11-15: **Rendering performance:** trees cast shadows from their low-detail models via shadow-only layers (clouds moved to layer 2), shadow maps 2048² → 1024² (cloud sun 512²), 4 firefly lights that exist only at night, and no full-resolution step when zoomed out (pixel size stops at 2).
- 2026-11-15: **Calmer meadows:** softer grass colours, about half the grass tufts and tall grass on plains, exposed dirt patches (`K.DIRT`), and no more generated ruins.
- 2026-11-15: **Rarer mountains:** range thresholds raised; mountain land ~20% → ~10%, same heights.
- 2026-11-15: **Lush slopes, snowy tops:** mountain lower slopes are now grass and forest (more woods in ranges), with a thin wobbly rock band under a snow line at ~13.5.
- 2026-11-15: **Taller mountains and hiking trails (endless worlds):** mountain ranges rise to about 22 units with rounded snowy summits. Winding dirt trails with gentle steps and stone cairns climb through them.
- 2026-11-15: **Fewer pines:** pine chance in pine woods 0.5 → 0.28 (`PINE_CHANCE`), rocky-slope pines 5% → 3%.
- 2026-11-15: **Ocean uses the shallow-water ripples, toned down** (32%), instead of wave bands.
- 2026-11-15: **Shallow vs open water:** caustic cells only in the shallows; open water looks like the ocean (deep blue, rolling pixel wave bands with white crest dashes). Depth blends smoothly between tiles.
- 2026-11-15: **Caustic water, lush watersides, insects:** water ripples became pixel caustic cells (from the user's reference), reeds stand in the shallows, there are more lily pads and plants along banks, and fly swarms and water striders were added.
- 2026-11-15: **Water and pond life:** depth-tinted, see-through water with pixel ripple lines and shore foam, a teal seabed, swaying seaweed, seabed rocks, lily pads (some flowering), and frogs hopping between pads. Each `swayMaterial` strength now gets its own shader program (they used to share one).
- 2026-11-15: **Larger pine woods:** forest ground comes from a broader noise (scale 9 → 20, threshold 0.56 → 0.52): woods cover ~45% of lowland instead of ~37%, in patches about 4.7× bigger. Islands and endless worlds.
- 2026-11-15: **Taller, more spread-out leafy trees:** 1.6× taller trunks with the canopy raised (pines and redwoods unchanged), and round trees keep at least 3.2 tiles apart.
- 2026-11-15: **Less lag zoomed out (endless worlds):** far trees switch to low-detail models and far small foliage is hidden, about 57% fewer triangles.
- 2026-11-15: **Endless worlds (Minecraft-style):** terrain keeps generating in 16-cell chunks as you explore, with oceans, coasts, mountain ranges, forests, redwood groves and ruins, all from a seed. It's the default for rooms, singleplayer and Create world. Saves store only the seed. Islands and the map editor are unchanged. The pathfinder and movement now use global cell keys.
- 2026-11-15: **Cartoonish animation:** spring-driven squash and stretch (footfalls, jumps, big landing squash), forward lean with overshoot, head lag, bouncy hop-steps with waddle and hip twist, big limb swings, idle look-around and happy hops, flailing jumps and a doggy paddle.
- 2026-11-15: **Main menu:** Play singleplayer (offline: random island or a saved world), Multiplayer (room code, optionally bringing a world), Create world (name, seed, generated or blank; saved in the browser) and Map editor. Menu button and Esc return to it. `?room=` skips it.
- 2026-11-15: **Fixed camera angles:** only Q/E (45° steps) turn the camera. Drag and twist rotation were removed.
- 2026-11-15: **Rotatable camera:** Q/E (45° steps, eased), right/middle-drag or a two-finger twist. WASD follows the screen, and the minimap shows the view direction. The editor rotates too.
- 2026-11-15: **Map editor mode:** sculpt and paint terrain, place trees, redwoods, rocks, ruins and the campfire, undo/redo, save in the browser, export/import files, and play a map for the whole room (`map` message). World generation is split into base + `finishWorld`.
- 2026-11-15: **Deep forest biome:** big patches of DEEP ground with towering redwoods whose canopy blocks both suns, so it's dark even by day. The sky fill dims and fireflies glow while you're inside. A corridor cutaway keeps the player visible. Clouds were raised above the redwoods.
- 2026-11-15: **Darker shadows:** 25% of the sky fill moved into the main sun (`SHADOW_DEPTH`), so lit areas stay the same and shadows deepen.
- 2026-11-15: **Subtle tilt-shift:** the top and bottom of the screen softly blur around a sharp centre band, a bit more when zoomed out.
- 2026-11-15: **Subtler firefly light:** intensity 2.2 → 0.4, range 2.6 → 2.0, paler colour.
- 2026-11-15: **Fireflies light their surroundings at night:** 8 pooled point lights follow the fireflies nearest the player.
- 2026-11-15: **Firefly glow at night:** soft stepped halos around fireflies fade in from dusk to dawn, and the fireflies get brighter.
- 2026-11-15: **Time-of-day slider:** a bottom-right HUD slider (local, remembered per browser, `?time=`) moves the sun and moon and blends sky, fog, light and cloud colours through dawn, day, golden hour, sunset and night.
- 2026-11-15: **See-through leaves:** tree canopies open up in a dithered circle around your character when they block the view. Silhouette made stronger (opacity 0.55 → 0.75, less washed-out).
- 2026-11-15: **Performance pass:** chunked static instancing for frustum and shadow culling, tree cluster cores at detail 1 (about −22% tree triangles), and tall grass and ferns no longer cast shadows.
- 2026-11-15: **Pixel filter eases off when zoomed out:** art pixel 3 → 2 past distance 15, → 1 past 25 (2 → 1 on narrow screens).
- 2026-11-15: **Walk-under trees and leafy conifers.** Most trunks now sit on tile corners, so the tiles under the canopy are walkable (only the diagonal through the trunk is blocked). Pines were rebuilt as tiered conifers with the same rounded leaves.
- 2026-11-15: **Rounder leaves:** oval leaf cards instead of pointed diamonds, less droop, smoother cluster cores.
- 2026-11-15: **Reference-style leafy trees** (`trees3d.js`): twisted purple-brown trunks with roots and branches, separate jagged leaf clusters in banded greens, 4 variants. Bushes match. Pines unchanged.
- 2026-11-15: **Bigger, fuller trees:** `TREE_SCALE` 1.5 for all trees, a 14-puff two-layer leafy canopy, and a third cone on pines.
- 2026-11-15: **Landing impact particles:** falling 2+ blocks (≥ 1.0) onto dry ground kicks up a dust ring and ground chips (`effects.js`), for you and for other players.
- 2026-11-15: **Removed the wind streaks** at the user's request. Drifting leaves stay.
- 2026-11-15: **Stronger cloud shadows:** sunlight split changed from 2.1 + 1.0 to 1.5 (main) + 1.6 (cloud sun), same total brightness.
- 2026-11-15: **Removed the village structures** at the user's request: cottages, cobblestone paths, fences, well, props and lanterns. The flat flowery clearing around the campfire stays. Models moved to `archive/village/`. The ruins are unchanged.
- 2026-11-15: **Cozy village and boxy clouds** (from the user's village reference).
  - Flattened village plaza at the spawn: 2 textured stone cottages, cobblestone PATH tiles, fences, a well, props and lanterns (`village3d.js`, `textures.js`).
  - Round vertex-colored leafy trees and bushes.
  - Clouds rebuilt from box puffs (same banded palette). God rays removed.
  - Grading back to lush (saturation 1.02, exposure 0.95).
- 2026-11-15: **God rays, softer colors, billowy clouds.** Additive crossed-plane light shafts along the sun direction. Grading toned down (saturation 0.88, exposure 0.88) with lavender shadows. Clouds rebuilt as banded peach-to-lavender cumulus clumps of icosphere puffs, replacing the voxel blocks.
- 2026-11-15: **Clouds, cloud shadows and ambient life.** Voxel clouds appear when zoomed out (max zoom 34) and never cover the player. Cloud shadows come from a separate weaker sun on layer 1. Added butterflies, dragonflies, wind streaks and falling leaves (`ambient.js`). Fog and shadow coverage scale with zoom.
- 2026-11-15: **Grassier block sides:** jagged hanging grass strands with drips, shaded tips, per-strand shadows and sprouts replace the flat grass band.
- 2026-11-15: **Blotchy grass tops** to match a new reference tile from the user: banded value-noise blotches replace the leaf marks and checker.
- 2026-11-15: **Cleaner grass blocks.** Sparse tidy leaf marks, no specks, a softer checker, a smooth grass lip, pebble-only dirt, ±1.5% column tint, and `COLOR_LEVELS` 12→18 to cut dither grain.
- 2026-11-15: **Hand-drawn-style grass** (from the user's reference image): lime tile checker with leaf marks, and fluffy vertex-colored leaf clumps instead of thin blades. Fixed dark back faces, stopped foliage from triggering the silhouette, and softened wall AO.
- 2026-11-15: **Grassier world and better lighting.** About 3× more grass tufts, tall meadow grass patches, more flowers, and grass on rock and sand. Rock and snow start higher. Bloom pass, ACES tone mapping, color grading and vignette. Warm sun with cool fill, pixel-stepped terrain AO, sparkly Phong water, HDR campfire and gems, fireflies. Grass blades switched to single quads for performance.
- 2026-11-15: **Tile-locked movement.** The character always stands on tile centers and moves tile to tile (8-way, no corner cutting). `PlayerController` was replaced by `GridController`. `PathFinder` now returns cell routes (no smoothing), with shared `stepOk` rules. Auto-jump became hop arcs between tiles. Space is a standing hop.
- 2026-11-15: **Textured terrain and foliage.** Grass blocks have dirt sides with a jagged grass lip; rock has strata and moss; snow has a lip; all via a procedural shader. Added grass tufts, bushes with berries, ferns, mushrooms, and reeds with cattails, with wind sway. Added the `?zoom=` URL option.
- 2026-11-15: **Cozy update.** Fixed ¾ follow camera instead of orbit. Cute chibi character (blink, blush, hairstyles and hats) with a see-through silhouette when hidden. Tap/click-to-go with A* pathfinding and auto-jump; the joystick and drag-look were removed.
- 2026-11-15: **Pivot to exploration.** Replaced the RTS/building game with a third-person explorable island, a controllable blocky character, multiplayer presence and a minimap. Building mode was moved to `archive/settlement-builder/`. The pixel filter was moved to `pixelfx.js` and its outline test changed to 1/viewZ for the perspective camera.
- 2026-11-15: Switched from a 2D canvas to a 3D Three.js board with a pixel-art post filter (low-res render, outlines, dithered palette). Pixel font and chunky UI. 3D-rendered palette icons.
- 2026-11-15: Initial build (settlement builder). Economy retuned after the first sim showed 2-minute games (tick 4s→5s, win 40→50, steeper cost scaling, pricier houses and monuments).
