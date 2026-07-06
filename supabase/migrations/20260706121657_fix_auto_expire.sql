CREATE OR REPLACE FUNCTION rpc_expire_stale_opportunities()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- 1. For PENDING_APPROVAL signals: If older than their timeframe, mark them as REJECTED
    UPDATE trade_opportunities
    SET status = 'REJECTED',
        ai_risks = 'Expired: Not approved within the ' || timeframe || ' timeframe window'
    WHERE status = 'PENDING_APPROVAL'
      AND (
        (LOWER(timeframe) = '1h' AND created_at < now() - interval '1 hour') OR
        (LOWER(timeframe) = '4h' AND created_at < now() - interval '4 hours') OR
        (LOWER(timeframe) = '1d' AND created_at < now() - interval '1 day')
      );

    -- 2. For REJECTED signals (including C-Tier warnings): Auto-archive them to clear the UI
    UPDATE trade_opportunities
    SET is_archived = true
    WHERE status = 'REJECTED' AND is_archived = false
      AND (
        (LOWER(timeframe) = '1h' AND created_at < now() - interval '1 hour') OR
        (LOWER(timeframe) = '4h' AND created_at < now() - interval '4 hours') OR
        (LOWER(timeframe) = '1d' AND created_at < now() - interval '1 day')
      );
END;
$$;
