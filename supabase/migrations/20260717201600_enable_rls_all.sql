-- Enable RLS on all tables that were previously unrestricted
-- Since no policies are attached to these, they default to "Deny All" for anon and authenticated users.
-- The backend edge functions utilize the SERVICE_ROLE key, which inherently bypasses RLS,
-- ensuring that the backend can still read/write freely while protecting the data from external API abuse.

ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."market_data_pti" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."meta_api_retry_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."profit_take_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."risk_limits" ENABLE ROW LEVEL SECURITY;
