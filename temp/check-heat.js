const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: user } = await supabase.from('user_risk_settings').select('*').limit(1).single();
  const { data: openTrades } = await supabase.from('user_trades').select('risk_amount, status, symbol').in('status', ['OPEN', 'PENDING']);
  
  console.log("User Capital:", user.portfolio_capital);
  console.log("Max Heat Pct:", user.max_portfolio_heat_pct);
  console.log("Open Trades:", JSON.stringify(openTrades, null, 2));
  
  const currentHeat = openTrades.reduce((acc, t) => acc + (t.risk_amount || 0), 0);
  console.log("Current Heat Amount:", currentHeat);
  console.log("Max Heat Amount:", user.portfolio_capital * user.max_portfolio_heat_pct);
}
run();
