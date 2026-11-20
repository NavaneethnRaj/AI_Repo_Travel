import { defineConfig } from "vite";

export default defineConfig({
  cacheDir: "../../node_modules/.vite/wayfarer-web",
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/health": "http://127.0.0.1:8080",
    },
  },
});
