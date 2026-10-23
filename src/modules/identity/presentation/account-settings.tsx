import { requireSession } from "@/composition-root";
import { ChangePasswordForm } from "./change-password-form";

/** Mục "Tài khoản của tôi" ở trang Cài đặt: mọi vai trò, cả khi cửa hàng hết hạn. */
export async function AccountSettings() {
  await requireSession();

  return (
    <section className="card p-5" aria-labelledby="s-me">
      <h2 id="s-me" className="font-semibold">
        Tài khoản của tôi
      </h2>
      <div className="mt-4">
        <ChangePasswordForm />
      </div>
    </section>
  );
}
