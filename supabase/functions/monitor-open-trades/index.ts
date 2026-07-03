import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../_shared/audit.ts";
import {
  exposureByCorrelationGroup,
  nextTrailLevel,
  shouldTightenTrail,
  trailStop,
} from "../../../packages/risk/index.ts";
import { fetchPaperBars, syncBrokerPosition, updateBrokerStopLoss } from "../../../packages/execution/index.ts";

/**
 * Simple per-minute monitor for open trades.
 *
 * Checks TTL, stop/target hits, max loss (1R), risk % caps, and manages trailing stops.
 */
serve(async (_req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ ok: false, error: "missing env" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  const supabase = createClient(url, key);

  const { data: trades, error } = await supabase
    .from("trades")
    .select(
      "id, symbol, correlation_group, side, qty, entry_price, stop_params_json, opened_at, opportunity_id",
    )
    .eq("status", "OPEN");
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const { data: limits } = await supabase
    .from("risk_limits")
    .select("cap_type, value")
    .eq("scope", "TRADE")
    .eq("active", true);
  const pctLimit = limits?.find((l) => l.cap_type === "PCT")?.value as
    | number
    | undefined;

  const { data: groupLimits } = await supabase
    .from("risk_limits")
    .select("cap_type, value")
    .eq("scope", "GROUP")
    .eq("active", true);
  const groupUsdLimit = groupLimits?.find((l) => l.cap_type === "USD")
    ?.value as number | undefined;

  let closed = 0;
  let openCount = 0;
  const positions: { group: string; qty: number; price: number }[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Grab the active user settings for broker API credentials
  const { data: settings } = await supabase.from('user_risk_settings').select('*').limit(1).single();
  const activeSettings = settings || { active_broker: 'ALPACA' };

  for (const t of trades ?? []) {
    // 1. Two-Way Sync: Check if the broker actually still has this position open
    const brokerPos = await syncBrokerPosition(t.symbol, activeSettings);
    
    // If the broker says it's closed (either manually or by broker TP/SL), sync the closure to our DB immediately
    if (!brokerPos.isOpen) {
      await supabase
        .from("trades")
        .update({
          status: "CLOSED",
          close_reason: "BROKER_SYNC",
          closed_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      
      closed++;
      await insertAuditLog(supabase, {
        actor_type: "SYSTEM",
        action: "CLOSE_TRADE",
        entity_type: "trade",
        entity_id: t.id,
        payload_json: { reason: "BROKER_SYNC", pnl: brokerPos.pl },
      });
      continue;
    }

    // Dynamically fetch live pricing from MetaAPI or Alpaca using user's DB credentials
    const bars = await fetchPaperBars(t.symbol, '1m', 1, supabase);
    const price = bars.length > 0 ? bars[0].c : null;
    
    if (price == null || t.qty == null) continue;
    let skipTrail = false;

    const opened = t.opened_at ? new Date(t.opened_at).getTime() : now;

    // Pull static plan (entry/stop/target) from opportunity if present
    const { data: opp } = await supabase
      .from("trade_opportunities")
      .select("entry_plan_json, stop_plan_json, take_profit_json")
      .eq("id", t.opportunity_id)
      .maybeSingle();

    // Dynamic (mutable) stop params from the trade row
    const entry = t.entry_price ?? opp?.entry_plan_json?.price ?? price;
    const stop =
      t.stop_params_json?.stop ?? opp?.stop_plan_json?.stop ?? null;
    const initial =
      t.stop_params_json?.initial ??
      opp?.stop_plan_json?.initial ??
      stop ??
      null;
    const lastLevel = t.stop_params_json?.trail_level ?? 0;
    const target = opp?.take_profit_json?.tp ?? null;

    const sideMult = t.side === "LONG" ? 1 : -1;
    const r = initial != null ? Math.abs(entry - initial) : null;
    const pnl = (price - entry) * t.qty * sideMult;
    const rMultiple = r ? ((price - entry) * sideMult) / r : 0;

    const { data: req } = await supabase
      .from("profit_take_requests")
      .select("id, expires_at")
      .eq("trade_id", t.id)
      .eq("status", "PENDING")
      .maybeSingle();

    if (req?.expires_at && new Date(req.expires_at).getTime() <= now) {
      if (r && initial != null) {
        const next = lastLevel + 0.5;
        const newStop = trailStop(entry, initial, next, t.side);
        // Push trailing stop modification to the live broker if permitted
        if (activeSettings.sync_trailing_stops) {
          await updateBrokerStopLoss(t.symbol, newStop, activeSettings, brokerPos.positionId);
        }

        await supabase
          .from("trades")
          .update({
            stop_params_json: {
              ...(t.stop_params_json ?? {}),
              stop: newStop,
              initial,
              trail_level: next,
            },
          })
          .eq("id", t.id);
      }
      await supabase
        .from("profit_take_requests")
        .update({
          status: "EXPIRED",
          decision_at: new Date().toISOString(),
        })
        .eq("id", req.id);
    }

    const pending =
      req?.expires_at && new Date(req.expires_at).getTime() > now;

    // Determine close reason(s)
    let reason = "";
    // Hard time-to-live
    if (!reason && now - opened > dayMs) reason = "TTL";

    // Percent risk cap check from opportunity plan
    if (!reason && entry && stop != null && pctLimit) {
      const riskPct =
        t.side === "LONG"
          ? ((entry - stop) / entry) * 100
          : ((stop - entry) / entry) * 100;
      if (riskPct > pctLimit) reason = "RISK";
    }

    // Stop/Target checks
    if (!reason && stop != null) {
      if (
        (t.side === "LONG" && price <= stop) ||
        (t.side === "SHORT" && price >= stop)
      ) {
        reason = "STOP";
      }
    }
    if (
      !reason &&
      target != null &&
      ((t.side === "LONG" && price >= target) ||
        (t.side === "SHORT" && price <= target))
    ) {
      if (!pending) {
        await supabase
          .from("profit_take_requests")
          .insert({
            trade_id: t.id,
            price,
            expires_at: new Date(now + 60_000).toISOString(),
          });
      }
      skipTrail = true;
    }

    // Max loss: breach of -1R from initial stop
    if (!reason && r && pnl <= -r * t.qty) {
      reason = "MAX_LOSS";
    }

    if (reason) {
      const { error: updErr } = await supabase
        .from("trades")
        .update({
          status: "CLOSED",
          close_reason: reason,
          closed_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      if (!updErr) {
        closed++;
        await insertAuditLog(supabase, {
          actor_type: "SYSTEM",
          action: "CLOSE_TRADE",
          entity_type: "trade",
          entity_id: t.id,
          payload_json: { reason },
        });
      }
      continue;
    }

    // Trailing stop management
    if (!skipTrail && r && shouldTightenTrail(rMultiple, lastLevel)) {
      const next = nextTrailLevel(rMultiple, lastLevel);
      if (next != null && initial != null) {
        const newStop = trailStop(entry, initial, next, t.side);
        // Push trailing stop modification to the live broker if permitted
        if (activeSettings.sync_trailing_stops) {
          await updateBrokerStopLoss(t.symbol, newStop, activeSettings, brokerPos.positionId);
        }

        await supabase
          .from("trades")
          .update({
            stop_params_json: {
              ...(t.stop_params_json ?? {}),
              stop: newStop,
              initial,
              trail_level: next,
            },
          })
          .eq("id", t.id);
      }
    }

    openCount++;
    positions.push({
      group: t.correlation_group ?? t.symbol,
      qty: t.qty,
      price,
    });
  }

  const exposures = exposureByCorrelationGroup(positions);

  const maxTrades = Number(Deno.env.get("MAX_CONCURRENT_TRADES") ?? "10");

  let killSwitch = false;
  if (openCount > maxTrades) killSwitch = true;
  for (const exp of Object.values(exposures)) {
    if (groupUsdLimit != null && Math.abs(exp) > groupUsdLimit) {
      killSwitch = true;
      break;
    }
  }

  if (killSwitch) {
    await supabase
      .from("audit_log")
      .insert({
        actor_type: "SYSTEM",
        action: "KILL_SWITCH",
        entity_type: "PORTFOLIO",
        payload_json: {
          openCount,
          exposures,
        },
      })
      .catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, closed, killSwitch }), {
    headers: { "content-type": "application/json" },
  });
});