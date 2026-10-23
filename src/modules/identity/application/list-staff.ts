import { businessDate } from "@/shared/kernel/local-date";
import type { StaffMember, StaffRepository } from "./ports";

// Một tiệm chỉ có vài KTV; giới hạn cứng thay cho phân trang.
export const STAFF_LIST_LIMIT = 200;

export class ListStaff {
  constructor(private readonly staff: StaffRepository) {}

  /** `shopId` lấy từ session (guard), không từ input của client. Gồm cả chủ tiệm (dòng đầu). */
  execute(shopId: string, now = new Date()): Promise<StaffMember[]> {
    return this.staff.listStaff(shopId, STAFF_LIST_LIMIT, `${businessDate(now).slice(0, 8)}01`);
  }
}
