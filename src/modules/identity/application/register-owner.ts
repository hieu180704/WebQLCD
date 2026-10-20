import { TRIAL_DAYS } from "@/modules/shop";
import type { Authenticator, OwnerRegistrar, OwnerRegistration, RegisterOwnerResult, SignupLimiter } from "./ports";

export class RegisterOwner {
  constructor(
    private readonly limiter: SignupLimiter,
    private readonly registrar: OwnerRegistrar,
    private readonly authenticator: Authenticator,
  ) {}

  async execute(input: OwnerRegistration): Promise<RegisterOwnerResult> {
    if (!(await this.limiter.tryAcquire())) return "rate_limited";
    const result = await this.registrar.registerOwner(input, TRIAL_DAYS);
    if (result !== "ok") return result;
    // Tài khoản đã tạo xong; đăng nhập hụt (vd. username đang bị khoá do bị dò trước đó) thì người dùng
    // tự đăng nhập lại sau, trang chủ sẽ chuyển về /dang-nhap.
    await this.authenticator.signIn({ username: input.username, password: input.password });
    return "ok";
  }
}
