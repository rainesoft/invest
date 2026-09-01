-- Migration: 20260901000000_cleanup_sentiment_trade_opportunities.sql
-- Description: Clean up historical raw sentiment news headlines from trade_opportunities
-- that were inserted without trade execution plans, restoring database cleanliness and win rate integrity.

BEGIN;

-- Delete un-actionable raw news items that were inserted with null entry plans and marked REJECTED
DELETE FROM trade_opportunities
WHERE (source IS NULL OR source = 'agent-news')
  AND entry_plan_json IS NULL
  AND status = 'REJECTED'
  AND ai_summary LIKE '[SENTIMENT]%';

-- Delete placeholder C-Tier empty rejections that have no entry plans and are older than 24 hours
DELETE FROM trade_opportunities
WHERE status = 'REJECTED'
  AND entry_plan_json IS NULL
  AND stop_plan_json IS NULL
  AND created_at < NOW() - INTERVAL '24 hours';

COMMIT;
