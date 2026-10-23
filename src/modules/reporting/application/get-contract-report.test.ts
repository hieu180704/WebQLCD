// Use case phần hợp đồng của báo cáo với nguồn số liệu giả.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { GetContractReport, type ContractReportSource } from "./get-contract-report";

const EMPTY = {
  securedLending: Money.ZERO,
  unsecuredLending: Money.ZERO,
  accruedInterest: Money.ZERO,
  overdue: 0,
  opened: 0,
  closed: 0,
  deleted: 0,
};

function fakeSource() {
  const calls: Parameters<ContractReportSource["load"]>[] = [];
  const source: ContractReportSource = {
    load: async (...args) => {
      calls.push(args);
      return EMPTY;
    },
  };
  return { source, calls };
}

describe("GetContractReport", () => {
  it("hôm nay theo giờ Việt Nam, kỳ như phần thu chi (mặc định tháng này, đến ngày tương lai quy về hôm nay)", async () => {
    const { source, calls } = fakeSource();
    const report = new GetContractReport(source);
    // 2026-10-31 23:30 UTC = 2026-11-01 06:30 giờ Việt Nam.
    const now = new Date("2026-10-31T23:30:00Z");
    await report.execute("s", { from: null, to: null }, now);
    await report.execute("s", { from: "2026-10-15", to: "2027-01-01" }, now);
    expect(calls).toEqual([
      ["s", "2026-11-01", { from: "2026-11-01", to: "2026-11-01" }],
      ["s", "2026-11-01", { from: "2026-10-15", to: "2026-11-01" }],
    ]);
  });

  it("từ ngày sau đến ngày: null, không truy vấn", async () => {
    const { source, calls } = fakeSource();
    expect(await new GetContractReport(source).execute("s", { from: "2026-10-20", to: "2026-10-10" })).toBeNull();
    expect(calls).toEqual([]);
  });
});
