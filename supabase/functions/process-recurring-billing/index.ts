import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY")!;

serve(async (req) => {
  // Add simple auth if called externally, but pg_cron typically calls via internal bypass
  // We'll enforce a service role key in the authorization header
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${supabaseServiceRoleKey}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

  try {
    // 1. Fetch live USD -> GHS rate
    let exchangeRate = 15.0; // Fallback
    try {
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const data = await res.json();
      if (data?.rates?.GHS) exchangeRate = data.rates.GHS;
    } catch (e) {
      console.error("Failed to fetch exchange rate, using fallback.", e);
    }

    // 2. Query due subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('status', 'active')
      .not('paystack_auth_code', 'is', null)
      .not('billing_amount_usd', 'is', null)
      .lte('next_billing_date', new Date().toISOString());

    if (subError) throw subError;

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No subscriptions due for billing." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Process each subscription
    let successCount = 0;
    let failCount = 0;

    for (const sub of subscriptions) {
      try {
        // Fetch user email
        const { data: userResp, error: userError } = await supabase.auth.admin.getUserById(sub.user_id);
        if (userError || !userResp.user?.email) throw new Error("Could not fetch user email");

        const email = userResp.user.email;
        const amountPesewas = Math.round(sub.billing_amount_usd * exchangeRate * 100);

        // Charge Authorization via Paystack
        const chargeRes = await fetch('https://api.paystack.co/transaction/charge_authorization', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            authorization_code: sub.paystack_auth_code,
            email: email,
            amount: amountPesewas,
            currency: 'GHS'
          })
        });

        const chargeData = await chargeRes.json();

        if (chargeData.status && chargeData.data.status === 'success') {
          // Success! Bump the next billing date by 30 days
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + 30);
          
          await supabase
            .from('user_subscriptions')
            .update({ next_billing_date: nextDate.toISOString() })
            .eq('id', sub.id);
            
          successCount++;
        } else {
          // Charge failed, mark past due
          await supabase
            .from('user_subscriptions')
            .update({ status: 'past_due' })
            .eq('id', sub.id);
            
          failCount++;
          console.error(`Charge failed for ${email}:`, chargeData);
        }
      } catch (err: any) {
        console.error(`Error processing subscription ${sub.id}:`, err);
        failCount++;
      }
    }

    return new Response(JSON.stringify({ 
      processed: subscriptions.length, 
      success: successCount, 
      failed: failCount 
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
