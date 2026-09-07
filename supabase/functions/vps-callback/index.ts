import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  try {
    if (req.headers.get("x-vps-secret") !== Deno.env.get("VPS_SECRET_KEY")) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = new URL(req.url);
    const tradeId = url.searchParams.get("trade_id");
    const status = url.searchParams.get("status");
    const ticket = url.searchParams.get("ticket");
    const errorMsg = url.searchParams.get("error");
    const price = url.searchParams.get("price") || url.searchParams.get("open_price");

    if (!tradeId || !status) {
      return new Response("Missing parameters", { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const updatePayload: any = { status };
    if (ticket && ticket !== "0") updatePayload.meta_api_order_id = ticket;
    if (errorMsg) updatePayload.error_message = errorMsg;
    if (price && Number(price) > 0) updatePayload.open_price = Number(price);

    // Autonomous HFT execution bypasses the Cloud ledger intentionally for speed.
    // We return 200 OK so the MT5 EA stops retrying and clears the queue.
    if (tradeId === "HFT_NATIVE") {
      return new Response("OK", { headers: { "Content-Type": "text/plain" } });
    }

    const { data: tradeData, error: fetchError } = await supabase
      .from("user_trades")
      .select("opportunity_id")
      .eq("id", tradeId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!tradeData) {
      console.log(`[VPS Callback] Trade ${tradeId} not found in user_trades (unmapped or external). Callback acknowledged.`);
      return new Response("OK", { headers: { "Content-Type": "text/plain" } });
    }

    const { error } = await supabase.from("user_trades").update(updatePayload).eq("id", tradeId);
    if (error) throw error;

    if (status === "OPEN" && tradeData?.opportunity_id) {
      const { data: oppData } = await supabase
        .from("trade_opportunities")
        .select("ai_summary, symbol")
        .eq("id", tradeData.opportunity_id)
        .maybeSingle();
      const existingSummary = oppData?.ai_summary || "";

      await supabase.from("trade_opportunities").update({ 
        status: "ACTIVE",
        ai_summary: `${existingSummary}\n\n[VPS Engine] Trade executed successfully. Ticket: ${ticket}`
      }).eq("id", tradeData.opportunity_id);

      // --- FLASH-FILL & EXECUTION VELOCITY CIRCUIT BREAKER ---
      try {
        const now = Date.now();
        const { data: trackerRow } = await supabase
          .from("system_settings")
          .select("value")
          .eq("key", "execution_velocity_tracker")
          .maybeSingle();

        const rawTimestamps: number[] = Array.isArray(trackerRow?.value) ? trackerRow.value : [];
        const recentTimestamps = rawTimestamps.filter(ts => (now - ts) <= 60000); // 60-second window
        recentTimestamps.push(now);

        await supabase.from("system_settings").upsert({
          key: "execution_velocity_tracker",
          value: recentTimestamps,
          updated_at: new Date().toISOString()
        }, { onConflict: "key" });

        // If 2 or more fills occur within 60s, trip the VELOCITY_LOCKOUT circuit breaker
        if (recentTimestamps.length >= 2) {
          const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();
          console.warn(`🚨 [Flash-Fill Breaker] ${recentTimestamps.length} trades executed in <60s! Tripping VELOCITY_LOCKOUT until ${expiresAt}.`);

          await supabase.from("market_context").insert({
            symbol: "GLOBAL",
            macro_bias: "VELOCITY_LOCKOUT",
            expires_at: expiresAt,
            confidence_score: 100,
            ai_narrative: `[Flash-Fill Circuit Breaker] ${recentTimestamps.length} trades filled in <60s. Halting pending execution for 15 minutes to protect against simultaneous execution shocks.`,
            dominant_driver: "EXECUTION_VELOCITY_CIRCUIT_BREAKER"
          });

          // Dispatch Telegram Alert
          const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
          const tgChat = Deno.env.get("TELEGRAM_CHAT_ID");
          if (tgToken && tgChat) {
            const alertText = [
              `🚨 <b>FLASH-FILL CIRCUIT BREAKER ENGAGED</b>`,
              `━━━━━━━━━━━━━━━━━━━━━`,
              `⚡ <b>Velocity:</b> ${recentTimestamps.length} trades filled in &lt; 60 seconds`,
              `🔒 <b>Status:</b> 15-minute <code>VELOCITY_LOCKOUT</code> active across all assets`,
              `⏳ <b>Expires:</b> ${new Date(now + 15 * 60 * 1000).toLocaleTimeString("en-US", { timeZone: "UTC" })} UTC`,
              ``,
              `<i>Resting pending executions paused to protect capital against simultaneous market spikes.</i>`
            ].join("\n");

            fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: tgChat, text: alertText, parse_mode: "HTML" })
            }).catch(err => console.error("[VPS Callback] Telegram dispatch error:", err));
          }
        }
      } catch (velErr: any) {
        console.error("[VPS Callback] Velocity tracker error:", velErr.message);
      }
    } else if (status === "FAILED" && tradeData?.opportunity_id) {
      // Check if ALL sibling trades for this opportunity failed
      const { data: siblings } = await supabase.from("user_trades").select("status").eq("opportunity_id", tradeData.opportunity_id);
      const hasWorkingTrades = siblings?.some((s: any) => ["OPEN", "VPS_PENDING", "VPS_PROCESSING", "PENDING"].includes(s.status));
      if (!hasWorkingTrades) {
        const { data: oppData } = await supabase
          .from("trade_opportunities")
          .select("ai_summary")
          .eq("id", tradeData.opportunity_id)
          .maybeSingle();
        const existingSummary = oppData?.ai_summary || "";
        const failReason = errorMsg ? `Execution Failed: ${errorMsg}` : "Execution Failed on Broker";
        await supabase.from("trade_opportunities").update({
          status: "REJECTED",
          ai_risks: failReason,
          ai_summary: `${existingSummary}\n\n[VPS Engine] ${failReason}`
        }).eq("id", tradeData.opportunity_id);
        console.log(`[VPS Callback] All trades failed for opportunity ${tradeData.opportunity_id}. Marked REJECTED.`);
      }
    }

    return new Response("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error updating VPS callback:", error);
    return new Response(`ERROR:${error.message}`, { status: 500 });
  }
});

