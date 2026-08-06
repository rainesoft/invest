import { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";

export async function isAutoTradingEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "auto_trading_enabled")
      .single();
      
    if (error || !data) return true; // Default to true if setting missing
    return data.value === true || data.value === "true";
  } catch (err) {
    console.error("[Settings] Error fetching auto_trading_enabled:", err);
    return true; // Failsafe default
  }
}

export async function getTradingSymbols(supabase: SupabaseClient): Promise<string[] | null> {
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "trading_symbols")
      .single();
      
    if (error || !data || !Array.isArray(data.value)) return null;
    return data.value;
  } catch (err) {
    console.error("[Settings] Error fetching trading_symbols:", err);
    return null;
  }
}
