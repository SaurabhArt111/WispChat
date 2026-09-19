import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
