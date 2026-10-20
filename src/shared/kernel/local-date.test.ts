import { describe, expect, it } from "vitest";
import { addDays, businessDate, diffDays, isLocalDate } from "./local-date";

describe("LocalDate", () => {
  it("ngày nghiệp vụ theo giờ Việt Nam (UTC+7)", () => {
    expect(businessDate(new Date("2026-10-20T16:59:59Z"))).toBe("2026-10-20");
    expect(businessDate(new Date("2026-10-20T17:00:00Z"))).toBe("2026-10-21");
  });

  it("cộng ngày qua tháng, năm nhuận", () => {
    expect(addDays("2026-10-20", 30)).toBe("2026-11-19");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-20", -20)).toBe("2026-09-30");
  });

  it("khoảng cách ngày", () => {
    expect(diffDays("2026-10-20", "2026-11-19")).toBe(30);
    expect(diffDays("2026-10-20", "2026-10-20")).toBe(0);
    expect(diffDays("2026-10-20", "2026-10-19")).toBe(-1);
  });

  it("kiểm định dạng và ngày có thật", () => {
    expect(isLocalDate("2026-10-20")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("20-10-2026")).toBe(false);
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-02-32")).toBe(false);
    expect(() => addDays("2026-13-01", 1)).toThrow(RangeError);
  });
});
