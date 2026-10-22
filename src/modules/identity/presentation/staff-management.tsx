import { redirect } from "next/navigation";
import { listStaff, requireSession } from "@/composition-root";
import { CreateStaffForm } from "./create-staff-form";
import { StaffStatusButton, StaffStatusDialog } from "./staff-status-dialog";

const formatDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format;

/** Trang quản lý KTV: chỉ chủ tiệm; KTV vào thì chuyển về trang chủ. */
export async function StaffManagement() {
  const principal = await requireSession();
  if (principal.role !== "owner") redirect("/");
  const members = await listStaff.execute(principal.shopId);

  return (
    <>
      <h1 className="text-2xl font-bold">Nhân viên</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[22rem_1fr] items-start">
        <section className="card p-5" aria-labelledby="staff-new">
          <h2 id="staff-new" className="font-semibold">
            Thêm nhân viên (KTV)
          </h2>
          <div className="mt-4">
            <CreateStaffForm />
          </div>
        </section>
        <section className="card" aria-labelledby="staff-list">
          <div className="p-5 pb-3">
            <h2 id="staff-list" className="font-semibold">
              Danh sách nhân viên
            </h2>
          </div>
          <StaffStatusDialog>
            {members.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-slate-500">Chưa có nhân viên nào.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Họ tên</th>
                      <th>Tên đăng nhập</th>
                      <th>Trạng thái</th>
                      <th>Ngày tạo</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td className="font-medium">{m.name}</td>
                        <td>{m.username}</td>
                        <td>
                          <span className={`badge ${m.isActive ? "badge-ok" : "badge-muted"}`}>{m.isActive ? "Đang hoạt động" : "Đã khoá"}</span>
                        </td>
                        <td className="num">{formatDate(m.createdAt)}</td>
                        <td>
                          <StaffStatusButton staffId={m.id} name={m.name} active={m.isActive} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </StaffStatusDialog>
          <p className="px-5 py-3 text-xs text-slate-500">
            Nhân viên bị khoá không đăng nhập được, phiên đang mở bị đăng xuất ngay. Hồ sơ cũ vẫn ghi tên người đó. Không xoá nhân viên để giữ lịch sử.
          </p>
        </section>
      </div>
    </>
  );
}
