import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "@/modules/identity";
import { AuthCard } from "../_components/auth-card";

export const metadata: Metadata = { title: "Đăng nhập — TP83" };

export default function SignInPage() {
  return (
    <AuthCard
      title="Đăng nhập"
      footer={
        <>
          Chưa có tài khoản?{" "}
          <Link href="/dang-ky" className="font-medium text-teal-700 hover:underline">
            Đăng ký dùng thử 7 ngày
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthCard>
  );
}
