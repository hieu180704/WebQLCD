// Use case xem CCCD đầy đủ với repository giả.
import { describe, expect, it } from "vitest";
import { RevealCccd } from "./edit-customer";
import type { CustomerRepository } from "./ports";

const repo = (found: { cccd: string | null } | null): CustomerRepository => ({
  recordEdit: async () => ({ ok: true, changed: [] }),
  revealCccd: async () => found,
});

describe("RevealCccd", () => {
  it("có CCCD → trả số; chưa có CCCD → no_cccd; không có khách → not_found", async () => {
    const actor = { userId: "u", shopId: "s" };
    expect(
      await new RevealCccd(repo({ cccd: "001099012345" })).execute(actor, "c"),
    ).toEqual({ ok: true, cccd: "001099012345" });
    expect(
      await new RevealCccd(repo({ cccd: null })).execute(actor, "c"),
    ).toEqual({ ok: false, error: "no_cccd" });
    expect(await new RevealCccd(repo(null)).execute(actor, "c")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
