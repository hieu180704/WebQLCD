// Use case trang chủ với nguồn số liệu giả.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { GetDashboardStats, monthOf, type DashboardStatsSource } from "./get-dashboard-stats";

describe("monthOf", () => {
  it("khoảng nửa mở của tháng, sang năm mới với tháng 12", () => {
    expect(monthOf("2026-10-22")).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(monthOf("2026-12-31")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(monthOf("2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-02-01" });
  });
});

describe("GetDashboardStats", () => {
  it("hôm nay và tháng theo giờ Việt Nam", async () => {
    const calls: Parameters<DashboardStatsSource["load"]>[] = [];
    const source: DashboardStatsSource = {
      load: async (...args) => {
        calls.push(args);
        return { lending: Money.ZERO, openSecured: 0, openUnsecured: 0, interestThisMonth: Money.ZERO, accruedInterest: Money.ZERO, overdue: 0 };
      },
    };
    // 2026-10-31 23:30 UTC = 2026-11-01 06:30 giờ Việt Nam.
    await new GetDashboardStats(source).execute("s", new Date("2026-10-31T23:30:00Z"));
    expect(calls).toEqual([["s", "2026-11-01", { from: "2026-11-01", to: "2026-12-01" }]]);
  });
});
