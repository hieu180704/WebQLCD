import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { CloseInstallment } from "./close-installment";
import { CreateInstallment, type CreateInstallmentInput } from "./create-installment";
import { DeleteInstallment } from "./delete-installment";
import { monthRange } from "./get-installment-stats";
import { DUE_LIST_LIMIT, ListDueInstallments } from "./list-due-installments";
import { EXPORT_BATCH_SIZE, ListInstallments } from "./list-installments";
import { PayInstallment } from "./pay-installment";
import type {
  InstallmentDraft,
  InstallmentFilter,
  InstallmentListRow,
  InstallmentRecord,
  InstallmentRepository,
  LatestOperation,
  PaymentDraft,
} from "./ports";
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
      // Khách chọn sẵn từ trang khách luôn là khách có sẵn (reused).
      const customer = "existingId" in draft.customer
        ? { id: draft.customer.existingId, reused: true, fullName: "Khách cũ" }
        : { id: "c1", reused: false, fullName: draft.customer.fullName };
      return { code: "TG-1", customer };
    },
    findCustomerSummary: unused,
    list: unused,
    stats: unused,
    listDue: unused,
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

  it("khách chọn sẵn từ trang khách: không báo khách cũ; khách không thuộc cửa hàng thì báo lỗi", async () => {
    const { repo } = fakeRepo();
    const existing = { ...input(), customer: { existingId: "c9" } };
    expect(await new CreateInstallment(repo).execute(ACTOR, existing, NOW)).toEqual({ ok: true, code: "TG-1", reusedCustomerName: null });
    const missing = fakeRepo({ create: async () => "customer_not_found" as const }).repo;
    expect(await new CreateInstallment(missing).execute(ACTOR, existing, NOW)).toEqual({ ok: false, error: "customer_not_found" });
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

describe("ListInstallments.batches", () => {
  const row = (i: number): InstallmentListRow => ({
    id: `id-${i}`,
    code: `TG-${i}`,
    customerId: "c1",
    customerName: "Khách",
    customerPhone: null,
    customerCccdMasked: null,
    amountGiven: vnd(4_000_000),
    totalDue: vnd(5_000_000),
    amountPaid: vnd(0),
    totalDays: 50,
    periodDays: 10,
    startDate: "2026-10-20",
    status: "active",
    deleted: false,
  });
  const ALL: InstallmentFilter = { search: null, cccd: null, status: null };

  it("đi hết keyset, lô cuối ngắn hơn thì dừng, mỗi dòng tính tiến độ như danh sách", async () => {
    const rows = Array.from({ length: EXPORT_BATCH_SIZE + 3 }, (_, i) => row(i));
    const afters: (string | null)[] = [];
    const { repo } = fakeRepo({
      list: async (_shop, _filter, _today, after, limit) => {
        afters.push(after);
        const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
        return rows.slice(start, start + limit);
      },
    });
    const sizes: number[] = [];
    for await (const batch of new ListInstallments(repo).batches("s1", ALL, NOW)) {
      sizes.push(batch.length);
      expect(batch[0]).toMatchObject({ progress: { periods: 5, paidPeriods: 0 }, dueStatus: { kind: "on_time" } });
      expect(batch[0].perPeriod.toBigInt()).toBe(1_000_000n);
    }
    expect(sizes).toEqual([EXPORT_BATCH_SIZE, 3]);
    expect(afters).toEqual([null, `id-${EXPORT_BATCH_SIZE - 1}`]);
  });
});

describe("monthRange", () => {
  it("đầu tháng và đầu tháng sau, qua năm mới", () => {
    expect(monthRange("2026-10-23")).toEqual(["2026-10-01", "2026-11-01"]);
    expect(monthRange("2026-12-31")).toEqual(["2026-12-01", "2027-01-01"]);
  });
});

describe("ListDueInstallments", () => {
  it("lọc tới hôm nay + 3 ngày, tiền kỳ tới là phần còn thiếu của kỳ đó", async () => {
    const calls: unknown[] = [];
    const { repo } = fakeRepo({
      listDue: async (...args) => {
        calls.push(args);
        // 5.000.000 / 25 kỳ 2 ngày = 200.000 mỗi kỳ; đã thu 1.650.000 → đủ 8 kỳ, kỳ 9 hạn 19/10 còn thiếu 150.000.
        return [{ ...record(1_650_000), id: "i1", customerName: "Tâm" }];
      },
    });
    const view = await new ListDueInstallments(repo).execute("s1", NOW);
    expect(calls).toEqual([["s1", "2026-10-23", DUE_LIST_LIMIT]]);
    expect(view.today).toBe("2026-10-20");
    expect(view.items).toEqual([{ id: "i1", code: "TG-1", customerName: "Tâm", due: "2026-10-19", periodRemaining: vnd(150_000) }]);
  });
});
