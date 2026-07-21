const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function enforceIsolation() {
  const userId = "00ebf71d-8ad4-4072-9bb8-6149f55594b1"; // Same user ID as used in execute API

  // Fetch all OPEN trades for the user
  const { data: userTrades, error } = await supabase
    .from('user_trades')
    .select('id, symbol, status, opportunity_id, trade_opportunities(ai_summary)')
    .eq('user_id', userId)
    .eq('status', 'OPEN');

  if (error) {
    console.error("Error fetching trades:", error);
    return;
  }

  // Group by symbol
  const bySymbol = {};
  for (const t of userTrades) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
    
    // Extract RR from ai_summary (e.g. "yielding a 1:6.4 Risk:Reward ratio")
    let rr = 0;
    const summary = t.trade_opportunities?.ai_summary || "";
    const rrMatch = summary.match(/yielding a 1:([0-9.]+)/);
    if (rrMatch) {
      rr = parseFloat(rrMatch[1]);
    }
    
    bySymbol[t.symbol].push({ ...t, rr });
  }

  for (const [symbol, trades] of Object.entries(bySymbol)) {
    console.log(`\nEvaluating ${symbol} (${trades.length} active trades)`);
    
    // Sort by RR descending
    trades.sort((a, b) => b.rr - a.rr);
    
    // The first one is the winner
    const winner = trades[0];
    const losers = trades.slice(1);
    
    console.log(`  Keeping: ${winner.id} (RR 1:${winner.rr}) -> Setting to PENDING`);
    
    // Set winner to PENDING (since they are limit orders and were incorrectly marked OPEN)
    await supabase.from('user_trades').update({ status: 'PENDING' }).eq('id', winner.id);
    
    for (const loser of losers) {
      console.log(`  Cancelling: ${loser.id} (RR 1:${loser.rr})`);
      await supabase.from('user_trades').update({ status: 'CANCELLED' }).eq('id', loser.id);
    }
  }
  
  console.log("\nDone enforcing asset isolation!");
}

enforceIsolation();
