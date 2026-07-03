ALTER TABLE user_risk_settings 
ADD COLUMN IF NOT EXISTS telegram_bot_token text,
ADD COLUMN IF NOT EXISTS telegram_chat_id text;
