import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Khách hàng: danh sách, tìm không dấu, tìm CCCD, lọc. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_kh_${RUN}`, password: "matkhau123", email: `e2e_kh_${RUN}@example.com` };
const CCCD = "001099012345";

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
