import type { Actor, SetStaffActiveResult, StaffRepository } from "./ports";

export class SetStaffActive {
  constructor(private readonly staff: StaffRepository) {}

  /** Chỉ chủ tiệm; mở khoá cần cửa hàng còn quyền ghi, khoá thì không: kiểm ở guard trước khi gọi. */
  execute(
    actor: Actor,
    staffId: string,
    active: boolean,
  ): Promise<SetStaffActiveResult> {
    return this.staff.setStaffActive(actor, staffId, active);
  }
}
