import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The repo-root directory (one level up from web/), where .env lives.
const rootDir = fileURLToPath(new URL("..", import.meta.url));

// The frontend talks to the backend only via /api, proxied to the local server.
export default defineConfig(({ mode }) => {
  // Load the repo-root .env so the UI port is configurable via WEB_PORT (default 5180),
  // and the proxy follows the server's PORT (default 3001).
  const env = loadEnv(mode, rootDir, "");
  const uiPort = Number(env.WEB_PORT) || 5180;
  const serverPort = Number(env.PORT) || 3001;
  return {
    plugins: [react()],
    server: {
      port: uiPort,
      strictPort: true,
      proxy: {
        "/api": `http://localhost:${serverPort}`,
      },
    },
  };
});
