const payload = {
  type: "UPDATE",
  table: "trade_opportunities",
  record: {
    symbol: "XAUUSD",
    side: "LONG",
    status: "APPROVED",
    entry_plan_json: { price: 3980 },
    stop_plan_json: { stop: 3960 },
    take_profit_json: { tp: 4020 }
  },
  old_record: { status: "PENDING_APPROVAL" }
};

fetch("http://localhost:54321/functions/v1/exness-executor", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
})
.then(res => res.text())
.then(console.log);
