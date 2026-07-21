CREATE TABLE IF NOT EXISTS "public"."shadow_ledger" (
    "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    "symbol" text NOT NULL,
    "timeframe" text NOT NULL,
    "side" text NOT NULL,
    "entry_price" numeric,
    "take_profit" numeric,
    "stop_loss" numeric,
    "status" text DEFAULT 'PENDING', -- PENDING, WON, LOST
    "created_at" timestamp with time zone DEFAULT now(),
    "evaluated_at" timestamp with time zone
);

ALTER TABLE "public"."shadow_ledger" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."shadow_ledger" TO "service_role";
GRANT SELECT ON TABLE "public"."shadow_ledger" TO "authenticated";
