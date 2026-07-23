CREATE TABLE public.trade_watchlists (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
    status TEXT NOT NULL DEFAULT 'WATCHING' CHECK (status IN ('WATCHING', 'TRIGGERED', 'EXPIRED', 'CANCELLED')),
    macro_score TEXT NOT NULL,
    source_agent TEXT NOT NULL,
    current_price NUMERIC,
    context JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    triggered_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_watchlist_active ON public.trade_watchlists (symbol) WHERE status = 'WATCHING';

ALTER TABLE public.trade_watchlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON public.trade_watchlists FOR SELECT USING (true);
CREATE POLICY "Enable insert for service role" ON public.trade_watchlists FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for service role" ON public.trade_watchlists FOR UPDATE USING (true);
