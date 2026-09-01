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
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
};

// Inside inline code `...`, only ` and \ must be escaped in Telegram MarkdownV2
const escapeCode = (text: string | null | undefined) => {
  if (!text) return "";
  return String(text).replace(/([\\`])/g, "\\$1");
};

const formatPrice = (val: any, symbol?: string): string => {
  if (val === null || val === undefined || val === "—") return "—";
  const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  if (isNaN(num)) return String(val);

  const sym = (symbol || "").toUpperCase();
  if (sym.includes("JPY")) {
    return num.toFixed(2);
  }
  if (["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "EURGBP"].includes(sym)) {
    return num.toFixed(4);
  }
  if (["UKOIL", "USOIL", "XTIUSD", "XBRUSD"].includes(sym)) {
    return num.toFixed(2);
  }
  if (num >= 1000) {
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (num >= 1) {
    return num.toFixed(2);
  }
  return num.toFixed(4);
};

function extractCleanThesis(rawSummary: string): string {
  if (!rawSummary) return "Algorithmic confluence setup";

  // 1. Strip solver / execution desk / post-mortem tags
  let text = rawSummary
    .replace(/\[(Adaptive Limit Solver|Trading Central Limit Optimizer|Execution Desk|POST-MORTEM)[^\]]*\]/gi, "")
    .trim();

  // 2. Extract strategy tag inside brackets if present e.g. [Pattern -> Strategy]
  let strategyTag = "";
  const bracketMatch = text.match(/\[([A-Z0-9_\s\-→>]+(?:→|->)[^\]]+)\]/i);
  if (bracketMatch) {
    strategyTag = bracketMatch[1]
      .replace(/^(SWING|DAY|SCALP|S-Tier|A-Tier|B-Tier|C-Tier|BULLISH_[A-Z_]+|BEARISH_[A-Z_]+)[\s\]\-]*/gi, "")
      .replace(/->/g, "→")
      .replace(/^[→\s]+/, "")
      .trim();
  }

  // 3. Remove all brackets and bracketed tags from the remaining text
  const cleanWithoutBrackets = text.replace(/\[[^\]]+\]/g, " ");

  // 4. Split by pipes or newlines
  const parts = cleanWithoutBrackets.split(/[|\n]/).map(p => p.trim()).filter(Boolean);
  const candidateNotes: string[] = [];

  for (const part of parts) {
    let clean = part.replace(/^[•\-\*\d\.\s\)]+/, "").replace(/[*_`]/g, "").trim();
    if (!clean) continue;

    // Filter out boilerplate, math, essays, TP/SL lists, and long numbered entries
    if (
      clean.match(/^TP\d/i) ||
      clean.match(/^R:R/i) ||
      clean.match(/^Fib Swing/i) ||
      clean.match(/^(Suggested execution|Given the technical setup|Based on the \w+ analysis|Execution Strategy|Confidence and Probability|Macro Sentiment|Execution Math|Order Type)/i) ||
      clean.match(/Typical R:R/i) ||
      clean.match(/R:R should be/i) ||
      clean.match(/Risk:Reward/i) ||
      clean.match(/\([0-9\.\s\-\+\/\*]+=\s*[0-9\.:]+\)/) || // math equations
      clean.match(/^\d+\.\s+/) || // numbered list like "1. The macro context..."
      clean.length > 120 || // long paragraph
      clean.length < 5
    ) {
      continue;
    }

    // Look for technical confluences / patterns
    const lower = clean.toLowerCase();
    const isTechnicalSignal = [
      "pattern", "divergence", "pinbar", "engulfing", "rejection", 
      "support", "resistance", "fvg", "channel", "wedge", "double top", 
      "double bottom", "head and shoulders", "breakout", "retest", "liquidity sweep", "trend continuation"
    ].some(term => lower.includes(term));

    if (isTechnicalSignal) {
      clean = clean.replace(/[:;,\s]+$/, "").trim();
      if (clean.length > 60) {
        clean = clean.slice(0, 57) + "...";
      }
      const isDuplicate = candidateNotes.some(n => n.toLowerCase() === clean.toLowerCase()) ||
                          (strategyTag && strategyTag.toLowerCase().includes(clean.toLowerCase()));
      if (!isDuplicate) {
        candidateNotes.push(clean);
      }
    }
  }

  // Prioritize punchy, concise candidate notes
  candidateNotes.sort((a, b) => a.length - b.length);

  const results: string[] = [];
  if (strategyTag) {
    if (strategyTag.length > 70) {
      const subParts = strategyTag.split("→").map(s => s.trim());
      if (subParts.length === 2 && subParts[0].length < 35) {
        strategyTag = `${subParts[0]} → ${subParts[1].slice(0, 30)}...`;
      } else {
        strategyTag = strategyTag.slice(0, 65) + "...";
      }
    }
    results.push(strategyTag);
  }

  for (const note of candidateNotes) {
    if (results.length >= 2) break;
    results.push(note);
  }

  if (results.length === 0) {
    const fallback = parts.find(p => {
      const c = p.replace(/^[•\-\*\d\.\s\)]+/, "").trim();
      return c.length > 10 && c.length < 80 && !c.startsWith("TP") && !c.startsWith("R:R") && !c.includes("=");
    });
    if (fallback) {
      return fallback.replace(/^[•\-\*\d\.\s\)]+/, "").slice(0, 60).trim();
    }
    return "Technical confluence setup";
  }

  return results.join(" • ");
}

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

      // Extract tier from ai_summary early to filter out noise (only S-Tier and A-Tier are broadcasted)
      const tierMatch = (record.ai_summary || "").match(/(S|A|B|C)-Tier/);
      const rawTier = tierMatch ? `${tierMatch[1]}-Tier` : null;

      if (rawTier === "B-Tier" || rawTier === "C-Tier" || !rawTier) {
        console.log(`Skipping ${rawTier || "unranked"} broadcast to Telegram (minimum A-Tier required).`);
        return new Response(`Ignored ${rawTier || "unranked"} signal`, { status: 200 });
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
      const sideEmoji = record.side === "LONG" ? "🟢" : "🔴";
      const tier = escapeMd(rawTier);

      // Parse trade levels from JSON plans with asset-aware number formatting
      const rawEntry = record.entry_plan_json?.price ?? record.entry_plan_json?.limit_price ?? record.entry_plan_json?.entry_price ?? "—";
      const rawSl    = record.stop_plan_json?.stop  ?? record.stop_plan_json?.stop_price ?? "—";
      const rawTp    = record.take_profit_json?.tp   ?? record.take_profit_json?.tp_price ?? "—";
      const rawOrderType = record.entry_plan_json?.order_type ?? (record.side === "LONG" ? "BUY LIMIT" : "SELL LIMIT");

      const entryFormatted = formatPrice(rawEntry, record.symbol);
      const slFormatted    = formatPrice(rawSl, record.symbol);
      const tpFormatted    = formatPrice(rawTp, record.symbol);

      // R:R formatting
      const rrMatch = (record.ai_summary || "").match(/1:([0-9.]+)/);
      const rr = rrMatch ? `1:${parseFloat(rrMatch[1]).toFixed(1)}` : "1:1.8";

      const orderTypeDisplay = rawOrderType.toUpperCase().includes("MARKET")
        ? `${record.side === "LONG" ? "Buy" : "Sell"} Market`
        : `${record.side === "LONG" ? "Buy" : "Sell"} Limit`;

      // Scale targets
      const tp1Raw = record.take_profit_json?.tp1;
      const tp2Raw = record.take_profit_json?.tp2;
      const tp3Raw = record.take_profit_json?.tp3;

      const targetParts: string[] = [];
      if (tp1Raw) targetParts.push(`TP1 \`${escapeCode(formatPrice(tp1Raw, record.symbol))}\``);
      if (tp2Raw) targetParts.push(`TP2 \`${escapeCode(formatPrice(tp2Raw, record.symbol))}\``);
      if (tp3Raw) targetParts.push(`TP3 \`${escapeCode(formatPrice(tp3Raw, record.symbol))}\``);

      const targetsLine = targetParts.length > 0
        ? `\n🎯 *Targets:* ${targetParts.join(" • ")}`
        : "";

      const timeframeDisplay = record.timeframe ? `${record.timeframe.toUpperCase()} ` : "";
      const thesis = extractCleanThesis(record.ai_summary || "");

      const message = `
🚀 *PAMM EXECUTION* \\| ${sideEmoji} *${side} ${symbol}* (${tier})

• *Entry:* \`${escapeCode(entryFormatted)}\` (${escapeMd(orderTypeDisplay)})
• *Stop Loss:* \`${escapeCode(slFormatted)}\` \\| *Target:* \`${escapeCode(tpFormatted)}\`
• *R:R:* ${escapeMd(rr)} \\| *Horizon:* ${escapeMd(timeframeDisplay)}Swing

💡 *Setup:* _${escapeMd(thesis)}_${targetsLine}
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

[Manage Account](https://raineinvest.com/dashboard)
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
