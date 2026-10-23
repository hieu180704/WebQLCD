import type { Actor, ResetStaffPasswordResult, StaffRepository } from "./ports";

export class ResetStaffPassword {
  constructor(private readonly staff: StaffRepository) {}

  /** Chỉ chủ tiệm, làm được cả khi cửa hàng hết hạn (thao tác bảo mật): kiểm ở guard trước khi gọi. */
  execute(
    actor: Actor,
    staffId: string,
    password: string,
  ): Promise<ResetStaffPasswordResult> {
    return this.staff.resetStaffPassword(actor, staffId, password);
  }
}
