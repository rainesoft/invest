-- 1. Create Wallets Table
CREATE TABLE IF NOT EXISTS public.wallets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    is_platform boolean NOT NULL DEFAULT false,
    currency text NOT NULL DEFAULT 'USD',
    balance numeric NOT NULL DEFAULT 0.00,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT balance_must_be_positive CHECK (balance >= 0)
);

-- Partial indexes to enforce one wallet per currency for users, and one platform wallet per currency
CREATE UNIQUE INDEX unique_user_currency_idx ON public.wallets (user_id, currency) WHERE is_platform = false;
CREATE UNIQUE INDEX unique_platform_currency_idx ON public.wallets (currency) WHERE is_platform = true;

-- 2. Create Ledger Transactions Table
CREATE TABLE IF NOT EXISTS public.ledger_transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reference_code text UNIQUE NOT NULL,
    description text NOT NULL,
    type text NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'FEE', 'WITHDRAWAL_REFUND'
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create Ledger Entries Table
CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    transaction_id uuid REFERENCES public.ledger_transactions(id) ON DELETE CASCADE NOT NULL,
    wallet_id uuid REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create Withdrawal Requests Table
CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    wallet_id uuid REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
    amount numeric NOT NULL,
    currency text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED
    reference_code text UNIQUE NOT NULL,
    payment_gateway text DEFAULT 'paystack',
    destination_details jsonb, -- bank account info, mobile money info
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Seed the Platform Clearing Wallets
INSERT INTO public.wallets (is_platform, currency, balance) VALUES 
(true, 'USD', 0.00),
(true, 'NGN', 0.00),
(true, 'GHS', 0.00)
ON CONFLICT DO NOTHING;

-- 6. Trigger for updated_at timestamps
CREATE OR REPLACE FUNCTION update_wallet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_wallets_timestamp
BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION update_wallet_updated_at();

CREATE TRIGGER update_withdrawal_requests_timestamp
BEFORE UPDATE ON public.withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION update_wallet_updated_at();

-- 7. Process Transfer RPC (Atomic Transaction)
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

  -- Debit the sender (amount is negative)
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (new_txn_id, sender_wallet_id, -transfer_amount);

  UPDATE public.wallets 
  SET balance = balance - transfer_amount 
  WHERE id = sender_wallet_id;

  -- Credit the receiver (amount is positive)
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (new_txn_id, receiver_wallet_id, transfer_amount);

  UPDATE public.wallets 
  SET balance = balance + transfer_amount 
  WHERE id = receiver_wallet_id;

  RETURN true;
END;
$$;

-- 7.1 Request Withdrawal RPC (Locks funds in Platform Escrow)
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
  v_withdrawal_id uuid;
  v_txn_id uuid;
BEGIN
  -- 1. Find the matching platform clearing wallet
  SELECT id INTO v_platform_wallet_id FROM public.wallets WHERE is_platform = true AND currency = p_currency;
  
  IF v_platform_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Platform wallet for currency % not found', p_currency;
  END IF;

  -- 2. Verify user has enough funds (triggers balance check automatically, but explicit check provides better error message)
  IF (SELECT balance FROM public.wallets WHERE id = p_wallet_id AND user_id = p_user_id) < p_amount THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  -- 3. Execute the internal transfer to lock funds
  UPDATE public.wallets SET balance = balance - p_amount WHERE id = p_wallet_id;
  UPDATE public.wallets SET balance = balance + p_amount WHERE id = v_platform_wallet_id;

  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (p_reference, 'Withdrawal Escrow Hold', 'WITHDRAWAL')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, p_wallet_id, -p_amount);
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_platform_wallet_id, p_amount);

  -- 4. Create withdrawal request
  INSERT INTO public.withdrawal_requests (user_id, wallet_id, amount, currency, reference_code, destination_details)
  VALUES (p_user_id, p_wallet_id, p_amount, p_currency, p_reference, p_destination)
  RETURNING id INTO v_withdrawal_id;

  RETURN v_withdrawal_id;
END;
$$;

-- 7.2 Reverse Withdrawal RPC (Refunds user if external payout fails)
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

  -- Debit platform
  UPDATE public.wallets SET balance = balance - v_req.amount WHERE id = v_platform_wallet_id;
  -- Credit user
  UPDATE public.wallets SET balance = balance + v_req.amount WHERE id = v_req.wallet_id;

  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES (p_reference || '-REV', 'Withdrawal Reversal', 'WITHDRAWAL_REFUND')
  RETURNING id INTO v_txn_id;

  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_platform_wallet_id, -v_req.amount);
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount) VALUES (v_txn_id, v_req.wallet_id, v_req.amount);

  UPDATE public.withdrawal_requests SET status = 'FAILED' WHERE id = v_req.id;

  RETURN true;
END;
$$;

-- 8. Enable Row-Level Security (RLS)
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- 9. RLS Policies
-- Users can only view their own wallets
CREATE POLICY "Users can view their own wallets"
ON public.wallets FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can view their own ledger entries
CREATE POLICY "Users can view their own ledger entries"
ON public.ledger_entries FOR SELECT
TO authenticated
USING (
  wallet_id IN (
    SELECT id FROM public.wallets WHERE user_id = auth.uid()
  )
);

-- Users can view transactions linked to their entries
CREATE POLICY "Users can view their own ledger transactions"
ON public.ledger_transactions FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT transaction_id FROM public.ledger_entries WHERE wallet_id IN (
      SELECT id FROM public.wallets WHERE user_id = auth.uid()
    )
  )
);

-- Users can view and create their own withdrawal requests
CREATE POLICY "Users can view their own withdrawal requests"
ON public.withdrawal_requests FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create withdrawal requests"
ON public.withdrawal_requests FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
