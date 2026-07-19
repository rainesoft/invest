const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function clean() {
  console.log('Cleaning up dummy BTCUSD records...');
  
  // Delete from trades
  const { data: trades, error: tradesErr } = await supabase
    .from('trades')
    .delete()
    .eq('symbol', 'BTCUSD')
    .select();
    
  if (tradesErr) console.error('Trades error:', tradesErr);
  else console.log(`Deleted ${trades.length} dummy trades.`);

  // Delete from trade_opportunities
  const { data: opps, error: oppsErr } = await supabase
    .from('trade_opportunities')
    .delete()
    .eq('symbol', 'BTCUSD')
    .select();
    
  if (oppsErr) console.error('Opps error:', oppsErr);
  else console.log(`Deleted ${opps.length} dummy opportunities.`);
}

clean();
