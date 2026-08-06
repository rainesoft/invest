'use server';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getTradingSymbolsAction(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'trading_symbols')
      .single();

    if (error || !data || !Array.isArray(data.value)) {
      return ["UKOIL", "EURUSD", "GBPUSD", "USDJPY", "US30", "NAS100"]; // Default fallback
    }
    return data.value;
  } catch (error) {
    console.error('[Admin Settings] Error fetching trading symbols:', error);
    return [];
  }
}

export async function updateTradingSymbolsAction(symbols: string[]): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('system_settings')
      .upsert({
        key: 'trading_symbols',
        value: symbols,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('[Admin Settings] Error updating trading symbols:', error);
    return { success: false, error: error.message || 'Failed to update symbols' };
  }
}
