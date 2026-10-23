export type Credentials = { username: string; password: string };

export type SignInResult = "ok" | "invalid_credentials" | "locked" | "inactive";

/** Dịch vụ xác thực (phiên đăng nhập, cookie) do lớp infrastructure cung cấp. */
export interface Authenticator {
  signIn(credentials: Credentials): Promise<SignInResult>;
  signOut(): Promise<void>;
}

/** Người thực hiện thao tác, lấy từ guard (session), không bao giờ từ input của client. */
export type Actor = { userId: string; shopId: string };

export type OwnerRegistration = {
  shopName: string;
  ownerName: string;
  email: string;
  username: string;
  password: string;
};

export type NewStaff = { name: string; username: string; password: string };

export type StaffMember = { id: string; name: string; username: string; isActive: boolean; createdAt: Date };

export type RegisterOwnerResult = "ok" | "rate_limited" | "username_taken" | "email_taken";

export type CreateStaffResult = "ok" | "username_taken";

/** `not_found`: không có KTV đó trong cửa hàng, hoặc KTV đã ở sẵn trạng thái muốn đổi. */
export type SetStaffActiveResult = "ok" | "not_found";

export type ResetStaffPasswordResult = "ok" | "not_found";

/** Tạo cửa hàng dùng thử + chủ tiệm trong một transaction. */
export interface OwnerRegistrar {
  registerOwner(input: OwnerRegistration, trialDays: number): Promise<Exclude<RegisterOwnerResult, "rate_limited">>;
}

/** KTV của một cửa hàng; mọi truy vấn lọc theo shopId của người thực hiện. */
export interface StaffRepository {
  createStaff(actor: Actor, input: NewStaff): Promise<CreateStaffResult>;
  listStaff(shopId: string, limit: number): Promise<StaffMember[]>;
  /** Khoá thì xoá luôn mọi phiên đang mở của KTV. Không đụng được chủ tiệm. */
  setStaffActive(actor: Actor, staffId: string, active: boolean): Promise<SetStaffActiveResult>;
  /** Đặt mật khẩu mới cho KTV (kể cả đang bị khoá) và xoá mọi phiên đang mở của KTV. */
  resetStaffPassword(actor: Actor, staffId: string, password: string): Promise<ResetStaffPasswordResult>;
}

export type PasswordChange = { currentPassword: string; newPassword: string };

export type ChangePasswordResult = "ok" | "wrong_password" | "locked";

/**
 * Đổi mật khẩu của chính người đang đăng nhập. Mật khẩu hiện tại sai thì đếm như đăng nhập sai
 * (cùng bộ đếm tài khoản + IP); đổi xong xoá mọi phiên khác, giữ phiên `sessionId`.
 */
export interface PasswordChanger {
  changeOwnPassword(actor: Actor, sessionId: string, input: PasswordChange): Promise<ChangePasswordResult>;
}

/** Giới hạn số lần đăng ký theo nguồn gửi (IP). Trả `false` khi đã hết lượt. */
export interface SignupLimiter {
  tryAcquire(): Promise<boolean>;
}
