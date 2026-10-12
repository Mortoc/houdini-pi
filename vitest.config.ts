import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@houdini-pi/protocol": here("./protocol/src/index.ts"),
      "@houdini-pi/pi-package": here("./pi/extensions/index.ts"),
    },
  },
  test: {
    include: ["protocol/src/**/*.test.ts", "sidecar/test/**/*.test.ts", "pi/test/**/*.test.ts"],
    environment: "node",
  },
});
