// Use case hợp đồng với repository giả trong bộ nhớ.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import type { ContractTerms } from "../domain/contract";
import { CreateContract, type CreateContractInput } from "./create-contract";
import { CONTRACT_PAGE_SIZE, ListContracts } from "./list-contracts";
import type { ContractDraft, ContractListRow, ContractRepository } from "./ports";
import { previewContract } from "./preview";

// 2026-10-20 23:30 giờ Việt Nam (UTC đã sang 16:30 cùng ngày).
const now = new Date("2026-10-20T16:30:00Z");
const actor = { userId: "u", shopId: "s" };

const terms = (overrides: Partial<ContractTerms> = {}): ContractTerms => ({
  kind: "secured",
  assetName: "Xe",
  principal: Money.fromNumber(5_000_000),
  interestType: "per_million_per_day",
  interestRate: 30_000n,
  interestPeriodDays: 10,
  termDays: 30,
  loanDate: "2026-10-15",
  prepaidInterest: true,
  ...overrides,
});
const input = (overrides: Partial<ContractTerms> = {}): CreateContractInput => ({
  terms: terms(overrides),
  customer: { fullName: "Khách", cccd: null, phone: null, address: null },
  note: null,
});

function fakeRepo(rows: ContractListRow[] = [], reused = false) {
  const drafts: ContractDraft[] = [];
  const repo: ContractRepository = {
    create: async (_actor, draft) => {
      drafts.push(draft);
      return { code: "CD-1", customer: { id: "c", fullName: "Khách Cũ", reused } };
    },
    list: async (_shop, _after, limit) => rows.slice(0, limit),
  };
  return { repo, drafts };
}

describe("CreateContract", () => {
  it("ngày vay lùi: sổ két ghi hôm nay, lãi trước tính từ ngày vay", async () => {
    const { repo, drafts } = fakeRepo();
    expect(await new CreateContract(repo).execute(actor, input(), now)).toEqual({ ok: true, code: "CD-1", reusedCustomerName: null });
    expect(drafts[0].businessDate).toBe("2026-10-20");
    expect(drafts[0].disbursement.prepaid).toMatchObject({ from: "2026-10-15", to: "2026-10-25" });
    expect(drafts[0].disbursement.cashToCustomer.toBigInt()).toBe(4_850_000n);
  });

  it("vi phạm quy tắc thì không ghi gì", async () => {
    const { repo, drafts } = fakeRepo();
    expect(await new CreateContract(repo).execute(actor, input({ loanDate: "2026-10-21" }), now)).toEqual({
      ok: false,
      error: "loan_date_in_future",
    });
    expect(drafts).toHaveLength(0);
  });

  it("báo tên khách cũ khi dùng lại theo CCCD", async () => {
    const result = await new CreateContract(fakeRepo([], true).repo).execute(actor, input(), now);
    expect(result).toEqual({ ok: true, code: "CD-1", reusedCustomerName: "Khách Cũ" });
  });
});

describe("ListContracts", () => {
  const row = (i: number, overrides: Partial<ContractListRow> = {}): ContractListRow => ({
    id: `id-${i}`,
    code: `CD-${i}`,
    customerName: "Khách",
    customerPhone: null,
    kind: "secured",
    assetName: "Xe",
    principal: Money.fromNumber(10_000_000),
    outstandingPrincipal: Money.fromNumber(10_000_000),
    loanDate: "2026-10-10",
    interestType: "percent_per_month",
    interestRate: 30_000n,
    interestPeriodDays: 30,
    interestPaidUntil: "2026-10-10",
    prepaidInterest: false,
    status: "active",
    ...overrides,
  });

  it("lãi đến hôm nay, hạn đóng lãi; hợp đồng đã đóng thì không tính", async () => {
    const view = await new ListContracts(fakeRepo([row(2), row(1, { status: "closed" })]).repo).execute("s", null, now);
    expect(view.items[0]).toMatchObject({ rateText: "3", nextInterestDue: "2026-11-09" });
    expect(view.items[0].accruedInterest?.toBigInt()).toBe(100_000n);
    expect(view.items[1]).toMatchObject({ accruedInterest: null, nextInterestDue: null });
    expect(view.nextAfter).toBeNull();
  });

  it("lấy thừa 1 dòng để biết còn trang sau", async () => {
    const rows = Array.from({ length: CONTRACT_PAGE_SIZE + 1 }, (_, i) => row(i));
    const view = await new ListContracts(fakeRepo(rows).repo).execute("s", null, now);
    expect(view.items).toHaveLength(CONTRACT_PAGE_SIZE);
    expect(view.nextAfter).toBe(`id-${CONTRACT_PAGE_SIZE - 1}`);
  });
});

describe("previewContract", () => {
  it("lãi mỗi kỳ, tiền giao khách, cảnh báo", () => {
    const p = previewContract({ principal: Money.fromNumber(5_000_000), interestType: "per_million_per_day", rate: 30_000n, periodDays: 10, prepaidInterest: true });
    expect(p.periodInterest.toBigInt()).toBe(150_000n);
    expect(p.cashToCustomer.toBigInt()).toBe(4_850_000n);
    expect(p).toMatchObject({ annualPercent: 109.5, warning: "criminal_risk" });
  });
});
