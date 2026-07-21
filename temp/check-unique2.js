const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('user_trades').insert([
    { user_id: '00ebf71d-8ad4-4072-9bb8-6149f55594b1', opportunity_id: '8ff588d8-ced1-4321-b9b4-5b7da2c8f021', symbol: 'EURUSD', side: 'LONG', volume: 0.1, risk_amount: 10, status: 'OPEN', meta_api_order_id: 'A' },
    { user_id: '00ebf71d-8ad4-4072-9bb8-6149f55594b1', opportunity_id: '8ff588d8-ced1-4321-b9b4-5b7da2c8f021', symbol: 'EURUSD', side: 'LONG', volume: 0.1, risk_amount: 10, status: 'OPEN', meta_api_order_id: 'B' }
  ]);
  console.log("Error:", error);
}
run();
