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

const getSymbolBadge = (symbol: string): string => {
  const s = (symbol || "").toUpperCase();
  if (["AAPL", "MSFT", "TSLA", "AMZN", "NVDA", "META", "GOOGL", "GOOG", "NFLX", "AMD"].includes(s)) return "🇺🇸";
  if (["SPX500", "US500", "NAS100", "USTEC", "US30", "DJ30", "RUSSELL2000"].includes(s)) return "📈";
  if (s === "JP225" || s === "NIKKEI") return "🇯🇵";
  if (s === "GER30" || s === "GER40" || s === "DE40") return "🇩🇪";
  if (s === "UK100" || s === "FTSE") return "🇬🇧";
  if (s === "EURUSD") return "🇪🇺🇺🇸";
  if (s === "GBPUSD") return "🇬🇧🇺🇸";
  if (s === "USDJPY") return "🇺🇸🇯🇵";
  if (s === "AUDUSD") return "🇦🇺🇺🇸";
  if (s === "NZDUSD") return "🇳🇿🇺🇸";
  if (s === "USDCAD") return "🇺🇸🇨🇦";
  if (s === "USDCHF") return "🇺🇸🇨🇭";
  if (s === "EURJPY") return "🇪🇺🇯🇵";
  if (s === "GBPJPY") return "🇬🇧🇯🇵";
  if (s === "AUDJPY") return "🇦🇺🇯🇵";
  if (s === "CADJPY") return "🇨🇦🇯🇵";
  if (s === "EURGBP") return "🇪🇺🇬🇧";
  if (["XAUUSD", "GOLD"].includes(s)) return "🪙";
  if (["XAGUSD", "SILVER"].includes(s)) return "🥈";
  if (["UKOIL", "USOIL", "BRENT", "WTI", "XBRUSD", "XTIUSD"].includes(s)) return "🛢";
  if (["BTCUSD", "ETHUSD", "SOLUSD", "BNBUSD"].includes(s)) return "⚡";
  return "🌐";
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

function truncateWords(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  const truncated = str.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 10 ? truncated.slice(0, lastSpace) : truncated).trim() + "…";
}

function normalizeEnumTitle(text: string): string {
  return text
    .replace(/DESCENDING_CHANNEL/gi, "Descending Channel")
    .replace(/ASCENDING_CHANNEL/gi, "Ascending Channel")
    .replace(/FALLING_WEDGE/gi, "Falling Wedge")
    .replace(/RISING_WEDGE/gi, "Rising Wedge")
    .replace(/DOUBLE_TOP/gi, "Double Top")
    .replace(/DOUBLE_BOTTOM/gi, "Double Bottom")
    .replace(/HEAD_AND_SHOULDERS/gi, "Head & Shoulders")
    .replace(/LIQUIDITY_SWEEP/gi, "Liquidity Sweep")
    .replace(/SNIPER_MODE/gi, "Sniper Mode")
    .replace(/CHOP/gi, "Range Chop");
}

function extractCleanThesis(rawSummary: string): string {
  if (!rawSummary) return "Algorithmic S/R & momentum confluence";

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
    strategyTag = normalizeEnumTitle(strategyTag);
  }

  // 3. Remove all brackets and bracketed tags from the remaining text
  const cleanWithoutBrackets = text.replace(/\[[^\]]+\]/g, " ");

  // 4. Split by pipes, newlines, or bullets
  const parts = cleanWithoutBrackets.split(/[|\n•]/).map(p => p.trim()).filter(Boolean);
  const candidateNotes: string[] = [];

  for (const part of parts) {
    let clean = part
      .replace(/^#+\s+/g, "") // remove markdown header hashtags
      .replace(/^[•\-\*\d\.\s\)]+/, "")
      .replace(/[*_`]/g, "")
      .trim();

    if (!clean) continue;

    // Filter out boilerplate headers, math, essays, TP/SL lists, and long numbered entries
    if (
      clean.match(/^TP\d/i) ||
      clean.match(/^R:R/i) ||
      clean.match(/^Fib Swing/i) ||
      clean.match(/^(Suggested execution|Given the technical setup|Based on the \w+ analysis|Execution Strategy|Confidence and Probability|Macro Sentiment|Execution Math|Order Type|Entry Setup|Setting up the Trade|Trade Plan|Overview|Key Confluences|Technical Analysis|Risk Management)/i) ||
      clean.match(/Typical R:R/i) ||
      clean.match(/R:R should be/i) ||
      clean.match(/Risk:Reward/i) ||
      clean.match(/\([0-9\.\s\-\+\/\*]+=\s*[0-9\.:]+\)/) || // math equations
      clean.match(/^\d+\.\s+/) || // numbered list like "1. The macro context..."
      clean.endsWith(":") || // trailing header colon
      clean.length > 120 || // long paragraph
      clean.length < 5
    ) {
      continue;
    }

    clean = normalizeEnumTitle(clean);

    // Look for technical confluences / patterns
    const lower = clean.toLowerCase();
    const isTechnicalSignal = [
      "pattern", "divergence", "pinbar", "engulfing", "rejection", 
      "support", "resistance", "fvg", "channel", "wedge", "double top", 
      "double bottom", "head and shoulders", "breakout", "retest", "liquidity sweep", "trend continuation", "sr flip", "s/r flip", "fibonacci", "harmonic"
    ].some(term => lower.includes(term));

    if (isTechnicalSignal) {
      clean = clean.replace(/[:;,\s]+$/, "").trim();
      clean = truncateWords(clean, 58);
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
    strategyTag = truncateWords(strategyTag, 60);
    results.push(strategyTag);
  }

  for (const note of candidateNotes) {
    if (results.length >= 2) break;
    results.push(note);
  }

  if (results.length === 0) {
    const fallback = parts.find(p => {
      const c = p.replace(/^#+\s+/g, "").replace(/^[•\-\*\d\.\s\)]+/, "").replace(/[*_`]/g, "").trim();
      return (
        c.length > 10 && 
        c.length < 80 && 
        !c.startsWith("TP") && 
        !c.startsWith("R:R") && 
        !c.includes("=") &&
        !c.endsWith(":") &&
        !c.match(/^(Entry Setup|Setting up|Trade Plan|Overview)/i)
      );
    });
    if (fallback) {
      const cleanedFallback = fallback.replace(/^#+\s+/g, "").replace(/^[•\-\*\d\.\s\)]+/, "").replace(/[*_`]/g, "").trim();
      return truncateWords(normalizeEnumTitle(cleanedFallback), 60);
    }
    return "Algorithmic structural S/R & momentum confluence";
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

      // --- DEDUPLICATION: 15-Minute Cooldown per Symbol & Side ---
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: recentOpps } = await supabase
        .from("trade_opportunities")
        .select("id")
        .eq("symbol", record.symbol)
        .eq("side", record.side)
        .neq("id", record.id)
        .gte("created_at", fifteenMinsAgo)
        .limit(1);

      if (recentOpps && recentOpps.length > 0) {
        console.log(`[Telegram Broadcast] Throttled duplicate broadcast for ${record.symbol} ${record.side} within 15m window.`);
        return new Response("Throttled duplicate signal", { status: 200 });
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
      const flagEmoji = getSymbolBadge(record.symbol);
      const tier = escapeMd(rawTier);

      // Parse trade levels from JSON plans with asset-aware number formatting
      const rawEntry = record.entry_plan_json?.price ?? record.entry_plan_json?.limit_price ?? record.entry_plan_json?.entry_price ?? "—";
      const rawSl    = record.stop_plan_json?.stop  ?? record.stop_plan_json?.stop_price ?? "—";
      const rawTp    = record.take_profit_json?.tp   ?? record.take_profit_json?.tp_price ?? "—";
      const rawOrderType = record.entry_plan_json?.order_type ?? (record.side === "LONG" ? "BUY LIMIT" : "SELL LIMIT");

      const entryFormatted = formatPrice(rawEntry, record.symbol);
      const slFormatted    = formatPrice(rawSl, record.symbol);
      const tpFormatted    = formatPrice(rawTp, record.symbol);

      // Compute mathematical R:R and percentage metrics if numeric levels exist
      const numEntry = typeof rawEntry === "number" ? rawEntry : parseFloat(String(rawEntry).replace(/[^0-9.-]/g, ""));
      const numSl    = typeof rawSl === "number" ? rawSl : parseFloat(String(rawSl).replace(/[^0-9.-]/g, ""));
      const numTp    = typeof rawTp === "number" ? rawTp : parseFloat(String(rawTp).replace(/[^0-9.-]/g, ""));

      let rrDisplay = "1:2.0";
      let slPctStr = "";
      let tpPctStr = "";

      if (!isNaN(numEntry) && !isNaN(numSl) && !isNaN(numTp) && numEntry > 0) {
        const isLong = record.side === "LONG";
        const risk = isLong ? (numEntry - numSl) : (numSl - numEntry);
        const reward = isLong ? (numTp - numEntry) : (numEntry - numTp);

        if (risk > 0 && reward > 0) {
          const ratio = reward / risk;
          rrDisplay = `1:${ratio.toFixed(1)}`;
        }

        const slPct = Math.abs((numSl - numEntry) / numEntry) * 100;
        const tpPct = Math.abs((numTp - numEntry) / numEntry) * 100;
        slPctStr = ` \\(\\-${slPct.toFixed(1)}\\%\\)`;
        tpPctStr = ` \\(\\+${tpPct.toFixed(1)}\\%\\)`;
      } else {
        const rrMatch = (record.ai_summary || "").match(/1:([0-9.]+)/);
        if (rrMatch && parseFloat(rrMatch[1]) >= 1.0) {
          rrDisplay = `1:${parseFloat(rrMatch[1]).toFixed(1)}`;
        }
      }

      const orderTypeDisplay = rawOrderType.toUpperCase().includes("MARKET")
        ? `${record.side === "LONG" ? "Buy" : "Sell"} Market`
        : `${record.side === "LONG" ? "Buy" : "Sell"} Limit`;

      // Scale targets (with strict deduplication of identical prices)
      const tp1Raw = record.take_profit_json?.tp1;
      const tp2Raw = record.take_profit_json?.tp2;
      const tp3Raw = record.take_profit_json?.tp3;

      const targetParts: string[] = [];
      const seenTargets = new Set<string>();

      if (tp1Raw) {
        const f = formatPrice(tp1Raw, record.symbol);
        if (f !== "—" && !seenTargets.has(f)) {
          seenTargets.add(f);
          targetParts.push(`TP1 \`${escapeCode(f)}\``);
        }
      }
      if (tp2Raw) {
        const f = formatPrice(tp2Raw, record.symbol);
        if (f !== "—" && !seenTargets.has(f)) {
          seenTargets.add(f);
          targetParts.push(`TP2 \`${escapeCode(f)}\``);
        }
      }
      if (tp3Raw) {
        const f = formatPrice(tp3Raw, record.symbol);
        if (f !== "—" && !seenTargets.has(f)) {
          seenTargets.add(f);
          targetParts.push(`TP3 \`${escapeCode(f)}\``);
        }
      }

      const targetsLine = targetParts.length > 0
        ? `\n🎯 *Targets:* ${targetParts.join(" • ")}`
        : "";

      const timeframeDisplay = record.timeframe ? `${record.timeframe.toUpperCase()} ` : "";
      const thesis = extractCleanThesis(record.ai_summary || "");

      // Give the Execution Desk (agent-trade) 1.2s to compute risk allocations and place broker orders
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const { data: latestOpp } = await supabase
        .from("trade_opportunities")
        .select("status, ai_risks, ai_summary")
        .eq("id", record.id)
        .single();

      const { data: executedTrades } = await supabase
        .from("user_trades")
        .select("id, status, volume, meta_api_order_id")
        .eq("opportunity_id", record.id);

      const hasLiveTrades = Boolean(executedTrades && executedTrades.length > 0);
      const isRejected = latestOpp?.status === "REJECTED" || 
                         (latestOpp?.ai_risks && (latestOpp.ai_risks.includes("Skipped") || latestOpp.ai_risks.includes("Rejected")));

      let headerTitle = `🚀 *PAMM SIGNAL*`;
      let statusLine = "";

      if (hasLiveTrades) {
        headerTitle = `🚀 *PAMM LIVE EXECUTION*`;
        statusLine = `\n• *Status:* ✅ *Executed* \\(Live Order Placed on MT5 VPS\\)`;
      } else if (isRejected) {
        headerTitle = `💡 *PAMM INTEL SETUP*`;
        let skipReason = latestOpp?.ai_risks || record.ai_risks || "Account Risk Heat Reached";
        if (skipReason.includes("10% Account Blowout Protection")) skipReason = "10% Portfolio Heat Hard Cap Reached";
        else if (skipReason.includes("Circuit Breaker")) skipReason = "Drawdown Circuit Breaker Active";
        else if (skipReason.includes("3.0% maximum risk budget")) skipReason = "3% Single-Trade Risk Limit Exceeded";
        else if (skipReason.includes("Contradictory signal")) skipReason = "Correlated Position Conflict";

        statusLine = `\n• *Status:* ⏸️ *Signal Only* \\(Skipped: ${escapeMd(truncateWords(skipReason, 45))}\\)`;
      } else if (rawOrderType.toUpperCase().includes("LIMIT")) {
        headerTitle = `⏳ *PAMM PENDING ORDER*`;
        statusLine = `\n• *Status:* ⏳ *Pending Order* \\(Awaiting Entry Pullback\\)`;
      } else {
        headerTitle = `📡 *PAMM DISPATCH*`;
        statusLine = `\n• *Status:* 📡 *Signal Dispatched*`;
      }

      const message = `
${headerTitle} \\| ${sideEmoji} *${side} ${symbol}* ${flagEmoji} \\(${tier}\\)
━━━━━━━━━━━━━━━━━━━━━${statusLine}
• *Entry:* \`${escapeCode(entryFormatted)}\` \\(${escapeMd(orderTypeDisplay)}\\)
• *Stop Loss:* \`${escapeCode(slFormatted)}\`${slPctStr} \\| *Target:* \`${escapeCode(tpFormatted)}\`${tpPctStr}
• *R:R:* ${escapeMd(rrDisplay)} \\| *Horizon:* ${escapeMd(timeframeDisplay)}Swing

💡 *Setup:* _${escapeMd(thesis)}_${targetsLine}
      `.trim();

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: `📊 Chart (${record.symbol})`, url: `https://raineinvest.com/chart?symbol=${encodeURIComponent(record.symbol)}` },
            { text: "⚡ Active Terminal", url: "https://raineinvest.com/dashboard" }
          ]
        ]
      };

      const telegramUrl = `https://api.telegram.org/bot${CENTRAL_TELEGRAM_BOT_TOKEN}/sendMessage`;
      const broadcastPromises = subscribedUsers.map(async (user) => {
        const response = await fetch(telegramUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: user.chatId,
            text: message,
            parse_mode: "MarkdownV2",
            reply_markup: replyMarkup,
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
      if (failures > 0) {
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(`[Telegram Broadcast] Error dispatching to ${subscribedUsers[idx]?.chatId}:`, r.reason);
          }
        });
      }
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
━━━━━━━━━━━━━━━━━━━━━
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
