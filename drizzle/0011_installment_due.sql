-- Viết tay. Hạn góp trả góp tính trong SQL để lọc "Chậm góp", "Đến hạn hôm nay" và đếm ô thống kê mà không tải từng dòng về JS.
-- Phải khớp domain installment (src/modules/installment/domain/installment.ts): test so khớp ở
-- installment/infrastructure/installment-due.db.test.ts. Đổi cách chia kỳ thì sửa cả hai.

-- Phải thu luỹ kế đến hết kỳ k = tổng × k / số kỳ, half-up về 1 đồng (dueThrough). Số kỳ = ceil(số ngày góp / số ngày mỗi kỳ).
-- Số không âm nên (2 × tử + mẫu) / (2 × mẫu) chia nguyên là half-up.
CREATE FUNCTION installment_due_through(total_due bigint, total_days integer, period_days integer, k integer) RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN (
    SELECT (total_due * least(greatest(k, 0), n)::bigint * 2 + n) / (2 * n)
    FROM (SELECT ((total_days + period_days - 1) / period_days)::bigint AS n) AS s
  );
--> statement-breakpoint

-- Có kỳ đã qua ngày phải góp mà chưa góp đủ (progress().lateCount > 0): luỹ kế phải thu của các kỳ có hạn trước `today`
-- lớn hơn số đã thu. Số kỳ có hạn trước `today` như periodsDueBefore.
CREATE FUNCTION installment_late(total_due bigint, total_days integer, period_days integer, start_date date, amount_paid bigint, today date)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN amount_paid < installment_due_through(
    total_due, total_days, period_days,
    CASE
      WHEN today - start_date <= 0 THEN 0
      WHEN today - start_date > total_days THEN (total_days + period_days - 1) / period_days
      ELSE least((total_days + period_days - 1) / period_days, (today - start_date - 1) / period_days)
    END
  );
--> statement-breakpoint

-- Không chậm và kỳ tới (kỳ đầu chưa góp đủ) đến hạn hôm nay (dueStatus = today). Kỳ có hạn đúng `today`: kỳ cuối khi
-- `today` là ngày kết thúc, hoặc kỳ (today − ngày bắt đầu) / số ngày mỗi kỳ khi chia hết; chưa góp đủ kỳ đó thì nó là kỳ tới.
CREATE FUNCTION installment_due_today(total_due bigint, total_days integer, period_days integer, start_date date, amount_paid bigint, today date)
  RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN NOT installment_late(total_due, total_days, period_days, start_date, amount_paid, today)
    AND coalesce(amount_paid < installment_due_through(
      total_due, total_days, period_days,
      CASE
        WHEN today - start_date = total_days THEN (total_days + period_days - 1) / period_days
        WHEN today - start_date > 0 AND today - start_date < total_days AND (today - start_date) % period_days = 0
          THEN (today - start_date) / period_days
      END
    ), false);
