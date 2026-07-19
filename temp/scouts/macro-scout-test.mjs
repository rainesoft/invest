function parseNumericString(val) {
  if (!val) return null;
  const numStr = val.replace(/[^0-9.-]/g, "");
  const num = parseFloat(numStr);
  if (isNaN(num)) return null;

  if (val.includes("K")) return num * 1000;
  if (val.includes("M")) return num * 1000000;
  if (val.includes("B")) return num * 1000000000;
  return num;
}

const rule = {
  id: "USD_NFP",
  titlePattern: /Non-Farm Employment Change/i,
  country: "USD",
  impact: "High",
  triggerThreshold: 50000, // 50K
  onBeat: { symbol: "USDJPY", side: "BUY", slDistance: 0.300 },
  onMiss: { symbol: "USDJPY", side: "SELL", slDistance: 0.300 }
};

// Fake NFP event (Beat)
const eventBeat = {
  title: "Non-Farm Employment Change",
  country: "USD",
  impact: "High",
  forecast: "200K",
  actual: "260K"
};

// Fake NFP event (Miss)
const eventMiss = {
  title: "Non-Farm Employment Change",
  country: "USD",
  impact: "High",
  forecast: "200K",
  actual: "140K"
};

function testEvent(event) {
  console.log(`\nTesting Event: ${event.title} (Actual: ${event.actual}, Forecast: ${event.forecast})`);
  const actualVal = parseNumericString(event.actual);
  const forecastVal = parseNumericString(event.forecast);
  
  const deviation = actualVal - forecastVal;
  console.log(`Deviation: ${deviation} (Threshold: ${rule.triggerThreshold})`);

  if (deviation >= rule.triggerThreshold) {
    console.log(`✅ BEAT! Action: ${JSON.stringify(rule.onBeat)}`);
  } else if (deviation <= -rule.triggerThreshold) {
    console.log(`✅ MISS! Action: ${JSON.stringify(rule.onMiss)}`);
  } else {
    console.log(`❌ No action triggered (deviation too small)`);
  }
}

testEvent(eventBeat);
testEvent(eventMiss);
testEvent({ ...eventBeat, actual: "210K" }); // Small beat
testEvent({ title: "CPI y/y", country: "USD", impact: "High", forecast: "3.2%", actual: "3.5%" }); // Not NFP

