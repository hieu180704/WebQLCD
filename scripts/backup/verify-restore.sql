-- Đối soát DB vừa khôi phục (data-model mục 4): cột tính sẵn phải khớp sổ két. Lệch thì báo lỗi, restore.sh dừng.
-- Chỉ tính dòng chưa bị đảo (loại dòng gốc có reversal trỏ tới và chính dòng reversal); bỏ qua hợp đồng đã xoá.
\set ON_ERROR_STOP on
-- File UTF-8; psql trên Windows mặc định WIN1252 làm vỡ thông báo tiếng Việt.
\encoding UTF8

SELECT
  (SELECT count(*) FROM shops) AS shops,
  (SELECT count(*) FROM customers) AS customers,
  (SELECT count(*) FROM contracts) AS contracts,
  (SELECT count(*) FROM installment_contracts) AS installment_contracts,
  (SELECT count(*) FROM cash_transactions) AS cash_transactions,
  (SELECT count(*) FROM audit_logs) AS audit_logs;

DO $$
DECLARE
  bad_contracts bigint;
  bad_installments bigint;
BEGIN
  CREATE TEMP TABLE live ON COMMIT DROP AS
    SELECT t.shop_id, t.contract_id, t.installment_contract_id, t.type, t.amount, t.period_to
    FROM cash_transactions t
    WHERE t.type <> 'reversal'
      AND NOT EXISTS (SELECT 1 FROM cash_transactions r WHERE r.shop_id = t.shop_id AND r.reverses_id = t.id);

  SELECT count(*) INTO bad_contracts
  FROM contracts c
  CROSS JOIN LATERAL (
    SELECT
      coalesce(-sum(l.amount) FILTER (WHERE l.type = 'additional_loan'), 0) AS added,
      coalesce(sum(l.amount) FILTER (WHERE l.type = 'principal_repayment'), 0) AS repaid,
      max(l.period_to) FILTER (WHERE l.type = 'interest_payment') AS paid_to
    FROM live l
    WHERE l.shop_id = c.shop_id AND l.contract_id = c.id
  ) s
  WHERE c.deleted_at IS NULL
    AND (c.outstanding_principal <> c.principal + s.added - s.repaid
      OR c.interest_paid_until <> coalesce(s.paid_to, c.loan_date));

  SELECT count(*) INTO bad_installments
  FROM installment_contracts i
  WHERE i.deleted_at IS NULL
    AND i.amount_paid <> coalesce((
      SELECT sum(l.amount) FROM live l
      WHERE l.shop_id = i.shop_id AND l.installment_contract_id = i.id AND l.type = 'installment_payment'
    ), 0);

  IF bad_contracts > 0 OR bad_installments > 0 THEN
    RAISE EXCEPTION 'Đối soát lệch: % hợp đồng cầm đồ/tín chấp, % hợp đồng trả góp', bad_contracts, bad_installments;
  END IF;
  RAISE NOTICE 'Đối soát khớp';
END $$;
