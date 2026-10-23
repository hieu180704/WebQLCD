import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Báo cáo thu chi theo kỳ, chỉ chủ tiệm. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_bc_${RUN}`, password: "matkhau123", email: `e2e_bc_${RUN}@example.com` };
const STAFF = { username: `e2e_bc_ktv_${RUN}`, password: "matkhau456" };

test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const vnDay = (date: string) => date.split("-").reverse().join("/");

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(username);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

async function submitEntry(page: Page, button: string, title: string, amount: string, note: string, submit: string) {
  await page.getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByLabel("Số tiền").fill(amount);
  await dialog.getByLabel(/Nội dung|Ghi chú/).fill(note);
  await dialog.getByRole("button", { name: submit }).click();
  await expect(dialog).toBeHidden();
}

const overview = (page: Page) => page.getByRole("region", { name: /^Tổng quan/ });
const tile = (page: Page, label: string) => overview(page).getByText(label).locator("..");

test("chủ tiệm: tổng quan, theo loại, theo ngày khớp sổ quỹ; chọn nhanh kỳ; từ ngày sau đến ngày thì báo lỗi", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Báo Cáo E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Báo Cáo");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");

  // Sổ quỹ hôm nay: quỹ đầu két 10tr, thu khác 2,5tr, chi khác 1,25tr rồi huỷ (dòng đảo +1,25tr), giải ngân 5tr.
  await page.goto("/quy-ket");
  await page.getByLabel("Quỹ đầu két (đồng)").fill("10.000.000");
  await page.getByRole("button", { name: "Lưu quỹ đầu két" }).click();
  await submitEntry(page, "+ Thu khác", "Phiếu thu khác", "2.500.000", "Bán thanh lý", "Lưu phiếu thu");
  await submitEntry(page, "− Chi khác", "Phiếu chi khác", "1.250.000", "Tiền điện", "Lưu phiếu chi");
  await page
    .getByRole("row", { name: /Tiền điện/ })
    .getByRole("button", { name: "Huỷ", exact: true })
    .click();
  const reverse = page.getByRole("dialog", { name: "Huỷ phiếu" });
  await reverse.getByLabel("Lý do huỷ").fill("Nhập nhầm");
  await reverse.getByRole("button", { name: "Huỷ phiếu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã huỷ phiếu.");
  await page.goto("/cam-do/moi");
  await page.getByLabel("Tên khách hàng").fill("Khách Báo Cáo");
  await page.getByLabel("Tên tài sản").fill("iPhone 13");
  await page.getByLabel("Số tiền vay").fill("5.000.000");
  await page.getByLabel("Lãi *", { exact: true }).fill("3");
  await page.getByLabel("Số ngày vay").fill("30");
  await page.getByLabel("Kỳ lãi").fill("10");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/\/cam-do\?moi=CD-1$/);

  await page.getByRole("navigation", { name: "Menu chính" }).getByRole("link", { name: "Báo cáo" }).click();
  await expect(page).toHaveURL("/bao-cao");
  await expect(page.getByRole("link", { name: "Tháng này" })).toHaveAttribute("aria-current", "page");
  await expect(tile(page, "Quỹ đầu kỳ")).toContainText("10.000.000");
  await expect(tile(page, "Tổng thu")).toContainText("3.750.000");
  await expect(tile(page, "Tổng chi")).toContainText("6.250.000");
  await expect(tile(page, "Quỹ cuối kỳ")).toContainText("7.500.000");

  // Hợp đồng vay hôm nay, thu lãi sau: chưa có lãi đến hôm nay, chưa quá hạn.
  const debt = page.getByRole("region", { name: /^Dư nợ hôm nay/ });
  await expect(debt.getByText("Cầm đồ đang cho vay (gốc)").locator("+ dd")).toHaveText("5.000.000");
  await expect(debt.getByText("Tín chấp đang cho vay (gốc)").locator("+ dd")).toHaveText("0");
  await expect(debt.getByText("Lãi đến hôm nay chưa thu").locator("+ dd")).toHaveText("0");
  await expect(debt.getByText("Trả góp còn phải thu").locator("+ dd")).toHaveText("0");
  await expect(debt.getByText("Hợp đồng quá hạn").locator("+ dd")).toHaveText("0 cầm đồ/tín chấp · 0 trả góp");
  const period = page.getByRole("region", { name: "Hợp đồng trong kỳ" });
  await expect(period.getByText("Mở mới").locator("+ dd")).toHaveText("1");
  await expect(period.getByText("Chuộc đồ / đóng hợp đồng / tất toán").locator("+ dd")).toHaveText("0");
  await expect(period.getByText("Đã xoá").locator("+ dd")).toHaveText("0");

  const byType = page.getByRole("region", { name: "Theo loại giao dịch" });
  await expect(byType.getByRole("row", { name: /Thu khác/ })).toContainText("2.500.000");
  await expect(byType.getByRole("row", { name: /Chi khác/ })).toContainText("1.250.000");
  await expect(byType.getByRole("row", { name: /Giải ngân cầm đồ, tín chấp/ })).toContainText("5.000.000");
  await expect(byType.getByRole("row", { name: /Bút toán đảo/ })).toContainText("1.250.000");
  await expect(byType.getByRole("row", { name: /Nạp vốn|Đóng lãi/ })).toHaveCount(0);

  const day = page.getByRole("region", { name: "Theo ngày" }).getByRole("row", { name: new RegExp(vnDay(today())) });
  await expect(day).toContainText(/10\.000\.000.*3\.750\.000.*6\.250\.000.*7\.500\.000/);
  await day.getByRole("link", { name: /Chi tiết/ }).click();
  await expect(page).toHaveURL(`/quy-ket?ngay=${today()}`);
  const cash = page.getByRole("region", { name: "Tổng két trong ngày" });
  await expect(cash.getByText("Tổng thu").locator("..")).toContainText("3.750.000");
  await expect(cash.getByText("Tiền cuối ngày").locator("..")).toContainText("7.500.000");

  // Tháng trước chưa mở két: không có giao dịch, quỹ đầu và cuối kỳ bằng 0.
  await page.goto("/bao-cao");
  await page.getByRole("link", { name: "Tháng trước" }).click();
  await expect(page).toHaveURL(/tu=.*&den=/);
  await expect(page.getByText("Không có giao dịch trong kỳ.")).toBeVisible();
  await expect(tile(page, "Quỹ cuối kỳ")).toHaveText(/\)\s*0$/);

  await page.getByLabel("Từ ngày").fill(today());
  await page.getByLabel("Đến ngày").fill("2026-01-01");
  await page.getByRole("button", { name: "Xem" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Từ ngày phải trước hoặc trùng đến ngày." })).toBeVisible();
});

test("KTV không thấy menu Báo cáo, vào thẳng /bao-cao thì về trang chủ", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Báo Cáo");
  await page.getByLabel("Tên đăng nhập").fill(STAFF.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(page.getByRole("status")).toHaveText(`Đã tạo nhân viên ${STAFF.username}.`);
  await page.getByRole("button", { name: "Đăng xuất" }).click();

  await signIn(page, STAFF.username, STAFF.password);
  await expect(page.getByRole("navigation", { name: "Menu chính" }).getByText("Báo cáo")).toHaveCount(0);
  await page.goto("/bao-cao");
  await expect(page).toHaveURL("/");
});

test("trả góp vào báo cáo (dư nợ, hợp đồng trong kỳ) và cột HĐ tháng này ở trang nhân viên", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/tra-gop/moi");
  await page.getByLabel("Tên khách hàng").fill("Khách Góp Báo Cáo");
  await page.getByLabel("Tiền đưa khách").fill("4.000.000");
  await page.getByLabel("Tổng tiền phải thu").fill("5.000.000");
  await page.getByLabel("Số ngày góp").fill("50");
  await page.getByLabel("Số ngày mỗi kỳ").fill("2");
  await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
  await expect(page).toHaveURL(/\/tra-gop\?moi=TG-1$/);

  await page.goto("/bao-cao");
  const debt = page.getByRole("region", { name: /^Dư nợ hôm nay/ });
  await expect(debt.getByText("Trả góp còn phải thu").locator("+ dd")).toHaveText("5.000.000");
  await expect(debt.getByText("Hợp đồng quá hạn").locator("+ dd")).toHaveText("0 cầm đồ/tín chấp · 0 trả góp");
  // CD-1 (test đầu) + TG-1, cùng tháng này.
  await expect(page.getByRole("region", { name: "Hợp đồng trong kỳ" }).getByText("Mở mới").locator("+ dd")).toHaveText("2");

  await page.goto("/nhan-vien");
  const owner = page.getByRole("row").filter({ has: page.getByRole("cell", { name: OWNER.username, exact: true }) });
  await expect(owner.getByRole("cell").nth(3)).toHaveText("2");
});
