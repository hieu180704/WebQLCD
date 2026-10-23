import { z } from "zod";
import { normalizeCccd } from "@/modules/customer";
import type { InstallmentFilter, InstallmentStatusFilter } from "../application/ports";

// Khoá = giá trị tham số trên URL (trang chủ trỏ vào `tt=sap-den-han`).
export const STATUSES: Record<string, { label: string; value: InstallmentStatusFilter }> = {
  "dang-gop": { label: "Đang góp", value: "open" },
  "cham-gop": { label: "Chậm góp", value: "late" },
  "hom-nay": { label: "Đến hạn hôm nay", value: "due_today" },
  "sap-den-han": { label: "Đến hạn trong 3 ngày (gồm chậm góp)", value: "due_soon" },
  "da-dong": { label: "Đã đóng", value: "closed" },
  "da-xoa": { label: "Đã xoá", value: "deleted" },
};

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi; CCCD sai định dạng thì báo để người nhập sửa.
const querySchema = z.object({
  q: z.string().trim().max(100).nullable().catch(null),
  cccd: z.string().trim().max(30).nullable().catch(null),
  tt: z
    .enum(Object.keys(STATUSES) as [string, ...string[]])
    .nullable()
    .catch(null),
  sau: z.uuid().nullable().catch(null),
  moi: z
    .string()
    .regex(/^TG-\d{1,18}$/)
    .nullable()
    .catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

/** Bộ lọc danh sách trả góp từ URL; trang danh sách và file Excel dùng chung để file khớp đúng cái đang xem. */
export function parseInstallmentQuery(get: (key: string) => string | null) {
  const params = querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((key) => [key, get(key)])));
  const q = params.q || null;
  const cccdText = params.cccd || null;
  const cccd = cccdText ? normalizeCccd(cccdText) : null;
  const filter: InstallmentFilter = { search: q, cccd, status: params.tt ? STATUSES[params.tt].value : null };
  // CCCD nhập sai định dạng: không tìm, không trả danh sách đầy đủ (người dùng tưởng là kết quả tìm).
  const invalidCccd = cccdText !== null && cccd === null;
  return { params, q, cccdText, filter, invalidCccd };
}
