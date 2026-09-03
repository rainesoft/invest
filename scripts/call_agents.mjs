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
  const args = process.argv.slice(2);
  const symbolArg = args.find((_, i) => args[i - 1] === '--symbol' || args[i - 1] === '-s') || null;
  const timeframeArg = args.find((_, i) => args[i - 1] === '--timeframe' || args[i - 1] === '-tf') || null;
  const isManual = args.includes('--manual') || args.includes('--is_manual') || Boolean(symbolArg);
  const summaryHours = Number(args.find((_, i) => args[i - 1] === '--hours') || 24);

  const startTime = new Date(Date.now() - 60 * 1000).toISOString();
  console.log(`Starting Multi-Agent Pipeline Run [Manual: ${isManual}, Symbol Target: ${symbolArg || 'ALL'}]...`);

  // 1. Run Event-Driven Macro News Scout
  await callAgent('agent-news');

  const SYMBOL_ALIASES = {
    'UKOI': 'UKOIL',
    'BRENT': 'UKOIL',
    'WTI': 'USOIL',
    'GOLD': 'XAUUSD',
    'SILVER': 'XAGUSD',
    'BITCOIN': 'BTCUSD',
    'BTC': 'BTCUSD',
    'ETH': 'ETHUSD',
    'DOW': 'US30',
    'NAS': 'NAS100',
    'NASDAQ': 'NAS100',
    'SPX': 'SPX500'
  };

  if (symbolArg) {
    const symList = symbolArg.split(',').map(s => {
      const clean = s.trim().toUpperCase();
      return SYMBOL_ALIASES[clean] || clean;
    });
    console.log(`\nTargeting specific symbol(s): ${symList.join(', ')}`);
    
    // Run Intraday M30
    await callAgent('agent-day', {
      symbols: symList,
      is_manual: isManual,
      timeframe: timeframeArg || '30m'
    });

    // Run Macro Swing
    await callAgent('agent-swing', {
      symbols: symList,
      is_manual: isManual,
      timeframe: timeframeArg || '1D'
    });
  } else {
    // 2. Run Intraday M30 Scalper (24 Global Assets)
    await callAgent('agent-day', {
      symbols: [
        "BTCUSD", "ETHUSD", "XAUUSD", "US30", "NAS100", "SPX500", "EURUSD", 
        "GBPUSD", "AUDUSD", "USDCAD", "USDCHF", "UKOIL", "USOIL", "XAGUSD", 
        "USDJPY", "GBPJPY", "EURJPY", "GER30", "JP225", "NVDA", "AAPL", "MSFT", "TSLA"
      ],
      is_manual: isManual
    });

    // 3. Run Swing Trader in chunks to avoid 150s Edge Function timeouts
    await callAgent('agent-swing', { symbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURJPY", "GBPJPY"], is_manual: isManual });
    await callAgent('agent-swing', { symbols: ["BTCUSD", "ETHUSD"], is_manual: isManual });
    await callAgent('agent-swing', { symbols: ["US30", "NAS100", "SPX500", "GER30", "JP225", "XAUUSD", "XAGUSD", "UKOIL", "USOIL"], is_manual: isManual });
    await callAgent('agent-swing', { symbols: ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META"], is_manual: isManual });
  }

  // 4. Summarize Opportunities generated in this run & recent window
  console.log(`\n========================================================================================`);
  console.log(`INSTITUTIONAL SIGNAL ANALYSIS & TIER CLASSIFICATION (Past ${summaryHours} Hours)`);
  console.log(`========================================================================================`);

  const filterTime = new Date(Date.now() - summaryHours * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from('trade_opportunities')
    .select('id, symbol, side, status, timeframe, confidence, ai_summary, ai_risks, entry_plan_json, stop_plan_json, take_profit_json, created_at')
    .gte('created_at', filterTime)
    .order('confidence', { ascending: false });

  if (symbolArg) {
    const symList = symbolArg.split(',').map(s => {
      const clean = s.trim().toUpperCase();
      return SYMBOL_ALIASES[clean] || clean;
    });
    query = query.in('symbol', symList);
  }

  const { data: opportunities, error: queryErr } = await query;

  if (queryErr) {
    console.error("Error querying opportunities:", queryErr.message);
    return;
  }

  if (!opportunities || opportunities.length === 0) {
    console.log("No signals found in the specified window.");
  } else {
    console.log(`Found ${opportunities.length} signal(s). Ranked by Institutional Tier & Confidence:\n`);
    
    opportunities.forEach((opp, idx) => {
      const conf = opp.confidence ?? 0;
      const tier = conf >= 90 ? 'S-Tier 🏆' : conf >= 80 ? 'A-Tier 💎' : conf >= 70 ? 'B-Tier ⚡' : 'C-Tier ⚠️';
      const entry = opp.entry_plan_json?.price ?? opp.entry_plan_json?.order_price ?? 'MKT';
      const orderType = opp.entry_plan_json?.order_type ?? 'MARKET';
      const stop = opp.stop_plan_json?.stop ?? opp.stop_plan_json?.stop_price ?? 'N/A';
      const tp1 = opp.take_profit_json?.tp1 ?? 'N/A';
      const tp2 = opp.take_profit_json?.tp2 ?? opp.take_profit_json?.tp ?? 'N/A';
      const tp3 = opp.take_profit_json?.tp3 ?? 'N/A';
      
      let rrStr = 'N/A';
      if (typeof entry === 'number' && typeof stop === 'number' && typeof tp2 === 'number') {
        const risk = Math.abs(entry - stop);
        const reward = Math.abs(tp2 - entry);
        if (risk > 0) rrStr = `1:${(reward / risk).toFixed(2)}`;
      }

      console.log(`[#${idx + 1}] [${opp.symbol}] ${opp.side} | ${tier} (Conf: ${conf}) | Status: ${opp.status} | TF: ${opp.timeframe}`);
      console.log(`     Order: ${orderType} @ ${entry} | SL: ${stop} | TP1: ${tp1} | TP2: ${tp2} | TP3: ${tp3} | R:R (TP2): ${rrStr}`);
      console.log(`     Created: ${opp.created_at}`);
      if (opp.ai_summary) {
        console.log(`     Rationale: ${opp.ai_summary.slice(0, 220)}...`);
      }
      if (opp.ai_risks && opp.status === 'REJECTED') {
        console.log(`     Rejection Reason: ${opp.ai_risks}`);
      }
      console.log('----------------------------------------------------------------------------------------');
    });
  }
}

run();
