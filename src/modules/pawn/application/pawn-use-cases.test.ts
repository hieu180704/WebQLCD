// Use case hợp đồng với repository giả trong bộ nhớ.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import type { ContractTerms } from "../domain/contract";
import { ChangePrincipal, type ChangePrincipalInput } from "./change-principal";
import { CreateContract, type CreateContractInput } from "./create-contract";
import { DeleteContract } from "./delete-contract";
import { ExtendContract, type ExtendContractInput } from "./extend-contract";
import { CONTRACT_PAGE_SIZE, ListContracts } from "./list-contracts";
import { PayInterest, type PayInterestInput } from "./pay-interest";
import type {
  ContractDraft,
  ContractListRow,
  ContractRepository,
  ContractStanding,
  DeletionDraft,
  ExtensionDraft,
  InterestPaymentDraft,
  LatestOperation,
  PrincipalChangeDraft,
  RedemptionDraft,
  ReversalDraft,
} from "./ports";
import { previewContract } from "./preview";
import { RedeemContract, type RedeemContractInput } from "./redeem-contract";
import { ReverseOperation } from "./reverse-operation";

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

function fakeRepo(
  rows: ContractListRow[] = [],
  reused = false,
  standing: ContractStanding | null = null,
  saves = true,
  latest: LatestOperation | null = null,
) {
  const drafts: ContractDraft[] = [];
  const payments: InterestPaymentDraft[] = [];
  const redemptions: RedemptionDraft[] = [];
  const principalChanges: PrincipalChangeDraft[] = [];
  const extensions: ExtensionDraft[] = [];
  const reversals: ReversalDraft[] = [];
  const deletions: DeletionDraft[] = [];
  const repo: ContractRepository = {
    create: async (_actor, draft) => {
      drafts.push(draft);
      return { code: "CD-1", customer: { id: "c", fullName: "Khách Cũ", reused } };
    },
    list: async (_shop, _after, limit) => rows.slice(0, limit),
    findDetail: async () => null,
    listTransactions: async () => [],
    findStanding: async () => standing,
    recordInterestPayment: async (_actor, draft) => {
      payments.push(draft);
      return saves;
    },
    recordRedemption: async (_actor, draft) => {
      redemptions.push(draft);
      return saves;
    },
    recordPrincipalChange: async (_actor, draft) => {
      principalChanges.push(draft);
      return saves;
    },
    recordExtension: async (_actor, draft) => {
      extensions.push(draft);
      return saves;
    },
    findLatestOperation: async () => latest,
    reverseOperation: async (_actor, draft) => {
      reversals.push(draft);
      return saves;
    },
    deleteContract: async (_actor, draft) => {
      deletions.push(draft);
      return saves;
    },
  };
  return { repo, drafts, payments, redemptions, principalChanges, extensions, reversals, deletions };
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

describe("PayInterest", () => {
  // 5tr, 3k/triệu/ngày, kỳ 10 ngày, thu lãi sau, đã trả đến 01/10: hôm nay 20/10 chọn được 1 hoặc 2 kỳ.
  const standing: ContractStanding = {
    status: "active",
    interestType: "per_million_per_day",
    interestRate: 30_000n,
    interestPeriodDays: 10,
    outstandingPrincipal: Money.fromNumber(5_000_000),
    interestPaidUntil: "2026-10-01",
    prepaidInterest: false,
    termDays: 30,
    code: "CD-7",
  };
  const pay = (overrides: Partial<PayInterestInput> = {}): PayInterestInput => ({
    contractId: "k",
    periods: 2,
    expectedPaidUntil: "2026-10-01",
    amount: null,
    ...overrides,
  });

  it("ghi sổ két hôm nay, kỳ [ngày trả đến, + 2 kỳ), kèm gốc lúc tính để khoá lạc quan", async () => {
    const { repo, payments } = fakeRepo([], false, standing);
    const result = await new PayInterest(repo).execute(actor, pay(), now);
    expect(result).toMatchObject({ ok: true, paidUntil: "2026-10-21" });
    expect(payments[0]).toMatchObject({ contractId: "k", businessDate: "2026-10-20", payment: { from: "2026-10-01", to: "2026-10-21" } });
    expect(payments[0].payment.amount.toBigInt()).toBe(300_000n);
    expect(payments[0].expectedOutstanding.toBigInt()).toBe(5_000_000n);
  });

  it("không thấy, đã đóng, trang cũ: không ghi", async () => {
    expect(await new PayInterest(fakeRepo().repo).execute(actor, pay(), now)).toEqual({ ok: false, error: "not_found" });
    const closed = fakeRepo([], false, { ...standing, status: "closed" });
    expect(await new PayInterest(closed.repo).execute(actor, pay(), now)).toEqual({ ok: false, error: "closed" });
    const stale = fakeRepo([], false, standing);
    expect(await new PayInterest(stale.repo).execute(actor, pay({ expectedPaidUntil: "2026-09-21" }), now)).toEqual({ ok: false, error: "stale" });
    expect([...closed.payments, ...stale.payments]).toHaveLength(0);
  });

  it("repository không khớp điều kiện (vừa có người đóng): báo trang cũ", async () => {
    const { repo } = fakeRepo([], false, standing, false);
    expect(await new PayInterest(repo).execute(actor, pay(), now)).toEqual({ ok: false, error: "stale" });
  });
});

describe("RedeemContract", () => {
  // 5tr, 3k/triệu/ngày, đã trả đến 01/10: hôm nay 20/10 lãi 19 ngày = 285.000 đ.
  const standing: ContractStanding = {
    status: "active",
    interestType: "per_million_per_day",
    interestRate: 30_000n,
    interestPeriodDays: 10,
    outstandingPrincipal: Money.fromNumber(5_000_000),
    interestPaidUntil: "2026-10-01",
    prepaidInterest: false,
    termDays: 30,
    code: "CD-7",
  };
  const redeem = (overrides: Partial<RedeemContractInput> = {}): RedeemContractInput => ({
    contractId: "k",
    expectedPaidUntil: "2026-10-01",
    expectedOutstanding: Money.fromNumber(5_000_000),
    asOf: "2026-10-20",
    interest: null,
    ...overrides,
  });

  it("thu lãi đến hôm nay + gốc còn lại, ghi sổ két hôm nay", async () => {
    const { repo, redemptions } = fakeRepo([], false, standing);
    const result = await new RedeemContract(repo).execute(actor, redeem(), now);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.total.toBigInt()).toBe(5_285_000n);
    expect(redemptions[0]).toMatchObject({ contractId: "k", businessDate: "2026-10-20", expectedPaidUntil: "2026-10-01" });
    expect(redemptions[0].redemption.interest).toEqual({ from: "2026-10-01", to: "2026-10-20", amount: Money.fromNumber(285_000) });
  });

  it("giảm lãi về 0: chỉ thu gốc", async () => {
    const { repo, redemptions } = fakeRepo([], false, standing);
    const result = await new RedeemContract(repo).execute(actor, redeem({ interest: Money.ZERO }), now);
    if (!result.ok) throw new Error(result.error);
    expect(result.total.toBigInt()).toBe(5_000_000n);
    expect(redemptions[0].redemption.interest).toBeNull();
  });

  it("không thấy, đã đóng, trang cũ (ngày trả đến, gốc, sang ngày khác), thu quá lãi: không ghi", async () => {
    expect(await new RedeemContract(fakeRepo().repo).execute(actor, redeem(), now)).toEqual({ ok: false, error: "not_found" });
    const closed = fakeRepo([], false, { ...standing, status: "closed" });
    expect(await new RedeemContract(closed.repo).execute(actor, redeem(), now)).toEqual({ ok: false, error: "closed" });
    const stale = fakeRepo([], false, standing);
    for (const overrides of [
      { expectedPaidUntil: "2026-09-21" },
      { expectedOutstanding: Money.fromNumber(4_000_000) },
      { asOf: "2026-10-19" },
    ]) {
      expect(await new RedeemContract(stale.repo).execute(actor, redeem(overrides), now)).toEqual({ ok: false, error: "stale" });
    }
    expect(await new RedeemContract(stale.repo).execute(actor, redeem({ interest: Money.fromNumber(285_001) }), now)).toEqual({
      ok: false,
      error: "interest_exceeds_due",
    });
    expect([...closed.redemptions, ...stale.redemptions]).toHaveLength(0);
  });

  it("repository không khớp điều kiện (vừa có người thao tác): báo trang cũ", async () => {
    const { repo } = fakeRepo([], false, standing, false);
    expect(await new RedeemContract(repo).execute(actor, redeem(), now)).toEqual({ ok: false, error: "stale" });
  });
});

describe("ChangePrincipal", () => {
  // 5tr, 3k/triệu/ngày, đã trả đến 01/10: hôm nay 20/10 lãi 19 ngày = 285.000 đ.
  const standing: ContractStanding = {
    status: "active",
    interestType: "per_million_per_day",
    interestRate: 30_000n,
    interestPeriodDays: 10,
    outstandingPrincipal: Money.fromNumber(5_000_000),
    interestPaidUntil: "2026-10-01",
    prepaidInterest: false,
    termDays: 30,
    code: "CD-7",
  };
  const change = (overrides: Partial<ChangePrincipalInput> = {}): ChangePrincipalInput => ({
    contractId: "k",
    direction: "repayment",
    expectedPaidUntil: "2026-10-01",
    expectedOutstanding: Money.fromNumber(5_000_000),
    asOf: "2026-10-20",
    amount: Money.fromNumber(2_000_000),
    interest: null,
    ...overrides,
  });

  it("trả bớt gốc: lãi đến hôm nay + gốc mới, ghi sổ két hôm nay, khoá lạc quan theo số liệu DB", async () => {
    const { repo, principalChanges } = fakeRepo([], false, standing);
    const result = await new ChangePrincipal(repo).execute(actor, change(), now);
    expect(result).toEqual({ ok: true, outstandingAfter: Money.fromNumber(3_000_000), interest: Money.fromNumber(285_000) });
    expect(principalChanges[0]).toMatchObject({
      contractId: "k",
      direction: "repayment",
      businessDate: "2026-10-20",
      expectedPaidUntil: "2026-10-01",
    });
    expect(principalChanges[0].change.interest).toEqual({ from: "2026-10-01", to: "2026-10-20", amount: Money.fromNumber(285_000) });
  });

  it("vay thêm: gốc tăng", async () => {
    const { repo, principalChanges } = fakeRepo([], false, standing);
    const result = await new ChangePrincipal(repo).execute(actor, change({ direction: "additional_loan" }), now);
    expect(result).toMatchObject({ ok: true, outstandingAfter: Money.fromNumber(7_000_000) });
    expect(principalChanges[0].direction).toBe("additional_loan");
  });

  it("không thấy, đã đóng, trang cũ, vi phạm quy tắc, repository không khớp: không ghi", async () => {
    expect(await new ChangePrincipal(fakeRepo().repo).execute(actor, change(), now)).toEqual({ ok: false, error: "not_found" });
    const closed = fakeRepo([], false, { ...standing, status: "closed" });
    expect(await new ChangePrincipal(closed.repo).execute(actor, change(), now)).toEqual({ ok: false, error: "closed" });
    const stale = fakeRepo([], false, standing);
    for (const overrides of [
      { expectedPaidUntil: "2026-09-21" },
      { expectedOutstanding: Money.fromNumber(4_000_000) },
      { asOf: "2026-10-19" },
    ]) {
      expect(await new ChangePrincipal(stale.repo).execute(actor, change(overrides), now)).toEqual({ ok: false, error: "stale" });
    }
    expect(await new ChangePrincipal(stale.repo).execute(actor, change({ amount: Money.fromNumber(5_000_000) }), now)).toEqual({
      ok: false,
      error: "amount_not_less_than_outstanding",
    });
    expect([...closed.principalChanges, ...stale.principalChanges]).toHaveLength(0);
    const conflict = fakeRepo([], false, standing, false);
    expect(await new ChangePrincipal(conflict.repo).execute(actor, change(), now)).toEqual({ ok: false, error: "stale" });
  });
});

describe("ExtendContract", () => {
  const standing: ContractStanding = {
    status: "active",
    interestType: "per_million_per_day",
    interestRate: 30_000n,
    interestPeriodDays: 10,
    outstandingPrincipal: Money.fromNumber(5_000_000),
    interestPaidUntil: "2026-10-01",
    prepaidInterest: false,
    termDays: 30,
    code: "CD-7",
  };
  const extend = (overrides: Partial<ExtendContractInput> = {}): ExtendContractInput => ({
    contractId: "k",
    extraDays: 15,
    expectedTermDays: 30,
    expectedPaidUntil: "2026-10-01",
    expectedOutstanding: Money.fromNumber(5_000_000),
    asOf: "2026-10-20",
    interest: null,
    ...overrides,
  });

  it("cộng số ngày vay; có thu lãi thì kèm kỳ [ngày trả đến, hôm nay)", async () => {
    const { repo, extensions } = fakeRepo([], false, standing);
    expect(await new ExtendContract(repo).execute(actor, extend(), now)).toEqual({ ok: true, termDays: 45, interest: null });
    const paid = await new ExtendContract(repo).execute(actor, extend({ interest: Money.fromNumber(100_000) }), now);
    expect(paid).toEqual({ ok: true, termDays: 45, interest: Money.fromNumber(100_000) });
    expect(extensions[1]).toMatchObject({ expectedTermDays: 30, businessDate: "2026-10-20" });
    expect(extensions[1].extension.interest).toEqual({ from: "2026-10-01", to: "2026-10-20", amount: Money.fromNumber(100_000) });
  });

  it("số ngày vay đã đổi, đã đóng, repository không khớp: không ghi", async () => {
    const stale = fakeRepo([], false, standing);
    expect(await new ExtendContract(stale.repo).execute(actor, extend({ expectedTermDays: 20 }), now)).toEqual({ ok: false, error: "stale" });
    expect(stale.extensions).toHaveLength(0);
    const closed = fakeRepo([], false, { ...standing, status: "closed" });
    expect(await new ExtendContract(closed.repo).execute(actor, extend(), now)).toEqual({ ok: false, error: "closed" });
    const conflict = fakeRepo([], false, standing, false);
    expect(await new ExtendContract(conflict.repo).execute(actor, extend(), now)).toEqual({ ok: false, error: "stale" });
  });
});

describe("ReverseOperation", () => {
  const latest = (overrides: Partial<LatestOperation> = {}): LatestOperation => ({
    id: "op-2",
    kind: "pay_interest",
    extraDays: null,
    createdAt: now,
    createdByName: "Chủ",
    cashNet: Money.fromNumber(150_000),
    ...overrides,
  });
  const input = { contractId: "k", operationId: "op-2", reason: "Nhập nhầm" };

  it("huỷ thao tác mới nhất, bút toán đảo ghi hôm nay", async () => {
    const { repo, reversals } = fakeRepo([], false, null, true, latest());
    expect(await new ReverseOperation(repo).execute(actor, input, now)).toEqual({ ok: true });
    expect(reversals).toEqual([{ contractId: "k", operationId: "op-2", reason: "Nhập nhầm", businessDate: "2026-10-20" }]);
  });

  it("không có thao tác, đã có thao tác mới hơn, giải ngân, repository không khớp: không ghi", async () => {
    expect(await new ReverseOperation(fakeRepo().repo).execute(actor, input, now)).toEqual({ ok: false, error: "not_found" });
    const newer = fakeRepo([], false, null, true, latest({ id: "op-3" }));
    expect(await new ReverseOperation(newer.repo).execute(actor, input, now)).toEqual({ ok: false, error: "stale" });
    const disbursement = fakeRepo([], false, null, true, latest({ kind: "disbursement" }));
    expect(await new ReverseOperation(disbursement.repo).execute(actor, input, now)).toEqual({ ok: false, error: "not_reversible" });
    expect([...newer.reversals, ...disbursement.reversals]).toHaveLength(0);
    const conflict = fakeRepo([], false, null, false, latest());
    expect(await new ReverseOperation(conflict.repo).execute(actor, input, now)).toEqual({ ok: false, error: "stale" });
  });
});

describe("DeleteContract", () => {
  const standing: ContractStanding = {
    status: "closed",
    interestType: "per_million_per_day",
    interestRate: 30_000n,
    interestPeriodDays: 10,
    outstandingPrincipal: Money.ZERO,
    interestPaidUntil: "2026-10-01",
    prepaidInterest: false,
    termDays: 30,
    code: "CD-7",
  };

  it("gõ đúng mã (không phân biệt hoa thường, bỏ khoảng trắng): xoá, đảo giao dịch hôm nay", async () => {
    const { repo, deletions } = fakeRepo([], false, standing);
    const result = await new DeleteContract(repo).execute(actor, { contractId: "k", confirmCode: " cd-7 ", reason: "Trùng hồ sơ" }, now);
    expect(result).toEqual({ ok: true, code: "CD-7" });
    expect(deletions).toEqual([{ contractId: "k", reason: "Trùng hồ sơ", businessDate: "2026-10-20" }]);
  });

  it("sai mã, không thấy: không xoá", async () => {
    const { repo, deletions } = fakeRepo([], false, standing);
    expect(await new DeleteContract(repo).execute(actor, { contractId: "k", confirmCode: "CD-70", reason: "x" }, now)).toEqual({
      ok: false,
      error: "code_mismatch",
    });
    expect(deletions).toHaveLength(0);
    expect(await new DeleteContract(fakeRepo().repo).execute(actor, { contractId: "k", confirmCode: "CD-7", reason: "x" }, now)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
