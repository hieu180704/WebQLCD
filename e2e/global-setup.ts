import { execSync } from "node:child_process";
import { clearLoginThrottles } from "./db";

export default async function globalSetup() {
  execSync("npm run db:seed", { stdio: "inherit" });
  await clearLoginThrottles();
}
