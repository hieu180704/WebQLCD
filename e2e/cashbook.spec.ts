import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Quỹ két đầy đủ: phiếu thu khác, chi khác, nạp vốn, huỷ phiếu. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_qk_${RUN}`, password: "matkhau123", email: `e2e_qk_${RUN}@example.com` };
const STAFF = { username: `e2e_qk_ktv_${RUN}`, password: "matkhau456" };

test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(username);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

const stat = (page: Page, label: string) => page.getByRole("region", { name: "Tổng két trong ngày" }).getByText(label).locator("..");

/** Mở hộp thoại phiếu, điền rồi lưu; trả về hộp thoại để kiểm lỗi. */
async function submitEntry(page: Page, button: string, title: string, amount: string, note: string, submit: string) {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByLabel("Số tiền").fill(amount);
  await dialog.getByLabel(/Nội dung|Ghi chú/).fill(note);
  await dialog.getByRole("button", { name: submit }).click();
  return dialog;
}

test("chủ tiệm: thu khác, chi khác, nạp vốn ghi sổ quỹ hôm nay", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Quỹ Két E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Quỹ Két");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/quy-ket");
  await page.getByLabel("Quỹ đầu két (đồng)").fill("10.000.000");
  await page.getByRole("button", { name: "Lưu quỹ đầu két" }).click();
  await expect(stat(page, "Tiền cuối ngày")).toContainText("10.000.000");

  // Số tiền sai: báo lỗi trong hộp thoại, giữ lại giá trị đã nhập.
  const income = await submitEntry(page, "+ Thu khác", "Phiếu thu khác", "abc", "Bán thanh lý điện thoại", "Lưu phiếu thu");
  await expect(income.getByRole("alert")).toHaveText("Nhập số tiền lớn hơn 0, tối đa 100 tỷ đồng.");
  await expect(income.getByLabel("Nội dung")).toHaveValue("Bán thanh lý điện thoại");
  await income.getByLabel("Số tiền").fill("2.500.000");
  await income.getByRole("button", { name: "Lưu phiếu thu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu phiếu thu.");
  await expect(income).toBeHidden();

  await submitEntry(page, "− Chi khác", "Phiếu chi khác", "1.250.000", "Tiền điện tháng 10", "Lưu phiếu chi");
  await expect(page.getByRole("status")).toHaveText("Đã lưu phiếu chi.");
  await submitEntry(page, "Nạp vốn", "Nạp vốn vào két", "50.000.000", "Chủ tiệm bổ sung vốn", "Nạp vốn");
  await expect(page.getByRole("status")).toHaveText("Đã nạp vốn vào két.");

  await expect(stat(page, "Tổng thu")).toContainText("52.500.000");
  await expect(stat(page, "Tổng chi")).toContainText("-1.250.000");
  await expect(stat(page, "Tiền cuối ngày")).toContainText("61.250.000");
  await expect(page.getByRole("cell", { name: "Thu khác" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Chi khác" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Nạp vốn" })).toBeVisible();
});

test("KTV ghi được thu/chi khác nhưng không có nút nạp vốn", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Quỹ");
  await page.getByLabel("Tên đăng nhập").fill(STAFF.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(page.getByRole("status")).toHaveText(`Đã tạo nhân viên ${STAFF.username}.`);
  await page.getByRole("button", { name: "Đăng xuất" }).click();

  await signIn(page, STAFF.username, STAFF.password);
  await page.goto("/quy-ket");
  await expect(page.getByRole("button", { name: "Nạp vốn" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Huỷ", exact: true })).toHaveCount(0);
  await submitEntry(page, "− Chi khác", "Phiếu chi khác", "100.000", "Mua nước", "Lưu phiếu chi");
  await expect(page.getByRole("status")).toHaveText("Đã lưu phiếu chi.");
  await expect(stat(page, "Tiền cuối ngày")).toContainText("61.150.000");
  await expect(page.getByRole("row", { name: /Chi khác.*Mua nước.*100\.000.*KTV Quỹ/ })).toBeVisible();
});

test("chủ tiệm huỷ phiếu chi khác: bút toán đảo kèm lý do; dòng hợp đồng không huỷ ở sổ quỹ", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/quy-ket");
  const row = page.getByRole("row", { name: /Tiền điện tháng 10/ });
  await row.getByRole("button", { name: "Huỷ", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Huỷ phiếu" });
  await expect(dialog).toContainText("Chi khác 1.250.000");
  await dialog.getByLabel("Lý do huỷ").fill("Nhập nhầm số tiền");
  await dialog.getByRole("button", { name: "Huỷ phiếu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã huỷ phiếu.");

  await expect(row).toContainText("Đã huỷ");
  await expect(row.getByRole("button", { name: "Huỷ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Bút toán đảo.*Huỷ “Chi khác” lúc .*lý do: Nhập nhầm số tiền/ })).toBeVisible();
  await expect(stat(page, "Tiền cuối ngày")).toContainText("62.400.000");

  // Giao dịch hợp đồng: mã là link sang chi tiết hợp đồng, không có nút huỷ ở sổ quỹ.
  await page.goto("/cam-do/moi");
  await page.getByLabel("Tên khách hàng").fill("Khách Quỹ Két");
  await page.getByLabel("Tên tài sản").fill("iPhone 13");
  await page.getByLabel("Số tiền vay").fill("5.000.000");
  await page.getByLabel("Lãi *", { exact: true }).fill("3");
  await page.getByLabel("Số ngày vay").fill("30");
  await page.getByLabel("Kỳ lãi").fill("10");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/\/cam-do\?moi=CD-1$/);
  await page.goto("/quy-ket");
  const disbursement = page.getByRole("row", { name: /Giải ngân/ });
  await expect(disbursement.getByRole("button", { name: "Huỷ", exact: true })).toHaveCount(0);
  await disbursement.getByRole("link", { name: "CD-1" }).click();
  await expect(page).toHaveURL(/\/cam-do\/[0-9a-f-]+$/);
});

test("lọc theo loại / người thực hiện, chuyển ngày giữ bộ lọc", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/quy-ket");
  const filter = page.getByRole("form", { name: "Lọc giao dịch" });

  await filter.getByLabel("Loại giao dịch").selectOption({ label: "Chi khác" });
  await filter.getByRole("button", { name: "Lọc" }).click();
  await expect(page).toHaveURL(/loai=chi-khac/);
  await expect(page.getByRole("row", { name: /Tiền điện tháng 10/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Mua nước/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Nạp vốn|Giải ngân|Bút toán đảo/ })).toHaveCount(0);
  // 4 ô tổng két không đổi theo bộ lọc.
  await expect(stat(page, "Tiền cuối ngày")).toContainText("57.400.000");

  await filter.getByLabel("Loại giao dịch").selectOption({ label: "Tất cả" });
  await filter.getByLabel("Người thực hiện").selectOption({ label: "KTV Quỹ" });
  await filter.getByRole("button", { name: "Lọc" }).click();
  await expect(page.getByRole("row", { name: /Mua nước/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Chủ Quỹ Két/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Ngày trước" }).click();
  await expect(page).toHaveURL(/ngay=\d{4}-\d{2}-\d{2}.*nv=|nv=.*ngay=/);
  await expect(page.getByText("Không có giao dịch phù hợp.")).toBeVisible();
  await page.getByRole("link", { name: "Ngày sau" }).click();
  await expect(page.getByRole("row", { name: /Mua nước/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ngày sau" })).toHaveCount(0);

  await page.getByRole("link", { name: "Bỏ lọc" }).click();
  await expect(page.getByRole("row", { name: /Giải ngân/ })).toBeVisible();
});
