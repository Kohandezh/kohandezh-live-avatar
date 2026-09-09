import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * One codebase, three build targets.
 *
 * - mobile: the Capacitor app (Android / iOS). Output: dist/mobile
 * - web:    the installable PWA for browsers. Output: dist/web
 * - admin:  the admin dashboard. Output: dist/admin
 *
 * Select a target with the APP_TARGET environment variable:
 *   APP_TARGET=admin vite
 *   APP_TARGET=web vite build
 *
 * Each target has its own entry folder under src/app/<target>/ with an
 * index.html and main.tsx. Everything else (pages, features, entities,
 * shared) is shared code.
 */
export const appTargets = ['mobile', 'web', 'admin'] as const;
export type AppTarget = (typeof appTargets)[number];

// Different ports so all three dev servers can run at the same time.
const devPorts: Record<AppTarget, number> = {
  mobile: 5173,
  web: 5174,
  admin: 5175,
};

const rootDir = import.meta.dirname;

function resolveAppTarget(): AppTarget {
  const value = process.env.APP_TARGET ?? 'web';

  if (!appTargets.includes(value as AppTarget)) {
    throw new Error(
      `Unknown APP_TARGET "${value}". Use one of: ${appTargets.join(', ')}.`,
    );
  }

  return value as AppTarget;
}

export default defineConfig(() => {
  const target = resolveAppTarget();
  const plugins: PluginOption[] = [react(), tailwindcss()];

  if (target === 'web') {
    // Only the web target is a PWA. The Capacitor app serves files locally,
    // so a service worker there adds risk without benefit.
    plugins.push(
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/favicon.svg'],
        manifest: {
          name: 'Cross-Platform App',
          short_name: 'App',
          description: 'Cross-platform web application.',
          start_url: '/',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: '#0f172a',
          icons: [
            {
              src: 'icons/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'icons/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: 'icons/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // API calls must never be answered by the SPA fallback page.
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    );
  }

  return {
    root: path.resolve(rootDir, 'src/app', target),
    publicDir: path.resolve(rootDir, 'public'),
    envDir: rootDir,
    cacheDir: path.resolve(rootDir, 'node_modules/.vite', target),
    plugins,
    define: {
      'import.meta.env.VITE_APP_TARGET': JSON.stringify(target),
    },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, 'src'),
      },
    },
    server: {
      port: devPorts[target],
      strictPort: true,
    },
    preview: {
      port: devPorts[target] + 1000,
      strictPort: true,
    },
    build: {
      outDir: path.resolve(rootDir, 'dist', target),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // Split big libraries into their own chunks so they cache well
          // and change less often than app code.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (
              /[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            ) {
              return 'react';
            }
            if (id.includes('@tanstack')) return 'query';
            if (id.includes('i18next')) return 'i18n';
            if (id.includes('zod')) return 'zod';
            return 'vendor';
          },
        },
      },
    },
  };
});
