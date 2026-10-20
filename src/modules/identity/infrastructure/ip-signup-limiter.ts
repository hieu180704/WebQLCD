import "server-only";
import { getIP } from "better-auth/api";
import { headers } from "next/headers";
import { auth } from "@/shared/infrastructure/auth/auth";
import { reserveSignupAttempt } from "@/shared/infrastructure/auth/signup-throttle";
import type { Db } from "@/shared/infrastructure/db/client";
import type { SignupLimiter } from "../application/ports";

export class IpSignupLimiter implements SignupLimiter {
  constructor(private readonly db: Db) {}

  async tryAcquire(): Promise<boolean> {
    // Xác định IP cùng cách với khoá đăng nhập (cấu hình advanced.ipAddress của Better Auth).
    // Không xác định được IP thì không có khoá để đếm, giống lớp IP của khoá đăng nhập.
    const ip = getIP(await headers(), auth.options);
    return ip ? reserveSignupAttempt(this.db, ip) : true;
  }
}
