import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Fetch Liability & Assets via RPC
    const { data: liabilityData, error: liabilityError } = await supabase.rpc('get_total_customer_liability');
    const { data: bankData, error: bankError } = await supabase.rpc('get_total_assets', { asset_type: 'BANK' });
    const { data: brokerData, error: brokerError } = await supabase.rpc('get_total_assets', { asset_type: 'BROKER' });

    if (liabilityError || bankError || brokerError) {
      throw new Error("Failed to fetch treasury aggregates from RPC");
    }

    const liability = Number(liabilityData || 0);
    const bankTotal = Number(bankData || 0);
    const exnessTotal = Number(brokerData || 0);
    
    const totalAssets = bankTotal + exnessTotal;
    const solvencyRatio = liability > 0 ? (totalAssets / liability) : 1.0;

    // 2. Insert Snapshot
    const { error: insertError } = await supabase.from('treasury_snapshots').insert({
      total_customer_liability: liability,
      bank_total: bankTotal,
      exness_master_total: exnessTotal,
      total_assets: totalAssets,
      solvency_ratio: solvencyRatio,
      notes: 'Automated Monthly Cron Snapshot'
    });

    if (insertError) {
      throw new Error(`Failed to insert snapshot: ${insertError.message}`);
    }

    return new Response(JSON.stringify({ 
      status: "success", 
      solvency_ratio: solvencyRatio,
      assets: totalAssets,
      liability: liability
    }), { headers: { "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("Error executing treasury snapshot:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
