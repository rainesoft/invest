async function run() {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/BZ=F');
    const data = await res.json();
    const price = data.chart.result[0].meta.regularMarketPrice;
    console.log("Current Brent Crude Price: $" + price);
  } catch (err) {
    console.error(err.message);
  }
}
run();
