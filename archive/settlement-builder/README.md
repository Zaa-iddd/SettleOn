# Archived: settlement-builder mode

This is the original SettleOn game: a shared isometric map where players placed buildings and raced to 50 renown.
It was removed on 2026-11-15 when the game switched to an explorable world with a controllable character.
The user said "remove the building mechanic for now", so it may come back.

- `game.js`: rules and content (buildings, costs, scoring, map generation). It was `src/shared/game.js`.
- `board3d.js`: the isometric 3D board renderer with the pixel filter. It was `src/client/board3d.js`.
- `main.js`, `index.html`, `style.css`: the client UI for build mode.
- `sim.mjs`: the bot balance simulator. It was `scripts/sim.mjs`.

The server's build, trade, start and newMap messages are not archived here. The rules they called are all in `game.js`.
None of this is imported by the current game.
