import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!RESEND_API_KEY) {
      console.error("Missing RESEND_API_KEY");
      return new Response("Server Configuration Error", { status: 500 });
    }

    // 1. Identify users created 3 days ago (Day 3 Drip)
    const threeDaysAgoStart = new Date();
    threeDaysAgoStart.setDate(threeDaysAgoStart.getDate() - 3);
    threeDaysAgoStart.setUTCHours(0, 0, 0, 0);

    const threeDaysAgoEnd = new Date(threeDaysAgoStart);
    threeDaysAgoEnd.setUTCHours(23, 59, 59, 999);

    const { data: day3Users, error: err3 } = await supabase
      .from('user_subscriptions')
      .select('user_id, auth.users!inner(email)')
      .eq('plan_tier', 'free')
      .gte('created_at', threeDaysAgoStart.toISOString())
      .lte('created_at', threeDaysAgoEnd.toISOString());

    if (err3) console.error("Error fetching Day 3 users:", err3);

    // If there are Day 3 users, find the best signal from the last 72 hours
    if (day3Users && day3Users.length > 0) {
      const seventyTwoHoursAgo = new Date();
      seventyTwoHoursAgo.setHours(seventyTwoHoursAgo.getHours() - 72);

      const { data: bestSignal } = await supabase
        .from('trade_opportunities')
        .select('*')
        .eq('status', 'WON')
        .gte('created_at', seventyTwoHoursAgo.toISOString())
        .order('r_multiple', { ascending: false })
        .limit(1)
        .single();

      if (bestSignal) {
        const emailPromises = day3Users.map((u: any) => {
          const email = u.users.email;
          const htmlContent = `
            <div style="font-family: sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
              <p>You've been monitoring the RaineInvest delayed feed for a few days now.</p>
              <p>Because you are on the public tier, you missed the execution window for our recent ${bestSignal.symbol} ${bestSignal.side} setup. It closed for a +${bestSignal.r_multiple}R gain.</p>
              <p><strong>The Institutional Rationale you missed:</strong><br/>
              <em>"${bestSignal.ai_summary || "Mathematical structural alignment."}"</em></p>
              <p>In this business, data latency is the cost of admission. When you are ready for real-time institutional intelligence, the Vault is waiting.</p>
              <p>Best,<br>RaineInvest Systems</p>
            </div>
          `;

          return fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
            body: JSON.stringify({
              from: "RaineInvest <system@raineinvest.com>",
              to: email,
              subject: "The Cost of the Delay",
              html: htmlContent,
            }),
          });
        });
        await Promise.all(emailPromises);
      }
    }

    // 2. Identify users created 7 days ago (Day 7 Upsell)
    const sevenDaysAgoStart = new Date();
    sevenDaysAgoStart.setDate(sevenDaysAgoStart.getDate() - 7);
    sevenDaysAgoStart.setUTCHours(0, 0, 0, 0);

    const sevenDaysAgoEnd = new Date(sevenDaysAgoStart);
    sevenDaysAgoEnd.setUTCHours(23, 59, 59, 999);

    const { data: day7Users, error: err7 } = await supabase
      .from('user_subscriptions')
      .select('user_id, auth.users!inner(email)')
      .eq('plan_tier', 'free')
      .gte('created_at', sevenDaysAgoStart.toISOString())
      .lte('created_at', sevenDaysAgoEnd.toISOString());

    if (err7) console.error("Error fetching Day 7 users:", err7);

    if (day7Users && day7Users.length > 0) {
      const emailPromises = day7Users.map((u: any) => {
        const email = u.users.email;
        const htmlContent = `
          <div style="font-family: sans-serif; font-size: 15px; color: #111; line-height: 1.6;">
            <p>You have seen the system. You have watched the ledger. You know the math works.</p>
            <p>It's time to take off the training wheels.</p>
            <p>Upgrade to <strong>RaineInvest Alpha</strong> to unlock real-time execution signals, exact institutional TP/SL parameters, and full AI logic rationale.</p>
            <p>One successful 1:2 R setup covers the $99 monthly subscription cost.</p>
            <p><a href="https://raineinvest.com/dashboard">Upgrade to Alpha Intelligence here.</a></p>
            <p>Best,<br>RaineInvest Systems</p>
          </div>
        `;

        return fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify({
            from: "RaineInvest <system@raineinvest.com>",
            to: email,
            subject: "Take the limits off.",
            html: htmlContent,
          }),
        });
      });
      await Promise.all(emailPromises);
    }

    return new Response(JSON.stringify({ success: true, processed: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Drip campaign error:", error);
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
});
