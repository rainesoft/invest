import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const body = await req.json();
    const action = body?.action; // 'INTERNAL_TRANSFER' or 'SYNC_BALANCE'

    if (action === 'INTERNAL_TRANSFER') {
      const { amount, user_id, reference } = body;
      
      if (!amount || !user_id || !reference) {
        throw new Error("Missing required fields for internal transfer: amount, user_id, or reference");
      }

      console.log(`[Broker] Executing Internal Transfer of $${amount} to PAMM sub-account for user ${user_id}`);
      
      // TODO: Actual Exness Partner API integration for internal transfers:
      // const response = await fetch('https://exness.com/api/v1/partners/internal-transfers', {
      //   method: 'POST',
      //   headers: { 'Authorization': `Bearer ${EXNESS_API_KEY}` },
      //   body: JSON.stringify({ from: 'MASTER_WALLET', to: `PAMM_${user_id}`, amount })
      // });
      // if (!response.ok) throw new Error("Exness internal transfer failed");

      // For now, simulate a successful API call
      const transferId = `EXN-TRF-${Math.floor(Math.random() * 1000000)}`;

      // Audit the broker-side transfer
      await supabase.from('audit_logs').insert({
        action: "EXNESS_INTERNAL_TRANSFER_EXECUTED",
        actor_type: "SYSTEM",
        entity_type: "users",
        entity_id: user_id,
        payload_json: { 
          amount, 
          reference, 
          broker_transfer_id: transferId,
          status: "SUCCESS"
        }
      });

      return new Response(JSON.stringify({ 
        status: "success", 
        message: "Internal transfer executed",
        broker_transfer_id: transferId
      }), { headers: { "Content-Type": "application/json" } });
    }

    // Default Action: SYNC_BALANCE
    // TODO: Fetch from Exness API once keys are provisioned
    const currentEquity = 0.00;

    const { error: updateError } = await supabase
      .from('treasury_accounts')
      .update({ balance: currentEquity, last_synced_at: new Date().toISOString() })
      .eq('account_name', 'Exness Master Trading');

    if (updateError) {
      throw new Error(`Failed to update Exness balance in treasury: ${updateError.message}`);
    }

    return new Response(JSON.stringify({ 
      status: "success", 
      message: "Exness treasury synced",
      equity: currentEquity
    }), { headers: { "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("Error syncing exness treasury:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
