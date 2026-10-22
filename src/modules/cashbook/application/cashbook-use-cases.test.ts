// Use case sổ két với repository giả trong bộ nhớ.
import { describe, expect, it } from "vitest";
import { Money } from "@/shared/kernel/money";
import { CASH_PAGE_SIZE, GetCashDay } from "./get-cash-day";
import type { CashLine, CashbookRepository, ManualEntry } from "./ports";
import { RecordManualEntry } from "./record-manual-entry";
import { ReverseManualEntry } from "./reverse-manual-entry";
import { SetOpeningBalance } from "./set-opening-balance";

const actor = { userId: "u", shopId: "s" };
const line = (i: number): CashLine => ({
  id: `id-${i}`,
  occurredAt: new Date(),
  type: "disbursement",
  amount: Money.of(-1n),
  contractId: "c",
  contractCode: "CD-1",
  createdByName: "Chủ",
  note: null,
  reversed: false,
  reverses: null,
});

function fakeRepo(lines: CashLine[] = []) {
  const calls: {
    date?: string;
    limit?: number;
    opening?: bigint;
    manual?: { entry: ManualEntry; date: string };
    reverse?: { id: string; reason: string; date: string };
  } = {};
  const repo: CashbookRepository = {
    recordOpeningBalance: async (_actor, amount) => {
      calls.opening = amount.toBigInt();
      return "ok";
    },
    recordManualEntry: async (_actor, entry, date) => {
      calls.manual = { entry, date };
    },
    reverseManualEntry: async (_actor, id, reason, date) => {
      calls.reverse = { id, reason, date };
      return "ok";
    },
    hasOpeningBalance: async () => true,
    dayTotals: async (_shop, date) => {
      calls.date = date;
      return { opening: Money.of(1_000n), income: Money.of(200n), expense: Money.of(-500n) };
    },
    listDay: async (_shop, _date, _after, limit) => {
      calls.limit = limit;
      return lines.slice(0, limit);
    },
  };
  return { repo, calls };
}

// 2026-10-20 23:30 giờ Việt Nam.
const now = new Date("2026-10-20T16:30:00Z");

describe("SetOpeningBalance", () => {
  it("từ chối số tiền không dương, không gọi repository", async () => {
    const { repo, calls } = fakeRepo();
    expect(await new SetOpeningBalance(repo).execute(actor, Money.ZERO)).toBe("not_positive");
    expect(calls.opening).toBeUndefined();
    expect(await new SetOpeningBalance(repo).execute(actor, Money.of(5n))).toBe("ok");
    expect(calls.opening).toBe(5n);
  });
});

describe("RecordManualEntry", () => {
  it("ghi vào hôm nay theo giờ Việt Nam", async () => {
    const { repo, calls } = fakeRepo();
    const entry: ManualEntry = { type: "manual_expense", amount: Money.of(1_250_000n), note: "Tiền điện" };
    expect(await new RecordManualEntry(repo).execute(actor, entry, now)).toBe("ok");
    expect(calls.manual).toEqual({ entry, date: "2026-10-20" });
  });

  it("thu/chi khác bắt buộc nội dung, nạp vốn thì không; số tiền phải dương", async () => {
    const { repo, calls } = fakeRepo();
    const use = new RecordManualEntry(repo);
    expect(await use.execute(actor, { type: "manual_income", amount: Money.of(5n), note: null }, now)).toBe("note_required");
    expect(await use.execute(actor, { type: "manual_expense", amount: Money.ZERO, note: "x" }, now)).toBe("not_positive");
    expect(calls.manual).toBeUndefined();
    expect(await use.execute(actor, { type: "capital_in", amount: Money.of(5n), note: null }, now)).toBe("ok");
  });
});

describe("ReverseManualEntry", () => {
  it("bắt buộc lý do; ghi bút toán đảo vào hôm nay", async () => {
    const { repo, calls } = fakeRepo();
    const use = new ReverseManualEntry(repo);
    expect(await use.execute(actor, "t1", "", now)).toBe("reason_required");
    expect(calls.reverse).toBeUndefined();
    expect(await use.execute(actor, "t1", "Nhập nhầm", now)).toBe("ok");
    expect(calls.reverse).toEqual({ id: "t1", reason: "Nhập nhầm", date: "2026-10-20" });
  });
});

describe("GetCashDay", () => {
  it("chỉ phiếu thu/chi khác, nạp vốn chưa bị huỷ là huỷ được từ sổ quỹ", async () => {
    const lines: CashLine[] = [
      { ...line(0), type: "manual_expense", contractId: null, contractCode: null },
      { ...line(1), type: "capital_in", contractId: null, contractCode: null, reversed: true },
      line(2),
      { ...line(3), type: "opening_balance", contractId: null, contractCode: null },
    ];
    const view = await new GetCashDay(fakeRepo(lines).repo).execute("s", null, null, now);
    expect(view.lines.map((l) => l.reversible)).toEqual([true, false, false, false]);
  });

  it("mặc định hôm nay theo giờ Việt Nam; ngày tương lai quy về hôm nay", async () => {
    const { repo, calls } = fakeRepo();
    expect((await new GetCashDay(repo).execute("s", null, null, now)).date).toBe("2026-10-20");
    expect((await new GetCashDay(repo).execute("s", "2026-10-21", null, now)).date).toBe("2026-10-20");
    expect((await new GetCashDay(repo).execute("s", "2026-10-01", null, now)).date).toBe("2026-10-01");
    expect(calls.date).toBe("2026-10-01");
  });

  it("cuối ngày = đầu − chi + thu; lấy thừa 1 dòng để biết còn trang sau", async () => {
    const lines = Array.from({ length: CASH_PAGE_SIZE + 1 }, (_, i) => line(i));
    const { repo, calls } = fakeRepo(lines);
    const view = await new GetCashDay(repo).execute("s", null, null, now);
    expect(view.summary.closing.toBigInt()).toBe(700n);
    expect(calls.limit).toBe(CASH_PAGE_SIZE + 1);
    expect(view.lines).toHaveLength(CASH_PAGE_SIZE);
    expect(view.nextAfter).toBe(`id-${CASH_PAGE_SIZE - 1}`);

    const last = await new GetCashDay(fakeRepo(lines.slice(0, 3)).repo).execute("s", null, null, now);
    expect(last.nextAfter).toBeNull();
  });
});
