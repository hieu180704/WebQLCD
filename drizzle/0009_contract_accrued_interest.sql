-- Viết tay. Lãi từ ngày đã trả đến tới `today` trên gốc còn lại, như accruedInterest (pawn/domain/contract.ts)
-- + interest-policy.ts: gốc × lãi × số ngày / mẫu số, làm tròn half-up về 1 đồng một lần (Money.mulDiv); chưa tới ngày đã trả đến thì 0.
-- rate là cột numeric(9,4) (chưa nhân RATE_SCALE). round(numeric) làm tròn xa 0, tức half-up với số không âm.
-- Phải khớp code TS: test so khớp ở pawn/infrastructure/contract-accrued-interest.db.test.ts.
CREATE FUNCTION contract_accrued_interest(kind interest_type, principal bigint, rate numeric, paid_until date, today date) RETURNS bigint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN round(
    principal::numeric * rate * greatest(today - paid_until, 0)
      / CASE kind WHEN 'per_million_per_day' THEN 1000 WHEN 'percent_per_month' THEN 3000 WHEN 'percent_per_week' THEN 700 END
  )::bigint;
