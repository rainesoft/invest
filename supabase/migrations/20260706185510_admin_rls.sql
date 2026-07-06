-- Enable RLS on trade_opportunities
ALTER TABLE "public"."trade_opportunities" ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to SELECT opportunities
CREATE POLICY "Users can view opportunities" ON "public"."trade_opportunities"
    FOR SELECT
    TO authenticated
    USING (true);

-- Allow admins to UPDATE opportunities
CREATE POLICY "Admins can update opportunities" ON "public"."trade_opportunities"
    FOR UPDATE
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM "public"."user_risk_settings"
        WHERE user_id = auth.uid() AND is_admin = true
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM "public"."user_risk_settings"
        WHERE user_id = auth.uid() AND is_admin = true
    ));

-- Allow admins to INSERT opportunities
CREATE POLICY "Admins can insert opportunities" ON "public"."trade_opportunities"
    FOR INSERT
    TO authenticated
    WITH CHECK (EXISTS (
        SELECT 1 FROM "public"."user_risk_settings"
        WHERE user_id = auth.uid() AND is_admin = true
    ));
