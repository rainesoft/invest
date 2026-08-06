import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Calculate the timestamp for 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    // Query for all resolved trades in the last 7 days
    const { data: trades, error } = await supabase
      .from('trade_opportunities')
      .select('status, r_multiple')
      .in('status', ['WON', 'LOST'])
      .gte('closed_at', sevenDaysAgoISO);

    if (error) {
      throw error;
    }

    if (!trades || trades.length === 0) {
      return new Response("No trades closed in the last 7 days.", { status: 200 });
    }

    const totalTrades = trades.length;
    let wonTrades = 0;
    let netR = 0;

    trades.forEach((trade) => {
      if (trade.status === 'WON') wonTrades++;
      if (trade.r_multiple != null) {
        netR += Number(trade.r_multiple);
      }
    });

    const winRate = ((wonTrades / totalTrades) * 100).toFixed(1);
    const formattedNetR = netR > 0 ? `+${netR.toFixed(2)}` : netR.toFixed(2);

    // Format the social media copy
    const message = `
RaineBank Alpha Engine: Weekly Audit 📊

Another week of autonomous, mathematically verified execution.

🔹 Net Performance: ${formattedNetR} R-Multiple
🔹 Win Rate: ${winRate}%
🔹 Total Setups Evaluated: ${totalTrades}

The agent-risk enforced strict 1:2 R/R and asset isolation rules perfectly. No emotional drift. No backtest inflation. Just transparent edge.

Live ledger and delayed feed are open to the public at https://rainebank.com. B2B API access is currently available for institutional partners.
    `.trim();

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error("Missing Telegram keys. Outputting to logs instead:\n", message);
      return new Response("Keys missing. Logged to console.", { status: 200 });
    }

    // Escape special characters for MarkdownV2 if needed, though for standard text formatting 
    // it's sometimes easier to avoid MarkdownV2 if we have raw URLs and emojis. We'll use standard text.
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Telegram API Error:", errorData);
      return new Response(`Telegram Dispatch Failed: ${errorData}`, { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, totalTrades, netR, winRate }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Weekly report generation failed:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
