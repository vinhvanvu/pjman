import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app builds into the tool's dist/ui and is served by `pjman serve`; in development the API is proxied to a running server.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../dist/ui', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.PJMAN_SERVE ?? 'http://127.0.0.1:7331', changeOrigin: true } },
  },
});
