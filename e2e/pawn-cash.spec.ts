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
  // Chờ chuyển trang xong: trang chủ cũng có link "Thêm hồ sơ", Next chỉ ẩn trang cũ (Activity, display: none) chứ không gỡ,
  // nên click sớm sẽ bám vào link đã ẩn và chờ tới hết giờ.
  await expect(page).toHaveURL("/cam-do");
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
  await expect(page.getByLabel("Tên tài sản")).toHaveCount(0);
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/moi=TC-1/);
  await expect(page.getByRole("status")).toContainText("khách hàng đã có cùng số CCCD");
  await expect(page.getByRole("row", { name: /TC-1/ })).toContainText("Nguyễn Văn E2E");

  // Thống kê cả cửa hàng: CD-1 thu lãi trước 150.000, cả hai vay hôm nay nên chưa có lãi đến hôm nay.
  await expect(page.getByText("2 hợp đồng đang mở")).toBeVisible();
  const tile = (label: string) => page.getByRole("region", { name: "Thống kê hợp đồng" }).getByText(label, { exact: true }).locator("..");
  await expect(tile("Tiền đang cho vay")).toContainText("10.000.000");
  await expect(tile("Lãi đến hôm nay")).toHaveText(/^Lãi đến hôm nay\s*0$/);
  await expect(tile("Lãi đã thu tháng này")).toContainText("150.000");
  await expect(tile("Quá hạn")).toHaveText(/^Quá hạn\s*0$/);
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

test("chuộc đồ: thu lãi theo ngày + gốc, không thu quá lãi, hợp đồng đã đóng", async ({ page }) => {
  await signIn(page);
  // Vay lùi 5 ngày, thu lãi sau: lãi đến hôm nay 5 × 15.000 = 75.000 đ.
  const loanDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(Date.now() - 5 * 86_400_000);
  await fillContract(page, "Khách Chuộc Đồ");
  await page.getByLabel("Ngày vay *", { exact: true }).fill(loanDate);
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/moi=CD-2/);
  await page.getByRole("link", { name: "CD-2" }).click();
  await expect(page.getByRole("heading", { name: "Hợp đồng CD-2" })).toBeVisible();

  await page.getByRole("button", { name: "Chuộc đồ" }).click();
  const dialog = page.getByRole("dialog", { name: "Chuộc đồ — CD-2" });
  await expect(dialog).toContainText("Lãi đến hôm nay (5 ngày)");
  await expect(dialog.getByLabel("Tiền lãi thu")).toHaveValue("75.000");
  await expect(dialog.getByText("Tổng cần thu").locator("..")).toContainText("5.075.000");
  await dialog.getByLabel("Tiền lãi thu").fill("80.000");
  await dialog.getByRole("button", { name: "Xác nhận chuộc đồ" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Tiền lãi thu không được lớn hơn lãi đến hôm nay.");
  await dialog.getByLabel("Tiền lãi thu").fill("70.000");
  await expect(dialog.getByText("Tổng cần thu").locator("..")).toContainText("5.070.000");
  await dialog.getByRole("button", { name: "Xác nhận chuộc đồ" }).click();

  await expect(page.getByText(/^Đã chuộc \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Chuộc đồ" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đóng lãi" })).toHaveCount(0);
  const tile = (label: string) => page.getByRole("region", { name: "Số liệu" }).getByText(label).locator("..");
  await expect(tile("Tiền gốc còn lại")).toContainText("0");
  await expect(page.getByRole("row", { name: /Trả gốc/ })).toContainText("5.000.000");
  await expect(page.getByRole("row", { name: /Đóng lãi/ })).toContainText("70.000");

  await page.goto("/quy-ket");
  await expect(page.getByRole("row", { name: /Trả gốc.*CD-2/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Thu lãi.*CD-2/ })).toBeVisible();
});

test("trả bớt gốc, vay thêm, gia hạn: lãi đến hôm nay thu kèm khi đổi gốc, ghi sổ quỹ", async ({ page }) => {
  await signIn(page);
  // Vay lùi 5 ngày, thu lãi sau: lãi đến hôm nay 5 × 15.000 = 75.000 đ.
  const loanDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(Date.now() - 5 * 86_400_000);
  await fillContract(page, "Khách Đổi Gốc");
  await page.getByLabel("Ngày vay *", { exact: true }).fill(loanDate);
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/moi=CD-3/);
  await page.getByRole("link", { name: "CD-3" }).click();
  const tile = (label: string) => page.getByRole("region", { name: "Số liệu" }).getByText(label).locator("..");

  await page.getByRole("button", { name: "Trả bớt gốc" }).click();
  const repay = page.getByRole("dialog", { name: "Trả bớt gốc — CD-3" });
  await expect(repay).toContainText("Lãi đến hôm nay 75.000 đ (5 ngày) thu kèm");
  await expect(repay.getByLabel("Tiền lãi thu kèm")).toHaveValue("75.000");
  await repay.getByLabel("Số tiền trả bớt gốc").fill("2.000.000");
  await expect(repay.getByText("Gốc sau khi trả").locator("..")).toContainText("3.000.000");
  await repay.getByLabel("Tiền lãi thu kèm").fill("0");
  await repay.getByRole("button", { name: "Xác nhận trả gốc" }).click();
  await expect(repay.getByRole("alert")).toHaveText("Tiền lãi thu kèm phải lớn hơn 0 (được giảm, không miễn hết).");
  await repay.getByLabel("Tiền lãi thu kèm").fill("70.000");
  await repay.getByRole("button", { name: "Xác nhận trả gốc" }).click();
  await expect(repay).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Đã trả bớt 2.000.000 đ, thu 70.000 đ tiền lãi. Gốc còn lại 3.000.000 đ.");
  await expect(tile("Tiền gốc còn lại")).toContainText("3.000.000");
  await expect(tile("Lãi đến hôm nay")).toContainText("0");

  // Lãi đã trả đến hôm nay: vay thêm không có lãi thu kèm.
  await page.getByRole("button", { name: "Vay thêm" }).click();
  const borrow = page.getByRole("dialog", { name: "Vay thêm — CD-3" });
  await expect(borrow.getByLabel("Tiền lãi thu kèm")).toHaveCount(0);
  await borrow.getByLabel("Số tiền vay thêm").fill("1.000.000");
  await borrow.getByRole("button", { name: "Xác nhận giải ngân" }).click();
  await expect(borrow).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Đã vay thêm 1.000.000 đ. Gốc còn lại 4.000.000 đ.");
  await expect(page.getByRole("row", { name: /Vay thêm/ })).toContainText("1.000.000");

  await page.getByRole("button", { name: "Gia hạn" }).click();
  const extend = page.getByRole("dialog", { name: "Gia hạn — CD-3" });
  await expect(extend).toContainText("(30 ngày)");
  await expect(extend.getByLabel(/Thu lãi đến hôm nay/)).toHaveCount(0);
  await extend.getByLabel("Gia hạn thêm (ngày)").fill("15");
  await expect(extend.getByText("Hạn mới").locator("..")).toContainText("(45 ngày)");
  await extend.getByRole("button", { name: "Xác nhận gia hạn" }).click();
  await expect(extend).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Đã gia hạn thêm 15 ngày (số ngày vay 45).");
  await expect(page.getByText(/^45 ngày \(đến/)).toBeVisible();

  // CD-1 thu lãi trước và đã đóng sớm: vay thêm thu lãi bổ sung trên phần vay thêm, 20 ngày × 3.000 = 60.000 đ.
  await page.goto("/cam-do");
  await page.getByRole("link", { name: "CD-1" }).click();
  await page.getByRole("button", { name: "Vay thêm" }).click();
  const more = page.getByRole("dialog", { name: "Vay thêm — CD-1" });
  await more.getByLabel("Số tiền vay thêm").fill("1.000.000");
  await expect(more.getByLabel("Tiền lãi thu kèm")).toHaveValue("60.000");
  await expect(more).toContainText("giao khách 940.000 đ");
  await more.getByRole("button", { name: "Xác nhận giải ngân" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã vay thêm 1.000.000 đ, thu 60.000 đ tiền lãi. Gốc còn lại 6.000.000 đ.");

  await page.goto("/quy-ket");
  await expect(page.getByRole("row", { name: /Vay thêm.*CD-3/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Trả gốc.*CD-3/ })).toBeVisible();
});

test("chủ tiệm huỷ giao dịch mới nhất (huỷ chuộc mở lại hợp đồng), xoá hợp đồng", async ({ page }) => {
  await signIn(page);
  const loanDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(Date.now() - 5 * 86_400_000);
  await fillContract(page, "Khách Huỷ Giao Dịch");
  await page.getByLabel("Ngày vay *", { exact: true }).fill(loanDate);
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/moi=CD-4/);
  await page.getByRole("link", { name: "CD-4" }).click();
  const tile = (label: string) => page.getByRole("region", { name: "Số liệu" }).getByText(label).locator("..");
  // Chỉ có giải ngân: không huỷ riêng được.
  await expect(page.getByRole("button", { name: "Huỷ giao dịch gần nhất" })).toHaveCount(0);

  await page.getByRole("button", { name: "Trả bớt gốc" }).click();
  const repay = page.getByRole("dialog", { name: "Trả bớt gốc — CD-4" });
  await repay.getByLabel("Số tiền trả bớt gốc").fill("1.000.000");
  await repay.getByRole("button", { name: "Xác nhận trả gốc" }).click();
  await expect(tile("Tiền gốc còn lại")).toContainText("4.000.000");

  await page.getByRole("button", { name: "Chuộc đồ" }).click();
  await page.getByRole("dialog", { name: "Chuộc đồ — CD-4" }).getByRole("button", { name: "Xác nhận chuộc đồ" }).click();
  await expect(page.getByText(/^Đã chuộc \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

  // Huỷ chuộc: hợp đồng mở lại.
  await page.getByRole("button", { name: "Huỷ giao dịch gần nhất" }).click();
  const reverse = page.getByRole("dialog", { name: "Huỷ giao dịch" });
  await expect(reverse).toContainText("Chuộc đồ");
  await expect(reverse).toContainText("+4.000.000");
  await reverse.getByLabel("Lý do huỷ").fill("Khách chưa chuộc");
  await reverse.getByRole("button", { name: "Huỷ giao dịch" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã huỷ giao dịch, bút toán đảo ghi vào quỹ két hôm nay.");
  await expect(page.getByRole("button", { name: "Chuộc đồ" })).toBeVisible();
  await expect(tile("Tiền gốc còn lại")).toContainText("4.000.000");
  await expect(page.getByRole("row", { name: /Huỷ giao dịch — Khách chưa chuộc/ }).first()).toBeVisible();

  // Huỷ tiếp trả bớt gốc (lãi thu kèm cũng đảo): về như lúc giải ngân.
  await page.getByRole("button", { name: "Huỷ giao dịch gần nhất" }).click();
  await expect(reverse).toContainText("Trả bớt gốc");
  await expect(reverse).toContainText("+1.075.000");
  await reverse.getByLabel("Lý do huỷ").fill("Nhập nhầm");
  await reverse.getByRole("button", { name: "Huỷ giao dịch" }).click();
  await expect(tile("Tiền gốc còn lại")).toContainText("5.000.000");
  await expect(tile("Lãi đến hôm nay")).toContainText("75.000");
  await expect(page.getByRole("button", { name: "Huỷ giao dịch gần nhất" })).toHaveCount(0);

  await page.getByRole("button", { name: "Xoá" }).click();
  const remove = page.getByRole("dialog", { name: "Xoá hợp đồng CD-4" });
  await expect(remove.getByText("Quỹ két thay đổi").locator("..")).toContainText("+5.000.000");
  await remove.getByLabel("Lý do xoá").fill("Tạo nhầm hồ sơ");
  await remove.getByLabel("Gõ mã hợp đồng để xác nhận").fill("CD-40");
  await remove.getByRole("button", { name: "Xoá hợp đồng" }).click();
  await expect(remove.getByRole("alert")).toHaveText("Mã hợp đồng gõ lại không khớp.");
  await remove.getByLabel("Gõ mã hợp đồng để xác nhận").fill("cd-4");
  await remove.getByRole("button", { name: "Xoá hợp đồng" }).click();
  await expect(page.getByText(/^Đã xoá \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await expect(page.getByText("Lý do: Tạo nhầm hồ sơ")).toBeVisible();
  await expect(page.getByRole("region", { name: "Thao tác" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Xoá" })).toHaveCount(0);

  await page.goto("/cam-do");
  await expect(page.getByRole("link", { name: "CD-4" })).toHaveCount(0);
});

test("sửa thông tin: tên tài sản, ghi chú; không sinh giao dịch", async ({ page }) => {
  await signIn(page);
  await page.goto("/cam-do");
  await page.getByRole("link", { name: "CD-3" }).click();
  await expect(page.getByRole("heading", { name: "Hợp đồng CD-3" })).toBeVisible();
  const historyRows = page.getByRole("region", { name: "Lịch sử giao dịch" }).getByRole("row");
  const before = await historyRows.count();

  await page.getByRole("button", { name: "Sửa thông tin" }).click();
  const edit = page.getByRole("dialog", { name: "Sửa thông tin — CD-3" });
  await expect(edit.getByLabel("Tên tài sản")).toHaveValue("Honda Vision 2022");
  await edit.getByLabel("Tên tài sản").fill("Honda Vision 2022 đỏ");
  await edit.getByLabel("Ghi chú").fill("Trầy yếm trái");
  await edit.getByRole("button", { name: "Lưu thông tin" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("Đã lưu thông tin hợp đồng.");
  const loan = page.getByRole("region", { name: "Khoản vay" });
  await expect(loan).toContainText("Honda Vision 2022 đỏ");
  await expect(loan).toContainText("Trầy yếm trái");
  await expect(historyRows).toHaveCount(before);

  await page.getByRole("button", { name: "Sửa thông tin" }).click();
  await edit.getByRole("button", { name: "Lưu thông tin" }).click();
  await expect(page.getByRole("status")).toHaveText("Không có thay đổi nào.");
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
