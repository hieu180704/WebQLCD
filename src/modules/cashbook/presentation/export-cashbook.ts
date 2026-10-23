import "server-only";
import type { NextRequest } from "next/server";
import { AccessDeniedError, getCashDay, recordExport, requireSession, xlsxResponse, type XlsxColumn } from "@/composition-root";
import type { Money } from "@/shared/kernel/money";
import { resolveCashDate } from "../application/get-cash-day";
import type { CashLine } from "../application/ports";
import { parseCashQuery } from "./cash-query";
import { TYPE_LABEL, formatDateTime, formatTime } from "./cash-summary";

const COLUMNS: XlsxColumn[] = [
  { header: "Ngày", width: 12 },
  { header: "Giờ", width: 8 },
  { header: "Loại", width: 20 },
  { header: "Đã huỷ", width: 8 },
  { header: "Nội dung", width: 48 },
  { header: "Thu", width: 14, money: true },
  { header: "Chi", width: 14, money: true },
  { header: "Người thực hiện", width: 22 },
];

const vnd = (money: Money) => Number(money.toBigInt());
const formatDay = (date: string) => date.split("-").reverse().join("/");

/** Nội dung như cột "Nội dung" ở trang quỹ két: mã hợp đồng, nội dung phiếu, hoặc dòng bị huỷ kèm lý do. */
function lineText(line: CashLine): string | null {
  const code = line.contractId && line.contractCode;
  if (line.reverses) {
    const target = `${TYPE_LABEL[line.reverses.type]}${code ? ` ${code}` : ""}`;
    return `Huỷ "${target}" lúc ${formatDateTime(line.reverses.occurredAt)}${line.note ? ` — lý do: ${line.note}` : ""}`;
  }
  return [code, line.note].filter(Boolean).join(" · ") || null;
}

/** GET `/quy-ket/xuat-excel`: giao dịch một ngày theo bộ lọc đang xem; chỉ chủ tiệm (web-security). */
export async function exportCashbook(request: NextRequest): Promise<Response> {
  const principal = await requireSession({ role: "owner" }).catch((error: unknown) => {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!principal) return new Response("Chỉ chủ tiệm được xuất Excel.", { status: 403 });
  const { ngay, group, nv } = parseCashQuery((key) => request.nextUrl.searchParams.get(key));
  const date = resolveCashDate(ngay);

  await recordExport(principal, "cash");
  const { shopId } = principal;
  async function* rows() {
    for await (const batch of getCashDay.batches(shopId, date, { group, createdBy: nv })) {
      yield batch.map((line) => {
        const income = !line.amount.isNegative();
        return [
          formatDay(date),
          formatTime(line.occurredAt),
          TYPE_LABEL[line.type],
          line.reversed ? "Đã huỷ" : null,
          lineText(line),
          income ? vnd(line.amount) : null,
          income ? null : vnd(line.amount.negate()),
          line.createdByName,
        ];
      });
    }
  }
  return xlsxResponse({ fileName: `quy-ket-${date}.xlsx`, sheetName: "Quỹ két", columns: COLUMNS, batches: rows() });
}
