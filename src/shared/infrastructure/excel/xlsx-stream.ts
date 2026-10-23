import "server-only";
import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";

/** Ô Excel: chuỗi (đã chống công thức khi ghi), số, hoặc để trống. */
export type XlsxCell = string | number | null;

/** `money`: cột tiền VND, định dạng có dấu phân cách nghìn. */
export type XlsxColumn = { header: string; width: number; money?: boolean };

export type XlsxSheet = {
  fileName: string;
  sheetName: string;
  columns: XlsxColumn[];
  /** Từng lô dòng đọc theo keyset; mỗi lô ghi xong mới đọc lô sau. */
  batches: AsyncIterable<XlsxCell[][]>;
};

const FORMULA_START = /^[=+\-@]/;

/** Chống formula injection (web-security): chuỗi bắt đầu bằng `=`, `+`, `-`, `@` thì thêm `'` phía trước. */
export function excelText(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/**
 * File .xlsx ghi streaming (web-performance: không dựng cả file trong RAM). Mỗi dòng commit ngay vào zip;
 * client tải chậm thì chờ luồng ra rút bớt rồi mới đọc lô tiếp theo.
 */
export function xlsxResponse(sheet: XlsxSheet): Response {
  const output = new PassThrough();
  void writeWorkbook(sheet, output).catch((error: unknown) => output.destroy(error instanceof Error ? error : new Error("xlsx")));
  return new Response(Readable.toWeb(output) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${sheet.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function writeWorkbook({ sheetName, columns, batches }: XlsxSheet, output: PassThrough) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true, useSharedStrings: false });
  const worksheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = columns.map(({ header, width, money }) => ({ header, width, style: money ? { numFmt: "#,##0" } : {} }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).commit();
  for await (const batch of batches) {
    for (const cells of batch) {
      worksheet.addRow(cells.map((cell) => (typeof cell === "string" ? excelText(cell) : cell))).commit();
    }
    if (output.writableNeedDrain) await drainOrClose(output);
    // Người dùng huỷ tải: dừng đọc DB.
    if (output.destroyed) return;
  }
  worksheet.commit();
  await workbook.commit();
}

const drainOrClose = (stream: PassThrough) =>
  new Promise<void>((resolve) => {
    const done = () => {
      stream.off("drain", done);
      stream.off("close", done);
      resolve();
    };
    stream.on("drain", done);
    stream.on("close", done);
  });
