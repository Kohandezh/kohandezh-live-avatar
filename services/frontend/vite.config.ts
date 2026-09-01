import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Environment-specific values come from .env.<mode> files (see .env.example).
// Source code never changes between environments.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        id: '/',
        name: 'Dr.Kohandezh Live Avatar',
        short_name: 'Live Avatar',
        description: 'Development console for the Dr.Kohandezh Persian live avatar pipeline.',
        lang: 'fa',
        dir: 'rtl',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The service worker only ever serves the app shell. API responses, media assets and
        // WebSocket/WebRTC traffic are never cached: server state is owned by TanStack Query and
        // avatar streaming genuinely requires the network.
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@app': fileURLToPath(new URL('./src/app', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@entities': fileURLToPath(new URL('./src/entities', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Local development talks to the Compose stack through the same-origin `/api` prefix that
    // Nginx exposes in production, so no CORS configuration is needed on the orchestrator.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8088',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep the WebRTC SDK and the UI framework in their own long-lived cacheable chunks.
        manualChunks(id) {
          if (id.includes('node_modules/livekit-client') || id.includes('node_modules/@livekit'))
            return 'livekit';
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id))
            return 'react';
          if (
            id.includes('node_modules/@heroui') ||
            id.includes('node_modules/react-aria') ||
            id.includes('node_modules/@react-')
          )
            return 'ui';
          return undefined;
        },
      },
    },
  },
});
