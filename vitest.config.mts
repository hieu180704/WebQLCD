import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile();
} catch {
  // Không có .env: test DB tự skip.
}

export default defineConfig({
  resolve: {
    // Test chạy ngoài React Server Components: cho module server import được "server-only".
    alias: { "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
