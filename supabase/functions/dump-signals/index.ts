import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data, error } = await supabase
    .from('trade_opportunities')
    .select('id, symbol, side, status, created_at, entry_plan_json, stop_plan_json, take_profit_json, ai_summary, ai_risks, risk_summary, confidence')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    return new Response(JSON.stringify({ error }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
});
