import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Discord loads the activity through a tunnel (e.g. *.trycloudflare.com).
    allowedHosts: true,
    // Hot reload through the HTTPS tunnel; Vite falls back to the direct port on localhost.
    hmr: { clientPort: 443 },
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
