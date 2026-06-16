import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend talks to the backend only via /api, proxied to the local server.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
