import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/**
 * Decommission stub for agent-sniper.
 * Gracefully acknowledges legacy external callers (e.g. pg_net cron from 18.169.92.26)
 * with HTTP 200 to eliminate false-alarm HTTP 401 log flooding (Section 1L).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      status: "DECOMMISSIONED",
      message: "agent-sniper has been decommissioned. Please stop and unschedule any external cron calls to this endpoint.",
      timestamp: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    }
  );
});
