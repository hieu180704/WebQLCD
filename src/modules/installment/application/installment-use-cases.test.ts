import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { CreateInstallment, type CreateInstallmentInput } from "./create-installment";
import type { InstallmentDraft, InstallmentRepository } from "./ports";

const ACTOR = { userId: "u1", shopId: "s1" };
// 10:00 ngày 20/10/2026 giờ Việt Nam.
const NOW = new Date("2026-10-20T03:00:00Z");

/** Repository giả: ghi lại draft nhận được; các hàm không dùng tới thì ném lỗi. */
function fakeRepo(overrides: Partial<InstallmentRepository> = {}) {
  const created: InstallmentDraft[] = [];
  const repo: InstallmentRepository = {
    async create(_actor, draft) {
      created.push(draft);
      return { code: "TG-1", customer: { id: "c1", reused: false, fullName: draft.customer.fullName } };
    },
    list: () => Promise.reject(new Error("không dùng")),
    ...overrides,
  };
  return { repo, created };
}

const input = (startDate = "2026-10-20"): CreateInstallmentInput => ({
  terms: { amountGiven: Money.fromNumber(4_000_000), totalDue: Money.fromNumber(5_000_000), totalDays: 50, periodDays: 2, startDate },
  customer: { fullName: "Đỗ Minh Tâm", cccd: null, phone: null, address: null },
  note: null,
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
