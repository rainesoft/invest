const fs = require('fs');
const envLocal = fs.readFileSync('apps/rainebank/.env.local', 'utf8');
const supabaseUrl = envLocal.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1];
const anonKey = envLocal.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1];

fetch(`${supabaseUrl}/rest/v1/?apikey=${anonKey}`)
  .then(res => res.json())
  .then(data => {
    const trades = data.definitions.trades.properties;
    const executions = data.definitions.executions.properties;
    const user_trades = data.definitions.user_trades.properties;
    console.log('Trades properties:', Object.keys(trades));
    console.log('Executions properties:', Object.keys(executions));
    console.log('User Trades properties:', Object.keys(user_trades));
  });
