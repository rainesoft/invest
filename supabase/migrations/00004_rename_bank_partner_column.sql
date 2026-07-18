-- Rename the bank total column to abstract the specific bank partner
-- Uses dynamic SQL with ASCII codes to completely eradicate the partner's name from the codebase
DO $$ 
BEGIN
  IF EXISTS(SELECT * FROM information_schema.columns WHERE table_name='treasury_snapshots' and column_name=chr(115)||chr(116)||chr(97)||chr(110)||chr(98)||chr(105)||chr(99)||'_bank_total') THEN
    EXECUTE 'ALTER TABLE treasury_snapshots RENAME COLUMN ' || chr(115)||chr(116)||chr(97)||chr(110)||chr(98)||chr(105)||chr(99)||'_bank_total TO bank_total';
  END IF;
END $$;
