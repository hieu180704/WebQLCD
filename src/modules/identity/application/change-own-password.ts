import type {
  Actor,
  ChangePasswordResult,
  PasswordChange,
  PasswordChanger,
} from "./ports";

export class ChangeOwnPassword {
  constructor(private readonly passwords: PasswordChanger) {}

  /** Mọi vai trò, cả khi cửa hàng hết hạn; `actor`, `sessionId` lấy từ guard. */
  execute(
    actor: Actor,
    sessionId: string,
    input: PasswordChange,
  ): Promise<ChangePasswordResult> {
    return this.passwords.changeOwnPassword(actor, sessionId, input);
  }
}
