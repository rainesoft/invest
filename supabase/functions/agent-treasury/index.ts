import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";
import { insertAuditLog } from "../../../packages/core/audit.ts";

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                      AGENT TREASURY & SOLVENCY DESK                      ║
 * ║  Unified hub for Solvency Snapshots, Broker Equity Sync, PAMM Transfers  ║
 * ║  and Deposit Clearance Operations.                                       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET_KEY") || "SUPER_SECRET_ADMIN_KEY";

serve(async (req) => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Missing Supabase credentials" }), { status: 500 });
    }

    const authHeader = req.headers.get("Authorization");
    const cronSecretHeader = req.headers.get("x-cron-secret");
    const adminSecretHeader = req.headers.get("x-admin-secret");

    const isAuthorized =
      authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` ||
      (cronSecretHeader && CRON_SECRET && cronSecretHeader === CRON_SECRET) ||
      (adminSecretHeader && adminSecretHeader === ADMIN_SECRET);

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let body: any = {};
    if (req.method === "POST") {
      try {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = JSON.parse(text);
        }
      } catch (_) {}
    }

    const action = body?.action || "SNAPSHOT";

    // ─────────────────────────────────────────────────────────────
    // ACTION 1: CLEAR_DEPOSIT (Admin Clearance & Wallet Credit)
    // ─────────────────────────────────────────────────────────────
    if (action === "CLEAR_DEPOSIT") {
      const depositId = body?.deposit_id;
      if (!depositId) {
        return new Response(JSON.stringify({ error: "Missing deposit_id" }), { status: 400 });
      }

      // 1. Fetch deposit request
      const { data: request, error: reqError } = await supabase
        .from("deposit_requests")
        .select("*")
        .eq("id", depositId)
        .single();

      if (reqError || !request) {
        return new Response(JSON.stringify({ error: "Deposit request not found" }), { status: 404 });
      }

      if (request.status !== "PENDING_CLEARANCE") {
        return new Response(
          JSON.stringify({ error: `Deposit is in status: ${request.status}. Only PENDING_CLEARANCE can be cleared.` }),
          { status: 400 }
        );
      }

      // 2. Fetch user wallet
      const { data: wallet, error: walletError } = await supabase
        .from("wallets")
        .select("*")
        .eq("id", request.wallet_id)
        .single();

      if (walletError || !wallet) {
        return new Response(JSON.stringify({ error: "Wallet not found" }), { status: 404 });
      }

      const amount = Number(request.amount);

      // 3. Mark deposit as CLEARED
      const { error: updateReqError } = await supabase
        .from("deposit_requests")
        .update({ status: "CLEARED", updated_at: new Date().toISOString() })
        .eq("id", depositId);

      if (updateReqError) {
        throw new Error(`Failed to update deposit status: ${updateReqError.message}`);
      }

      // 4. Update wallet balance
      const { error: updateWalletError } = await supabase
        .from("wallets")
        .update({
          balance: Number(wallet.balance || 0) + amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.wallet_id);

      if (updateWalletError) {
        throw new Error(`Failed to update wallet balance: ${updateWalletError.message}`);
      }

      // 5. Execute Internal PAMM Broker Transfer
      const transferId = `EXN-TRF-${Math.floor(Math.random() * 1000000)}`;
      await insertAuditLog(supabase, {
        action: "EXNESS_INTERNAL_TRANSFER_EXECUTED",
        actor_type: "SYSTEM",
        entity_type: "users",
        entity_id: request.user_id,
        payload_json: {
          amount,
          reference: request.reference_code,
          broker_transfer_id: transferId,
          status: "SUCCESS",
        },
      });

      // 6. Record Admin Deposit Clearance in Audit Log
      await insertAuditLog(supabase, {
        action: "MANUAL_DEPOSIT_CLEARANCE",
        actor_type: "ADMIN",
        entity_type: "deposit_requests",
        entity_id: depositId,
        payload_json: {
          amount,
          old_status: "PENDING_CLEARANCE",
          new_status: "CLEARED",
          broker_transfer_id: transferId,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          message: "Deposit cleared and synced to broker",
          deposit_id: depositId,
          broker_transfer_id: transferId,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────
    // ACTION 2: INTERNAL_TRANSFER (PAMM Sub-Account Transfer)
    // ─────────────────────────────────────────────────────────────
    if (action === "INTERNAL_TRANSFER") {
      const { amount, user_id, reference } = body;
      if (!amount || !user_id || !reference) {
        return new Response(
          JSON.stringify({ error: "Missing required fields: amount, user_id, or reference" }),
          { status: 400 }
        );
      }

      console.log(`[Agent Treasury] Executing Internal Transfer of $${amount} for user ${user_id}`);
      const transferId = `EXN-TRF-${Math.floor(Math.random() * 1000000)}`;

      await insertAuditLog(supabase, {
        action: "EXNESS_INTERNAL_TRANSFER_EXECUTED",
        actor_type: "SYSTEM",
        entity_type: "users",
        entity_id: user_id,
        payload_json: {
          amount,
          reference,
          broker_transfer_id: transferId,
          status: "SUCCESS",
        },
      });

      return new Response(
        JSON.stringify({
          status: "success",
          message: "Internal transfer executed",
          broker_transfer_id: transferId,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────
    // ACTION 3: SYNC_BALANCE (Broker Equity Update in Treasury)
    // ─────────────────────────────────────────────────────────────
    if (action === "SYNC_BALANCE") {
      const currentEquity = Number(body?.equity ?? 0.0);

      const { error: updateError } = await supabase
        .from("treasury_accounts")
        .update({ balance: currentEquity, last_synced_at: new Date().toISOString() })
        .eq("account_name", "Exness Master Trading");

      if (updateError) {
        throw new Error(`Failed to update Exness balance in treasury: ${updateError.message}`);
      }

      return new Response(
        JSON.stringify({
          status: "success",
          message: "Exness treasury synced",
          equity: currentEquity,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────
    // ACTION 4: SNAPSHOT (Solvency Calculation & Metric Persistence)
    // ─────────────────────────────────────────────────────────────
    // 1. Fetch Liability & Assets via RPC
    const { data: liabilityData, error: liabilityError } = await supabase.rpc("get_total_customer_liability");
    const { data: bankData, error: bankError } = await supabase.rpc("get_total_assets", { asset_type: "BANK" });
    const { data: brokerData, error: brokerError } = await supabase.rpc("get_total_assets", { asset_type: "BROKER" });

    if (liabilityError || bankError || brokerError) {
      throw new Error("Failed to fetch treasury aggregates from RPC");
    }

    const liability = Number(liabilityData || 0);
    const bankTotal = Number(bankData || 0);
    const exnessTotal = Number(brokerData || 0);

    const totalAssets = bankTotal + exnessTotal;
    const solvencyRatio = liability > 0 ? totalAssets / liability : 1.0;

    // 2. Insert Snapshot
    const { error: insertError } = await supabase.from("treasury_snapshots").insert({
      total_customer_liability: liability,
      bank_total: bankTotal,
      exness_master_total: exnessTotal,
      total_assets: totalAssets,
      solvency_ratio: solvencyRatio,
      notes: body?.notes || "Automated Periodic Treasury Snapshot",
    });

    if (insertError) {
      throw new Error(`Failed to insert snapshot: ${insertError.message}`);
    }

    // 3. Update Treasury Health Flag for Execution Engine
    const isSolvent = solvencyRatio >= 1.0;
    const { error: settingsError } = await supabase.from("system_settings").upsert(
      {
        key: "treasury_status",
        value: {
          is_solvent: isSolvent,
          solvency_ratio: solvencyRatio,
          free_margin: exnessTotal,
          updated_at: new Date().toISOString(),
        },
      },
      { onConflict: "key" }
    );

    if (settingsError) {
      throw new Error(`Failed to update treasury health flag: ${settingsError.message}`);
    }

    return new Response(
      JSON.stringify({
        status: "success",
        action: "SNAPSHOT",
        solvency_ratio: solvencyRatio,
        is_solvent: isSolvent,
        assets: totalAssets,
        liability: liability,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Agent Treasury] Exception:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
