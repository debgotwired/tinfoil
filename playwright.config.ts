import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  retries: 0,
  reporter: "list",
  webServer: {
    command: "npm run dev -- -p 3002",
    port: 3002,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
