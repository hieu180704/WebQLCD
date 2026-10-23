import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles } from "./db";

// Trang chủ: 4 ô thống kê hợp đồng + bảng đến hạn (cầm đồ, tín chấp, trả góp). Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_tc_${RUN}`, password: "matkhau123", email: `e2e_tc_${RUN}@example.com` };

test.beforeEach(clearLoginThrottles);

/** Ngày nghiệp vụ (giờ Việt Nam) lùi `days` ngày, dạng YYYY-MM-DD. */
const daysAgo = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

async function createContract(page: Page, kind: "secured" | "unsecured", loanDate: string, prepaid: boolean) {
  await page.goto("/cam-do/moi");
  await page.getByLabel("Tên khách hàng").fill(kind === "secured" ? "Khách Quá Hạn" : "Khách Tín Chấp");
  await page.getByLabel("Loại tài sản").selectOption(kind);
  if (kind === "secured") await page.getByLabel("Tên tài sản").fill("Honda Vision 2022"); // Tín chấp không có ô tài sản.
  await page.getByLabel("Số tiền vay").fill("5.000.000");
  await page.getByLabel("Ngày vay *", { exact: true }).fill(loanDate);
  await page.getByLabel("Lãi *", { exact: true }).fill("3");
  await page.getByLabel("Số ngày vay").fill("30");
  await page.getByLabel("Kỳ lãi").fill("10");
  if (prepaid) await page.getByLabel("Thu lãi trước").check();
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/\/cam-do\?moi=/);
}

async function createInstallment(page: Page, startDate: string) {
  await page.goto("/tra-gop/moi");
  await page.getByLabel("Tên khách hàng").fill("Khách Chậm Góp");
  await page.getByLabel("Tiền đưa khách").fill("4.000.000");
  await page.getByLabel("Tổng tiền phải thu").fill("5.000.000");
  await page.getByLabel("Ngày bắt đầu").fill(startDate);
  await page.getByLabel("Số ngày góp").fill("50");
  await page.getByLabel("Số ngày mỗi kỳ").fill("2");
  await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
  await expect(page).toHaveURL(/\/tra-gop\?moi=TG-1$/);
}

const tile = (page: Page, label: string) => page.getByRole("region", { name: "Thống kê hợp đồng" }).getByText(label).locator("..");

test("thống kê hợp đồng, bảng đến hạn: quá hạn, chậm góp hiện, chưa tới hạn thì không; nút trang chủ trỏ vào bộ lọc", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Trang Chủ E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Trang Chủ");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Không có hợp đồng nào quá hạn hoặc đến hạn trong 3 ngày tới.")).toBeVisible();

  // Thu lãi sau, vay cách đây 15 ngày, kỳ 10 ngày: hạn đã qua 5 ngày.
  await createContract(page, "secured", daysAgo(15), false);
  // Thu lãi trước hôm nay: hạn sau 10 ngày, không vào bảng; lãi trước 150.000 tính vào lãi tháng này.
  await createContract(page, "unsecured", daysAgo(0), true);
  // Trả góp bắt đầu cách đây 15 ngày, 2 ngày một kỳ, chưa góp: kỳ 1 (200.000) đã qua hạn 13 ngày.
  await createInstallment(page, daysAgo(15));

  await page.goto("/");
  await expect(tile(page, "Đang cho vay")).toContainText("15.000.000");
  await expect(tile(page, "Hợp đồng đang mở")).toContainText("3");
  await expect(tile(page, "Hợp đồng đang mở")).toContainText("Cầm đồ 1 · Tín chấp 1 · Trả góp 1");
  await expect(tile(page, "Lãi đã thu tháng này")).toContainText("150.000");
  await expect(tile(page, "Lãi đã thu tháng này")).toContainText("Thu góp tháng này 0");
  await expect(tile(page, "Quá hạn / chậm góp")).toContainText("2");

  const due = page.getByRole("region", { name: "Đến hạn" });
  // Hạn sớm nhất trước: TG-1 (quá 13 ngày) trên CD-1 (quá 5 ngày).
  await expect(due.getByRole("row").nth(1)).toContainText("TG-1");
  const late = due.getByRole("row", { name: /TG-1/ });
  await expect(late).toContainText("Khách Chậm Góp");
  await expect(late).toContainText("Trả góp");
  await expect(late).toContainText("200.000");
  await expect(late).toContainText("Quá 13 ngày");
  await late.getByRole("link", { name: "TG-1" }).click();
  await expect(page).toHaveURL(/\/tra-gop\/[0-9a-f-]+$/);
  await page.goto("/");

  const row = due.getByRole("row", { name: /CD-1/ });
  await expect(row).toContainText("Khách Quá Hạn");
  await expect(row).toContainText("Cầm đồ");
  await expect(row).toContainText("150.000");
  await expect(row).toContainText("Quá 5 ngày");
  await expect(due.getByRole("row", { name: /TC-1/ })).toHaveCount(0);

  await row.getByRole("link", { name: "CD-1" }).click();
  await expect(page).toHaveURL(/\/cam-do\/[0-9a-f-]+$/);
  await page.goto("/");
  await due.getByRole("link", { name: "Tất cả cầm đồ, tín chấp đến hạn" }).click();
  await expect(page).toHaveURL("/cam-do?tt=sap-den-han");
  const contracts = page.getByRole("region", { name: "Danh sách hợp đồng" });
  await expect(contracts.getByRole("row", { name: /CD-1/ })).toBeVisible();
  await expect(contracts.getByRole("row", { name: /TC-1/ })).toHaveCount(0);
  await page.goto("/");
  await due.getByRole("link", { name: "Tất cả trả góp đến hạn" }).click();
  await expect(page).toHaveURL("/tra-gop?tt=sap-den-han");
  await expect(page.getByRole("row", { name: /TG-1/ })).toBeVisible();

  await page.goto("/");
  await tile(page, "Quá hạn / chậm góp").getByRole("link", { name: "Cầm đồ/tín chấp 1" }).click();
  await expect(page).toHaveURL("/cam-do?tt=qua-han");
  await expect(contracts.getByRole("row", { name: /CD-1/ })).toBeVisible();
  await expect(contracts.getByRole("row", { name: /TC-1/ })).toHaveCount(0);

  await page.goto("/");
  await tile(page, "Quá hạn / chậm góp").getByRole("link", { name: "Trả góp 1" }).click();
  await expect(page).toHaveURL("/tra-gop?tt=cham-gop");
  await expect(page.getByRole("row", { name: /TG-1/ })).toBeVisible();
});
