import "server-only";
import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { AUTH_ERROR_CODES, auth } from "@/shared/infrastructure/auth/auth";
import type { Authenticator, Credentials, SignInResult } from "../application/ports";

export class BetterAuthAuthenticator implements Authenticator {
  async signIn({ username, password }: Credentials): Promise<SignInResult> {
    try {
      // nextCookies ghi cookie phiên vào response của server action.
      await auth.api.signInUsername({ body: { username, password }, headers: await headers() });
      return "ok";
    } catch (error) {
      if (!isAPIError(error)) throw error;
      if (error.body?.code === AUTH_ERROR_CODES.loginLocked) return "locked";
      if (error.body?.code === AUTH_ERROR_CODES.accountInactive) return "inactive";
      if (error.statusCode === 401 || error.statusCode === 422) return "invalid_credentials";
      throw error;
    }
  }

  async signOut(): Promise<void> {
    await auth.api.signOut({ headers: await headers() });
  }
}
