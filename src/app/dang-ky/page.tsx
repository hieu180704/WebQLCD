import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/modules/identity";
import { AuthCard } from "../_components/auth-card";

export const metadata: Metadata = { title: "Đăng ký dùng thử — TP83" };

export default function RegisterPage() {
  return (
    <AuthCard
      title="Đăng ký dùng thử"
      subtitle="Miễn phí 7 ngày. Hết hạn, dữ liệu vẫn được giữ; tài khoản chuyển sang chỉ xem cho tới khi gia hạn."
      footer={
        <>
          Đã có tài khoản?{" "}
          <Link href="/dang-nhap" className="font-medium text-teal-700 hover:underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
