// Dữ liệu demo cho khách xem: cửa hàng riêng, lịch sử ~60 ngày, đi qua use case thật. Chạy: npm run db:seed-demo.
// Code ứng dụng dùng alias "@/", import không đuôi, JSX qua barrel module: nạp bằng module runner của Vite (giống vitest).
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

try {
  process.loadEnvFile();
} catch {
  // Không có .env: dùng biến môi trường sẵn có.
}
if (process.env.NODE_ENV === "production") throw new Error("Không chạy seed demo ở production");

const root = fileURLToPath(new URL("..", import.meta.url));
const { module } = await runnerImport(fileURLToPath(new URL("./demo/seed-demo.ts", import.meta.url)), {
  root,
  configFile: false,
  logLevel: "warn",
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": fileURLToPath(new URL("../node_modules/server-only/empty.js", import.meta.url)) },
  },
});
await module.run();
