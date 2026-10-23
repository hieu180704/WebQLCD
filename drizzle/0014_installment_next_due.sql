-- Viết tay. Hạn kỳ tới (kỳ đầu chưa góp đủ) tính trong SQL để bảng "Đến hạn" ở trang chủ lọc hợp đồng chậm hoặc sắp đến hạn
-- mà không tải từng dòng về JS. Phải khớp progress().next.due của domain installment
-- (src/modules/installment/domain/installment.ts): test so khớp ở installment/infrastructure/installment-due.db.test.ts.

-- Số kỳ đã góp đủ = kỳ k lớn nhất có installment_due_through(k) ≤ đã thu (paidPeriods). Với n = số kỳ, T = tổng phải thu:
-- (2Tk + n) / (2n) ≤ paid ⟺ k ≤ (2n·paid + n − 1) / (2T), chia nguyên; T > 0 (CHECK installment_contracts_amounts).
-- Đã góp đủ mọi kỳ thì NULL. Hạn kỳ k = ngày bắt đầu + min(k × số ngày mỗi kỳ, số ngày góp) (periodDueDate).
CREATE FUNCTION installment_next_due(total_due bigint, total_days integer, period_days integer, start_date date, amount_paid bigint)
  RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN (
    SELECT CASE WHEN k < n THEN start_date + least((k + 1) * period_days, total_days)::integer END
    FROM (
      SELECT n, least(n, (2 * n * amount_paid + n - 1) / (2 * total_due)) AS k
      FROM (SELECT ((total_days + period_days - 1) / period_days)::bigint AS n) AS s
    ) AS p
  );
