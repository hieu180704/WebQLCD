import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { excelText, xlsxResponse, type XlsxCell } from "./xlsx-stream";

async function* batchesOf(...batches: XlsxCell[][][]) {
  yield* batches;
}

describe("xuất Excel", () => {
  it("chuỗi bắt đầu bằng = + - @ thì thêm dấu nháy", () => {
    for (const bad of ["=1+1", "+84912", "-5", "@SUM(A1)"]) expect(excelText(bad)).toBe(`'${bad}`);
    for (const ok of ["Nguyễn Văn A", "0912", "a=b", ""]) expect(excelText(ok)).toBe(ok);
  });

  it("ghi file đọc lại được: tiêu đề, nhiều lô, ô trống, số giữ kiểu số, chuỗi đã chống công thức", async () => {
    const response = xlsxResponse({
      fileName: "test.xlsx",
      sheetName: "Thử",
      columns: [
        { header: "Tên", width: 10 },
        { header: "Tiền", width: 10, money: true },
      ],
      batches: batchesOf([["=HYPERLINK(\"x\")", 1_500_000]], [["B", null], ["C", -20_000]]),
    });
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="test.xlsx"');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.getWorksheet("Thử")!;
    const rows = sheet.getSheetValues().slice(1).map((row) => (row as unknown[]).slice(1));
    expect(rows).toEqual([
      ["Tên", "Tiền"],
      ["'=HYPERLINK(\"x\")", 1_500_000],
      ["B"],
      ["C", -20_000],
    ]);
  });
});
