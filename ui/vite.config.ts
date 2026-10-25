import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The app builds into the tool's dist/ui and is served by `pjman start`; in development the API is proxied to a
// running server. Routes are files under src/routes; the router plugin writes the typed route tree into src/app.
export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/app/routeTree.gen.ts',
      routeFileIgnorePrefix: '-',
      quoteStyle: 'single',
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  build: { outDir: '../dist/ui', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.PJMAN_SERVE ?? 'http://127.0.0.1:7331', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/app/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
