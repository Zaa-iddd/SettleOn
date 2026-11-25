import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// The Cloudflare plugin runs the Worker (worker/index.js: /api/token and the PartyKit rooms at
// /parties/room/<id>) inside the Vite dev server, so dev is a single port. `vite build` builds the
// client into dist/client and the Worker into dist/settleon, which `wrangler deploy` uploads.
export default defineConfig({
  plugins: [cloudflare()],
  server: {
    port: 5173,
    // Discord loads the activity through a tunnel (e.g. *.trycloudflare.com).
    allowedHosts: true,
    // Hot reload through the HTTPS tunnel; Vite falls back to the direct port on localhost.
    hmr: { clientPort: 443 },
  },
});
