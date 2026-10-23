import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { clearLoginThrottles, countAudit } from "./db";

// Xuất Excel theo bộ lọc đang xem. Mỗi lần chạy tạo một cửa hàng mới trong DB dev.
const RUN = Date.now().toString(36);
const OWNER = { username: `e2e_xl_${RUN}`, password: "matkhau123", email: `e2e_xl_${RUN}@example.com` };
const STAFF = { username: `e2e_xl_ktv_${RUN}`, password: "matkhau456" };

// Test sau dùng cửa hàng, hợp đồng, KTV test đầu tạo.
test.describe.configure({ mode: "serial" });
test.beforeEach(clearLoginThrottles);

async function signIn(page: Page, account: { username: string; password: string } = OWNER) {
  await page.goto("/dang-nhap");
  await page.getByLabel("Tên đăng nhập").fill(account.username);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL("/");
}

async function createContract(page: Page, name: string, cccd: string, asset: string) {
  await page.goto("/cam-do/moi");
  await page.getByLabel("Tên khách hàng").fill(name);
  await page.getByLabel("Số CCCD").fill(cccd);
  await page.getByLabel("Số điện thoại").fill("0912345678");
  await page.getByLabel("Tên tài sản").fill(asset);
  await page.getByLabel("Số tiền vay").fill("5.000.000");
  await page.getByLabel("Lãi *", { exact: true }).fill("3");
  await page.getByLabel("Số ngày vay").fill("30");
  await page.getByLabel("Kỳ lãi").fill("10");
  await page.getByRole("button", { name: "Lưu hợp đồng và giải ngân" }).click();
  await expect(page).toHaveURL(/\/cam-do\?moi=/);
}

/** Bấm "Xuất Excel", đọc lại file tải về: mảng dòng (dòng đầu là tiêu đề). */
async function download(page: Page): Promise<{ fileName: string; rows: unknown[][] }> {
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Xuất Excel" }).click()]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(await file.path());
  const rows = workbook.worksheets[0].getSheetValues().slice(1).map((row) => (row as unknown[]).slice(1));
  return { fileName: file.suggestedFilename(), rows };
}

test("/cam-do: chủ tiệm xuất đúng bộ lọc, CCCD 4 số cuối, SĐT đã che, chống công thức, ghi nhật ký", async ({ page }) => {
  await page.goto("/dang-ky");
  await page.getByLabel("Tên cửa hàng").fill("Tiệm Excel E2E");
  await page.getByLabel("Họ tên chủ tiệm").fill("Chủ Excel");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Tên đăng nhập").fill(OWNER.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(OWNER.password);
  await page.getByLabel("Nhập lại mật khẩu").fill(OWNER.password);
  await page.getByRole("button", { name: "Đăng ký dùng thử 7 ngày" }).click();
  await expect(page).toHaveURL("/");

  await createContract(page, "Nguyễn Văn Bình", "001099012345", "=HYPERLINK(\"http://x\")");
  await createContract(page, "Đặng Thị Hoa", "001099054321", "Honda Vision");

  // Lọc theo tên: file chỉ có hợp đồng đang xem.
  await page.goto("/cam-do?q=binh");
  const { fileName, rows } = await download(page);
  expect(fileName).toMatch(/^cam-do-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(rows[0]).toEqual(expect.arrayContaining(["Mã HĐ", "Khách hàng", "CCCD (4 số cuối)", "Tiền vay"]));
  expect(rows).toHaveLength(2);
  const [code, name, phone, cccd, kind, asset, principal] = rows[1];
  expect([code, name, phone, cccd, kind, asset, principal]).toEqual([
    "CD-1",
    "Nguyễn Văn Bình",
    "091****678",
    "********2345",
    "Thế chấp",
    "'=HYPERLINK(\"http://x\")",
    5_000_000,
  ]);
  expect(await countAudit(OWNER.username, "contract", "export")).toBe(1);

  // Không lọc: đủ cả hai hợp đồng.
  await page.goto("/cam-do");
  expect((await download(page)).rows).toHaveLength(3);
});

test("/tra-gop: xuất đúng bộ lọc, tiến độ, còn phải thu, tên khách bắt đầu bằng @ được chống công thức", async ({ page }) => {
  await signIn(page);
  for (const [name, cccd] of [
    ["@Lê Văn Cường", "001099077777"],
    ["Phạm Thị Dung", "001099088888"],
  ]) {
    await page.goto("/tra-gop/moi");
    await page.getByLabel("Tên khách hàng").fill(name);
    await page.getByLabel("Số CCCD").fill(cccd);
    await page.getByLabel("Số điện thoại").fill("0938214552");
    await page.getByLabel("Tiền đưa khách").fill("4.000.000");
    await page.getByLabel("Tổng tiền phải thu").fill("5.000.000");
    await page.getByLabel("Số ngày góp").fill("50");
    await page.getByLabel("Số ngày mỗi kỳ").fill("2");
    await page.getByRole("button", { name: "Lưu hợp đồng" }).click();
    await expect(page).toHaveURL(/\/tra-gop\?moi=TG-\d+$/);
  }

  await page.goto("/tra-gop?cccd=001099077777");
  const { fileName, rows } = await download(page);
  expect(fileName).toMatch(/^tra-gop-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toEqual(expect.arrayContaining(["Mã HĐ", "Còn phải thu", "Tiến độ"]));
  const row = rows[1];
  expect(row.slice(0, 4)).toEqual(["TG-1", "'@Lê Văn Cường", "093****552", "********7777"]);
  expect(row.slice(5, 11)).toEqual([4_000_000, 5_000_000, 0, 5_000_000, "0 / 25 kỳ", 200_000]);
  expect(row[11]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  expect(row[12]).toBe("Đúng hạn");
  expect(await countAudit(OWNER.username, "installment_contract", "export")).toBe(1);
});

test("/quy-ket: xuất giao dịch trong ngày theo loại, thu / chi tách cột, nội dung phiếu được chống công thức", async ({ page }) => {
  await signIn(page);
  await page.goto("/quy-ket");
  await page.getByRole("button", { name: "− Chi khác" }).click();
  const dialog = page.getByRole("dialog", { name: "Phiếu chi khác" });
  await dialog.getByLabel("Số tiền").fill("150.000");
  await dialog.getByLabel(/Nội dung|Ghi chú/).fill("-Tiền điện");
  await dialog.getByRole("button", { name: "Lưu phiếu chi" }).click();
  await expect(page.getByRole("row", { name: /Chi khác.*-Tiền điện.*150\.000/ })).toBeVisible();

  // Lọc "Chi khác": file chỉ có phiếu chi, không có các dòng giải ngân trong ngày.
  const filter = page.getByRole("form", { name: "Lọc giao dịch" });
  await filter.getByLabel("Loại giao dịch").selectOption({ label: "Chi khác" });
  await filter.getByRole("button", { name: "Lọc" }).click();
  await expect(page).toHaveURL(/loai=chi-khac/);
  const { fileName, rows } = await download(page);
  expect(fileName).toMatch(/^quy-ket-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(rows[0]).toEqual(["Ngày", "Giờ", "Loại", "Đã huỷ", "Nội dung", "Thu", "Chi", "Người thực hiện"]);
  expect(rows).toHaveLength(2);
  const [, , type, reversed, note, income, expense, actor] = rows[1];
  expect([type, reversed, note, income, expense, actor]).toEqual(["Chi khác", undefined, "'-Tiền điện", undefined, 150_000, "Chủ Excel"]);

  // Không lọc: đủ 4 dòng giải ngân (2 cầm đồ, 2 trả góp) + phiếu chi; giải ngân ở cột Chi kèm mã hợp đồng.
  await page.goto("/quy-ket");
  const all = (await download(page)).rows;
  expect(all).toHaveLength(6);
  expect(all.filter((row) => row[2] === "Giải ngân").map((row) => [row[4], row[6]])).toEqual([
    ["CD-2", 5_000_000],
    ["CD-1", 5_000_000],
  ]);
  expect(await countAudit(OWNER.username, "cash", "export")).toBe(2);
});

test("KTV không thấy nút Xuất Excel và bị chặn khi gọi thẳng", async ({ page }) => {
  await signIn(page);
  await page.goto("/nhan-vien");
  await page.getByLabel("Họ tên nhân viên").fill("KTV Excel");
  await page.getByLabel("Tên đăng nhập").fill(STAFF.username);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(STAFF.password);
  await page.getByRole("button", { name: "Tạo nhân viên" }).click();
  await expect(page.getByRole("status")).toHaveText(`Đã tạo nhân viên ${STAFF.username}.`);
  await page.getByRole("button", { name: "Đăng xuất" }).click();

  await signIn(page, STAFF);
  for (const list of ["/cam-do", "/tra-gop", "/quy-ket"]) {
    await page.goto(list);
    await expect(page.getByRole("link", { name: "Xuất Excel" })).toHaveCount(0);
    expect((await page.request.get(`${list}/xuat-excel`)).status()).toBe(403);
  }
});
