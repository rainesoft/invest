-- Add order_type to trade_opportunities to support limit/stop orders
ALTER TABLE public.trade_opportunities ADD COLUMN IF NOT EXISTS order_type text;
