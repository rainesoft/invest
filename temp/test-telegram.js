async function run() {
  const TELEGRAM_BOT_TOKEN = '8878346657:AAHKvJ0gZLyc8rdiT80DQKFEon4T4fYI7k4';
  const TELEGRAM_CHAT_ID = '5132401254';

  const escapeMd = (text) => {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  };

  const symbol = escapeMd('BTCUSD');
  const side = escapeMd('LONG');
  const entryPrice = escapeMd('62541.92');
  const status = escapeMd('PENDING_APPROVAL');
  const riskSummary = escapeMd('RSI 40.2');
  const aiSummary = escapeMd('[B-Tier] [BULLISH_TREND -> PULLBACK] The recommended direction is LONG as the price is in a bullish pullback within a larger uptrend, supported by the higher timeframe support levels at 62541.92. A bullish reversal candlestick pattern at the suggested entry price of 62541.92 will trigger the trade. The stop loss is placed at 60860.13, below the higher timeframe support, to invalidate the setup if the price breaks this level. The take profit target is set at the higher timeframe resistance of 63693.69, aligning with the structural target. Without fundamental context, this must be treated as a purely technical setup. Execution Math: Take Profit perfectly aligned at 65905.5 for a guaranteed 1:2.0 Risk:Reward ratio.');

  const message = `
🚨 *RAINEBANK ALPHA SIGNAL* 🚨

*Symbol:* ${symbol}
*Side:* ${side}
*Status:* ${status}

*Entry Target:* ${entryPrice}
*Risk Profile:* ${riskSummary}

*Institutional Rationale:*
_${aiSummary}_

[View Ledger](https://yourdomain.com/dashboard)
  `.trim();

  const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    }),
  });

  const resText = await response.text();
  console.log(resText);
}
run();
