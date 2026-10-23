import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Cài đặt cửa hàng: thông tin cửa hàng, mặc định khi tạo hợp đồng. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_cd_${RUN}`, password: "matkhau123", email: `e2e_cd_${RUN}@example.com` };
const STAFF = { username: `e2e_cd_ktv_${RUN}`, password: "matkhau456" };

// Test sau dùng cửa hàng và KTV test đầu tạo.
test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

async function signIn(page: Page, account: { username: string; password: string } = OWNER) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(account.username);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

const shopSection = (page: Page) => page.getByRole("region", { name: "Thông tin cửa hàng" });

test("chủ tiệm sửa thông tin cửa hàng: tên mới hiện trên đầu trang, tên trống bị từ chối", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Cài Đặt E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Cài Đặt");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: "Nhân viên" }).click();
  await expect(page).toHaveURL("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Cài Đặt");
  await page.getByLabel("Tên đăng nhập").fill(STAFF.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(page.getByRole("status")).toHaveText(`Đã tạo nhân viên ${STAFF.username}.`);

  await page.getByRole("link", { name: "Cài đặt cửa hàng" }).click();
  await expect(page).toHaveURL("/cai-dat");
  const section = shopSection(page);
  await expect(section.getByLabel("Tên cửa hàng")).toHaveValue("Tiệm Cài Đặt E2E");

  await section.getByLabel("Tên cửa hàng").fill("   ");
  await section.getByLabel("Số điện thoại").fill("0283 456 789");
  await section.getByRole("button", { name: "Lưu thông tin" }).click();
  await expect(section.getByRole("alert")).toHaveText("Nhập tên cửa hàng.");
  await expect(section.getByLabel("Số điện thoại")).toHaveValue("0283 456 789");

  await section.getByLabel("Tên cửa hàng").fill("Cầm đồ Minh Phát E2E");
  await section.getByLabel("Địa chỉ").fill("215 Hai Bà Trưng, Q. 3, TP.HCM");
  await section.getByRole("button", { name: "Lưu thông tin" }).click();
  await expect(section.getByRole("status")).toHaveText("Đã lưu thông tin cửa hàng.");
  await expect(page.getByText("Cầm đồ Minh Phát E2E", { exact: true })).toBeVisible();

  await page.reload();
  await expect(shopSection(page).getByLabel("Số điện thoại")).toHaveValue("0283 456 789");
  await expect(shopSection(page).getByLabel("Địa chỉ")).toHaveValue("215 Hai Bà Trưng, Q. 3, TP.HCM");
});

test("KTV chỉ thấy mục Tài khoản của tôi ở trang Cài đặt", async ({ page }) => {
  await signIn(page, STAFF);
  await page.goto("/cai-dat");
  await expect(page.getByRole("heading", { name: "Tài khoản của tôi" })).toBeVisible();
  await expect(shopSection(page)).toHaveCount(0);
  await expect(page.getByText("Cầm đồ Minh Phát E2E", { exact: true })).toBeVisible();
});

const defaultsSection = (page: Page) => page.getByRole("region", { name: "Mặc định khi tạo hợp đồng" });

test("chủ tiệm đặt mặc định khi tạo hợp đồng: form /cam-do/moi điền sẵn, kỳ lãi dài hơn số ngày vay bị từ chối", async ({ page }) => {
  await signIn(page);
  await page.goto("/cam-do/moi");
  await expect(page.getByLabel("Hình thức lãi")).toHaveValue("per_million_per_day");
  await expect(page.getByLabel("Lãi *", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Số ngày vay")).toHaveValue("30");

  await page.goto("/cai-dat");
  const section = defaultsSection(page);
  await section.getByLabel("Hình thức lãi").selectOption("percent_per_month");
  await section.getByLabel("Lãi", { exact: true }).fill("1,5");
  await section.getByLabel("Số ngày vay").fill("20");
  await section.getByLabel("Kỳ lãi (ngày)").fill("30");
  await section.getByRole("button", { name: "Lưu mặc định" }).click();
  await expect(section.getByRole("alert")).toHaveText("Kỳ lãi không được dài hơn số ngày vay.");
  await expect(section.getByLabel("Lãi", { exact: true })).toHaveValue("1,5");
  await expect(section.getByLabel("Hình thức lãi")).toHaveValue("percent_per_month");

  await section.getByLabel("Số ngày vay").fill("60");
  await section.getByLabel("Kỳ lãi (ngày)").fill("15");
  await section.getByLabel('Mặc định bật "Thu lãi trước"').check();
  await section.getByRole("button", { name: "Lưu mặc định" }).click();
  await expect(section.getByRole("status")).toHaveText("Đã lưu mặc định.");

  await page.goto("/cam-do/moi");
  await expect(page.getByLabel("Hình thức lãi")).toHaveValue("percent_per_month");
  await expect(page.getByLabel("Lãi *", { exact: true })).toHaveValue("1,5");
  await expect(page.getByLabel("Số ngày vay")).toHaveValue("60");
  await expect(page.getByLabel("Kỳ lãi")).toHaveValue("15");
  await expect(page.getByLabel("Thu lãi trước")).toBeChecked();
});
