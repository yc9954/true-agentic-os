import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API + WebSocket to the orchestrator on :4000.
// For the recorded demo the UI is built and served by the orchestrator itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/stream": { target: "ws://localhost:4000", ws: true },
    },
  },
});
