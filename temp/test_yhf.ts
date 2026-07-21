import yahooFinance from 'npm:yahoo-finance2';

async function test() {
  try {
    const symbol = 'XAUUSD=X';
    const result = await yahooFinance.historical(symbol, {
      period1: '2024-01-01',
      interval: '1d'
    });
    console.log(`Fetched ${result.length} bars`);
    if (result.length > 0) {
      console.log(result[result.length - 1]);
    }
  } catch (e) {
    console.error(e);
  }
}

test();
