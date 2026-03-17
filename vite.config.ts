import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'TabeMap',
        short_name: 'TabeMap',
        description: 'Fast map-first discovery for top-rated restaurants in Japan.',
        theme_color: '#f4efe6',
        background_color: '#f6f1e8',
        display: 'standalone',
        lang: 'en',
        start_url: '/',
        icons: [
          {
            src: 'icons/app-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: 'icons/app-icon-maskable.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,txt,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'data-cache'
            }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) {
            return 'vendor-maplibre';
          }

          if (id.includes('node_modules/svelte-i18n') || id.includes('node_modules/@formatjs')) {
            return 'vendor-i18n';
          }

          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-query';
          }

          return undefined;
        }
      }
    }
  },
  test: {
    include: ['tests/unit/**/*.test.ts']
  },
  server: {
    port: 4173
  }
});
