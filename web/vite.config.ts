import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Connect RPC routes live under /<proto package>.<Service>/<Method>, so
// proxying the "/stoop." prefix covers every API service; /ws is the
// realtime gateway and /livekit the proxied LiveKit signaling socket.
// /files is the one plain-HTTP route the app uses (avatars, space icons
// and attachment bytes); without it the dev server answers those with
// index.html and every uploaded image renders blank.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/stoop.": {
        target: "http://localhost:8091",
        changeOrigin: false,
      },
      "/files": {
        target: "http://localhost:8091",
        changeOrigin: false,
      },
      "/ws": {
        target: "http://localhost:8091",
        ws: true,
      },
      "/livekit": {
        target: "http://localhost:8091",
        ws: true,
      },
    },
  },
});
