import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("mật khẩu", () => {
  it("băm argon2id, salt ngẫu nhiên, verify đúng/sai", async () => {
    const hash = await hashPassword("matkhau123");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await hashPassword("matkhau123")).not.toBe(hash);
    expect(await verifyPassword(hash, "matkhau123")).toBe(true);
    expect(await verifyPassword(hash, "matkhau124")).toBe(false);
  });
});
