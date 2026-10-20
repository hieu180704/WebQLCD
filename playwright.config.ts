import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile();
} catch {
  // Không có .env: dùng biến môi trường sẵn có (cần DATABASE_URL).
}

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

// E2E chạy trên bản build production để kiểm đúng cờ cookie (Secure) và header bảo mật.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL, channel: "msedge" },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `${baseURL}/dang-nhap`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString("base64"),
      BETTER_AUTH_URL: baseURL,
    },
  },
});
