import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const FALLBACK_TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const FALLBACK_TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

interface DatabaseWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: any;
  schema: string;
  old_record: any | null;
}

serve(async (req) => {
  try {
    const payload: DatabaseWebhookPayload = await req.json();

    // We only care about INSERTS into trade_opportunities
    if (payload.type !== "INSERT" || payload.table !== "trade_opportunities") {
      return new Response("Ignored non-insert or wrong table", { status: 200 });
    }

    const signal = payload.record;

    if (signal.status === "REJECTED") {
      return new Response("Ignored REJECTED signal", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let TELEGRAM_BOT_TOKEN = FALLBACK_TELEGRAM_BOT_TOKEN;
    let TELEGRAM_CHAT_ID = FALLBACK_TELEGRAM_CHAT_ID;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data: settings } = await supabase.from('user_risk_settings').select('telegram_bot_token, telegram_chat_id').limit(1).single();
      if (settings?.telegram_bot_token) TELEGRAM_BOT_TOKEN = settings.telegram_bot_token;
      if (settings?.telegram_chat_id) TELEGRAM_CHAT_ID = settings.telegram_chat_id;
    }

    // Check if we have the necessary credentials
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      console.error("Missing Telegram credentials in both database and environment.");
      return new Response("Server Configuration Error", { status: 500 });
    }

    // Escape special characters for MarkdownV2 syntax in Telegram
    // Special characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
    const escapeMd = (text: string | null | undefined) => {
      if (!text) return "";
      return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
    };

    const symbol = escapeMd(signal.symbol);
    const side = escapeMd(signal.side);
    const entryPrice = signal.entry_plan_json?.entry_price ? escapeMd(String(signal.entry_plan_json.entry_price)) : "Market Execution";
    const status = escapeMd(signal.status);
    const aiSummary = escapeMd(signal.ai_summary || "Automated mathematical setup evaluated by Alpha Engine.");
    const riskSummary = escapeMd(signal.risk_summary || "Standard Model Risk Constraints Applied.");
    
    // Formatting the message
    const message = `
🚨 *RAINEBANK ALPHA SIGNAL* 🚨

*Symbol:* ${symbol}
*Side:* ${side}
*Status:* ${status}

*Entry Target:* ${entryPrice}
*Risk Profile:* ${riskSummary}

*Institutional Rationale:*
_${aiSummary}_

[View Ledger](https://yourdomain.com/dashboard)
    `.trim();

    // Dispatch to Telegram
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Telegram API Error:", errorData);
      return new Response(`Telegram Dispatch Failed: ${errorData}`, { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
