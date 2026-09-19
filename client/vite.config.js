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
      manifest: {
        id: "/",
        name: "Wisp — Chat",
        short_name: "Wisp",
        description: "Fast, modern realtime chat — messages, media, groups and calls in one place.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone", "browser"],
        orientation: "portrait-primary",
        background_color: "#0b0e12",
        theme_color: "#0b0e12",
        categories: ["social", "communication", "productivity"],
        icons: [
          { src: "/icons/icon-48.png", sizes: "48x48", type: "image/png" },
          { src: "/icons/icon-72.png", sizes: "72x72", type: "image/png" },
          { src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
          { src: "/icons/icon-128.png", sizes: "128x128", type: "image/png" },
          { src: "/icons/icon-144.png", sizes: "144x144", type: "image/png" },
          { src: "/icons/icon-152.png", sizes: "152x152", type: "image/png" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-256.png", sizes: "256x256", type: "image/png" },
          { src: "/icons/icon-384.png", sizes: "384x384", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          {
            name: "New conversation",
            url: "/?action=new-chat",
            icons: [{ src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" }],
          },
        ],
      },
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
        skipWaiting: false, // we drive activation from the custom update prompt instead
        runtimeCaching: [
          {
            // REST API: always prefer a fresh network response, but keep a
            // short-lived cached fallback so the UI has *something* to show
            // (e.g. the last conversation list) when the network is down.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "wisp-api-cache",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Uploaded media (images/videos/audio/documents/gifs/stickers):
            // once fetched, a given file never changes, so cache-first with
            // a generous cap makes chat history usable offline without
            // re-downloading media on every visit.
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "CacheFirst",
            options: {
              cacheName: "wisp-media-cache",
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
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
        // Let the SW register in `vite dev` too, so installability and the
        // update flow can be sanity-checked without a production build.
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
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
