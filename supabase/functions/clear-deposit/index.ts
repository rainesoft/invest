import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { insertAuditLog } from "../../../packages/core/audit.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminSecret = Deno.env.get("ADMIN_SECRET_KEY") || "SUPER_SECRET_ADMIN_KEY";

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const authHeader = req.headers.get("x-admin-secret");
    if (!authHeader || authHeader !== adminSecret) {
      return new Response("Unauthorized Admin Access", { status: 401 });
    }

    const { deposit_id } = await req.json();
    if (!deposit_id) {
      return new Response(JSON.stringify({ error: "Missing deposit_id" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 1. Fetch the deposit request
    const { data: request, error: reqError } = await supabase
      .from('deposit_requests')
      .select('*')
      .eq('id', deposit_id)
      .single();

    if (reqError || !request) {
      return new Response(JSON.stringify({ error: "Deposit request not found" }), { status: 404 });
    }

    if (request.status !== 'PENDING_CLEARANCE') {
      return new Response(JSON.stringify({ error: `Deposit is in status: ${request.status}. Only PENDING_CLEARANCE can be cleared.` }), { status: 400 });
    }

    // 2. Fetch the wallet
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('id', request.wallet_id)
      .single();

    if (walletError || !wallet) {
      return new Response(JSON.stringify({ error: "Wallet not found" }), { status: 404 });
    }

    const amount = Number(request.amount);

    // 3. Mark the deposit as CLEARED
    const { error: updateReqError } = await supabase
      .from('deposit_requests')
      .update({ status: 'CLEARED', updated_at: new Date().toISOString() })
      .eq('id', deposit_id);

    if (updateReqError) {
      throw new Error(`Failed to update deposit status: ${updateReqError.message}`);
    }

    // 4. Update the wallet's balance
    const { error: updateWalletError } = await supabase
      .from('wallets')
      .update({ 
        balance: Number(wallet.balance || 0) + amount,
        updated_at: new Date().toISOString()
      })
      .eq('id', request.wallet_id);

    if (updateWalletError) {
      throw new Error(`Failed to update wallet balance: ${updateWalletError.message}`);
    }

    // 5. Invoke sync-exness-treasury to perform Internal Transfer
    const { data: syncData, error: syncError } = await supabase.functions.invoke('sync-exness-treasury', {
      body: { 
        action: 'INTERNAL_TRANSFER', 
        amount: amount,
        user_id: request.user_id,
        reference: request.reference_code
      }
    });

    if (syncError) {
      console.error("Broker Sync failed, but DB cleared successfully:", syncError);
      await insertAuditLog(supabase, {
        action: "DEPOSIT_BROKER_SYNC_FAILED",
        actor_type: "SYSTEM",
        entity_type: "deposit_requests",
        entity_id: deposit_id,
        payload_json: { error: syncError.message }
      });
    } else {
      console.log("Broker sync successful:", syncData);
    }

    // 6. Insert Audit Log
    await insertAuditLog(supabase, {
      action: "MANUAL_DEPOSIT_CLEARANCE",
      actor_type: "ADMIN",
      entity_type: "deposit_requests",
      entity_id: deposit_id,
      payload_json: { amount, old_status: "PENDING_CLEARANCE", new_status: "CLEARED", broker_sync_success: !syncError }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Deposit cleared and synced to broker",
      broker_sync: !syncError
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Clearance Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
