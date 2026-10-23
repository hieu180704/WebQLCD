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
