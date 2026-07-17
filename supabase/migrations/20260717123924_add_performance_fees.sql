-- 1. Schema Updates
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS watermark_principal numeric NOT NULL DEFAULT 0.00;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS is_revenue boolean NOT NULL DEFAULT false;

ALTER TABLE public.withdrawal_requests ADD COLUMN IF NOT EXISTS performance_fee numeric NOT NULL DEFAULT 0.00;
ALTER TABLE public.withdrawal_requests ADD COLUMN IF NOT EXISTS principal_withdrawn numeric NOT NULL DEFAULT 0.00;

-- Ensure there is only one revenue wallet per currency
CREATE UNIQUE INDEX IF NOT EXISTS unique_revenue_currency_idx ON public.wallets (currency) WHERE is_revenue = true;

-- Seed Revenue Wallets
INSERT INTO public.wallets (is_platform, is_revenue, currency, balance) VALUES 
(false, true, 'USD', 0.00),
(false, true, 'NGN', 0.00),
(false, true, 'GHS', 0.00)
ON CONFLICT DO NOTHING;

-- 2. Update process_transfer to track watermarks on deposit
CREATE OR REPLACE FUNCTION process_transfer(
  sender_wallet_id uuid,
  receiver_wallet_id uuid,
  transfer_amount numeric,
  txn_reference text,
  txn_description text,
  txn_type text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_txn_id uuid;
BEGIN
  -- Create the transaction record
  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (txn_reference, txn_description, txn_type)
  RETURNING id INTO new_txn_id;

  -- Debit the sender
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (new_txn_id, sender_wallet_id, -transfer_amount);

  UPDATE public.wallets 
  SET balance = balance - transfer_amount 
  WHERE id = sender_wallet_id;

  -- Credit the receiver
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (new_txn_id, receiver_wallet_id, transfer_amount);

  UPDATE public.wallets 
  SET balance = balance + transfer_amount 
  WHERE id = receiver_wallet_id;

  -- If it's a deposit, increase the receiver's High-Water Mark
  IF txn_type = 'DEPOSIT' THEN
    UPDATE public.wallets
    SET watermark_principal = watermark_principal + transfer_amount
    WHERE id = receiver_wallet_id AND is_platform = false AND is_revenue = false;
  END IF;

  RETURN true;
END;
$$;

-- 3. Update request_withdrawal to calculate performance fee via HWM
CREATE OR REPLACE FUNCTION request_withdrawal(
  p_user_id uuid,
  p_wallet_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference text,
  p_destination jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_platform_wallet_id uuid;
  v_revenue_wallet_id uuid;
  v_user_wallet record;
  v_plan_tier text;
  v_withdrawal_id uuid;
  v_txn_id uuid;
  
  v_profit numeric;
  v_amount_profit numeric;
  v_amount_principal numeric;
  v_fee_amount numeric := 0;
  v_net_to_user numeric;
BEGIN
  -- 1. Find the platform clearing wallet and revenue wallet
  SELECT id INTO v_platform_wallet_id FROM public.wallets WHERE is_platform = true AND currency = p_currency;
  SELECT id INTO v_revenue_wallet_id FROM public.wallets WHERE is_revenue = true AND currency = p_currency;
  
  IF v_platform_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Platform wallet for currency % not found', p_currency;
  END IF;
  
  IF v_revenue_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Revenue wallet for currency % not found', p_currency;
  END IF;

  -- 2. Fetch User Wallet & Subscription
  SELECT * INTO v_user_wallet FROM public.wallets WHERE id = p_wallet_id AND user_id = p_user_id;
  IF v_user_wallet.id IS NULL THEN
    RAISE EXCEPTION 'User wallet not found';
  END IF;

  IF v_user_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  SELECT plan_tier INTO v_plan_tier FROM public.user_subscriptions WHERE user_id = p_user_id;

  -- 3. High-Water Mark Profit Calculation
  v_profit := GREATEST(0, v_user_wallet.balance - v_user_wallet.watermark_principal);
  v_amount_profit := LEAST(p_amount, v_profit);
  v_amount_principal := p_amount - v_amount_profit;

  -- If the user is on the free tier, we take 30% of the withdrawn profit
  IF COALESCE(v_plan_tier, 'free') = 'free' THEN
    v_fee_amount := v_amount_profit * 0.30;
  END IF;

  v_net_to_user := p_amount - v_fee_amount;

  -- 4. Adjust the Watermark if principal is being withdrawn
  IF v_amount_principal > 0 THEN
    UPDATE public.wallets 
    SET watermark_principal = GREATEST(0, watermark_principal - v_amount_principal)
    WHERE id = p_wallet_id;
  END IF;

  -- 5. Execute Internal Transfers
  -- Debit user the full gross amount
  UPDATE public.wallets SET balance = balance - p_amount WHERE id = p_wallet_id;
  
  -- Credit platform escrow with the net amount
  UPDATE public.wallets SET balance = balance + v_net_to_user WHERE id = v_platform_wallet_id;
  
  -- Credit revenue wallet with the fee
  IF v_fee_amount > 0 THEN
    UPDATE public.wallets SET balance = balance + v_fee_amount WHERE id = v_revenue_wallet_id;
  END IF;

  -- 6. Record Ledger Entries
  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (p_reference, 'Withdrawal Escrow & Performance Fee', 'WITHDRAWAL')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, p_wallet_id, -p_amount);
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_platform_wallet_id, v_net_to_user);
  
  IF v_fee_amount > 0 THEN
    INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_revenue_wallet_id, v_fee_amount);
  END IF;

  -- 7. Create Withdrawal Request (Net Amount is passed to Paystack)
  INSERT INTO public.withdrawal_requests (user_id, wallet_id, amount, performance_fee, principal_withdrawn, currency, reference_code, destination_details)
  VALUES (p_user_id, p_wallet_id, v_net_to_user, v_fee_amount, v_amount_principal, p_currency, p_reference, p_destination)
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;

-- 4. Update reverse_withdrawal to handle reversing fees and restoring watermarks
CREATE OR REPLACE FUNCTION reverse_withdrawal(
  p_reference text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_req record;
  v_platform_wallet_id uuid;
  v_revenue_wallet_id uuid;
  v_txn_id uuid;
BEGIN
  SELECT * INTO v_req FROM public.withdrawal_requests WHERE reference_code = p_reference;
  
  IF v_req.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;

  IF v_req.status != 'PENDING' AND v_req.status != 'PROCESSING' THEN
    RAISE EXCEPTION 'Withdrawal request is not pending';
  END IF;

  SELECT id INTO v_platform_wallet_id FROM public.wallets WHERE is_platform = true AND currency = v_req.currency;
  SELECT id INTO v_revenue_wallet_id FROM public.wallets WHERE is_revenue = true AND currency = v_req.currency;

  -- Debit platform (net amount)
  UPDATE public.wallets SET balance = balance - v_req.amount WHERE id = v_platform_wallet_id;
  
  -- Debit revenue (fee amount)
  IF COALESCE(v_req.performance_fee, 0) > 0 THEN
    UPDATE public.wallets SET balance = balance - v_req.performance_fee WHERE id = v_revenue_wallet_id;
  END IF;

  -- Credit user (gross amount)
  UPDATE public.wallets SET balance = balance + v_req.amount + COALESCE(v_req.performance_fee, 0) WHERE id = v_req.wallet_id;

  -- Restore the watermark if principal was withdrawn
  IF COALESCE(v_req.principal_withdrawn, 0) > 0 THEN
    UPDATE public.wallets SET watermark_principal = watermark_principal + v_req.principal_withdrawn WHERE id = v_req.wallet_id;
  END IF;

  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (p_reference || '-REV', 'Withdrawal Reversal', 'WITHDRAWAL_REFUND')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_platform_wallet_id, -v_req.amount);
  
  IF COALESCE(v_req.performance_fee, 0) > 0 THEN
    INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_revenue_wallet_id, -v_req.performance_fee);
  END IF;
  
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_req.wallet_id, v_req.amount + COALESCE(v_req.performance_fee, 0));

  UPDATE public.withdrawal_requests SET status = 'FAILED' WHERE id = v_req.id;

  RETURN true;
END;
$$;
