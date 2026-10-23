import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { CreateInstallment, type CreateInstallmentInput } from "./create-installment";
import { PayInstallment } from "./pay-installment";
import type { InstallmentDraft, InstallmentRecord, InstallmentRepository, PaymentDraft } from "./ports";

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
