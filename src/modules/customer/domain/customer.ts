/** Khách nhập kèm hợp đồng; các field đã chuẩn hoá ở presentation (CCCD, SĐT qua personal-data). */
export type NewCustomer = {
  fullName: string;
  cccd: string | null;
  phone: string | null;
  address: string | null;
};

/** Khách gắn với hợp đồng: `reused` = đã có sẵn trong cửa hàng (trùng CCCD), thông tin cũ giữ nguyên. */
export type ResolvedCustomer = { id: string; fullName: string; reused: boolean };
