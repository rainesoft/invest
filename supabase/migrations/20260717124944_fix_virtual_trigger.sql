-- Clean up redundant column (profit_usd already exists)
ALTER TABLE public.user_trades DROP COLUMN IF EXISTS realized_pnl;

-- Update the Virtual PnL Allocation Trigger to use profit_usd and listen for WON/LOST statuses
CREATE OR REPLACE FUNCTION allocate_virtual_pnl()
RETURNS TRIGGER AS $$
DECLARE
  v_user_wallet_id uuid;
  v_platform_wallet_id uuid;
  v_txn_id uuid;
  v_description text;
BEGIN
  -- We only allocate when the status changes to WON or LOST
  IF NEW.status IN ('WON', 'LOST') AND OLD.status NOT IN ('WON', 'LOST') THEN
    
    -- Assuming Rainebank trading pool operates in USD
    SELECT id INTO v_user_wallet_id FROM public.wallets 
    WHERE user_id = NEW.user_id AND currency = 'USD' AND is_platform = false;
    
    SELECT id INTO v_platform_wallet_id FROM public.wallets 
    WHERE currency = 'USD' AND is_platform = true;

    IF v_user_wallet_id IS NOT NULL AND v_platform_wallet_id IS NOT NULL AND COALESCE(NEW.profit_usd, 0) != 0 THEN
      
      -- Create Ledger Transaction
      IF NEW.profit_usd > 0 THEN
        v_description := 'Virtual Trading Profit: ' || NEW.symbol;
      ELSE
        v_description := 'Virtual Trading Loss: ' || NEW.symbol;
      END IF;

      INSERT INTO public.ledger_transactions (reference_code, description, type) 
      VALUES ('TRADE-' || NEW.id, v_description, 'TRADE_PNL')
      RETURNING id INTO v_txn_id;

      -- Double Entry Logging
      -- Debit/Credit Platform Escrow Wallet
      INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
      VALUES (v_txn_id, v_platform_wallet_id, -NEW.profit_usd);

      UPDATE public.wallets 
      SET balance = GREATEST(0, balance - NEW.profit_usd)
      WHERE id = v_platform_wallet_id;

      -- Debit/Credit User Wallet
      INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
      VALUES (v_txn_id, v_user_wallet_id, NEW.profit_usd);

      UPDATE public.wallets 
      SET balance = GREATEST(0, balance + NEW.profit_usd)
      WHERE id = v_user_wallet_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-apply trigger
DROP TRIGGER IF EXISTS trg_allocate_virtual_pnl ON public.user_trades;
CREATE TRIGGER trg_allocate_virtual_pnl
AFTER UPDATE ON public.user_trades
FOR EACH ROW EXECUTE FUNCTION allocate_virtual_pnl();
