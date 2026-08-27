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

    const { data: tradeData, error: fetchError } = await supabase.from("user_trades").select("opportunity_id").eq("id", tradeId).single();
    if (fetchError) throw fetchError;

    const { error } = await supabase.from("user_trades").update(updatePayload).eq("id", tradeId);
    if (error) throw error;

    if (status === "OPEN" && tradeData?.opportunity_id) {
      const { data: oppData } = await supabase.from("trade_opportunities").select("ai_summary").eq("id", tradeData.opportunity_id).single();
      const existingSummary = oppData?.ai_summary || "";

      await supabase.from("trade_opportunities").update({ 
        status: "ACTIVE",
        ai_summary: `${existingSummary}\n\n[VPS Engine] Trade executed successfully. Ticket: ${ticket}`
      }).eq("id", tradeData.opportunity_id);
    } else if (status === "FAILED" && tradeData?.opportunity_id) {
      // Check if ALL sibling trades for this opportunity failed
      const { data: siblings } = await supabase.from("user_trades").select("status").eq("opportunity_id", tradeData.opportunity_id);
      const hasWorkingTrades = siblings?.some(s => ["OPEN", "VPS_PENDING", "VPS_PROCESSING", "PENDING"].includes(s.status));
      if (!hasWorkingTrades) {
        const { data: oppData } = await supabase.from("trade_opportunities").select("ai_summary").eq("id", tradeData.opportunity_id).single();
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

    if (error) throw error;

    return new Response("OK", { headers: { "Content-Type": "text/plain" } });
  } catch (error: any) {
    console.error("Error updating VPS callback:", error);
    return new Response(`ERROR:${error.message}`, { status: 500 });
  }
});
