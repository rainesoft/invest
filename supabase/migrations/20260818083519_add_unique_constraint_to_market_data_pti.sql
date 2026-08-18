-- Add unique constraint to market_data_pti to allow UPSERT (ON CONFLICT) cache updates
ALTER TABLE market_data_pti
ADD CONSTRAINT market_data_pti_symbol_timeframe_ts_key UNIQUE (symbol, timeframe, ts);
