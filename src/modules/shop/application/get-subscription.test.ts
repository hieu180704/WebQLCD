// Use case trạng thái thuê bao với repository giả trong bộ nhớ.
import { describe, expect, it } from "vitest";
import type { Subscription } from "../domain/subscription";
import { GetSubscription } from "./get-subscription";

const now = new Date("2026-10-20T10:00:00Z");
const at = (iso: string) => new Date(iso);
const view = (subscription: Subscription | undefined) =>
  new GetSubscription({ findSubscription: async () => subscription }).execute("shop", now);

describe("GetSubscription", () => {
  it("dùng thử còn hạn: số ngày còn lại làm tròn lên", async () => {
    const endsAt = at("2026-10-27T10:00:00Z");
    expect(await view({ status: "trial", trialEndsAt: endsAt, paidUntil: null })).toEqual({ kind: "trial", daysLeft: 7, endsAt });
    expect(await view({ status: "trial", trialEndsAt: at("2026-10-20T10:00:01Z"), paidUntil: null })).toMatchObject({ daysLeft: 1 });
  });

  it("hết dùng thử, hết hạn trả phí, expired thì chỉ đọc (cùng luật quyền ghi của guard)", async () => {
    const past = at("2026-10-20T09:59:59Z");
    const future = at("2026-11-20T00:00:00Z");
    expect(await view({ status: "trial", trialEndsAt: past, paidUntil: null })).toEqual({ kind: "read_only" });
    expect(await view({ status: "active", trialEndsAt: past, paidUntil: past })).toEqual({ kind: "read_only" });
    expect(await view({ status: "active", trialEndsAt: past, paidUntil: null })).toEqual({ kind: "read_only" });
    expect(await view({ status: "expired", trialEndsAt: future, paidUntil: future })).toEqual({ kind: "read_only" });
  });

  it("đã trả phí còn hạn", async () => {
    const until = at("2026-11-20T00:00:00Z");
    expect(await view({ status: "active", trialEndsAt: at("2026-10-01T00:00:00Z"), paidUntil: until })).toEqual({ kind: "paid", until });
  });

  it("không tìm thấy cửa hàng thì báo lỗi", async () => {
    await expect(view(undefined)).rejects.toThrow();
  });
});
