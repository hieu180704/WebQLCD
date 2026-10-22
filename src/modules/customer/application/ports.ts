export type Actor = { userId: string; shopId: string };

/** Field sửa được ở trang khách (core-spec mục 2); CCCD đi riêng vì chỉ có bản che ở phía người dùng. */
export type CustomerInfo = {
  fullName: string;
  phone: string | null;
  address: string | null;
};

export type CustomerField = keyof CustomerInfo | "cccd";

export type CustomerEditDraft = {
  customerId: string;
  /** Giá trị người sửa đang thấy (khoá lạc quan); CCCD so bằng bản che. */
  expected: CustomerInfo & { cccdMasked: string | null };
  info: CustomerInfo;
  /** CCCD mới đã chuẩn hoá; null = giữ nguyên. */
  cccd: string | null;
};

export type EditCustomerError = "not_found" | "stale" | "duplicate_cccd";

export type EditCustomerResult =
  | { ok: true; changed: CustomerField[] }
  | { ok: false; error: EditCustomerError };

export interface CustomerRepository {
  /** So giá trị đang thấy, ghi field đổi + audit `edit` trong một transaction. Không đổi gì thì không ghi. */
  recordEdit(
    actor: Actor,
    draft: CustomerEditDraft,
  ): Promise<EditCustomerResult>;
  /** CCCD đầy đủ đã giải mã, ghi audit `view_cccd` cùng transaction. null = không có khách; `cccd` null = khách chưa có CCCD. */
  revealCccd(
    actor: Actor,
    customerId: string,
  ): Promise<{ cccd: string | null } | null>;
}
