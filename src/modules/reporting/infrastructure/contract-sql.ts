import "server-only";
import { sql } from "drizzle-orm";
import { contracts } from "@/shared/infrastructure/db/schema";
import type { LocalDate } from "@/shared/kernel/local-date";

/**
 * Hợp đồng (bảng `contracts`, không alias) quá hạn đóng lãi tính đến `today`. Hạn theo hàm SQL contract_interest_due
 * (migration 0007, như `nextInterestDue` của pawn); lãi suất 0 không có thao tác đóng lãi nên không bao giờ quá hạn.
 * Chỉ ý nghĩa với hợp đồng đang mở, chưa xoá: bên gọi tự lọc.
 */
export const overdueCondition = (today: LocalDate) =>
  sql`(${contracts.interestRate} > 0 AND contract_interest_due(${contracts.interestPaidUntil}, ${contracts.prepaidInterest}, ${contracts.interestPeriodDays}) < ${today})`;
