import type { InterestType } from "@/modules/pawn";
import type { Subscription } from "../domain/subscription";

/** Người thực hiện thao tác, lấy từ guard (session), không bao giờ từ input của client. */
export type Actor = { userId: string; shopId: string };

/** Thông tin cửa hàng sửa được ở trang Cài đặt; ngày mở két chỉ đọc. */
export type ShopInfo = { name: string; phone: string | null; address: string | null };

export type ShopProfile = ShopInfo & { openedAt: string };

/** Giá trị điền sẵn vào form tạo hợp đồng cầm đồ/tín chấp. `interestRate` dạng "3", "1.5"; null = không điền sẵn. */
export type ContractDefaults = {
  interestType: InterestType;
  interestRate: string | null;
  termDays: number;
  interestPeriodDays: number;
  prepaidInterest: boolean;
};

export interface ShopRepository {
  findSubscription(shopId: string): Promise<Subscription | undefined>;
  findProfile(shopId: string): Promise<ShopProfile | undefined>;
  /** Ghi các field đổi khác giá trị cũ + audit `edit` (field nào) trong một transaction; trả danh sách field đã đổi. */
  updateInfo(actor: Actor, info: ShopInfo): Promise<(keyof ShopInfo)[]>;
  findContractDefaults(shopId: string): Promise<ContractDefaults | undefined>;
  /** Như `updateInfo`, cho mặc định tạo hợp đồng. */
  updateContractDefaults(actor: Actor, defaults: ContractDefaults): Promise<(keyof ContractDefaults)[]>;
}
