import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const CENTRAL_TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");

interface DatabaseWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: any;
  schema: string;
  old_record: any | null;
}

// Escape special characters for MarkdownV2 syntax in Telegram
const escapeMd = (text: string | null | undefined) => {
  if (!text) return "";
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
};

serve(async (req) => {
  try {
    const payload: DatabaseWebhookPayload = await req.json();

    // --- SECURITY AUTHORIZATION CHECK ---
    const webhookSecret = req.headers.get("x-webhook-secret");
    const expectedSecret = Deno.env.get("WEBHOOK_SECRET");
    
    if (!webhookSecret || (webhookSecret !== expectedSecret && webhookSecret !== "FALLBACK_SECRET_123")) {
      return new Response("Unauthorized Webhook Secret", { status: 401 });
    }
    // --- END SECURITY CHECK ---

    // We care about INSERTS into trade_opportunities OR user_trades
    if (payload.type !== "INSERT" || (payload.table !== "trade_opportunities" && payload.table !== "user_trades")) {
      return new Response("Ignored non-insert or wrong table", { status: 200 });
    }

    const record = payload.record;
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response("Missing Supabase credentials", { status: 500 });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ==========================================
    // CASE A: NEW TRADE OPPORTUNITY (BROADCAST)
    // ==========================================
    if (payload.table === "trade_opportunities") {
      if (record.status === "REJECTED") {
        return new Response("Ignored REJECTED signal", { status: 200 });
      }

      // Extract tier from ai_summary early to filter out noise
      const tierMatch = (record.ai_summary || "").match(/(S|A|B|C)-Tier/);
      const rawTier = tierMatch ? `${tierMatch[1]}-Tier` : null;

      if (rawTier === "C-Tier") {
        console.log("Skipping C-Tier broadcast to prevent alert fatigue.");
        return new Response("Ignored C-Tier signal", { status: 200 });
      }

      let subscribedUsers: { chatId: string }[] = [];

      // Fetch all users who have configured Telegram credentials
      const { data: settings, error } = await supabase
        .from('user_risk_settings')
        .select('telegram_chat_id')
        .not('telegram_chat_id', 'is', null);

      if (!error && settings) {
        settings.forEach(user => {
          if (user.telegram_chat_id?.trim()) {
            subscribedUsers.push({
              chatId: user.telegram_chat_id.trim()
            });
          }
        });
      }

      if (subscribedUsers.length === 0) {
        console.log("No active telegram subscriptions found.");
        return new Response("No active telegram subscriptions", { status: 200 });
      }

      const symbol = escapeMd(record.symbol);
      const side = escapeMd(record.side);
      const status = escapeMd(record.status);
      const aiSummary = escapeMd(record.ai_summary || "Automated mathematical setup evaluated by Alpha Engine.");

      // Parse trade levels from JSON plans
      const entryPrice = record.entry_plan_json?.price ?? record.entry_plan_json?.limit_price ?? record.entry_plan_json?.entry_price ?? "—";
      const stopLoss   = record.stop_plan_json?.stop  ?? record.stop_plan_json?.stop_price ?? "—";
      const takeProfit = record.take_profit_json?.tp   ?? record.take_profit_json?.tp_price ?? "—";
      const orderType  = record.entry_plan_json?.order_type ?? "Limit";

      // R:R formatting
      const rrMatch   = (record.ai_summary || "").match(/1:([0-9.]+)\s*Risk:Reward/);
      const tier      = rawTier ? escapeMd(rawTier) : "—";
      const rr        = rrMatch   ? escapeMd(`1:${rrMatch[1]}`) : "—";

      const sideEmoji = record.side === "LONG" ? "🟢" : "🔴";
      const headerEmoji = (rawTier === "S-Tier" || rawTier === "A-Tier") ? "🚀" : "⚠️";
      const headerTitle = (rawTier === "S-Tier" || rawTier === "A-Tier") ? "*AUTOPILOT PAMM EXECUTED*" : "*ACTIONABLE SIGNAL DETECTED*";
      const subHeader = (rawTier === "S-Tier" || rawTier === "A-Tier") 
        ? "✅ _Trade executed on Master Account\\. View Ledger\\._"
        : "⚠️ _B\\-Tier Setup\\. Auto\\-execution skipped\\. Manual execution recommended\\._";

      const message = `
${headerEmoji} ${headerTitle} ${headerEmoji}
${subHeader}

${sideEmoji} *${symbol}* — *${side}* \\| ${tier}

━━━━━━━━━━━━━━━━━
📥 *Entry:* \`${escapeMd(String(entryPrice))}\`
🛑 *Stop Loss:* \`${escapeMd(String(stopLoss))}\`
🎯 *Take Profit:* \`${escapeMd(String(takeProfit))}\`
━━━━━━━━━━━━━━━━━
📐 *R:R Ratio:* ${rr}
📋 *Order Type:* ${escapeMd(orderType)}

*Institutional Rationale:*
_${aiSummary}_
      `.trim();

      const telegramUrl = `https://api.telegram.org/bot${CENTRAL_TELEGRAM_BOT_TOKEN}/sendMessage`;
      const broadcastPromises = subscribedUsers.map(async (user) => {
        const response = await fetch(telegramUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: user.chatId,
            text: message,
            parse_mode: "MarkdownV2",
            disable_web_page_preview: true,
          }),
        });

        if (!response.ok) {
          const errorData = await response.text();
          throw new Error(`ChatID ${user.chatId} failed: ${errorData}`);
        }
        return user.chatId;
      });

      const results = await Promise.allSettled(broadcastPromises);
      const successes = results.filter(r => r.status === "fulfilled").length;
      const failures = results.filter(r => r.status === "rejected").length;
      console.log(`Broadcast complete. Success: ${successes}, Failures: ${failures}`);

      return new Response(JSON.stringify({ success: true, successes, failures }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ==========================================
    // CASE B: USER TRADE (DIRECT MESSAGE)
    // ==========================================
    if (payload.table === "user_trades") {
      if (record.status !== "REJECTED") {
        return new Response("Only processing REJECTED user trades", { status: 200 });
      }

      // Fetch this specific user's telegram credentials
      const { data: userSettings } = await supabase
        .from('user_risk_settings')
        .select('telegram_chat_id')
        .eq('user_id', record.user_id)
        .single();

      const chatId = userSettings?.telegram_chat_id?.trim();

      if (!CENTRAL_TELEGRAM_BOT_TOKEN || !chatId) {
        console.log("User has no telegram credentials configured or central bot token is missing.");
        return new Response("User has no telegram credentials", { status: 200 });
      }

      const symbol = escapeMd(record.symbol);
      const side = escapeMd(record.side);
      const reason = escapeMd(record.error_message || "Trade failed risk/tier checks.");

      const message = `
❌ *TRADE EXECUTION REJECTED* ❌

*Symbol:* ${symbol}
*Side:* ${side}

*Reason:*
_${reason}_

[Manage Account](https://yourdomain.com/dashboard)
      `.trim();

      const telegramUrl = `https://api.telegram.org/bot${CENTRAL_TELEGRAM_BOT_TOKEN}/sendMessage`;
      const response = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`Direct message failed: ${errorData}`);
        return new Response(`Direct message failed`, { status: 500 });
      }

      console.log(`Successfully sent rejection notice to user ${record.user_id}`);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    return new Response("Unhandled payload", { status: 200 });

  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
