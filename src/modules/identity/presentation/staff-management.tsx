import { redirect } from "next/navigation";
import { listStaff, requireSession } from "@/composition-root";
import { CreateStaffForm } from "./create-staff-form";

const formatDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format;

/** Trang quản lý KTV: chỉ chủ tiệm; KTV vào thì chuyển về trang chủ. */
export async function StaffManagement() {
  const principal = await requireSession();
  if (principal.role !== "owner") redirect("/");
  const members = await listStaff.execute(principal.shopId);

  return (
    <div className="grid gap-8 md:grid-cols-[20rem_1fr]">
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">Thêm nhân viên (KTV)</h2>
        <CreateStaffForm />
      </section>
      <section>
        <h2 className="mb-4 font-semibold">Danh sách nhân viên</h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có nhân viên nào.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 font-medium">Họ tên</th>
                <th className="py-2 font-medium">Tên đăng nhập</th>
                <th className="py-2 font-medium">Trạng thái</th>
                <th className="py-2 font-medium">Ngày tạo</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="py-2">{m.name}</td>
                  <td className="py-2">{m.username}</td>
                  <td className="py-2">{m.isActive ? "Đang hoạt động" : "Đã khoá"}</td>
                  <td className="py-2">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
