import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile();
} catch {
  // Không có .env: test DB tự skip.
}

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
