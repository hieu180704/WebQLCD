import "server-only";
import { hash, verify } from "@node-rs/argon2";

// argon2id (thuật toán mặc định của @node-rs/argon2), tham số theo khuyến nghị OWASP: m=19 MiB, t=2, p=1.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password);
}
