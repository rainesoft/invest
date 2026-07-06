CREATE OR REPLACE TRIGGER "on_user_trade_inserted"
  AFTER INSERT ON "public"."user_trades"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."trigger_telegram_broadcast"();
