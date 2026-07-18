import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { hmac } from "https://deno.land/x/crypto@v0.10.1/hmac.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY")!;

// Paystack verifies with HMAC SHA512
async function verifyPaystackSignature(payload: string, signature: string): Promise<boolean> {
  if (!signature || !paystackSecretKey) return false;
  
  // Deno Web Crypto API implementation of HMAC-SHA512
  const encoder = new TextEncoder();
  const keyBuf = encoder.encode(paystackSecretKey);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  
  const payloadBuf = encoder.encode(payload);
  const signatureBuf = await crypto.subtle.sign("HMAC", cryptoKey, payloadBuf);
  
  // Convert ArrayBuffer to Hex String
  const hashArray = Array.from(new Uint8Array(signatureBuf));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex === signature;
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const signature = req.headers.get('x-paystack-signature');
    const rawBody = await req.text();
    
    if (!signature) {
      return new Response('Missing signature', { status: 401 });
    }

    const isValid = await verifyPaystackSignature(rawBody, signature);
    
    if (!isValid) {
      console.error('Invalid Paystack signature');
      return new Response('Invalid signature', { status: 401 });
    }

    const event = JSON.parse(rawBody);
    console.log(`Received Paystack Event: ${event.event}`);

    // Create Supabase client with admin privileges to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    if (event.event === 'charge.success' && event.data.reference?.startsWith('DEP-')) {
      const reference = event.data.reference;
      console.log(`Processing successful deposit for reference: ${reference}`);
      
      // 1. Get deposit request
      const { data: request, error: reqError } = await supabase
        .from('deposit_requests')
        .select('*')
        .eq('reference_code', reference)
        .single();
        
      if (reqError || !request) {
        console.error(`Deposit request not found for reference: ${reference}`);
        return new Response('Deposit request not found', { status: 404 });
      }
      
      if (request.status !== 'PENDING_PAYMENT') {
        console.log(`Deposit ${reference} already processed. Current status: ${request.status}`);
        return new Response('Already processed', { status: 200 });
      }

      // 2. Update status to PENDING_CLEARANCE
      await supabase
        .from('deposit_requests')
        .update({ status: 'PENDING_CLEARANCE' })
        .eq('id', request.id);
        
      // 3. Update the wallet's ledger_balance
      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('ledger_balance')
        .eq('id', request.wallet_id)
        .single();
        
      if (!walletError && wallet) {
        await supabase
          .from('wallets')
          .update({ ledger_balance: Number(wallet.ledger_balance) + Number(request.amount) })
          .eq('id', request.wallet_id);
      }
      
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (event.event === 'charge.success' || event.event === 'subscription.create') {
      const email = event.data.customer.email;
      const customerCode = event.data.customer.customer_code;
      
      // Extract custom tokenized billing fields
      const authCode = event.data.authorization?.authorization_code || null;
      let billingAmountUSD = null;
      
      if (event.data.metadata && event.data.metadata.custom_fields) {
        const amountField = event.data.metadata.custom_fields.find((f: any) => f.variable_name === 'billing_amount_usd');
        if (amountField) {
          billingAmountUSD = parseInt(amountField.value, 10);
        }
      }

      console.log(`Processing successful payment for: ${email}`);

      // 1. Look up the user by email in auth.users
      const { data: users, error: userError } = await supabase.auth.admin.listUsers();
      
      if (userError || !users.users) {
        throw new Error(`Failed to list users: ${userError?.message}`);
      }
      
      const user = users.users.find((u: any) => u.email === email);

      if (!user) {
        console.warn(`User not found for email: ${email}. The webhook was successful but no account is linked.`);
        return new Response('User not found but webhook processed', { status: 200 });
      }

      // Calculate next billing date (30 days from now)
      const nextBillingDate = new Date();
      nextBillingDate.setDate(nextBillingDate.getDate() + 30);

      // 2. Update their subscription record with tokenized billing data
      const { error: updateError } = await supabase
        .from('user_subscriptions')
        .update({
          plan_tier: 'pro',
          paystack_customer_code: customerCode,
          paystack_auth_code: authCode,
          billing_amount_usd: billingAmountUSD,
          next_billing_date: nextBillingDate.toISOString(),
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('Failed to update user_subscriptions', updateError);
        throw updateError;
      }

      // 3. Auto-unlock Live Execution!
      const { error: riskError } = await supabase
        .from('user_risk_settings')
        .update({
          is_live_execution_enabled: true
        })
        .eq('user_id', user.id);

      if (riskError) {
        console.error('Failed to update user_risk_settings', riskError);
      }

      console.log(`Successfully upgraded user ${user.id} to pro tier and unlocked live execution.`);
    } else if (event.event === 'subscription.disable' || event.event === 'charge.failed') {
      const email = event.data.customer.email;
      console.log(`Processing subscription cancellation for: ${email}`);
      
      const { data: users, error: userError } = await supabase.auth.admin.listUsers();
      if (userError || !users.users) throw new Error(`Failed to list users: ${userError?.message}`);
      
      const user = users.users.find((u: any) => u.email === email);
      if (user) {
        await supabase.from('user_subscriptions').update({
          plan_tier: 'free',
          status: 'canceled',
          updated_at: new Date().toISOString()
        }).eq('user_id', user.id);

        await supabase.from('user_risk_settings').update({
          is_live_execution_enabled: false
        }).eq('user_id', user.id);

        console.log(`Successfully downgraded user ${user.id} to free tier and locked live execution.`);
      }
    }

    // You can handle other events here (e.g. subscription.disable, invoice.payment_failed)

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Webhook Error:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 500 });
  }
});
