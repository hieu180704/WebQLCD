import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile();
} catch {
  // Không có .env: dùng biến môi trường sẵn có (cần DATABASE_URL).
}

// Mỗi worktree chạy song song đặt E2E_PORT riêng trong .env để không tranh cổng.
const PORT = Number(process.env.E2E_PORT ?? 3100);
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
      // Khoá CCCD ngẫu nhiên khi máy chưa cấu hình; dữ liệu e2e là rác, không cần giải mã lại.
      CCCD_ENCRYPTION_KEY: process.env.CCCD_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
      CCCD_HMAC_KEY: process.env.CCCD_HMAC_KEY ?? randomBytes(32).toString("base64"),
    },
  },
});
