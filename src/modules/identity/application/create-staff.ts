import type { Actor, CreateStaffResult, NewStaff, StaffRepository } from "./ports";

export class CreateStaff {
  constructor(private readonly staff: StaffRepository) {}

  /** Chỉ chủ tiệm, cửa hàng còn quyền ghi: kiểm ở guard trước khi gọi. */
  execute(actor: Actor, input: NewStaff): Promise<CreateStaffResult> {
    return this.staff.createStaff(actor, input);
  }
}
