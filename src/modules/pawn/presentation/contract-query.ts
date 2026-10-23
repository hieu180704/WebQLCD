import { z } from "zod";
import { normalizeCccd } from "@/modules/customer";
import type { ContractFilter, ContractStatusFilter } from "../application/ports";

// Khoá = giá trị tham số trên URL (trang chủ trỏ vào `tt=qua-han`, `tt=sap-den-han`).
export const KINDS: Record<string, { label: string; value: NonNullable<ContractFilter["kind"]> }> = {
  "the-chap": { label: "Thế chấp (cầm đồ)", value: "secured" },
  "tin-chap": { label: "Tín chấp", value: "unsecured" },
};
export const STATUSES: Record<string, { label: string; value: ContractStatusFilter }> = {
  "dang-mo": { label: "Đang mở", value: "open" },
  "qua-han": { label: "Quá hạn", value: "overdue" },
  "hom-nay": { label: "Đến hạn hôm nay", value: "due_today" },
  "sap-den-han": { label: "Đến hạn trong 3 ngày (gồm quá hạn)", value: "due_soon" },
  "da-dong": { label: "Đã chuộc / Đã đóng", value: "closed" },
  "da-xoa": { label: "Đã xoá", value: "deleted" },
};

const keyOf = (record: Record<string, unknown>) =>
  z
    .enum(Object.keys(record) as [string, ...string[]])
    .nullable()
    .catch(null);

// Tham số URL sai định dạng thì bỏ qua, không báo lỗi; CCCD sai định dạng thì báo để người nhập sửa.
const querySchema = z.object({
  q: z.string().trim().max(100).nullable().catch(null),
  cccd: z.string().trim().max(30).nullable().catch(null),
  loai: keyOf(KINDS),
  tt: keyOf(STATUSES),
  sau: z.uuid().nullable().catch(null),
  moi: z.string().regex(/^(CD|TC)-\d{1,18}$/).nullable().catch(null),
  khach: z.literal("cu").nullable().catch(null),
});

/** Bộ lọc danh sách hợp đồng từ URL; trang danh sách và file Excel dùng chung để file khớp đúng cái đang xem. */
export function parseContractQuery(get: (key: string) => string | null) {
  const params = querySchema.parse(Object.fromEntries(Object.keys(querySchema.shape).map((key) => [key, get(key)])));
  const q = params.q || null;
  const cccdText = params.cccd || null;
  const cccd = cccdText ? normalizeCccd(cccdText) : null;
  const filter: ContractFilter = {
    search: q,
    cccd,
    kind: params.loai ? KINDS[params.loai].value : null,
    status: params.tt ? STATUSES[params.tt].value : null,
  };
  // CCCD nhập sai định dạng: không tìm, không trả danh sách đầy đủ (người dùng tưởng là kết quả tìm).
  const invalidCccd = cccdText !== null && cccd === null;
  return { params, q, cccdText, filter, invalidCccd };
}
