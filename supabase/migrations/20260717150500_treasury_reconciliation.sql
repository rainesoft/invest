-- 1. Create Treasury Accounts Table
CREATE TABLE IF NOT EXISTS public.treasury_accounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    account_name text NOT NULL,
    account_type text NOT NULL, -- 'BANK', 'BROKER', 'CRYPTO'
    currency text NOT NULL DEFAULT 'USD',
    balance numeric NOT NULL DEFAULT 0.00,
    sync_method text NOT NULL, -- 'MANUAL', 'API'
    last_synced_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create Treasury Snapshots Table
CREATE TABLE IF NOT EXISTS public.treasury_snapshots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    snapshot_timestamp timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    total_customer_liability numeric NOT NULL,
    stanbic_bank_total numeric NOT NULL,
    exness_master_total numeric NOT NULL,
    total_assets numeric NOT NULL,
    solvency_ratio numeric NOT NULL,
    notes text
);

-- 3. Seed Initial Accounts
INSERT INTO public.treasury_accounts (account_name, account_type, currency, balance, sync_method) VALUES
('Stanbic Corporate Main', 'BANK', 'USD', 0.00, 'MANUAL'),
('Exness Master Trading', 'BROKER', 'USD', 0.00, 'API')
ON CONFLICT DO NOTHING;

-- 4. RPC for Manual Bank Balance Update
CREATE OR REPLACE FUNCTION update_treasury_balance(
  p_account_id uuid,
  p_new_balance numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.treasury_accounts
  SET balance = p_new_balance,
      last_synced_at = now()
  WHERE id = p_account_id;
  RETURN true;
END;
$$;

-- 4.1 RPC for Total Customer Liability
CREATE OR REPLACE FUNCTION get_total_customer_liability()
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(sum(balance), 0) FROM public.wallets WHERE is_platform = false;
$$;

-- 4.2 RPC for Total Assets by Type
CREATE OR REPLACE FUNCTION get_total_assets(asset_type text)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE(sum(balance), 0) FROM public.treasury_accounts WHERE account_type = asset_type;
$$;

-- 5. Enable RLS and Restrict to Admins
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage treasury accounts"
ON public.treasury_accounts
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "Admins can view treasury snapshots"
ON public.treasury_snapshots FOR SELECT
TO authenticated
USING (auth.jwt() ->> 'role' = 'admin');

-- 6. Schedule Monthly Snapshot via pg_cron
-- We will run this on the 1st of every month at midnight UTC
SELECT cron.schedule(
    'monthly-treasury-snapshot',
    '0 0 1 * *', -- At 00:00 on day-of-month 1
    $$
    SELECT net.http_post(
        url:='https://ktezlusdkqlfdwqrldtn.supabase.co/functions/v1/cron-treasury-snapshot',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
    ) as request_id;
    $$
);
