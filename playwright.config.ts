import { defineConfig } from "@playwright/test";
const port = Number(process.env.TEST_PORT ?? 3000);
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 240000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    actionTimeout: 10000,
  },
  reporter: [["list"], ["json", { outputFile: "docs/private/test-results.json" }]],
  webServer:
    process.env.EXTERNAL_TEST_SERVER === "1"
      ? undefined
      : {
          command: "node scripts/test-server.mjs",
          url: `http://127.0.0.1:${port}/login`,
          reuseExistingServer: false,
          timeout: 60000,
        },
});
