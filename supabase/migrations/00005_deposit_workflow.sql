-- Deposit Request Tracking Table
CREATE TABLE IF NOT EXISTS "public"."deposit_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "wallet_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "currency" "text" NOT NULL,
    "status" "text" DEFAULT 'PENDING_PAYMENT'::"text" NOT NULL,
    "reference_code" "text" NOT NULL,
    "payment_gateway" "text" DEFAULT 'paystack'::"text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);

ALTER TABLE "public"."deposit_requests" OWNER TO "postgres";

ALTER TABLE ONLY "public"."deposit_requests"
    ADD CONSTRAINT "deposit_requests_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."deposit_requests"
    ADD CONSTRAINT "deposit_requests_reference_code_key" UNIQUE ("reference_code");

ALTER TABLE ONLY "public"."deposit_requests"
    ADD CONSTRAINT "deposit_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."deposit_requests"
    ADD CONSTRAINT "deposit_requests_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE CASCADE;

CREATE TRIGGER "update_deposit_requests_timestamp" BEFORE UPDATE ON "public"."deposit_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_wallet_updated_at"();

-- RLS
ALTER TABLE "public"."deposit_requests" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create deposit requests" ON "public"."deposit_requests" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "Users can view their own deposit requests" ON "public"."deposit_requests" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));

-- Admins can view and update all deposit requests
-- Assuming public.users.is_admin = true
CREATE POLICY "Admins can view all deposit requests" ON "public"."deposit_requests" FOR SELECT TO "authenticated" USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.is_admin = true));

CREATE POLICY "Admins can update deposit requests" ON "public"."deposit_requests" FOR UPDATE TO "authenticated" USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.is_admin = true));

GRANT ALL ON TABLE "public"."deposit_requests" TO "anon";
GRANT ALL ON TABLE "public"."deposit_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."deposit_requests" TO "service_role";

-- Admin Approve Deposit Function
CREATE OR REPLACE FUNCTION "public"."admin_approve_deposit"("p_request_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_req record;
  v_txn_id uuid;
  v_admin boolean;
BEGIN
  -- Verify caller is admin
  SELECT is_admin INTO v_admin FROM public.users WHERE id = auth.uid();
  IF v_admin IS NULL OR v_admin = false THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an admin';
  END IF;

  -- Verify the request exists and is pending
  SELECT * INTO v_req FROM public.deposit_requests WHERE id = p_request_id AND status = 'PENDING_CLEARANCE' FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit request not found or not in PENDING_CLEARANCE status';
  END IF;

  -- Create Ledger Transaction
  INSERT INTO public.ledger_transactions (reference_code, description, type) 
  VALUES ('DEP-' || v_req.id, 'Deposit Cleared', 'DEPOSIT')
  RETURNING id INTO v_txn_id;

  -- Credit User Wallet (Available Balance)
  INSERT INTO public.ledger_entries (transaction_id, wallet_id, amount)
  VALUES (v_txn_id, v_req.wallet_id, v_req.amount);

  -- Update Wallet Balances
  -- Available balance increases. Ledger balance remains the same because it was increased when PENDING_CLEARANCE.
  UPDATE public.wallets 
  SET balance = balance + v_req.amount,
      watermark_principal = watermark_principal + v_req.amount
  WHERE id = v_req.wallet_id;

  -- Mark the request as CLEARED
  UPDATE public.deposit_requests SET status = 'CLEARED' WHERE id = v_req.id;

  RETURN true;
END;
$$;

ALTER FUNCTION "public"."admin_approve_deposit"("p_request_id" "uuid") OWNER TO "postgres";
GRANT ALL ON FUNCTION "public"."admin_approve_deposit"("p_request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_approve_deposit"("p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_approve_deposit"("p_request_id" "uuid") TO "service_role";
