import { z } from "zod";
import { isLocalDate } from "@/shared/kernel/local-date";
import { isCashTypeGroup } from "../application/cash-filter";

// Tham số URL sai định dạng thì bỏ qua (về hôm nay / trang đầu / không lọc), không báo lỗi.
const querySchema = z.object({
  ngay: z.string().refine(isLocalDate).nullable().catch(null),
  loai: z.string().refine(isCashTypeGroup).nullable().catch(null),
  nv: z.uuid().nullable().catch(null),
  sau: z.uuid().nullable().catch(null),
});

/** Ngày + bộ lọc sổ quỹ từ URL; trang quỹ két và file Excel dùng chung để file khớp đúng cái đang xem. */
export function parseCashQuery(get: (key: string) => string | null) {
  const { ngay, loai, nv, sau } = querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((key) => [key, get(key)])));
  const group = loai && isCashTypeGroup(loai) ? loai : null;
  return { ngay, group, nv, sau };
}
