import { requireSession } from "@/composition-root";
import { ChangePasswordForm } from "./change-password-form";

/** Trang cài đặt: hiện chỉ có mục "Tài khoản của tôi" (các mục cài đặt cửa hàng hoãn theo pilot-scope); mọi vai trò. */
export async function AccountSettings() {
  await requireSession();

  return (
    <>
      <h1 className="text-2xl font-bold">Cài đặt cửa hàng</h1>
      <div className="mt-6 max-w-md">
        <section className="card p-5" aria-labelledby="s-me">
          <h2 id="s-me" className="font-semibold">
            Tài khoản của tôi
          </h2>
          <div className="mt-4">
            <ChangePasswordForm />
          </div>
        </section>
      </div>
    </>
  );
}
