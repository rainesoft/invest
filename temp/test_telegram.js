const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const serviceRoleKey = envLocal.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1];

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function testTelegram() {
  console.log('Invoking telegram-broadcast...');
  
  const payload = {
    type: "INSERT",
    table: "trade_opportunities",
    schema: "public",
    old_record: null,
    record: {
      id: "test-signal-123",
      symbol: "TEST/USD",
      timeframe: "1H",
      status: "PENDING_APPROVAL",
      direction: "BUY",
      entry_price: 50000,
      stop_loss: 49000,
      take_profit: 52000,
      confidence_score: 99,
      ai_reasoning: "System test notification to verify Telegram integration.",
      technical_analysis: {},
      fundamental_analysis: {},
      created_at: new Date().toISOString()
    }
  };

  const { data, error } = await supabase.functions.invoke('telegram-broadcast', {
    body: payload
  });

  if (error) {
    console.error('Failed:', error);
  } else {
    console.log('Success!', data);
  }
}

testTelegram();
