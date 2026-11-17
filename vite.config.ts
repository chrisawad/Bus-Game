import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: process.env.BASE_PATH || './',
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        id: './',
        name: 'Bus Jam — Colorful Traffic Puzzles',
        short_name: 'Bus Jam',
        description: 'Untangle the buses. Match the colors. Get everyone home.',
        start_url: './',
        scope: './',
        display: 'standalone',
        related_applications: [{ platform: 'webapp', url: './manifest.webmanifest', id: './' }],
        orientation: 'any',
        theme_color: '#ecf4ef',
        background_color: '#ecf4ef',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
