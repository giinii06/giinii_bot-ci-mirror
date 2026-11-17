import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Activity SPA. 빌드는 정적 JS/CSS만 만들고, 서버는 그 결과를 읽어서 돌려준다.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1400,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
