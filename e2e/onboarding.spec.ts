import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles, expireTrial } from "./db";

// Mỗi lần chạy tạo một cửa hàng mới trong DB dev (không xoá được: audit_logs append-only).
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_${RUN}`, password: "matkhau123", email: `e2e_${RUN}@example.com` };
const STAFF = { username: `e2e_ktv_${RUN}`, password: "matkhau456" };

test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

async function register(page: Page, username: string, email: string) {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Tiệm E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Tên đăng nhập").fill(username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
}

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(username);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

const formAlert = (page: Page) => page.locator("form").getByRole("alert");

test("đăng ký: tạo cửa hàng dùng thử 7 ngày và đăng nhập luôn", async ({ page }) => {
  await register(page, OWNER.username, OWNER.email);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("status")).toContainText("Dùng thử: còn 7 ngày");
});

test("đăng ký trùng tên đăng nhập: báo lỗi, giữ lại giá trị đã nhập", async ({ page }) => {
  await register(page, OWNER.username.toUpperCase(), `khac_${OWNER.email}`);
  await expect(formAlert(page)).toHaveText("Tên đăng nhập đã có người dùng.");
  await expect(page.getByLabel("Tên cửa hàng")).toHaveValue("Tiệm E2E");
  await expect(page).toHaveURL("/dang-ky");
});

test("chủ tiệm tạo KTV; KTV đăng nhập được nhưng không vào được trang nhân viên", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.getByRole("link", { name: "Nhân viên" }).click();
  await expect(page).toHaveURL("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Lan");
  await page.getByLabel("Tên đăng nhập").fill(STAFF.username);
  await page.getByLabel("Mật khẩu").fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(page.getByRole("status")).toHaveText(`Đã tạo nhân viên ${STAFF.username}.`);
  await expect(page.getByRole("cell", { name: STAFF.username })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await signIn(page, STAFF.username, STAFF.password);
  await expect(page.getByRole("link", { name: "Nhân viên" })).toHaveCount(0);
  await page.goto("/nhan-vien");
  await expect(page).toHaveURL("/");
});

test("hết hạn dùng thử: báo chỉ xem, không tạo thêm KTV được", async ({ page }) => {
  await expireTrial(OWNER.username);
  await signIn(page, OWNER.username, OWNER.password);
  await expect(page.getByRole("status")).toContainText("hết hạn sử dụng");
  await page.goto("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Hết Hạn");
  await page.getByLabel("Tên đăng nhập").fill(`${STAFF.username}_2`);
  await page.getByLabel("Mật khẩu").fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(formAlert(page)).toHaveText("Cửa hàng đã hết hạn sử dụng, không tạo thêm nhân viên được.");
  await expect(page.getByRole("cell", { name: `${STAFF.username}_2` })).toHaveCount(0);
});

test("đăng ký quá 5 lần trong 1 giờ từ một IP thì bị chặn", async ({ page }) => {
  // Lần gửi bị trùng tên đăng nhập vẫn tính lượt, nên không cần tạo cửa hàng thật.
  for (let i = 0; i < 5; i++) {
    await register(page, OWNER.username, `lan${i}_${OWNER.email}`);
    await expect(formAlert(page)).toHaveText("Tên đăng nhập đã có người dùng.");
  }
  await register(page, OWNER.username, `lan5_${OWNER.email}`);
  await expect(formAlert(page)).toHaveText("Đăng ký quá nhiều lần từ mạng này. Vui lòng thử lại sau 1 giờ.");
});
