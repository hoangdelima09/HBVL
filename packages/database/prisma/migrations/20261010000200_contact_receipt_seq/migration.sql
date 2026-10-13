-- Human-friendly, gap-tolerant, unique contact receipt numbers (LH-YYYY-000123 is built in the application).
CREATE SEQUENCE contact_receipt_seq START 1;
-- The runtime role needs USAGE on sequences created after the default-privilege grant; make it explicit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hbvl_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE contact_receipt_seq TO hbvl_app;
  END IF;
END $$;
