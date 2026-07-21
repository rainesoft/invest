-- Add trace_id to trade_opportunities
ALTER TABLE "public"."trade_opportunities" ADD COLUMN IF NOT EXISTS "trace_id" "uuid";

-- Add trace_id to market_context
ALTER TABLE "public"."market_context" ADD COLUMN IF NOT EXISTS "trace_id" "uuid";

-- Create agent_verdicts table
CREATE TABLE IF NOT EXISTS "public"."agent_verdicts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trace_id" "uuid" NOT NULL,
    "opportunity_id" "uuid",
    "agent_name" "text" NOT NULL,
    "verdict" "text" NOT NULL,
    "reasoning" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "agent_verdicts_verdict_check" CHECK (("verdict" = ANY (ARRAY['APPROVE'::"text", 'VETO'::"text", 'ABSTAIN'::"text"])))
);

ALTER TABLE "public"."agent_verdicts" OWNER TO "postgres";

ALTER TABLE ONLY "public"."agent_verdicts"
    ADD CONSTRAINT "agent_verdicts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."agent_verdicts"
    ADD CONSTRAINT "agent_verdicts_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."trade_opportunities"("id") ON DELETE SET NULL;

ALTER TABLE "public"."agent_verdicts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view agent verdicts" ON "public"."agent_verdicts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."user_risk_settings"
  WHERE (("user_risk_settings"."user_id" = "auth"."uid"()) AND ("user_risk_settings"."is_admin" = true)))));

GRANT ALL ON TABLE "public"."agent_verdicts" TO "anon";
GRANT ALL ON TABLE "public"."agent_verdicts" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_verdicts" TO "service_role";
