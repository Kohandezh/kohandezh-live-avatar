import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * One codebase, four build targets.
 *
 * - mobile: the Capacitor app (Android / iOS). Output: dist/mobile
 * - web:    the installable PWA for browsers. Output: dist/web
 * - admin:  the admin dashboard. Output: dist/admin
 * - widget: the script customers embed on their own website. Output: dist/widget
 *
 * Select a target with the APP_TARGET environment variable:
 *   APP_TARGET=admin vite
 *   APP_TARGET=web vite build
 *
 * Each target has its own entry folder under src/app/<target>/ with an
 * index.html and main.tsx. Everything else (pages, features, entities,
 * shared) is shared code.
 */
export const appTargets = ['mobile', 'web', 'admin', 'widget'] as const;
export type AppTarget = (typeof appTargets)[number];

// Different ports so all dev servers can run at the same time.
const devPorts: Record<AppTarget, number> = {
  mobile: 5173,
  web: 5174,
  admin: 5175,
  widget: 5176,
};

const rootDir = import.meta.dirname;

/** The global the embedded script defines on the customer's page. */
const WIDGET_GLOBAL = 'KohandezhAssistant';
/** The single file a customer loads with a <script> tag. */
const WIDGET_FILE = 'assistant-widget.js';
/**
 * The script tag the demo page uses while `vite dev` serves it. The build swaps it for the
 * bundled file, so the same page works in both modes.
 */
const WIDGET_DEV_SCRIPT = /type="module"\s+src="\/main\.tsx"/;

function resolveAppTarget(): AppTarget {
  const value = process.env.APP_TARGET ?? 'web';

  if (!appTargets.includes(value as AppTarget)) {
    throw new Error(
      `Unknown APP_TARGET "${value}". Use one of: ${appTargets.join(', ')}.`,
    );
  }

  return value as AppTarget;
}

/**
 * Library mode has no HTML entry, so Vite never sees src/app/widget/index.html.
 * That page is the widget demo, so copy it into dist/widget by hand.
 */
function widgetDemoPage(htmlPath: string): Plugin {
  return {
    name: 'widget-demo-page',
    apply: 'build',
    async generateBundle() {
      const source = await readFile(htmlPath, 'utf8');

      if (!WIDGET_DEV_SCRIPT.test(source)) {
        throw new Error(
          `${htmlPath} no longer has the dev script tag the widget build rewrites.`,
        );
      }

      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: source.replace(WIDGET_DEV_SCRIPT, `src="./${WIDGET_FILE}"`),
      });
    },
  };
}

export default defineConfig(() => {
  const target = resolveAppTarget();
  // Tailwind runs for every target. The widget imports the same stylesheet with `?inline`
  // and injects the text into its Shadow DOM instead of linking a CSS file.
  const plugins: PluginOption[] = [react(), tailwindcss()];

  if (target === 'web') {
    // Only the web target is a PWA. The Capacitor app serves files locally,
    // so a service worker there adds risk without benefit. The widget runs on
    // somebody else's origin and must never register one.
    plugins.push(
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/favicon.svg'],
        manifest: {
          name: 'Dr. Kohandezh Assistant',
          short_name: 'Kohandezh',
          description: "Live conversation with Dr. Kohandezh's digital avatar.",
          lang: 'fa',
          dir: 'rtl',
          start_url: '/',
          display: 'standalone',
          // `background_color` is the splash-screen ground behind the icon while the app boots.
          // It stays #f5f5f5: that is the exact hex of HeroUI's light `--background`
          // (oklch(97.02% 0 0)), which is what the app paints one frame later. Making the splash
          // purple would flash a colour no screen of the app actually shows, so this one does
          // NOT follow the accent. `theme_color` is the browser and system chrome, which is the
          // accent: oklch(58% 0.215 308) = #9e49d9. Keep theme_color in step with THEME_COLOR in
          // src/features/settings/ThemeSync.tsx and the anti-FOUC script in each index.html.
          background_color: '#f5f5f5',
          theme_color: '#9e49d9',
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

  const isWidget = target === 'widget';

  if (isWidget) {
    plugins.push(
      widgetDemoPage(path.resolve(rootDir, 'src/app/widget/index.html')),
    );
  }

  return {
    root: path.resolve(rootDir, 'src/app', target),
    // The widget output is one script plus the demo page. It must not carry the app icons.
    publicDir: isWidget ? (false as const) : path.resolve(rootDir, 'public'),
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
      ...(isWidget
        ? {
            // One self-contained classic script: React, the assistant feature and the CSS
            // all live inside it. A customer adds one <script> tag and nothing else.
            // IIFE output cannot be code-split, so the LiveAvatar SDK is bundled in too.
            cssCodeSplit: false,
            lib: {
              entry: path.resolve(rootDir, 'src/app/widget/main.tsx'),
              name: WIDGET_GLOBAL,
              formats: ['iife' as const],
              fileName: () => WIDGET_FILE,
            },
          }
        : {
            rollupOptions: {
              output: {
                // Split big libraries into their own chunks so they cache well
                // and change less often than app code.
                //
                // ONE rule governs this function: a cycle must never cross a chunk
                // boundary. Rollup orders modules within a chunk, but between chunks
                // the import order is fixed, so a cycle that spans two chunks can
                // evaluate a subclass before its base class exists. That crashes the
                // app at load with "Cannot access 'X' before initialization", it only
                // happens in a built bundle, and `vite build` reports nothing.
                //
                // That is exactly what a `react`-only chunk caused here: HeroUI's
                // toast queue subclasses a React Stately class, and with React split
                // off on its own the two ended up in different chunks. So everything
                // in the React component ecosystem stays together.
                manualChunks(id: string) {
                  if (!id.includes('node_modules')) return undefined;
                  // The assistant loads the SDK (and LiveKit with it) only when a conversation
                  // starts, so keep both out of the chunk every page downloads. This split is
                  // safe because it follows a real dynamic `import()` boundary in the code, so
                  // nothing in it is evaluated until the whole graph above it already exists.
                  if (
                    /@heygen[\\/]liveavatar-web-sdk|livekit-client/.test(id)
                  ) {
                    return 'liveavatar';
                  }
                  // Everything else ships as one vendor chunk, on purpose. Splitting it by
                  // library for nicer caching is what broke the build.
                  return 'vendor';
                },
              },
            },
          }),
    },
  };
});
