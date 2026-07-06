-- 1. Add user_id to trades
ALTER TABLE "public"."trades" ADD COLUMN "user_id" uuid;
ALTER TABLE "public"."trades" ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- 2. Add user_id to executions
ALTER TABLE "public"."executions" ADD COLUMN "user_id" uuid;
ALTER TABLE "public"."executions" ADD CONSTRAINT "executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- 3. Enable RLS
ALTER TABLE "public"."trades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."executions" ENABLE ROW LEVEL SECURITY;

-- 4. Create RLS Policies for trades
CREATE POLICY "Users can view their own trades" ON "public"."trades"
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- 5. Create RLS Policies for executions
CREATE POLICY "Users can view their own executions" ON "public"."executions"
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
