const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data, error } = await supabase
    .from('market_data')
    .select('symbol, timeframe, current_price, high, timestamp')
    .eq('symbol', 'XAUUSD')
    .order('timestamp', { ascending: false })
    .limit(5);
  console.log(data);
}
check();
