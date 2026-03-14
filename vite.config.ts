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
  test: {
    include: ['tests/unit/**/*.test.ts']
  },
  server: {
    port: 4173
  }
});
