-- Sổ két và nhật ký audit chỉ được thêm, không sửa/xoá (data-model mục 2, ý 4).
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % chỉ cho phép thêm dòng (append-only)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cash_transactions_append_only
  BEFORE UPDATE OR DELETE ON cash_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER cash_transactions_no_truncate
  BEFORE TRUNCATE ON cash_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
-- Dòng reversal phải là số đối của dòng gốc, cùng hợp đồng, và không đảo một dòng reversal.
CREATE FUNCTION check_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  original cash_transactions%ROWTYPE;
BEGIN
  SELECT * INTO original FROM cash_transactions
    WHERE id = NEW.reverses_id AND shop_id = NEW.shop_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giao dịch gốc cần đảo' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF original.type = 'reversal' THEN
    RAISE EXCEPTION 'Không được đảo một bút toán đảo' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount <> -original.amount
     OR NEW.contract_id IS DISTINCT FROM original.contract_id
     OR NEW.installment_contract_id IS DISTINCT FROM original.installment_contract_id THEN
    RAISE EXCEPTION 'Bút toán đảo phải ngược dấu và cùng hợp đồng với giao dịch gốc'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cash_transactions_check_reversal
  BEFORE INSERT ON cash_transactions
  FOR EACH ROW WHEN (NEW.type = 'reversal') EXECUTE FUNCTION check_reversal();
