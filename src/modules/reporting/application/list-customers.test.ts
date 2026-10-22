// Use case danh sách khách với nguồn số liệu giả.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { CUSTOMER_PAGE_SIZE, ListCustomers, type CustomerDirectory, type CustomerListRow } from "./list-customers";

const row = (i: number): CustomerListRow => ({
  id: `id-${i}`,
  fullName: "Khách",
  phone: null,
  address: null,
  cccdMasked: null,
  openContracts: 0,
  overdueContracts: 0,
  debt: Money.ZERO,
  lastActivity: null,
});

describe("ListCustomers", () => {
  it("lấy thừa 1 dòng để biết còn trang sau; hôm nay theo giờ Việt Nam", async () => {
    const calls: unknown[][] = [];
    const directory: CustomerDirectory = {
      list: async (...args) => {
        calls.push(args);
        return Array.from({ length: CUSTOMER_PAGE_SIZE + 1 }, (_, i) => row(i));
      },
      totals: async () => ({ customers: 60, withOpenContracts: 3 }),
    };
    const query = { search: "binh", cccd: null, filter: "open" as const };
    // 2026-10-31 23:30 UTC = 2026-11-01 06:30 giờ Việt Nam.
    const view = await new ListCustomers(directory).execute("s", query, null, new Date("2026-10-31T23:30:00Z"));
    expect(calls).toEqual([["s", query, "2026-11-01", null, CUSTOMER_PAGE_SIZE + 1]]);
    expect(view.items).toHaveLength(CUSTOMER_PAGE_SIZE);
    expect(view.nextAfter).toBe(`id-${CUSTOMER_PAGE_SIZE - 1}`);
    expect(view.totals).toEqual({ customers: 60, withOpenContracts: 3 });
  });
});
