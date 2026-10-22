import { describe, expect, it } from "vitest";
import { maskCccd, maskPhone, normalizeCccd, normalizePhone } from "./personal-data";

describe("dữ liệu cá nhân", () => {
  it("CCCD 12 số hoặc CMND 9 số, bỏ khoảng trắng", () => {
    expect(normalizeCccd("001 099 012 345")).toBe("001099012345");
    expect(normalizeCccd("123456789")).toBe("123456789");
    for (const bad of ["", "12345678", "1234567890", "00109901234a"]) expect(normalizeCccd(bad)).toBeNull();
  });

  it("che CCCD còn 4 số cuối", () => {
    expect(maskCccd("001099012345")).toBe("********2345");
    expect(maskCccd("123456789")).toBe("*****6789");
  });

  it("SĐT: chuẩn hoá và che giữa", () => {
    expect(normalizePhone("0912.345.678")).toBe("0912345678");
    expect(normalizePhone("+84 912 345 678")).toBe("+84912345678");
    expect(normalizePhone("12345")).toBeNull();
    expect(maskPhone("0912345678")).toBe("091****678");
  });
});
