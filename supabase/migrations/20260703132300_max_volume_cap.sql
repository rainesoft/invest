ALTER TABLE user_risk_settings 
ADD COLUMN IF NOT EXISTS max_volume_per_trade numeric DEFAULT 50;
