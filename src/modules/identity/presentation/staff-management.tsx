import { redirect } from "next/navigation";
import { listStaff, requireSession } from "@/composition-root";
import { CreateStaffForm } from "./create-staff-form";
import { ResetPasswordButton, ResetPasswordDialog } from "./reset-password-dialog";
import { StaffStatusButton, StaffStatusDialog } from "./staff-status-dialog";

const formatDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format;
const formatDay = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format;
const formatTime = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format;
/** "19/10/2026 07:55" như mockup (vi-VN mặc định đặt giờ trước ngày). */
const formatDateTime = (at: Date) => `${formatDay(at)} ${formatTime(at)}`;

/** Trang quản lý KTV: chỉ chủ tiệm; KTV vào thì chuyển về trang chủ. Dòng chủ tiệm chỉ để xem (không khoá, không đặt lại mật khẩu). */
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
            <ResetPasswordDialog>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Họ tên</th>
                      <th>Tên đăng nhập</th>
                      <th>Vai trò</th>
                      <th className="text-right">HĐ tháng này</th>
                      <th>Đăng nhập gần nhất</th>
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
                        <td>{m.role === "owner" ? "Chủ tiệm" : "Nhân viên"}</td>
                        <td className="text-right num">{m.contractsThisMonth}</td>
                        <td className="num">{m.lastLoginAt ? formatDateTime(m.lastLoginAt) : "Chưa đăng nhập"}</td>
                        <td>
                          <span className={`badge ${m.isActive ? "badge-ok" : "badge-muted"}`}>{m.isActive ? "Đang hoạt động" : "Đã khoá"}</span>
                        </td>
                        <td className="num">{formatDate(m.createdAt)}</td>
                        <td>
                          {m.role === "staff" && (
                            <div className="flex gap-3 whitespace-nowrap">
                              {m.isActive && <ResetPasswordButton staffId={m.id} name={m.name} />}
                              <StaffStatusButton staffId={m.id} name={m.name} active={m.isActive} />
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ResetPasswordDialog>
          </StaffStatusDialog>
          <p className="px-5 py-3 text-xs text-slate-500">
            Nhân viên bị khoá không đăng nhập được, phiên đang mở bị đăng xuất ngay. Hồ sơ cũ vẫn ghi tên người đó. Không xoá nhân viên để giữ lịch sử.
          </p>
        </section>
      </div>
    </>
  );
}
