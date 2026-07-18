-- Add ledger_balance to wallets to track pending funds (e.g. pending manual bank transfers)
ALTER TABLE public.wallets 
ADD COLUMN IF NOT EXISTS ledger_balance numeric DEFAULT 0.00 NOT NULL;

-- Ensure ledger_balance is positive
ALTER TABLE public.wallets 
ADD CONSTRAINT ledger_balance_must_be_positive CHECK (ledger_balance >= 0.00);

-- Make sure existing rows have their ledger_balance equal to their current available balance
UPDATE public.wallets SET ledger_balance = balance WHERE ledger_balance = 0.00 AND balance > 0;
