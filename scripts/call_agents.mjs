import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function parseEnv(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2];
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      env[match[1]] = val;
    }
  });
  return env;
}

const prodEnv = parseEnv('.env');
const serviceKey = prodEnv['SUPABASE_SERVICE_ROLE_KEY'];
const PROJECT_URL = prodEnv['SUPABASE_URL'] || 'https://ktezlusdkqlfdwqrldtn.supabase.co';

if (!serviceKey || serviceKey === '[SENSITIVE]' || serviceKey === '') {
  console.error("Service key missing or redacted in .env. Please check credentials.");
  process.exit(1);
}

const supabase = createClient(PROJECT_URL, serviceKey);

async function callAgent(agentName, body = null) {
  console.log(`\nCalling ${agentName}...`);
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${PROJECT_URL}/functions/v1/${agentName}`, options);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (json.rejections && json.rejections.length > 0) {
        console.log(`Response from ${agentName} [${res.status}]:\n  - Opportunities: ${json.opportunities?.length || 0}\n  - Rejections / Evaluations:`);
        json.rejections.forEach(r => console.log(`    ⚠️ ${r.symbol} [${r.layer}]: ${r.reason}`));
      } else {
        console.log(`Response from ${agentName} [${res.status}]:`, json);
      }
      return json;
    } catch (e) {
      console.log(`Response from ${agentName} [${res.status}]:`, text);
    }
  } catch (err) {
    console.error(`Error calling ${agentName}:`, err.message);
  }
}

async function run() {
  const startTime = new Date(Date.now() - 60 * 1000).toISOString();

  // 1. Run Event-Driven Macro News Scout
  await callAgent('agent-news');

  // 2. Run Intraday M30 Scalper
  await callAgent('agent-day', {
    symbols: ["BTCUSD", "EURUSD", "GBPUSD", "USDJPY", "EURJPY", "GBPJPY", "AUDUSD", "NZDUSD", "AUDJPY", "CADJPY", "EURGBP", "XAUUSD", "XAGUSD", "UKOIL", "US30", "NAS100"]
  });

  // 3. Run Swing Trader in chunks to avoid 150s Edge Function timeouts
  await callAgent('agent-swing', { symbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "EURJPY", "GBPJPY", "AUDJPY", "CADJPY", "EURGBP"] });
  await callAgent('agent-swing', { symbols: ["BTCUSD"] });
  await callAgent('agent-swing', { symbols: ["US30", "NAS100", "XAUUSD", "XAGUSD", "UKOIL"] });

  // 4. Summarize Opportunities generated in this run
  console.log(`\n========================================`);
  console.log(`SESSION SUMMARY: GENERATED SIGNALS`);
  console.log(`========================================`);

  const { data: opportunities } = await supabase
    .from('trade_opportunities')
    .select('id, symbol, side, status, timeframe, confidence, ai_summary, ai_risks, entry_plan_json, stop_plan_json, take_profit_json, created_at')
    .gte('created_at', startTime)
    .order('created_at', { ascending: false });

  if (!opportunities || opportunities.length === 0) {
    console.log("No new opportunities created in this run window.");
  } else {
    for (const opp of opportunities) {
      console.log(`\n[${opp.symbol}] ${opp.side} | ${opp.status} | TF: ${opp.timeframe} | Conf: ${opp.confidence}`);
      console.log(`Summary: ${opp.ai_summary}`);
      if (opp.entry_plan_json) console.log(`Entry Plan:`, opp.entry_plan_json);
      if (opp.stop_plan_json) console.log(`Stop Plan:`, opp.stop_plan_json);
      if (opp.take_profit_json) console.log(`Take Profit Plan:`, opp.take_profit_json);
    }
  }
}

run();
