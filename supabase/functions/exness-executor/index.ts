import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { validateUserExposure } from "../../../packages/strategy/riskManager.ts";
import { insertAuditLog } from "../_shared/audit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface WebhookPayload {
  type?: "INSERT" | "UPDATE";
  table?: "trade_opportunities";
  record?: any;
  action?: "MANUAL_EXECUTION";
  user_id?: string;
  opportunity_id?: string;
}

serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- SECURITY AUTHORIZATION CHECK ---
    const webhookSecret = req.headers.get("x-webhook-secret");
    const authHeader = req.headers.get("Authorization");
    const expectedSecret = Deno.env.get("WEBHOOK_SECRET");

    if (webhookSecret) {
      if (webhookSecret !== expectedSecret) {
        return new Response("Unauthorized Webhook Secret", { status: 401 });
      }
    } else if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !user) {
        return new Response("Unauthorized JWT", { status: 401 });
      }
      
      if (payload.action === "MANUAL_EXECUTION" && payload.user_id !== user.id) {
        return new Response("Forbidden: JWT does not match payload user_id", { status: 403 });
      }
    } else {
      return new Response("Unauthorized: Missing credentials", { status: 401 });
    }
    // --- END SECURITY CHECK ---

    let signal: any = null;
    let usersToProcess: any[] = [];

    // --- MANUAL EXECUTION BRANCH ---
    if (payload.action === "MANUAL_EXECUTION") {
      if (!payload.user_id || !payload.opportunity_id) {
        return new Response(
          "Missing user_id or opportunity_id for manual execution",
          { status: 400 },
        );
      }

      // Fetch the signal
      const { data: oppData } = await supabase
        .from("trade_opportunities")
        .select("*")
        .eq("id", payload.opportunity_id)
        .single();
      if (!oppData) return new Response("Signal not found", { status: 404 });
      signal = oppData;

      // Fetch the specific user
      const { data: userData } = await supabase
        .from("user_risk_settings")
        .select("*")
        .eq("user_id", payload.user_id)
        .single();
      if (!userData)
        return new Response("User settings not found", { status: 404 });
      usersToProcess = [userData];
    }
    // --- WEBHOOK BRANCH ---
    else {
      if (payload.type !== "INSERT" && payload.type !== "UPDATE") {
        return new Response("Ignored non-actionable webhook", { status: 200 });
      }

      signal = payload.record;
      const oldSignal = (payload as any).old_record;

      if (
        payload.type === "UPDATE" &&
        oldSignal &&
        oldSignal.status === "APPROVED"
      ) {
        return new Response("Signal was already approved. Ignoring.", {
          status: 200,
        });
      }

      if (signal.status !== "APPROVED") {
        return new Response("Signal not approved.", { status: 200 });
      }

      // Fetch all active user risk settings
      const { data: users, error: usersError } = await supabase
        .from("user_risk_settings")
        .select("*");

      if (usersError || !users) {
        return new Response("No users found or error querying users.", {
          status: 500,
        });
      }

      // Extract the signal tier from ai_summary (e.g. "S-Tier", "A-Tier")
      const signalTier = (() => {
        const summary = signal.ai_summary || "";
        const match = summary.match(/(S|A|B|C)-Tier/m);
        return match ? `${match[1]}-Tier` : null;
      })();

      // Only include users who have the Master Auto-Trade Switch ON
      // and whose permitted tiers include this signal's tier.
      usersToProcess = users.filter(u => {
        if (!u.auto_trade_enabled) {
          console.log(`[Router] Skipping user ${u.user_id}: Master Auto-Trade Switch is OFF.`);
          return false;
        }
        if (signalTier && u.auto_trade_tiers && Array.isArray(u.auto_trade_tiers)) {
          if (!u.auto_trade_tiers.includes(signalTier)) {
            console.log(`[Router] Skipping user ${u.user_id}: Signal tier ${signalTier} not in permitted tiers [${u.auto_trade_tiers.join(', ')}].`);
            return false;
          }
        }
        return true;
      });

      if (usersToProcess.length === 0) {
        return new Response("No users opted in to auto-trade for this signal tier.", { status: 200 });
      }

    }

    const entryPlan = signal.entry_plan_json || {};
    const stopPlan = signal.stop_plan_json || {};

    const defaultEntryPrice =
      entryPlan.price || entryPlan.entry_price || entryPlan.limit_price;
    const scaledEntries =
      entryPlan.scaled_entries &&
      Array.isArray(entryPlan.scaled_entries) &&
      entryPlan.scaled_entries.length > 0
        ? entryPlan.scaled_entries
        : [{ price: defaultEntryPrice, weight: 1.0 }];
    const stopLoss = stopPlan.stop || stopPlan.stop_price;
    const takeProfit =
      signal.take_profit_json?.tp || signal.take_profit_json?.tp_price;

    const baseUrl =
      Deno.env.get("META_API_BASE_URL") ||
      "https://mt-client-api-v1.new-york.agiliumtrade.ai";

    let actionType = "ORDER_TYPE_BUY";
    const aiOrderType = (
      signal.entry_plan_json?.order_type || "Market"
    ).toUpperCase();

    if (aiOrderType.includes("BUY LIMIT")) actionType = "ORDER_TYPE_BUY_LIMIT";
    else if (aiOrderType.includes("SELL LIMIT"))
      actionType = "ORDER_TYPE_SELL_LIMIT";
    else if (aiOrderType.includes("BUY STOP"))
      actionType = "ORDER_TYPE_BUY_STOP";
    else if (aiOrderType.includes("SELL STOP"))
      actionType = "ORDER_TYPE_SELL_STOP";
    else if (signal.side === "LONG") actionType = "ORDER_TYPE_BUY";
    else actionType = "ORDER_TYPE_SELL";

    const executions = [];

    // Route signal to all target users
    for (const user of usersToProcess) {
      console.log(`[Router] Processing user ${user.user_id}`);

      // 1. Position Sizing
      for (const scaledEntry of scaledEntries) {
        const entryPrice = scaledEntry.price;
        const entryWeight = scaledEntry.weight || 1.0;
        const riskPerTrade =
          Number(user.portfolio_capital) *
          Number(user.risk_per_trade_pct) *
          entryWeight;
        const pointsAtRisk = Math.abs(entryPrice - stopLoss);

        const contractSizes: Record<string, number> = {
          UKOIL: 1000,
          XAUUSD: 100,
          XAGUSD: 5000,
          US30: 1,
          NAS100: 1,
          SPX500: 1,
          GER30: 1,
          BTCUSD: 1,
          EURUSD: 100000,
          GBPUSD: 100000,
          USDJPY: 100000,
        };
        const contractSize = contractSizes[signal.symbol] || 100000;

        let pointValueUsd = contractSize;
        if (signal.symbol.endsWith("JPY")) {
          pointValueUsd = contractSize / entryPrice;
        } else if (signal.symbol === "GER30") {
          pointValueUsd = contractSize * 1.1; // EUR multiplier approx
        }

        let volume =
          pointsAtRisk > 0
            ? riskPerTrade / (pointsAtRisk * pointValueUsd)
            : 0.01;
        volume = Math.max(0.01, Math.round(volume * 100) / 100);

        const userRiskAmount = pointsAtRisk * volume * pointValueUsd;

        // 2. Portfolio Heat Check
        const riskValidation = await validateUserExposure(
          supabase,
          user.user_id,
          userRiskAmount,
        );

        if (!riskValidation.valid) {
          console.log(
            `[Router] User ${user.user_id} rejected: ${riskValidation.reason}`,
          );
          await supabase.from("user_trades").insert({
            user_id: user.user_id,
            opportunity_id: signal.id,
            symbol: signal.symbol,
            side: signal.side,
            volume: volume,
            risk_amount: userRiskAmount,
            status: "REJECTED",
            error_message: riskValidation.reason,
          });
          executions.push({ user_id: user.user_id, status: "REJECTED", error_message: riskValidation.reason });
          continue;
        }

        // 2.5 Pre-Trade Tier Enforcer Check
        let tierExceeded = false;
        let tierRejectReason = "";

        if (
          user.is_live_execution_enabled &&
          user.meta_api_token &&
          user.meta_api_account_id
        ) {
          const { data: subData } = await supabase
            .from("user_subscriptions")
            .select("billing_amount_usd")
            .eq("user_id", user.user_id)
            .eq("status", "active")
            .single();

          if (subData) {
            const fee = subData.billing_amount_usd || 0;
            let maxEquity = Infinity;
            if (fee <= 9) maxEquity = 999;
            else if (fee <= 19) maxEquity = 2499;
            else if (fee <= 39) maxEquity = 4999;
            else if (fee <= 79) maxEquity = 9999;

            try {
              const accountUrl = `${baseUrl}/users/current/accounts/${user.meta_api_account_id}/accountInformation`;
              const accRes = await fetch(accountUrl, {
                headers: { "auth-token": user.meta_api_token },
              });
              if (accRes.ok) {
                const accData = await accRes.json();
                const equity = accData.equity || 0;

                // Drawdown Breaker Logic
                const maxDdPct = Number(user.max_drawdown_pct ?? 0.05);
                const hwm = Number(user.high_water_mark_equity ?? 0);

                if (equity > hwm) {
                  await supabase
                    .from("user_risk_settings")
                    .update({ high_water_mark_equity: equity })
                    .eq("user_id", user.user_id);
                } else if (hwm > 0) {
                  const currentDrawdown = (hwm - equity) / hwm;
                  if (currentDrawdown >= maxDdPct) {
                    tierExceeded = true;
                    tierRejectReason = `Drawdown Breaker Tripped! Account equity has dropped by ${(currentDrawdown * 100).toFixed(2)}% from peak. Trading halted to protect capital.`;
                  }
                }

                // Tier Limit Check (only if drawdown breaker wasn't tripped)
                if (!tierExceeded && equity > maxEquity) {
                  tierExceeded = true;
                  tierRejectReason = `Account equity ($${equity.toFixed(2)}) exceeds subscription tier limit ($${maxEquity}). Please upgrade your Autopilot plan.`;
                }
              }
            } catch (e) {
              console.error(
                `[Router] Failed to fetch account info for ${user.user_id}: ${e}`,
              );
            }
          }
        }

        if (tierExceeded) {
          console.log(
            `[Router] User ${user.user_id} rejected: ${tierRejectReason}`,
          );
          await supabase.from("user_trades").insert({
            user_id: user.user_id,
            opportunity_id: signal.id,
            symbol: signal.symbol,
            side: signal.side,
            volume: volume,
            risk_amount: userRiskAmount,
            status: "REJECTED",
            error_message: tierRejectReason,
          });
          // Notify user via Telegram (handled downstream by insert trigger on user_trades)
          executions.push({ user_id: user.user_id, status: "REJECTED", error_message: tierRejectReason });
          continue;
        }

        // 3. Spread Check
        let spreadExceeded = false;
        let spreadRejectReason = "";

        if (
          user.is_live_execution_enabled &&
          user.meta_api_token &&
          user.meta_api_account_id
        ) {
          try {
            const quoteUrl = `${baseUrl}/users/current/accounts/${user.meta_api_account_id}/symbols/${signal.symbol}/current-quote`;
            const quoteRes = await fetch(quoteUrl, {
              headers: { "auth-token": user.meta_api_token },
            });

            if (quoteRes.ok) {
              const quoteData = await quoteRes.json();
              if (quoteData.ask && quoteData.bid) {
                const diff = quoteData.ask - quoteData.bid;
                const bidStr = quoteData.bid.toString();
                const decimals = bidStr.includes(".")
                  ? bidStr.split(".")[1].length
                  : 0;
                const multiplier = Math.pow(10, decimals);
                const spreadPoints = Math.round(diff * multiplier);

                const maxPoints = Number(user.max_spread_points ?? 50);

                if (spreadPoints > maxPoints) {
                  spreadExceeded = true;
                  spreadRejectReason = `Spread exceeded tolerance (Current: ${spreadPoints} pts, Max: ${maxPoints} pts)`;
                }
              }
            }
          } catch (e) {
            console.error(
              `[Router] Failed to fetch spread for ${user.user_id}: ${e}`,
            );
          }
        }

        if (spreadExceeded) {
          console.log(
            `[Router] User ${user.user_id} rejected: ${spreadRejectReason}`,
          );
          await supabase.from("user_trades").insert({
            user_id: user.user_id,
            opportunity_id: signal.id,
            symbol: signal.symbol,
            side: signal.side,
            volume: volume,
            risk_amount: userRiskAmount,
            status: "REJECTED",
            error_message: spreadRejectReason,
          });
          executions.push({ user_id: user.user_id, status: "REJECTED", error_message: spreadRejectReason });
          continue;
        }

        // 4. Execution
        let status = "PENDING";
        let error_message = null;
        let meta_api_order_id = null;
        
        const tradeId = crypto.randomUUID();

        const isMarketOrder = actionType === "ORDER_TYPE_BUY" || actionType === "ORDER_TYPE_SELL";

        if (
          user.is_live_execution_enabled &&
          user.meta_api_token &&
          user.meta_api_account_id
        ) {
          if (!isMarketOrder) {
            // Soft Pending Order: Do NOT send limit/stop orders to the broker.
            // We will hold them internally and monitor price action before converting to a Market Order.
            status = "PENDING";
          } else {
            // Hard Market Order: Execute immediately
            const orderPayload: any = {
              actionType: actionType,
              symbol: signal.symbol,
              volume: volume,
              stopLoss: stopLoss,
              takeProfit: takeProfit,
              clientId: tradeId,
            };

            const atrRaw = signal.stop_plan_json?.atr;
            if (user.sync_trailing_stops && atrRaw && typeof atrRaw === 'number') {
              orderPayload.trailingStopLoss = {
                distance: {
                  distance: Number((atrRaw * 2.0).toFixed(5)),
                  units: "RELATIVE_PRICE"
                }
              };
            }

            try {
              const metaApiUrl = `${baseUrl}/users/current/accounts/${user.meta_api_account_id}/trade`;
              const response = await fetch(metaApiUrl, {
                method: "POST",
                headers: {
                  "auth-token": user.meta_api_token,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(orderPayload),
              });

              if (!response.ok) {
                error_message = await response.text();
                status = "FAILED";
              } else {
                const responseData = await response.json();
                meta_api_order_id = responseData.orderId || "EXECUTED";
                status = "OPEN";
              }
            } catch (e: any) {
              error_message = e.message;
              status = "FAILED";
            }
          }
        } else {
          // Paper trading
          status = isMarketOrder ? "PAPER_OPEN" : "PENDING";
        }

        // Record the user's trade execution
        // Record the user's trade execution
        const { error: insertError } = await supabase.from("user_trades").insert({
          id: tradeId,
          user_id: user.user_id,
          opportunity_id: signal.id,
          symbol: signal.symbol,
          side: signal.side,
          volume: volume,
          risk_amount: userRiskAmount,
          status: status,
          meta_api_order_id: meta_api_order_id,
          error_message: error_message,
        });

        if (insertError) {
          console.error(`[Router Error] Failed to insert trade for ${user.user_id}: ${insertError.message}`);
          await insertAuditLog(supabase, {
            actor_type: "SYSTEM",
            action: "TRADE_INSERT_ERROR",
            entity_type: "trade_opportunities",
            entity_id: signal.id,
            payload_json: { reason: "Database constraint or connection error during insertion", meta_api_order_id, error: insertError.message }
          });
        }

        executions.push({ user_id: user.user_id, status, error_message: error_message || riskValidation?.reason || spreadRejectReason || tierRejectReason });
      }
    }

    return new Response(JSON.stringify({ executions }), { status: 200 });
  } catch (error: any) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
