import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Khách hàng: danh sách, tìm không dấu, tìm CCCD, lọc. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_kh_${RUN}`, password: "matkhau123", email: `e2e_kh_${RUN}@example.com` };
const CCCD = "001099012345";
const STAFF = { username: `e2e_kh_ktv_${RUN}`, password: "matkhau456" };

// Test sau dùng cửa hàng và hợp đồng test đầu tạo.
test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

/** Ngày nghiệp vụ (giờ Việt Nam) lùi `days` ngày, dạng YYYY-MM-DD. */
const daysAgo = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

async function createContract(page: Page, name: string, cccd: string, loanDate: string) {
  await page.goto("/cam-do/moi");
  await page.getByLabel("Tên khách hàng").fill(name);
  await page.getByLabel("Số CCCD").fill(cccd);
  await page.getByLabel("Số điện thoại").fill("0912345678");
  await page.getByLabel("Tên tài sản").fill("Honda Vision 2022");
  await page.getByLabel("Số tiền vay").fill("5.000.000");
  await page.getByLabel("Ngày vay *", { exact: true }).fill(loanDate);
  await page.getByLabel("Lãi *", { exact: true }).fill("3");
  await page.getByLabel("Số ngày vay").fill("30");
  await page.getByLabel("Kỳ lãi").fill("10");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/\/cam-do\?moi=/);
}

async function signIn(page: Page, account: { username: string; password: string } = OWNER) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(account.username);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

const list = (page: Page) => page.getByRole("region", { name: "Danh sách khách hàng" });

async function search(page: Page, fields: { q?: string; cccd?: string; loc?: string }) {
  const form = page.getByRole("search");
  await form.getByLabel("Tìm kiếm").fill(fields.q ?? "");
  await form.getByLabel("Số CCCD").fill(fields.cccd ?? "");
  await form.getByLabel("Lọc", { exact: true }).selectOption(fields.loc ?? "");
  await form.getByRole("button", { name: "Lọc" }).click();
}

test("danh sách khách: số liệu hợp đồng, tìm không dấu, tìm CCCD, lọc quá hạn", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Khách Hàng E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Khách Hàng");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");

  // Bình: thu lãi sau, vay cách đây 15 ngày, kỳ 10 ngày → quá hạn. Hoa: vay hôm nay.
  await createContract(page, "Nguyễn Văn Bình", CCCD, daysAgo(15));
  await createContract(page, "Đặng Thị Hoa", "001099054321", daysAgo(0));

  await page.goto("/");
  await page.getByRole("link", { name: "Khách hàng" }).click();
  await expect(page).toHaveURL("/khach-hang");
  await expect(page.getByText("2 khách hàng · 2 khách đang có hợp đồng mở")).toBeVisible();
  const binh = list(page).getByRole("row", { name: /Nguyễn Văn Bình/ });
  await expect(binh).toContainText("091****678");
  await expect(binh).toContainText("********2345");
  await expect(binh).toContainText("1 quá hạn");
  await expect(binh).toContainText("5.000.000");

  await search(page, { q: "nguyen van" });
  await expect(page).toHaveURL(/q=nguyen\+van/);
  await expect(list(page).getByRole("row", { name: /Nguyễn Văn Bình/ })).toBeVisible();
  await expect(list(page).getByRole("row", { name: /Đặng Thị Hoa/ })).toHaveCount(0);

  await search(page, { cccd: "0010 9905 4321" });
  await expect(page).toHaveURL(/cccd=0010/);
  await expect(list(page).getByRole("row", { name: /Đặng Thị Hoa/ })).toBeVisible();
  await expect(list(page).getByRole("row", { name: /Nguyễn Văn Bình/ })).toHaveCount(0);

  await search(page, { cccd: "12345" });
  await expect(page).toHaveURL(/cccd=12345/);
  await expect(list(page).getByRole("alert")).toHaveText("Số CCCD phải đủ 12 số (hoặc CMND 9 số).");

  await search(page, { loc: "qua-han" });
  await expect(page).toHaveURL(/loc=qua-han/);
  await expect(list(page).getByRole("row", { name: /Nguyễn Văn Bình/ })).toBeVisible();
  await expect(list(page).getByRole("row", { name: /Đặng Thị Hoa/ })).toHaveCount(0);

  await page.getByRole("link", { name: "Bỏ lọc" }).click();
  await expect(page).toHaveURL("/khach-hang");
  await expect(list(page).getByRole("row", { name: /Đặng Thị Hoa/ })).toBeVisible();
});

test("chi tiết khách: số liệu, hợp đồng, giao dịch; tên khách ở /cam-do và chi tiết hợp đồng là link", async ({ page }) => {
  await signIn(page);

  await page.goto("/khach-hang");
  await list(page).getByRole("link", { name: "Nguyễn Văn Bình" }).click();
  await expect(page).toHaveURL(/\/khach-hang\/[0-9a-f-]{36}$/);
  const customerUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: "Nguyễn Văn Bình" })).toBeVisible();
  await expect(page.getByText("1 hợp đồng quá hạn")).toBeVisible();
  const stats = page.getByRole("region", { name: "Số liệu" });
  await expect(stats).toContainText("HĐ đang mở1");
  await expect(stats).toContainText("Dư nợ hiện tại5.000.000");
  await expect(stats).toContainText("Tổng lãi đã đóng0");
  const info = page.getByRole("region", { name: "Thông tin khách" });
  await expect(info).toContainText("0912345678");
  await expect(info).toContainText("********2345");
  await expect(page.getByRole("region", { name: "Giao dịch gần đây" }).getByRole("row", { name: /Giải ngân, tạo hợp đồng/ })).toContainText(
    "5.000.000",
  );
  const contract = page.getByRole("region", { name: "Hợp đồng của khách" }).getByRole("row", { name: /Honda Vision 2022/ });
  await expect(contract).toContainText("Quá");

  await contract.getByRole("link").click();
  await expect(page).toHaveURL(/\/cam-do\/[0-9a-f-]{36}$/);
  await page.getByRole("region", { name: "Khách hàng" }).getByRole("link", { name: "Nguyễn Văn Bình" }).click();
  await expect(page).toHaveURL(customerUrl);

  await page.goto("/cam-do");
  await page.getByRole("link", { name: "Đặng Thị Hoa" }).click();
  await expect(page).toHaveURL(/\/khach-hang\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Đặng Thị Hoa" })).toBeVisible();
});

test("sửa thông tin khách: CCCD trùng khách khác bị từ chối, CCCD để trống giữ nguyên; chủ tiệm xem CCCD đầy đủ", async ({ page }) => {
  await signIn(page);
  await page.goto("/khach-hang");
  await list(page).getByRole("link", { name: "Nguyễn Văn Bình" }).click();
  await expect(page).toHaveURL(/\/khach-hang\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Sửa thông tin" }).click();
  const dialog = page.getByRole("dialog", { name: "Sửa thông tin khách" });
  await dialog.getByLabel("Số CCCD").fill("001099054321"); // CCCD của Hoa
  await dialog.getByRole("button", { name: "Lưu" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Số CCCD này đã thuộc một khách hàng khác trong cửa hàng.");

  await dialog.getByLabel("Số CCCD").fill("");
  await dialog.getByLabel("Địa chỉ").fill("34 Lê Lợi, Q.1");
  await dialog.getByLabel("Số điện thoại").fill("0987 654 321");
  await dialog.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã lưu thông tin khách hàng.");
  const info = page.getByRole("region", { name: "Thông tin khách" });
  await expect(info).toContainText("34 Lê Lợi, Q.1");
  await expect(info).toContainText("0987654321");
  await expect(info).toContainText("********2345");

  await info.getByRole("button", { name: "Hiện số đầy đủ" }).click();
  await expect(info).toContainText(CCCD);
  await expect(info.getByRole("button", { name: "Hiện số đầy đủ" })).toHaveCount(0);
});

test("KTV xem trang khách thấy CCCD đã che, không có nút xem số đầy đủ", async ({ page }) => {
  await signIn(page);
  await page.goto("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Khách");
  await page.getByLabel("Tên đăng nhập").fill(STAFF.username);
  await page.getByLabel("Mật khẩu").fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(page.getByRole("status")).toHaveText(`Đã tạo nhân viên ${STAFF.username}.`);
  await page.getByRole("button", { name: "Đăng xuất" }).click();

  await signIn(page, STAFF);
  await page.goto("/khach-hang");
  await list(page).getByRole("link", { name: "Nguyễn Văn Bình" }).click();
  await expect(page).toHaveURL(/\/khach-hang\/[0-9a-f-]{36}$/);
  const info = page.getByRole("region", { name: "Thông tin khách" });
  await expect(info).toContainText("********2345");
  await expect(info.getByRole("button", { name: "Hiện số đầy đủ" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sửa thông tin" })).toBeVisible();
});

test("/cam-do: tìm tên không dấu, tìm tài sản, CCCD, lọc loại, bỏ lọc", async ({ page }) => {
  await signIn(page);
  await page.goto("/cam-do");
  const contracts = page.getByRole("region", { name: "Danh sách hợp đồng" });
  const form = page.getByRole("search");

  await form.getByLabel("Tìm kiếm").fill("dang thi");
  await form.getByRole("button", { name: "Lọc" }).click();
  await expect(page).toHaveURL(/q=dang\+thi/);
  await expect(contracts.getByRole("row", { name: /Đặng Thị Hoa/ })).toBeVisible();
  await expect(contracts.getByRole("row", { name: /Nguyễn Văn Bình/ })).toHaveCount(0);

  await form.getByLabel("Tìm kiếm").fill("HONDA vision");
  await form.getByLabel("Số CCCD").fill(CCCD);
  await form.getByRole("button", { name: "Lọc" }).click();
  await expect(page).toHaveURL(/cccd=001099012345/);
  await expect(contracts.getByRole("row", { name: /Nguyễn Văn Bình/ })).toBeVisible();
  await expect(contracts.getByRole("row", { name: /Đặng Thị Hoa/ })).toHaveCount(0);

  await form.getByLabel("Loại").selectOption("tin-chap");
  await form.getByRole("button", { name: "Lọc" }).click();
  await expect(page).toHaveURL(/loai=tin-chap/);
  await expect(contracts.getByText("Không tìm thấy hợp đồng phù hợp.")).toBeVisible();

  await page.getByRole("link", { name: "Bỏ lọc" }).click();
  await expect(page).toHaveURL("/cam-do");
  await expect(contracts.getByRole("row", { name: /Đặng Thị Hoa/ })).toBeVisible();
});
