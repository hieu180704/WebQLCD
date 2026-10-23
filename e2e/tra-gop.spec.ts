import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Vòng đời hợp đồng trả góp. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_tg_${RUN}`, password: "matkhau123", email: `e2e_tg_${RUN}@example.com` };

test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

async function signIn(page: Page) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

test("đăng ký cửa hàng mới", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Trả Góp E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Tiệm E2E");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");
});

test("tạo hợp đồng trả góp: tóm tắt, cảnh báo lãi, giải ngân ghi sổ quỹ", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Trả góp" }).click();
  await expect(page).toHaveURL("/tra-gop");
  await expect(page.getByText("Chưa có hợp đồng nào.")).toBeVisible();
  await page.getByRole("link", { name: "Thêm hợp đồng" }).click();
  await expect(page).toHaveURL("/tra-gop/moi");

  await page.getByLabel("Tên khách hàng").fill("Đỗ Minh Tâm");
  await page.getByLabel("Tiền đưa khách").fill("4.000.000");
  await page.getByLabel("Tổng tiền phải thu").fill("5.000.000");
  await page.getByLabel("Số ngày góp").fill("50");
  await page.getByLabel("Số ngày mỗi kỳ").fill("2");
  const summary = page.getByRole("region", { name: "Tóm tắt" });
  const summaryRow = (term: string) => summary.getByText(term, { exact: true }).locator("..");
  await expect(summaryRow("Số kỳ")).toContainText("25");
  await expect(summaryRow("Tiền góp mỗi kỳ")).toContainText("200.000");
  await expect(summaryRow("Tiền lời")).toContainText("1.000.000");
  await expect(summaryRow("Lãi suất quy đổi")).toContainText("182,5%");
  await expect(summary.getByRole("note")).toContainText("Điều 201 Bộ luật Hình sự");

  // Tổng phải thu nhỏ hơn tiền đưa khách: báo lỗi, giữ giá trị đã nhập.
  await page.getByLabel("Tổng tiền phải thu").fill("3.000.000");
  await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
  await expect(summary.getByRole("alert")).toContainText("không được nhỏ hơn tiền đưa khách");
  await expect(page.getByLabel("Tên khách hàng")).toHaveValue("Đỗ Minh Tâm");

  await page.getByLabel("Tổng tiền phải thu").fill("5.000.000");
  await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
  await expect(page).toHaveURL(/\/tra-gop\?moi=TG-1$/);
  await expect(page.getByRole("status")).toContainText("Đã tạo hợp đồng TG-1");
  const row = page.getByRole("row", { name: /TG-1/ });
  await expect(row).toContainText("Đỗ Minh Tâm");
  await expect(row).toContainText("4.000.000");
  await expect(row).toContainText("0 / 25 kỳ");
  await expect(row).toContainText("200.000");
  await expect(row).toContainText("Đúng hạn");

  await page.goto("/quy-ket");
  const cash = page.getByRole("row", { name: /Giải ngân trả góp/ });
  await expect(cash).toContainText("4.000.000");
});

test("chi tiết: lịch góp, đóng tiền góp lẻ dồn sang kỳ sau, ghi sổ quỹ", async ({ page }) => {
  await signIn(page);
  await page.goto("/tra-gop");
  await page.getByRole("link", { name: "TG-1" }).click();
  await expect(page).toHaveURL(/\/tra-gop\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Hợp đồng TG-1" })).toBeVisible();
  const stats = page.getByRole("region", { name: "Số liệu" });
  await expect(stats.getByText("Tiến độ").locator("..")).toContainText("0 / 25 kỳ");
  const schedule = page.getByRole("region", { name: "Lịch góp" });
  await expect(schedule.getByRole("row")).toHaveCount(7); // tiêu đề + 6 kỳ đầu
  await expect(schedule.getByRole("link", { name: "Xem đủ 25 kỳ" })).toBeVisible();

  // Khách đưa lẻ 250.000: đủ kỳ 1, kỳ 2 góp được 50.000.
  await page.getByRole("button", { name: "Đóng tiền góp" }).click();
  const dialog = page.getByRole("dialog", { name: "Đóng tiền góp — TG-1" });
  await expect(dialog.getByLabel("Số tiền khách đưa")).toHaveValue("200.000");
  await dialog.getByLabel("Góp đến hết kỳ").selectOption("2");
  await expect(dialog.getByLabel("Số tiền khách đưa")).toHaveValue("400.000");
  await dialog.getByLabel("Số tiền khách đưa").fill("250.000");
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByRole("status")).toContainText("Đã thu 250.000 đ tiền góp");
  await expect(stats.getByText("Đã thu").locator("..")).toContainText("250.000");
  await expect(stats.getByText("Còn phải thu").locator("..")).toContainText("4.750.000");
  await expect(stats.getByText("Tiến độ").locator("..")).toContainText("1 / 25 kỳ");
  const row = (k: number) =>
    schedule
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: String(k), exact: true }) })
      .first();
  await expect(row(1)).toContainText("Đã góp");
  await expect(row(2)).toContainText("50.000");
  await expect(row(2)).toContainText("Chưa tới");
  const history = page.getByRole("region", { name: "Lịch sử giao dịch" });
  await expect(history.getByRole("row", { name: /Góp kỳ 1–2/ })).toContainText("250.000");

  // Hộp thoại gợi ý phần còn thiếu của kỳ 2; thu quá số còn phải thu thì từ chối.
  await page.getByRole("button", { name: "Đóng tiền góp" }).click();
  await expect(dialog.getByLabel("Số tiền khách đưa")).toHaveValue("150.000");
  await dialog.getByLabel("Số tiền khách đưa").fill("4.750.001");
  await dialog.getByRole("button", { name: "Xác nhận" }).click();
  await expect(dialog.getByRole("alert")).toContainText("không được lớn hơn số còn phải thu");
  await dialog.getByRole("button", { name: "Huỷ" }).click();

  await page.goto("/quy-ket");
  await expect(page.getByRole("row", { name: /Thu trả góp/ })).toContainText("250.000");
});

test("đóng hợp đồng: tất toán sớm được giảm, hợp đồng chuyển Đã đóng", async ({ page }) => {
  await signIn(page);
  await page.goto("/tra-gop");
  await page.getByRole("link", { name: "TG-1" }).click();
  await expect(page.getByRole("heading", { name: "Hợp đồng TG-1" })).toBeVisible();
  await page.getByRole("button", { name: "Đóng hợp đồng" }).click();
  const dialog = page.getByRole("dialog", { name: "Đóng hợp đồng — TG-1" });
  await expect(dialog.getByText("Còn phải thu").locator("..")).toContainText("4.750.000");
  await expect(dialog.getByLabel("Số tiền thu để tất toán")).toHaveValue("4.750.000");
  await dialog.getByLabel("Số tiền thu để tất toán").fill("4.500.000");
  await dialog.getByRole("button", { name: "Xác nhận đóng" }).click();
  await expect(page.getByText(/^Đã đóng \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Đóng tiền góp" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Lịch sử giao dịch" }).getByRole("row", { name: /Tất toán/ })).toContainText("4.500.000");
  await expect(page.getByText("Giảm khi tất toán").locator("..")).toContainText("250.000");

  await page.goto("/tra-gop");
  await expect(page.getByRole("row", { name: /TG-1/ })).toContainText("Đã đóng");
});
