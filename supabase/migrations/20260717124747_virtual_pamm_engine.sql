-- 1. Add is_master_account to user_risk_settings
ALTER TABLE public.user_risk_settings ADD COLUMN IF NOT EXISTS is_master_account boolean NOT NULL DEFAULT false;

-- 2. Designate the Master Account
DO $$
DECLARE
    v_admin_id uuid;
BEGIN
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'kobequagraine@yahoo.com' LIMIT 1;
    
    IF v_admin_id IS NOT NULL THEN
        UPDATE public.user_risk_settings SET is_master_account = true WHERE user_id = v_admin_id;
    END IF;
END $$;

-- 3. Sever retail broker connections
UPDATE public.user_risk_settings 
SET meta_api_token = NULL, meta_api_account_id = NULL 
WHERE is_master_account = false;

-- 4. Add realized_pnl to user_trades
ALTER TABLE public.user_trades ADD COLUMN IF NOT EXISTS realized_pnl numeric NOT NULL DEFAULT 0.00;

-- 5. Virtual PnL Allocation Trigger
CREATE OR REPLACE FUNCTION allocate_virtual_pnl()
RETURNS TRIGGER AS $$
DECLARE
  v_user_wallet_id uuid;
  v_platform_wallet_id uuid;
  v_txn_id uuid;
  v_description text;
BEGIN
  -- We only allocate when the status changes TO 'CLOSED'
  IF NEW.status = 'CLOSED' AND OLD.status != 'CLOSED' THEN
    
    -- Assuming Rainebank trading pool operates in USD
    SELECT id INTO v_user_wallet_id FROM public.wallets 
    WHERE user_id = NEW.user_id AND currency = 'USD' AND is_platform = false;
    
    SELECT id INTO v_platform_wallet_id FROM public.wallets 
    WHERE currency = 'USD' AND is_platform = true;

    IF v_user_wallet_id IS NOT NULL AND v_platform_wallet_id IS NOT NULL AND NEW.realized_pnl != 0 THEN
      
      -- Create Ledger Transaction
      IF NEW.realized_pnl > 0 THEN
        v_description := 'Virtual Trading Profit: ' || NEW.symbol;
      ELSE
        v_description := 'Virtual Trading Loss: ' || NEW.symbol;
      END IF;

      INSERT INTO public.ledger_transactions (reference_code, description, type) 
      VALUES ('TRADE-' || NEW.id, v_description, 'TRADE_PNL')
      RETURNING id INTO v_txn_id;

      -- Double Entry Logging
      -- Debit Platform (-realized_pnl)
      INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
      VALUES (v_txn_id, v_platform_wallet_id, -NEW.realized_pnl);

      UPDATE public.wallets 
      SET balance = GREATEST(0, balance - NEW.realized_pnl)
      WHERE id = v_platform_wallet_id;

      -- Credit User (+realized_pnl)
      INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
      VALUES (v_txn_id, v_user_wallet_id, NEW.realized_pnl);

      UPDATE public.wallets 
      SET balance = GREATEST(0, balance + NEW.realized_pnl)
      WHERE id = v_user_wallet_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Safely recreate the trigger
DROP TRIGGER IF EXISTS trg_allocate_virtual_pnl ON public.user_trades;
CREATE TRIGGER trg_allocate_virtual_pnl
AFTER UPDATE ON public.user_trades
FOR EACH ROW EXECUTE FUNCTION allocate_virtual_pnl();
