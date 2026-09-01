import test from 'node:test';
import assert from 'node:assert/strict';

// Simple in-memory database to simulate supabase tables
class FakeDB {
  constructor(){
    this.opportunities = [];
    this.trades = [];
    this.orders = [];
    this.audit = [];
    this._id = 0;
  }
  uid(){ return (++this._id).toString(); }
}

function researchRun(db){
  const opp = { id: db.uid(), symbol: 'AAPL', timeframe: '1d', side: 'LONG', status: 'PENDING_APPROVAL' };
  db.opportunities.push(opp);
  db.audit.push({ action: 'RESEARCH_RUN', entity: 'opportunity', entityId: opp.id });
  return opp;
}

function approveOpportunity(db, oppId){
  const opp = db.opportunities.find(o=>o.id===oppId);
  if(!opp) throw new Error('missing opportunity');
  const trade = { id: db.uid(), opportunity_id: oppId, symbol: opp.symbol, side: opp.side, qty: 1, status: 'OPEN', opened_at: Date.now() };
  db.trades.push(trade);
  const order = { id: db.uid(), trade_id: trade.id, status: 'FILLED' };
  db.orders.push(order);
  db.audit.push({ action: 'APPROVE', entity: 'trade', entityId: trade.id });
  return trade;
}

function monitorTrades(db){
  for(const t of db.trades){
    if(t.status==='OPEN' && t.pnl<0){
      t.status='CLOSED';
      t.close_reason='LOSS';
      t.closed_at=Date.now();
      db.audit.push({ action: 'MONITOR_CLOSE', entity: 'trade', entityId: t.id });
    }
  }
}

function killSwitch(db){
  for(const t of db.trades){
    if(t.status==='OPEN'){
      t.status='CLOSED';
      t.close_reason='KILL_SWITCH';
      t.closed_at=Date.now();
      db.audit.push({ action: 'KILL_SWITCH', entity: 'trade', entityId: t.id });
    }
  }
}

test('end-to-end trade lifecycle', () => {
  const db = new FakeDB();
  const opp = researchRun(db);
  assert.equal(db.opportunities.length, 1);
  const trade = approveOpportunity(db, opp.id);
  assert.equal(db.trades.length, 1);
  assert.equal(db.orders.length, 1);
  // mark trade as losing and monitor
  trade.pnl = -5;
  monitorTrades(db);
  assert.equal(db.trades[0].status, 'CLOSED');
  assert.equal(db.trades[0].close_reason, 'LOSS');
  // create another trade and activate kill switch
  const opp2 = researchRun(db);
  const trade2 = approveOpportunity(db, opp2.id);
  killSwitch(db);
  const t2 = db.trades.find(t=>t.id===trade2.id);
  assert.equal(t2.status, 'CLOSED');
  assert.equal(t2.close_reason, 'KILL_SWITCH');
  // audit log should have entries for each action
  const actions = db.audit.map(a=>a.action);
  assert.deepEqual(actions, [
    'RESEARCH_RUN',
    'APPROVE',
    'MONITOR_CLOSE',
    'RESEARCH_RUN',
    'APPROVE',
    'KILL_SWITCH'
  ]);
});

test('weekend defense filters non-crypto trades and protects capital', () => {
  const isCrypto = (symbol) => {
    if (!symbol) return false;
    const upper = symbol.toUpperCase();
    const cryptoBases = ["BTC", "ETH", "SOL", "XRP", "DOGE", "LTC", "ADA"];
    return cryptoBases.some(c => upper.startsWith(c)) || upper.endsWith("USDT");
  };

  const openTrades = [
    { id: '1', meta_api_order_id: 'ord-1', symbol: 'EURUSD', profit: -12.5, open_price: 1.0850 },
    { id: '2', meta_api_order_id: 'ord-2', symbol: 'XAUUSD', profit: 45.0, open_price: 2350.0 },
    { id: '3', meta_api_order_id: 'ord-3', symbol: 'BTCUSD', profit: -50.0, open_price: 64000.0 },
    { id: '4', meta_api_order_id: 'ord-4', symbol: 'US30', profit: 0.0, open_price: 39000.0 },
  ];

  // Filter out 24/7 crypto trades
  const vulnerableTrades = openTrades.filter(t => t.symbol ? !isCrypto(t.symbol) : true);
  assert.equal(vulnerableTrades.length, 3);
  assert.deepEqual(vulnerableTrades.map(t => t.symbol), ['EURUSD', 'XAUUSD', 'US30']);

  let closedCount = 0;
  let movedToBeCount = 0;
  const closedSymbols = [];
  const beSymbols = [];

  for (const trade of vulnerableTrades) {
    if (trade.profit <= 0) {
      closedCount++;
      closedSymbols.push(trade.symbol);
    } else {
      movedToBeCount++;
      beSymbols.push(trade.symbol);
    }
  }

  assert.equal(closedCount, 2); // EURUSD (loss) and US30 (break-even/zero profit closed)
  assert.equal(movedToBeCount, 1); // XAUUSD (profit moved to BE)
  assert.deepEqual(closedSymbols, ['EURUSD', 'US30']);
  assert.deepEqual(beSymbols, ['XAUUSD']);
});

test('telegram broadcast filters out B-Tier, C-Tier, and unranked signals', () => {
  const filterSignal = (aiSummary) => {
    const tierMatch = (aiSummary || "").match(/(S|A|B|C)-Tier/);
    const rawTier = tierMatch ? `${tierMatch[1]}-Tier` : null;
    if (rawTier === "B-Tier" || rawTier === "C-Tier" || !rawTier) {
      return { broadcast: false, tier: rawTier };
    }
    return { broadcast: true, tier: rawTier };
  };

  assert.deepEqual(filterSignal("[S-Tier] Strong bullish confluence"), { broadcast: true, tier: "S-Tier" });
  assert.deepEqual(filterSignal("[A-Tier] Clear breakout setup"), { broadcast: true, tier: "A-Tier" });
  assert.deepEqual(filterSignal("[B-Tier] Moderate setup"), { broadcast: false, tier: "B-Tier" });
  assert.deepEqual(filterSignal("[C-Tier] Weak signal"), { broadcast: false, tier: "C-Tier" });
  assert.deepEqual(filterSignal("No tier specified"), { broadcast: false, tier: null });
});

