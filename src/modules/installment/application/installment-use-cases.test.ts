import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { CloseInstallment } from "./close-installment";
import { CreateInstallment, type CreateInstallmentInput } from "./create-installment";
import { DeleteInstallment } from "./delete-installment";
import { PayInstallment } from "./pay-installment";
import type { InstallmentDraft, InstallmentRecord, InstallmentRepository, LatestOperation, PaymentDraft } from "./ports";
import { ReverseInstallmentOperation } from "./reverse-installment-operation";

const ACTOR = { userId: "u1", shopId: "s1" };
// 10:00 ngày 20/10/2026 giờ Việt Nam.
const NOW = new Date("2026-10-20T03:00:00Z");
const vnd = (n: number) => Money.fromNumber(n);

const unused = () => Promise.reject(new Error("không dùng"));

/** Repository giả: ghi lại draft nhận được; các hàm không cấu hình thì ném lỗi. */
function fakeRepo(overrides: Partial<InstallmentRepository> = {}) {
  const created: InstallmentDraft[] = [];
  const payments: PaymentDraft[] = [];
  const repo: InstallmentRepository = {
    async create(_actor, draft) {
      created.push(draft);
      return { code: "TG-1", customer: { id: "c1", reused: false, fullName: draft.customer.fullName } };
    },
    list: unused,
    findDetail: unused,
    listTransactions: unused,
    listPayments: unused,
    findRecord: unused,
    findLatestOperation: unused,
    reverseOperation: unused,
    deleteContract: unused,
    async recordPayment(_actor, draft) {
      payments.push(draft);
      return true;
    },
    ...overrides,
  };
  return { repo, created, payments };
}

const input = (startDate = "2026-10-20"): CreateInstallmentInput => ({
  terms: { amountGiven: vnd(4_000_000), totalDue: vnd(5_000_000), totalDays: 50, periodDays: 2, startDate },
  customer: { fullName: "Đỗ Minh Tâm", cccd: null, phone: null, address: null },
  note: null,
});

const record = (paid: number, status: "active" | "closed" = "active"): InstallmentRecord => ({
  code: "TG-1",
  status,
  totalDue: vnd(5_000_000),
  totalDays: 50,
  periodDays: 2,
  startDate: "2026-10-01",
  amountPaid: vnd(paid),
});

describe("CreateInstallment", () => {
  it("ghi sổ két vào hôm nay kể cả khi ngày bắt đầu lùi về trước", async () => {
    const { repo, created } = fakeRepo();
    const result = await new CreateInstallment(repo).execute(ACTOR, input("2026-10-01"), NOW);
    expect(result).toEqual({ ok: true, code: "TG-1", reusedCustomerName: null });
    expect(created[0].businessDate).toBe("2026-10-20");
  });

  it("vi phạm quy tắc thì không ghi", async () => {
    const { repo, created } = fakeRepo();
    const result = await new CreateInstallment(repo).execute(ACTOR, input("2026-10-21"), NOW);
    expect(result).toEqual({ ok: false, error: "start_date_in_future" });
    expect(created).toHaveLength(0);
  });
});

describe("PayInstallment", () => {
  const pay = (repo: InstallmentRepository, expected: number, amount: number) =>
    new PayInstallment(repo).execute(ACTOR, { contractId: "i1", expectedPaid: vnd(expected), amount: vnd(amount) }, NOW);

  it("ghi thu, khoá lạc quan theo số đã thu; thu đủ thì đóng", async () => {
    const { repo, payments } = fakeRepo({ findRecord: async () => record(4_800_000) });
    const result = await pay(repo, 4_800_000, 200_000);
    expect(result).toMatchObject({ ok: true, closed: true });
    expect(payments[0]).toMatchObject({ kind: "pay", businessDate: "2026-10-20" });
    expect(payments[0].expectedPaid.toBigInt()).toBe(4_800_000n);
  });

  it("trang cũ, hợp đồng đã đóng, không thấy, thu quá", async () => {
    expect(await pay(fakeRepo({ findRecord: async () => record(400_000) }).repo, 200_000, 200_000)).toEqual({ ok: false, error: "stale" });
    expect(await pay(fakeRepo({ findRecord: async () => record(0, "closed") }).repo, 0, 1)).toEqual({ ok: false, error: "closed" });
    expect(await pay(fakeRepo({ findRecord: async () => null }).repo, 0, 1)).toEqual({ ok: false, error: "not_found" });
    expect(await pay(fakeRepo({ findRecord: async () => record(0) }).repo, 0, 5_000_001)).toEqual({
      ok: false,
      error: "amount_exceeds_remaining",
    });
    // DB đã đổi giữa lúc đọc và lúc ghi.
    const raced = fakeRepo({ findRecord: async () => record(0), recordPayment: async () => false });
    expect(await pay(raced.repo, 0, 1)).toEqual({ ok: false, error: "stale" });
  });
});

describe("CloseInstallment", () => {
  const close = (repo: InstallmentRepository, expected: number, amount: number) =>
    new CloseInstallment(repo).execute(ACTOR, { contractId: "i1", expectedPaid: vnd(expected), amount: vnd(amount) }, NOW);

  it("tất toán được giảm, ghi thao tác close và đóng hợp đồng", async () => {
    const { repo, payments } = fakeRepo({ findRecord: async () => record(1_600_000) });
    const result = await close(repo, 1_600_000, 3_000_000);
    expect(result.ok && [result.amount.toBigInt(), result.discount.toBigInt()]).toEqual([3_000_000n, 400_000n]);
    expect(payments[0]).toMatchObject({ kind: "close", payment: { closes: true } });
  });

  it("thu quá còn phải thu, trang cũ, đã đóng", async () => {
    expect(await close(fakeRepo({ findRecord: async () => record(1_600_000) }).repo, 1_600_000, 3_400_001)).toEqual({
      ok: false,
      error: "amount_exceeds_remaining",
    });
    expect(await close(fakeRepo({ findRecord: async () => record(1_800_000) }).repo, 1_600_000, 0)).toEqual({ ok: false, error: "stale" });
    expect(await close(fakeRepo({ findRecord: async () => record(0, "closed") }).repo, 0, 0)).toEqual({ ok: false, error: "closed" });
  });
});

describe("ReverseInstallmentOperation", () => {
  const op = (kind: LatestOperation["kind"], id = "op2"): LatestOperation => ({
    id,
    kind,
    createdAt: NOW,
    createdByName: "Chủ",
    cashNet: vnd(200_000),
  });
  const reverse = (repo: InstallmentRepository, operationId = "op2") =>
    new ReverseInstallmentOperation(repo).execute(ACTOR, { contractId: "i1", operationId, reason: "nhầm" }, NOW);

  it("chỉ huỷ thao tác mới nhất, không huỷ giải ngân", async () => {
    let reversed = 0;
    const ok = fakeRepo({ findLatestOperation: async () => op("pay"), reverseOperation: async () => (reversed++, true) });
    expect(await reverse(ok.repo)).toEqual({ ok: true });
    expect(reversed).toBe(1);
    expect(await reverse(fakeRepo({ findLatestOperation: async () => op("pay", "op3") }).repo)).toEqual({ ok: false, error: "stale" });
    expect(await reverse(fakeRepo({ findLatestOperation: async () => op("disbursement") }).repo)).toEqual({
      ok: false,
      error: "not_reversible",
    });
    expect(await reverse(fakeRepo({ findLatestOperation: async () => null }).repo)).toEqual({ ok: false, error: "not_found" });
  });
});

describe("DeleteInstallment", () => {
  it("gõ lại mã không phân biệt hoa thường; sai mã thì không xoá", async () => {
    let deleted = 0;
    const { repo } = fakeRepo({ findRecord: async () => record(0), deleteContract: async () => (deleted++, true) });
    const remove = (confirmCode: string) =>
      new DeleteInstallment(repo).execute(ACTOR, { contractId: "i1", confirmCode, reason: "nhầm" }, NOW);
    expect(await remove("TG-2")).toEqual({ ok: false, error: "code_mismatch" });
    expect(deleted).toBe(0);
    expect(await remove(" tg-1 ")).toEqual({ ok: true, code: "TG-1" });
    expect(deleted).toBe(1);
  });
});
