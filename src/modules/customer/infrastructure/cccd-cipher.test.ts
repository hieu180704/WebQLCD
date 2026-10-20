import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CccdCipher } from "./cccd-cipher";

const cipher = new CccdCipher(randomBytes(32), randomBytes(32));
const CCCD = "001099012345";

describe("CccdCipher", () => {
  it("mã hoá rồi giải mã ra đúng CCCD; mỗi lần mã hoá khác nhau (IV ngẫu nhiên)", () => {
    const a = cipher.encrypt("shop-a", CCCD);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain(CCCD);
    expect(cipher.encrypt("shop-a", CCCD)).not.toBe(a);
    expect(cipher.decrypt("shop-a", a)).toBe(CCCD);
  });

  it("bản mã của cửa hàng này không giải mã được dưới cửa hàng khác (AAD)", () => {
    expect(() => cipher.decrypt("shop-b", cipher.encrypt("shop-a", CCCD))).toThrow();
  });

  it("bản mã bị sửa thì giải mã báo lỗi", () => {
    const payload = cipher.encrypt("shop-a", CCCD);
    const raw = Buffer.from(payload.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => cipher.decrypt("shop-a", `v1:${raw.toString("base64")}`)).toThrow();
  });

  it("hash ổn định trong một cửa hàng, khác giữa hai cửa hàng", () => {
    expect(cipher.hash("shop-a", CCCD)).toBe(cipher.hash("shop-a", CCCD));
    expect(cipher.hash("shop-a", CCCD)).not.toBe(cipher.hash("shop-b", CCCD));
  });

  it("từ chối khoá sai độ dài, hai khoá trùng nhau, thiếu biến môi trường", () => {
    const key = randomBytes(32);
    expect(() => new CccdCipher(randomBytes(16), key)).toThrow();
    expect(() => new CccdCipher(key, Buffer.from(key))).toThrow();
    expect(() => CccdCipher.fromEnv({})).toThrow("CCCD_ENCRYPTION_KEY");
  });
});
