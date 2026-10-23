// Use case chi tiết khách với nguồn số liệu giả.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import {
  CUSTOMER_RECENT_TRANSACTIONS,
  GetCustomerDetail,
  type CustomerProfileSource,
  type CustomerSummary,
} from "./get-customer-detail";

const customer: CustomerSummary = {
  id: "c",
  fullName: "Khách",
  phone: null,
  address: null,
  cccdMasked: null,
  // 2026-02-28 17:30 UTC = 2026-03-01 00:30 giờ Việt Nam.
  createdAt: new Date("2026-02-28T17:30:00Z"),
  openContracts: 0,
  overdueContracts: 0,
  debt: Money.ZERO,
  interestPaid: Money.ZERO,
};

const source = (
  found: CustomerSummary | null,
  calls: unknown[][] = [],
): CustomerProfileSource => ({
  findCustomer: async (...args) => {
    calls.push(["findCustomer", ...args]);
    return found;
  },
  listContracts: async (...args) => {
    calls.push(["listContracts", ...args]);
    return [];
  },
  recentTransactions: async (...args) => {
    calls.push(["recentTransactions", ...args]);
    return [];
  },
});

describe("GetCustomerDetail", () => {
  it("hôm nay và tháng tạo khách theo giờ Việt Nam; lấy 20 giao dịch gần nhất", async () => {
    const calls: unknown[][] = [];
    // 2026-10-31 23:30 UTC = 2026-11-01 06:30 giờ Việt Nam.
    const view = await new GetCustomerDetail(source(customer, calls)).execute(
      "s",
      "c",
      new Date("2026-10-31T23:30:00Z"),
    );
    expect(calls).toEqual([
      ["findCustomer", "s", "c", "2026-11-01"],
      ["listContracts", "s", "c", "2026-11-01"],
      ["recentTransactions", "s", "c", CUSTOMER_RECENT_TRANSACTIONS],
    ]);
    expect(view).toMatchObject({
      today: "2026-11-01",
      since: "2026-03-01",
      contracts: [],
      transactions: [],
    });
  });

  it("khách không thuộc cửa hàng → null", async () => {
    expect(
      await new GetCustomerDetail(source(null)).execute("s", "c"),
    ).toBeNull();
  });
});
