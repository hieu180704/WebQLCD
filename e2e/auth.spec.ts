import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles, countIpThrottles, setUserActive } from "./db";

const USERNAME = "chutiem";
const PASSWORD = process.env.SEED_OWNER_PASSWORD ?? "matkhau123";

test.beforeEach(clearLoginThrottles);

async function signIn(page: Page, username: string, password: string) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(username);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

test("chưa đăng nhập thì bị chuyển về /dang-nhap", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/dang-nhap");
});

test("đăng nhập đúng: cookie phiên HttpOnly, Secure, SameSite=Lax; đăng xuất xoá phiên", async ({ page }) => {
  const signInResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/dang-nhap"));
  await signIn(page, USERNAME.toUpperCase(), PASSWORD);
  const setCookie = (await (await signInResponse).headerValue("set-cookie")) ?? "";
  const sessionCookie = setCookie.split("\n").find((c) => c.startsWith("__Secure-better-auth.session_token="));
  expect(sessionCookie).toBeDefined();
  expect(sessionCookie).toMatch(/;\s*HttpOnly/i);
  expect(sessionCookie).toMatch(/;\s*Secure/i);
  expect(sessionCookie).toMatch(/;\s*SameSite=Lax/i);

  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL("/dang-nhap");
  await page.goto("/");
  await expect(page).toHaveURL("/dang-nhap");
});

test("sai mật khẩu báo lỗi chung", async ({ page }) => {
  await signIn(page, USERNAME, "saimatkhau");
  await expect(page.locator("form").getByRole("alert")).toHaveText("Sai tên đăng nhập hoặc mật khẩu.");
  await expect(page).toHaveURL("/dang-nhap");
});

test("sai 5 lần thì lần thứ 6 bị khoá, kể cả mật khẩu đúng", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await signIn(page, USERNAME, `saimatkhau${i}`);
    await expect(page.locator("form").getByRole("alert")).toHaveText("Sai tên đăng nhập hoặc mật khẩu.");
  }
  await signIn(page, USERNAME, PASSWORD);
  await expect(page.locator("form").getByRole("alert")).toHaveText("Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.");
  await expect(page).toHaveURL("/dang-nhap");
  // Lớp IP cũng phải đếm được: server production phải xác định được IP người gọi.
  expect(await countIpThrottles()).toBe(1);
});

test("tài khoản bị vô hiệu hoá không tạo được phiên", async ({ page }) => {
  await setUserActive(USERNAME, false);
  try {
    await signIn(page, USERNAME, PASSWORD);
    await expect(page.locator("form").getByRole("alert")).toHaveText("Tài khoản đã bị vô hiệu hoá. Vui lòng liên hệ chủ tiệm.");
    await page.goto("/");
    await expect(page).toHaveURL("/dang-nhap");
  } finally {
    await setUserActive(USERNAME, true);
  }
});
