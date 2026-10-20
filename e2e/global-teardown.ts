import { clearLoginThrottles } from "./db";

// Không để tài khoản dev bị khoá sau khi chạy e2e.
export default async function globalTeardown() {
  await clearLoginThrottles();
}
