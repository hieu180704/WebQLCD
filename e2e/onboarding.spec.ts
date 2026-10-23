import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles, expireTrial } from "./db";

// Mỗi lần chạy tạo một cửa hàng mới trong DB dev (không xoá được: audit_logs append-only).
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_${RUN}`, password: "matkhau123", email: `e2e_${RUN}@example.com` };
const STAFF = { username: `e2e_ktv_${RUN}`, password: "matkhau456", newPassword: "matkhaumoi789" };

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
const subscription = (page: Page) => page.getByRole("region", { name: "Thuê bao" });

test("đăng ký: tạo cửa hàng dùng thử 7 ngày và đăng nhập luôn", async ({ page }) => {
  await register(page, OWNER.username, OWNER.email);
  await expect(page).toHaveURL("/");
  await expect(subscription(page)).toContainText("Dùng thử: còn 7 ngày");
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
  await page.getByLabel("Mật khẩu", { exact: true }).fill(STAFF.password);
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

const staffRow = (page: Page) => page.getByRole("row").filter({ has: page.getByRole("cell", { name: STAFF.username, exact: true }) });

async function setStaffStatus(page: Page, action: "Khoá" | "Mở khoá") {
  await page.getByRole("button", { name: `${action} KTV Lan`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName(`${action} tài khoản KTV Lan?`);
  await dialog.getByRole("button", { name: action === "Khoá" ? "Khoá tài khoản" : "Mở khoá" }).click();
}

test("chủ tiệm khoá KTV: phiên đang mở của KTV bị đăng xuất, đăng nhập lại bị chặn; mở khoá thì vào lại được", async ({ page, browser }) => {
  const staffContext = await browser.newContext();
  try {
    const staffPage = await staffContext.newPage();
    await signIn(staffPage, STAFF.username, STAFF.password);

    await signIn(page, OWNER.username, OWNER.password);
    await page.goto("/nhan-vien");
    await setStaffStatus(page, "Khoá");
    await expect(page.getByRole("status")).toHaveText("Đã khoá nhân viên, mọi phiên đăng nhập của người đó bị đăng xuất.");
    await expect(staffRow(page)).toContainText("Đã khoá");

    await staffPage.goto("/");
    await expect(staffPage).toHaveURL("/dang-nhap");
    await staffPage.getByLabel("Tên đăng nhập").fill(STAFF.username);
    await staffPage.getByLabel("Mật khẩu").fill(STAFF.password);
    await staffPage.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(formAlert(staffPage)).toHaveText("Tài khoản đã bị vô hiệu hoá. Vui lòng liên hệ chủ tiệm.");

    await setStaffStatus(page, "Mở khoá");
    await expect(page.getByRole("status")).toHaveText("Đã mở khoá nhân viên.");
    await expect(staffRow(page)).toContainText("Đang hoạt động");
    await signIn(staffPage, STAFF.username, STAFF.password);
  } finally {
    await staffContext.close();
  }
});

async function resetStaffPassword(page: Page, password: string) {
  await page.getByRole("button", { name: "Đặt lại mật khẩu KTV Lan", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("Đặt lại mật khẩu — KTV Lan");
  await dialog.getByLabel("Mật khẩu mới").fill(password);
  await dialog.getByRole("button", { name: "Đặt lại" }).click();
}

test("chủ tiệm đặt lại mật khẩu KTV: phiên đang mở bị đăng xuất, mật khẩu cũ hết dùng được", async ({ page, browser }) => {
  const staffContext = await browser.newContext();
  try {
    const staffPage = await staffContext.newPage();
    await signIn(staffPage, STAFF.username, STAFF.password);

    await signIn(page, OWNER.username, OWNER.password);
    await page.goto("/nhan-vien");
    await resetStaffPassword(page, "ngan");
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Mật khẩu tối thiểu 8 ký tự.");
    await page.getByRole("dialog").getByLabel("Mật khẩu mới").fill(STAFF.newPassword);
    await page.getByRole("dialog").getByRole("button", { name: "Đặt lại" }).click();
    await expect(page.getByRole("status")).toHaveText("Đã đặt lại mật khẩu, mọi phiên đăng nhập của nhân viên đó bị đăng xuất.");

    await staffPage.goto("/");
    await expect(staffPage).toHaveURL("/dang-nhap");
    await staffPage.getByLabel("Tên đăng nhập").fill(STAFF.username);
    await staffPage.getByLabel("Mật khẩu").fill(STAFF.password);
    await staffPage.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(formAlert(staffPage)).toHaveText("Sai tên đăng nhập hoặc mật khẩu.");
    await expect(staffPage).toHaveURL("/dang-nhap");
    await signIn(staffPage, STAFF.username, STAFF.newPassword);
  } finally {
    await staffContext.close();
  }
});

async function changeOwnPassword(page: Page, current: string, next: string, confirm = next) {
  await page.getByLabel("Mật khẩu hiện tại").fill(current);
  await page.getByLabel("Mật khẩu mới", { exact: true }).fill(next);
  await page.getByLabel("Nhập lại mật khẩu mới").fill(confirm);
  await page.getByRole("button", { name: "Đổi mật khẩu" }).click();
}

test("KTV tự đổi mật khẩu ở Cài đặt: giữ phiên đang dùng, phiên khác bị đăng xuất", async ({ page, browser }) => {
  const otherContext = await browser.newContext();
  try {
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, STAFF.username, STAFF.newPassword);

    await signIn(page, STAFF.username, STAFF.newPassword);
    await page.getByRole("link", { name: "Cài đặt cửa hàng" }).click();
    await expect(page).toHaveURL("/cai-dat");
    await changeOwnPassword(page, "saimatkhau", STAFF.password);
    await expect(formAlert(page)).toHaveText("Sai mật khẩu hiện tại.");
    await changeOwnPassword(page, STAFF.newPassword, STAFF.password, "khongkhop1");
    await expect(formAlert(page)).toHaveText("Mật khẩu nhập lại không khớp.");
    await changeOwnPassword(page, STAFF.newPassword, STAFF.password);
    await expect(page.getByRole("status")).toHaveText("Đã đổi mật khẩu. Các phiên đăng nhập khác của tài khoản này bị đăng xuất.");

    await page.reload();
    await expect(page).toHaveURL("/cai-dat");
    await otherPage.goto("/");
    await expect(otherPage).toHaveURL("/dang-nhap");
    await signIn(otherPage, STAFF.username, STAFF.password);
  } finally {
    await otherContext.close();
  }
});

test("hết hạn dùng thử: báo chỉ xem, không tạo thêm KTV được", async ({ page }) => {
  await expireTrial(OWNER.username);
  await signIn(page, OWNER.username, OWNER.password);
  await expect(subscription(page)).toContainText("hết hạn sử dụng");
  await page.goto("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Hết Hạn");
  await page.getByLabel("Tên đăng nhập").fill(`${STAFF.username}_2`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(formAlert(page)).toHaveText("Cửa hàng đã hết hạn sử dụng, không tạo thêm nhân viên được.");
  await expect(page.getByRole("cell", { name: `${STAFF.username}_2` })).toHaveCount(0);
});

test("hết hạn dùng thử: vẫn đặt lại mật khẩu và khoá được KTV, không mở khoá được", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/nhan-vien");
  await resetStaffPassword(page, STAFF.password);
  await expect(page.getByRole("status")).toHaveText("Đã đặt lại mật khẩu, mọi phiên đăng nhập của nhân viên đó bị đăng xuất.");
  await setStaffStatus(page, "Khoá");
  await expect(staffRow(page)).toContainText("Đã khoá");
  await setStaffStatus(page, "Mở khoá");
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Cửa hàng đã hết hạn sử dụng, không mở khoá nhân viên được.");
  await page.reload();
  await expect(staffRow(page)).toContainText("Đã khoá");
});

test("hết hạn dùng thử: chủ tiệm vẫn tự đổi được mật khẩu", async ({ page }) => {
  await signIn(page, OWNER.username, OWNER.password);
  await page.goto("/cai-dat");
  await changeOwnPassword(page, OWNER.password, "matkhauchu456");
  await expect(page.getByRole("status")).toHaveText("Đã đổi mật khẩu. Các phiên đăng nhập khác của tài khoản này bị đăng xuất.");
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
