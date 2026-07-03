ALTER TABLE user_risk_settings 
ADD COLUMN IF NOT EXISTS sync_trailing_stops boolean DEFAULT false;
