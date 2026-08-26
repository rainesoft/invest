import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL");

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Query the ledger for the absolute latest generated signal
    const { data: latestSignal, error } = await supabase
      .from('trade_opportunities')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows returned"
      throw error;
    }

    if (!latestSignal) {
      return new Response("No signals found in the ledger. System might be uninitialized.", { status: 200 });
    }

    const lastRunTime = new Date(latestSignal.created_at).getTime();
    const currentTime = Date.now();
    const diffMinutes = Math.floor((currentTime - lastRunTime) / (1000 * 60));

    // The Threshold: 45 minutes
    if (diffMinutes > 45) {
      console.error(`🚨 WATCHDOG TRIGGERED: Pipeline stalled. Last signal was ${diffMinutes} minutes ago.`);

      if (RESEND_API_KEY && ADMIN_EMAIL) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "Watchdog <system@raineinvest.com>", // Replace with your verified Resend domain
            to: ADMIN_EMAIL,
            subject: "🚨 RAINEINVEST CRITICAL: Data ingestion pipeline stalled",
            html: `
              <div style="font-family: sans-serif; padding: 24px; max-width: 600px;">
                <h2 style="color: #dc2626;">System Failure Detected</h2>
                <p>The autonomous Alpha Engine has missed a scheduled M30 cycle.</p>
                <div style="background: #fef2f2; padding: 16px; border-radius: 8px; border: 1px solid #fecaca; margin: 24px 0;">
                  <p style="margin: 0;"><strong>Last Updated:</strong> ${diffMinutes} minutes ago.</p>
                </div>
                <p>Please investigate the Edge Function logs, the Alpaca API connection, or OpenAI latency immediately.</p>
              </div>
            `,
          }),
        });
      }

      return new Response("Watchdog alert dispatched", { status: 500 });
    }

    return new Response(`System Healthy. Last update: ${diffMinutes} mins ago.`, { status: 200 });
  } catch (error) {
    console.error("Watchdog execution failed:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
