import "server-only";
import type { NextRequest } from "next/server";
import { AccessDeniedError, listContracts, recordExport, requireSession, xlsxResponse, type XlsxColumn } from "@/composition-root";
import { businessDate } from "@/shared/kernel/local-date";
import type { Money } from "@/shared/kernel/money";
import { parseContractQuery } from "./contract-query";
import { INTEREST_UNIT, dueLabel, formatDay } from "./format";

const COLUMNS: XlsxColumn[] = [
  { header: "Mã HĐ", width: 12 },
  { header: "Khách hàng", width: 26 },
  { header: "SĐT", width: 14 },
  { header: "CCCD (4 số cuối)", width: 16 },
  { header: "Loại", width: 10 },
  { header: "Tài sản", width: 26 },
  { header: "Tiền vay", width: 14, money: true },
  { header: "Gốc còn lại", width: 14, money: true },
  { header: "Ngày vay", width: 12 },
  { header: "Hình thức lãi", width: 18 },
  { header: "Lãi đến hôm nay", width: 15, money: true },
  { header: "Hạn đóng lãi", width: 12 },
  { header: "Trạng thái", width: 16 },
];

const vnd = (money: Money) => Number(money.toBigInt());

/** GET `/cam-do/xuat-excel`: danh sách hợp đồng theo bộ lọc đang xem; chỉ chủ tiệm (web-security). */
export async function exportContracts(request: NextRequest): Promise<Response> {
  const principal = await requireSession({ role: "owner" }).catch((error: unknown) => {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  });
  if (!principal) return new Response("Chỉ chủ tiệm được xuất Excel.", { status: 403 });
  const { filter, invalidCccd } = parseContractQuery((key) => request.nextUrl.searchParams.get(key));
  if (invalidCccd) return new Response("Số CCCD phải đủ 12 số (hoặc CMND 9 số).", { status: 400 });

  await recordExport(principal, "contract");
  const now = new Date();
  const today = businessDate(now);
  const { shopId } = principal;
  async function* rows() {
    for await (const batch of listContracts.batches(shopId, filter, now)) {
      yield batch.map((c) => [
        c.code,
        c.customerName,
        c.customerPhone,
        c.customerCccdMasked,
        c.kind === "secured" ? "Thế chấp" : "Tín chấp",
        c.assetName,
        vnd(c.principal),
        vnd(c.outstandingPrincipal),
        formatDay(c.loanDate),
        `${c.rateText.replace(".", ",")} ${INTEREST_UNIT[c.interestType]}`,
        c.accruedInterest ? vnd(c.accruedInterest) : null,
        c.nextInterestDue ? formatDay(c.nextInterestDue) : null,
        c.deleted ? "Đã xoá" : dueLabel(c.nextInterestDue, today, c.kind).text,
      ]);
    }
  }
  return xlsxResponse({ fileName: `cam-do-${today}.xlsx`, sheetName: "Cầm đồ", columns: COLUMNS, batches: rows() });
}
