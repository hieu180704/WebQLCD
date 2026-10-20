import type { StaffMember, StaffRepository } from "./ports";

// Một tiệm chỉ có vài KTV; giới hạn cứng thay cho phân trang.
export const STAFF_LIST_LIMIT = 200;

export class ListStaff {
  constructor(private readonly staff: StaffRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. */
  execute(shopId: string): Promise<StaffMember[]> {
    return this.staff.listStaff(shopId, STAFF_LIST_LIMIT);
  }
}
