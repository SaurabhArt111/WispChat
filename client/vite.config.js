import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "generateSW" is the zero-config workbox strategy: it precaches the
      // build output and lets us layer on a few runtimeCaching rules for
      // API calls and uploaded media, without hand-writing a service worker.
      strategy: "generateSW",
      // "autoUpdate": a new deploy activates immediately (skipWaiting +
      // clientsClaim below) instead of waiting for someone to click an
      // "Update available" card — waiting on that click is a big reason the
      // app looked stuck on an old build.
      registerType: "autoUpdate",
      // We call the registration hook ourselves (see src/pwa.js) so we can
      // show a custom "update available" toast instead of the plugin's
      // default silent/prompt behavior.
      injectRegister: false,
      includeAssets: [
        "favicon.ico",
        "icons/favicon.svg",
        "icons/apple-touch-icon.png",
        "icons/apple-splash-*.png",
      ],
      // The manifest is kept in public/ so the same valid JSON is served by
      // Vite in development and copied unchanged into production builds.
      manifest: false,
      workbox: {
        // Precache the built app shell (JS/CSS/HTML/icons) for instant,
        // offline-capable loads.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // SPA fallback for client-side routing while offline — but never for
        // API/socket/upload requests, which must reach the real network.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/socket\.io\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // REST API + realtime: NEVER cache. The app keeps its own
            // warm cache of conversations/messages (utils/messageCache.js)
            // and revalidates it on every load; a service-worker copy of
            // /api responses only ever served *stale* data (the old
            // NetworkFirst rule fell back to a day-old response whenever
            // the network was slow), which is exactly the "nothing updates
            // until I reload" symptom.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/"),
            handler: "NetworkOnly",
          },
          {
            // Uploaded media: file names are unique and immutable, so
            // cache-first is safe. `rangeRequests` lets cached video/audio
            // still stream and seek (without it Safari refuses to play
            // cached video), and only real 200 responses are stored so
            // opaque/partial responses can't poison the cache.
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "CacheFirst",
            options: {
              cacheName: "wisp-media-cache-v2",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
          {
            // Google Fonts stylesheet + font files.
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "wisp-fonts-stylesheets" },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "wisp-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Development has no built app shell for Workbox to precache. Keep
        // the service worker enabled for production builds only.
        enabled: false,
        type: "module",
      },
    }),
  ],
  // ffmpeg.wasm (used for GIF/video compression, see utils/mediaCompressor.js)
  // ships its own worker + wasm loading that Vite's dependency
  // pre-bundling tends to mangle — excluding it is the documented
  // workaround so both dev and build load the real files untouched.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:5000", changeOrigin: true },
      "/uploads": { target: "http://localhost:5000", changeOrigin: true },
      // Socket.io needs its own entry with ws:true — without this the client's
      // realtime connection silently never reaches the backend, and everything
      // that depends on it (new messages arriving, reactions, typing, presence)
      // only shows up after a manual refresh re-fetches over REST instead.
      "/socket.io": { target: "http://localhost:5000", ws: true, changeOrigin: true },
    },
  },
});
