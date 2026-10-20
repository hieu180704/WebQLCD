// Unit test tính lãi (bắt buộc, architecture-spec mục 2.5).
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { interestPolicy } from "./interest-policy";
import { annualPercent, formatRate, parseRate, rateWarning } from "./rate";

const vnd = (n: number) => Money.fromNumber(n);
const rate = (text: string) => {
  const value = parseRate(text);
  if (value === null) throw new Error(`rate sai: ${text}`);
  return value;
};
const interest = (type: Parameters<typeof interestPolicy>[0], principal: number, r: string, days: number) =>
  interestPolicy(type).interestFor(vnd(principal), rate(r), days).toBigInt();

describe("strategy lãi", () => {
  it("k/triệu/ngày: 5 triệu, 3k/triệu/ngày, 10 ngày = 150.000", () => {
    expect(interest("per_million_per_day", 5_000_000, "3", 10)).toBe(150_000n);
    expect(interest("per_million_per_day", 1_500_000, "2,5", 7)).toBe(26_250n);
  });

  it("%/tháng: 10 triệu, 3%/tháng, 30 ngày = 300.000; 10 ngày làm tròn về đồng", () => {
    expect(interest("percent_per_month", 10_000_000, "3", 30)).toBe(300_000n);
    expect(interest("percent_per_month", 10_000_000, "3", 10)).toBe(100_000n);
    expect(interest("percent_per_month", 1_000_000, "1", 1)).toBe(333n); // 333,33
    expect(interest("percent_per_month", 1_000_000, "1", 2)).toBe(667n); // 666,67
  });

  it("%/tuần: 7 triệu, 1%/tuần, 7 ngày = 70.000", () => {
    expect(interest("percent_per_week", 7_000_000, "1", 7)).toBe(70_000n);
    expect(interest("percent_per_week", 1_000_000, "1", 3)).toBe(4_286n); // 4.285,71
  });

  it("làm tròn một lần cho cả khoảng, không cộng dồn từng ngày đã làm tròn", () => {
    expect(interest("percent_per_month", 1_000_000, "1", 3)).toBe(1_000n);
    expect(3n * interest("percent_per_month", 1_000_000, "1", 1)).toBe(999n);
  });

  it("0 ngày hoặc lãi suất 0 thì lãi 0; ngày âm là lỗi lập trình", () => {
    expect(interest("percent_per_month", 1_000_000, "3", 0)).toBe(0n);
    expect(interest("per_million_per_day", 1_000_000, "0", 30)).toBe(0n);
    expect(() => interestPolicy("percent_per_week").interestFor(vnd(1), 1n, -1)).toThrow(RangeError);
  });

  it("gốc rất lớn không mất chính xác (bigint)", () => {
    const principal = Money.of(90_000_000_000_000n);
    expect(interestPolicy("per_million_per_day").interestFor(principal, rate("3"), 365).toBigInt()).toBe(98_550_000_000_000n);
  });
});

describe("lãi suất", () => {
  it("parse/format theo numeric(9,4), nhận dấu phẩy thập phân", () => {
    expect(parseRate("3")).toBe(30_000n);
    expect(parseRate(" 1,5 ")).toBe(15_000n);
    expect(parseRate("0.0833")).toBe(833n);
    expect(parseRate("99999.9999")).toBe(999_999_999n);
    for (const bad of ["", "-1", "1.23456", "100000", "1e3", "abc", "1,"]) expect(parseRate(bad)).toBeNull();
    expect(formatRate(30_000n)).toBe("3");
    expect(formatRate(15_000n)).toBe("1.5");
    expect(formatRate(833n)).toBe("0.0833");
  });

  it("quy đổi %/năm theo core-spec mục 2", () => {
    expect(annualPercent("per_million_per_day", rate("1"))).toBe(36.5);
    expect(annualPercent("percent_per_month", rate("3"))).toBe(36.5);
    expect(annualPercent("percent_per_week", rate("1"))).toBe(52.14);
  });

  it("cảnh báo: > 20%/năm vàng, ≥ 100%/năm đỏ", () => {
    // %/tháng: 20%/năm ↔ 1,6438...%/tháng; 100%/năm ↔ 8,2191...%/tháng.
    expect(rateWarning("percent_per_month", rate("1.6438"))).toBe("none");
    expect(rateWarning("percent_per_month", rate("1.6439"))).toBe("above_civil_cap");
    expect(rateWarning("percent_per_month", rate("8.2191"))).toBe("above_civil_cap");
    expect(rateWarning("percent_per_month", rate("8.2192"))).toBe("criminal_risk");
    // k/triệu/ngày: ×36,5 → 20%/năm khi lãi = 0,5479...; đúng 100%/năm không tròn số, kiểm ngưỡng ≥ bằng tuần.
    expect(rateWarning("per_million_per_day", rate("0.5479"))).toBe("none");
    expect(rateWarning("per_million_per_day", rate("3"))).toBe("criminal_risk");
    // %/tuần: ×365/7, 100%/năm ↔ đúng 1,9178...; 20%/năm ↔ 0,3835...
    expect(rateWarning("percent_per_week", rate("0.3835"))).toBe("none");
    expect(rateWarning("percent_per_week", rate("0.3836"))).toBe("above_civil_cap");
    expect(rateWarning("percent_per_month", rate("0"))).toBe("none");
  });
});
