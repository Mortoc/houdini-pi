import { defineConfig } from "@playwright/test";

/** The UI spec runs against the built page served by the sidecar with the fake agent. */
export default defineConfig({
  testDir: "./ui/e2e",
  timeout: 30_000,
  retries: 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:9123",
    headless: true,
  },
  webServer: {
    command: "node sidecar/dist/src/index.js --fake-agent --port 9123 --token e2e",
    url: "http://127.0.0.1:9123/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
