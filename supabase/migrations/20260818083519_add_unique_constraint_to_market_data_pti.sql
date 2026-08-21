-- Add unique constraint to market_data_pti to allow UPSERT (ON CONFLICT) cache updates
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_data_pti_symbol_timeframe_ts_key') THEN
        ALTER TABLE market_data_pti ADD CONSTRAINT market_data_pti_symbol_timeframe_ts_key UNIQUE (symbol, timeframe, ts);
    END IF;
END $$;
