export type Credentials = { username: string; password: string };

export type SignInResult = "ok" | "invalid_credentials" | "locked" | "inactive";

/** Dịch vụ xác thực (phiên đăng nhập, cookie) do lớp infrastructure cung cấp. */
export interface Authenticator {
  signIn(credentials: Credentials): Promise<SignInResult>;
  signOut(): Promise<void>;
}
