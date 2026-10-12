import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const sidecar = process.env["HOUDINI_PI_SIDECAR"] ?? "http://127.0.0.1:9123";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@houdini-pi/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: sidecar, ws: true },
      "/health": { target: sidecar },
    },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
