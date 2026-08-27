import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../../../packages/core/audit.ts";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                      EMAIL CAMPAIGNS & ONBOARDING HUB                    ║
 * ║  Unified hub for Day 0 Welcome emails, Day 3 & Day 7 Drip Campaigns,      ║
 * ║  and user communication lifecycle via Resend.                            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn(`[Email Campaigns] RESEND_API_KEY missing. Skipped sending to ${to}`);
    return { ok: false, error: "Missing RESEND_API_KEY" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "RaineInvest <system@raineinvest.com>",
        to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Email Campaigns] Failed to send email to ${to}:`, errText);
      return { ok: false, error: errText };
    }
    return { ok: true };
  } catch (e: any) {
    console.error(`[Email Campaigns] Network error sending to ${to}:`, e);
    return { ok: false, error: e.message };
  }
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let payload: any = {};
    if (req.method === "POST") {
      try {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          payload = JSON.parse(text);
        }
      } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────
    // 1. DAY 0 ONBOARDING (Database Webhook on auth.users INSERT)
    // ─────────────────────────────────────────────────────────────
    if (payload.type === "INSERT" && (payload.table === "users" || payload.schema === "auth")) {
      const email = payload.record?.email;
      if (!email) {
        return new Response(JSON.stringify({ message: "No email in insert record" }), { status: 200 });
      }

      console.log(`[Email Campaigns] Sending Day 0 Welcome email to ${email}...`);

      const htmlContent = `
        <div style="font-family: sans-serif; font-size: 15px; color: #111; line-height: 1.6; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #0f172a;">Welcome to the RaineInvest Vault</h2>
          <p>You now have access to the public ledger. Because you are on the free tier, the signals you see on the dashboard are delayed by 4+ hours to protect the edge of our institutional and Alpha clients.</p>
          <p>RaineInvest is built on three core tenets:</p>
          <ol>
            <li><strong>Deterministic Math:</strong> We don't guess. The engine processes raw market structure and momentum oscillators to mathematically define the regime.</li>
            <li><strong>AI Guardrails:</strong> A specialized LLM evaluates structural alignment and rejects subpar setups.</li>
            <li><strong>Strict Risk Isolation:</strong> We mandate strict 1:2 R/R minimums to protect capital.</li>
          </ol>
          <p>Watch the ledger this week. The math speaks for itself.</p>
          <p style="margin-top: 24px;">Best,<br><strong>RaineInvest Systems</strong></p>
        </div>
      `;

      const result = await sendEmail(email, "Welcome to the RaineInvest Vault", htmlContent);
      await insertAuditLog(supabase, {
        action: "EMAIL_CAMPAIGN_DISPATCHED",
        actor_type: "SYSTEM",
        entity_type: "users",
        entity_id: payload.record?.id,
        payload_json: { campaign: "DAY_0_ONBOARDING", email, success: result.ok },
      });

      return new Response(JSON.stringify({ success: result.ok, campaign: "DAY_0_ONBOARDING" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. DAILY DRIP CAMPAIGN (Day 3 Nurture + Day 7 Conversion)
    // ─────────────────────────────────────────────────────────────
    const isDailyDrip = payload.action === "DAILY_DRIP" || !payload.action;
    if (isDailyDrip) {
      console.log("[Email Campaigns] Starting Daily Drip evaluation...");
      let day3Count = 0;
      let day7Count = 0;

      // 2A. Day 3 Users (Created 3 days ago)
      const threeDaysAgoStart = new Date();
      threeDaysAgoStart.setDate(threeDaysAgoStart.getDate() - 3);
      threeDaysAgoStart.setUTCHours(0, 0, 0, 0);

      const threeDaysAgoEnd = new Date(threeDaysAgoStart);
      threeDaysAgoEnd.setUTCHours(23, 59, 59, 999);

      const { data: day3Users } = await supabase
        .from("user_subscriptions")
        .select("user_id, plan_tier")
        .eq("plan_tier", "free")
        .gte("created_at", threeDaysAgoStart.toISOString())
        .lte("created_at", threeDaysAgoEnd.toISOString());

      if (day3Users && day3Users.length > 0) {
        // Fetch top winning setup in the last 72 hours
        const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
        const { data: bestSignal } = await supabase
          .from("trade_opportunities")
          .select("*")
          .eq("status", "WON")
          .gte("created_at", seventyTwoHoursAgo)
          .order("r_multiple", { ascending: false })
          .limit(1)
          .maybeSingle();

        for (const sub of day3Users) {
          const { data: userResp } = await supabase.auth.admin.getUserById(sub.user_id);
          const email = userResp?.user?.email;
          if (!email) continue;

          const signalDesc = bestSignal
            ? `our recent ${bestSignal.symbol} ${bestSignal.side} setup which closed for a +${bestSignal.r_multiple || 2.0}R gain.`
            : `multiple high-probability Alpha setups with verified 1:2+ R/R performance.`;

          const htmlContent = `
            <div style="font-family: sans-serif; font-size: 15px; color: #111; line-height: 1.6; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0f172a;">The Cost of the Delay</h2>
              <p>You've been monitoring the RaineInvest delayed feed for a few days now.</p>
              <p>Because you are on the public tier, you missed the execution window for ${signalDesc}</p>
              <p>In this business, data latency is the cost of admission. When you are ready for real-time institutional intelligence, the Vault is waiting.</p>
              <p><a href="https://raineinvest.com/dashboard" style="display: inline-block; padding: 10px 18px; background: #0f172a; color: #ffffff; text-decoration: none; border-radius: 6px; margin-top: 12px;">Access Real-Time Vault</a></p>
              <p style="margin-top: 24px;">Best,<br><strong>RaineInvest Systems</strong></p>
            </div>
          `;

          await sendEmail(email, "The Cost of the Delay", htmlContent);
          day3Count++;
        }
      }

      // 2B. Day 7 Users (Created 7 days ago)
      const sevenDaysAgoStart = new Date();
      sevenDaysAgoStart.setDate(sevenDaysAgoStart.getDate() - 7);
      sevenDaysAgoStart.setUTCHours(0, 0, 0, 0);

      const sevenDaysAgoEnd = new Date(sevenDaysAgoStart);
      sevenDaysAgoEnd.setUTCHours(23, 59, 59, 999);

      const { data: day7Users } = await supabase
        .from("user_subscriptions")
        .select("user_id, plan_tier")
        .eq("plan_tier", "free")
        .gte("created_at", sevenDaysAgoStart.toISOString())
        .lte("created_at", sevenDaysAgoEnd.toISOString());

      if (day7Users && day7Users.length > 0) {
        for (const sub of day7Users) {
          const { data: userResp } = await supabase.auth.admin.getUserById(sub.user_id);
          const email = userResp?.user?.email;
          if (!email) continue;

          const htmlContent = `
            <div style="font-family: sans-serif; font-size: 15px; color: #111; line-height: 1.6; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #0f172a;">Take the limits off.</h2>
              <p>You have seen the system. You have watched the ledger. You know the math works.</p>
              <p>It's time to take off the training wheels.</p>
              <p>Upgrade to <strong>RaineInvest Alpha</strong> to unlock real-time execution signals, exact institutional TP/SL parameters, and full AI logic rationale.</p>
              <p>One successful 1:2 R setup covers the monthly subscription cost.</p>
              <p><a href="https://raineinvest.com/dashboard" style="display: inline-block; padding: 10px 18px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; margin-top: 12px;">Upgrade to Alpha Intelligence</a></p>
              <p style="margin-top: 24px;">Best,<br><strong>RaineInvest Systems</strong></p>
            </div>
          `;

          await sendEmail(email, "Take the limits off.", htmlContent);
          day7Count++;
        }
      }

      await insertAuditLog(supabase, {
        action: "EMAIL_CAMPAIGN_DISPATCHED",
        actor_type: "SYSTEM",
        payload_json: { campaign: "DAILY_DRIP", day3_sent: day3Count, day7_sent: day7Count },
      });

      return new Response(
        JSON.stringify({ success: true, day3_sent: day3Count, day7_sent: day7Count }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ message: "No matching campaign event" }), { status: 200 });
  } catch (error: any) {
    console.error("[Email Campaigns] Exception:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
