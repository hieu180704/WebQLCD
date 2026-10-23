import "server-only";
import type { NextRequest } from "next/server";
import { AccessDeniedError, listInstallments, recordExport, requireSession, xlsxResponse, type XlsxColumn } from "@/composition-root";
import { businessDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { dueLabel, formatDay } from "./format";
import { parseInstallmentQuery } from "./installment-query";

const COLUMNS: XlsxColumn[] = [
  { header: "Mã HĐ", width: 12 },
  { header: "Khách hàng", width: 26 },
  { header: "SĐT", width: 14 },
  { header: "CCCD (4 số cuối)", width: 16 },
  { header: "Ngày bắt đầu", width: 12 },
  { header: "Tiền đưa khách", width: 15, money: true },
  { header: "Tổng phải thu", width: 15, money: true },
  { header: "Đã thu", width: 15, money: true },
  { header: "Còn phải thu", width: 15, money: true },
  { header: "Tiến độ", width: 12 },
  { header: "Mỗi kỳ", width: 13, money: true },
  { header: "Kỳ tới", width: 12 },
  { header: "Trạng thái", width: 14 },
];

const vnd = (money: Money) => Number(money.toBigInt());

/** GET `/tra-gop/xuat-excel`: danh sách hợp đồng trả góp theo bộ lọc đang xem; chỉ chủ tiệm (web-security). */
export async function exportInstallments(request: NextRequest): Promise<Response> {
  const principal = await requireSession({ role: "owner" }).catch((error: unknown) => {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!principal) return new Response("Chỉ chủ tiệm được xuất Excel.", { status: 403 });
  const { filter, invalidCccd } = parseInstallmentQuery((key) => request.nextUrl.searchParams.get(key));
  if (invalidCccd) return new Response("Số CCCD phải đủ 12 số (hoặc CMND 9 số).", { status: 400 });

  await recordExport(principal, "installment_contract");
  const now = new Date();
  const today = businessDate(now);
  const { shopId } = principal;
  async function* rows() {
    for await (const batch of listInstallments.batches(shopId, filter, now)) {
      yield batch.map((c) => [
        c.code,
        c.customerName,
        c.customerPhone,
        c.customerCccdMasked,
        formatDay(c.startDate),
        vnd(c.amountGiven),
        vnd(c.totalDue),
        vnd(c.amountPaid),
        // Như trang chi tiết: hợp đồng đã đóng / đã xoá để trống (tất toán được giảm thì tổng − đã thu khác 0).
        c.status === "active" && !c.deleted ? vnd(c.progress.remaining) : null,
        `${c.progress.paidPeriods} / ${c.progress.periods} kỳ`,
        vnd(c.perPeriod),
        c.dueStatus && c.progress.next ? formatDay(c.progress.next.due) : null,
        c.deleted ? "Đã xoá" : dueLabel(c.dueStatus).text,
      ]);
    }
  }
  return xlsxResponse({ fileName: `tra-gop-${today}.xlsx`, sheetName: "Trả góp", columns: COLUMNS, batches: rows() });
}
