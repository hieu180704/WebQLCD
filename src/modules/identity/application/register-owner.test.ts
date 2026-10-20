// Use case đăng ký với adapter giả trong bộ nhớ.
import { describe, expect, it } from "vitest";
import { TRIAL_DAYS } from "@/modules/shop";
import type { Authenticator, Credentials, OwnerRegistrar, OwnerRegistration, SignupLimiter } from "./ports";
import { RegisterOwner } from "./register-owner";

const input: OwnerRegistration = {
  shopName: "Tiệm A",
  ownerName: "Nguyễn Văn A",
  email: "a@example.com",
  username: "chutiema",
  password: "matkhau123",
};

function setup({ allowed = true, registered = "ok" as Awaited<ReturnType<OwnerRegistrar["registerOwner"]>> } = {}) {
  const calls = { registered: [] as [OwnerRegistration, number][], signedIn: [] as Credentials[] };
  const limiter: SignupLimiter = { tryAcquire: async () => allowed };
  const registrar: OwnerRegistrar = {
    registerOwner: async (owner, trialDays) => {
      calls.registered.push([owner, trialDays]);
      return registered;
    },
  };
  const authenticator: Authenticator = {
    signIn: async (credentials) => {
      calls.signedIn.push(credentials);
      return "ok";
    },
    signOut: async () => {},
  };
  return { useCase: new RegisterOwner(limiter, registrar, authenticator), calls };
}

describe("RegisterOwner", () => {
  it("tạo cửa hàng dùng thử rồi đăng nhập luôn", async () => {
    const { useCase, calls } = setup();
    expect(await useCase.execute(input)).toBe("ok");
    expect(calls.registered).toEqual([[input, TRIAL_DAYS]]);
    expect(calls.signedIn).toEqual([{ username: input.username, password: input.password }]);
  });

  it("hết lượt đăng ký thì không chạm DB", async () => {
    const { useCase, calls } = setup({ allowed: false });
    expect(await useCase.execute(input)).toBe("rate_limited");
    expect(calls.registered).toEqual([]);
    expect(calls.signedIn).toEqual([]);
  });

  it("trùng tên đăng nhập hoặc email thì không đăng nhập", async () => {
    for (const registered of ["username_taken", "email_taken"] as const) {
      const { useCase, calls } = setup({ registered });
      expect(await useCase.execute(input)).toBe(registered);
      expect(calls.signedIn).toEqual([]);
    }
  });
});
