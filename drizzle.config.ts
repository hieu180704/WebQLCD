import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // Không có .env (CI, production): dùng biến môi trường sẵn có.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/infrastructure/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
