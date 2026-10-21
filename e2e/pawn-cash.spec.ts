import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles, expireTrial } from "./db";

// Luồng tiền chính: quỹ đầu két → tạo hợp đồng giải ngân → sổ quỹ. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_cd_${RUN}`, password: "matkhau123", email: `e2e_cd_${RUN}@example.com` };
const CCCD = "001099012345"; // Hash CCCD gắn với cửa hàng, nên mỗi lần chạy (cửa hàng mới) không đụng nhau.

test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

async function signIn(page: Page) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

const stat = (page: Page, label: string) => page.getByRole("region", { name: "Tổng két trong ngày" }).getByText(label).locator("..");

async function fillContract(page: Page, name: string) {
  await page.goto("/cam-do/moi");
  await page.getByLabel("Tên khách hàng").fill(name);
  await page.getByLabel("Số CCCD").fill(CCCD);
  await page.getByLabel("Số điện thoại").fill("0912345678");
  await page.getByLabel("Tên tài sản").fill("Honda Vision 2022");
  await page.getByLabel("Số tiền vay").fill("5.000.000");
  await page.getByLabel("Lãi *", { exact: true }).fill("3");
  await page.getByLabel("Số ngày vay").fill("30");
  await page.getByLabel("Kỳ lãi").fill("10");
}

test("đăng ký cửa hàng mới, nhập quỹ đầu két một lần", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Cầm Đồ E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Tiệm E2E");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: "Quỹ két" }).click();
  await expect(page).toHaveURL("/quy-ket");
  await page.getByLabel("Quỹ đầu két (đồng)").fill("20.000.000");
  await page.getByRole("button", { name: "Lưu quỹ đầu két" }).click();
  await expect(stat(page, "Quỹ đầu ngày")).toContainText("20.000.000");
  await expect(stat(page, "Tổng thu")).toContainText("0");
  await expect(stat(page, "Tiền cuối ngày")).toContainText("20.000.000");
  await expect(page.getByRole("cell", { name: "Quỹ đầu két" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lưu quỹ đầu két" })).toHaveCount(0);
});

test("tạo hợp đồng thu lãi trước: cảnh báo lãi suất, giải ngân ghi sổ quỹ", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Cầm đồ" }).click();
  await page.getByRole("link", { name: "Thêm hồ sơ" }).click();
  await fillContract(page, "Nguyễn Văn E2E");
  await page.getByLabel("Thu lãi trước").check();

  const summary = page.getByRole("region", { name: "Tóm tắt" });
  const summaryRow = (term: string) => summary.getByText(term).locator("..");
  await expect(summaryRow("Lãi mỗi kỳ (10 ngày)")).toContainText("150.000");
  await expect(summaryRow("Tiền giao khách")).toContainText("4.850.000");
  await expect(summary.getByRole("note")).toContainText("Điều 201 Bộ luật Hình sự");

  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/\/cam-do\?moi=CD-1$/);
  await expect(page.getByRole("status")).toContainText("Đã tạo hợp đồng CD-1");
  const row = page.getByRole("row", { name: /CD-1/ });
  await expect(row).toContainText("Nguyễn Văn E2E");
  await expect(row).toContainText("091****678");
  await expect(row).toContainText("5.000.000");

  await page.goto("/quy-ket");
  await expect(stat(page, "Tổng chi")).toContainText("-5.000.000");
  await expect(stat(page, "Tổng thu")).toContainText("150.000");
  await expect(stat(page, "Tiền cuối ngày")).toContainText("15.150.000");
  await expect(page.getByRole("row", { name: /Giải ngân.*CD-1/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Thu lãi.*CD-1/ })).toBeVisible();
});

test("CCCD trùng: hợp đồng mới gắn với khách cũ, báo cho người nhập", async ({ page }) => {
  await signIn(page);
  await fillContract(page, "Tên Gõ Khác");
  await page.getByLabel("Loại tài sản").selectOption("unsecured");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/moi=TC-1/);
  await expect(page.getByRole("status")).toContainText("khách hàng đã có cùng số CCCD");
  await expect(page.getByRole("row", { name: /TC-1/ })).toContainText("Nguyễn Văn E2E");
});

test("chi tiết hợp đồng: đóng lãi sớm một kỳ, được giảm lãi, ghi sổ quỹ", async ({ page }) => {
  await signIn(page);
  await page.goto("/cam-do");
  await page.getByRole("link", { name: "CD-1" }).click();
  await expect(page.getByRole("heading", { name: "Hợp đồng CD-1" })).toBeVisible();
  const tile = (label: string) => page.getByRole("region", { name: "Số liệu" }).getByText(label).locator("..");
  await expect(tile("Tiền gốc còn lại")).toContainText("5.000.000");
  await expect(tile("Lãi đã đóng")).toContainText("150.000");
  await expect(page.getByRole("row", { name: /Giải ngân, tạo hợp đồng/ })).toContainText("5.000.000");

  // Thu lãi trước, vay hôm nay: kỳ kế tiếp chưa tới hạn, chỉ có một lựa chọn đóng sớm 150.000 đ.
  await page.getByRole("button", { name: "Đóng lãi" }).click();
  const dialog = page.getByRole("dialog", { name: "Đóng lãi — CD-1" });
  await expect(dialog.getByLabel("Đóng đến hết kỳ")).toContainText("150.000 đ");
  await expect(dialog.getByLabel("Số tiền khách đưa")).toHaveValue("150.000");
  await dialog.getByLabel("Số tiền khách đưa").fill("200.000");
  await dialog.getByRole("button", { name: "Xác nhận đóng lãi" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Số tiền khách đưa không được lớn hơn tiền lãi của các kỳ đã chọn.");
  await dialog.getByLabel("Số tiền khách đưa").fill("100.000");
  await dialog.getByRole("button", { name: "Xác nhận đóng lãi" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Đã thu 100.000 đ tiền lãi");
  await expect(tile("Lãi đã đóng")).toContainText("250.000");
  await expect(page.getByRole("row", { name: /Đóng lãi.*100\.000/ })).toBeVisible();

  await page.goto("/quy-ket");
  await expect(stat(page, "Tổng thu")).toContainText("250.000");
});

test("dữ liệu sai: báo lỗi, giữ lại giá trị đã nhập", async ({ page }) => {
  await signIn(page);
  await fillContract(page, "Khách Lỗi");
  await page.getByLabel("Kỳ lãi").fill("31");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Kỳ lãi không được dài hơn số ngày vay.");
  await expect(page.getByLabel("Tên khách hàng")).toHaveValue("Khách Lỗi");
  await expect(page).toHaveURL("/cam-do/moi");
});

test("hết hạn dùng thử: không tạo được hợp đồng", async ({ page }) => {
  await expireTrial(OWNER.username);
  await signIn(page);
  await fillContract(page, "Khách Hết Hạn");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Cửa hàng đã hết hạn sử dụng, không tạo được hợp đồng mới.");
});
