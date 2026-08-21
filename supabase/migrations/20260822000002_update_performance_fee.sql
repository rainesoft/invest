-- Migration 00007: Update Performance Fee to 20%

CREATE OR REPLACE FUNCTION "public"."request_withdrawal"("p_user_id" "uuid", "p_wallet_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_reference" "text", "p_destination" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
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

  v_locked_balance numeric := 0;
  v_unlocked_balance numeric := 0;
  v_scheduled_for timestamp with time zone;
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

  -- Calculate 30-day locked balance
  SELECT COALESCE(SUM(amount), 0) INTO v_locked_balance
  FROM public.deposit_requests
  WHERE user_id = p_user_id 
    AND wallet_id = p_wallet_id
    AND status IN ('DEPOSITED', 'CLEARED')
    AND created_at >= NOW() - INTERVAL '30 days';

  v_unlocked_balance := GREATEST(0, v_user_wallet.balance - v_locked_balance);

  IF p_amount > v_unlocked_balance THEN
    RAISE EXCEPTION 'Insufficient unlocked funds. You have a locked balance of % % which cannot be withdrawn yet.', v_locked_balance, p_currency;
  END IF;

  SELECT plan_tier INTO v_plan_tier FROM public.user_subscriptions WHERE user_id = p_user_id;

  -- Calculate next processing date (1st or 15th)
  IF EXTRACT(DAY FROM CURRENT_DATE) <= 15 THEN
    -- If today is 1st to 15th, schedule for the 15th of current month at noon UTC
    v_scheduled_for := DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '14 days 12 hours';
  ELSE
    -- If today is after 15th, schedule for the 1st of next month at noon UTC
    v_scheduled_for := DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month 12 hours';
  END IF;

  -- 3. High-Water Mark Profit Calculation
  v_profit := GREATEST(0, v_user_wallet.balance - v_user_wallet.watermark_principal);
  v_amount_profit := LEAST(p_amount, v_profit);
  v_amount_principal := p_amount - v_amount_profit;

  -- If the user is on the free tier, we take 20% of the withdrawn profit (Updated from 30%)
  IF COALESCE(v_plan_tier, 'free') = 'free' THEN
    v_fee_amount := v_amount_profit * 0.20;
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

  -- 7. Create Withdrawal Request
  INSERT INTO public.withdrawal_requests (user_id, wallet_id, amount, performance_fee, principal_withdrawn, currency, reference_code, destination_details, status, scheduled_for)
  VALUES (p_user_id, p_wallet_id, v_net_to_user, v_fee_amount, v_amount_principal, p_currency, p_reference, p_destination, 'SCHEDULED', v_scheduled_for)
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;
