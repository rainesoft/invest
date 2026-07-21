CREATE TABLE IF NOT EXISTS "public"."system_settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now()
);

ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE "public"."system_settings" TO authenticated;
GRANT ALL ON TABLE "public"."system_settings" TO service_role;

CREATE POLICY "Allow read for all" ON "public"."system_settings" FOR SELECT USING (true);
CREATE POLICY "Allow update for admins" ON "public"."system_settings" FOR UPDATE USING (
  auth.uid() IN (SELECT id FROM public.users WHERE is_admin = true)
);
CREATE POLICY "Allow insert for admins" ON "public"."system_settings" FOR INSERT WITH CHECK (
  auth.uid() IN (SELECT id FROM public.users WHERE is_admin = true)
);

INSERT INTO "public"."system_settings" ("key", "value") VALUES ('auto_trading_enabled', 'true'::jsonb) ON CONFLICT ("key") DO NOTHING;
