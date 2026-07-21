const escapeMd = (text: string | null | undefined) => {
  if (!text) return "";
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
};

const aiSummary = "[B-Tier] [BULLISH_TREND -> PULLBACK] The recommended direction is LONG as the price is in a bullish pullback within a larger uptrend, supported by the higher timeframe support levels at 62541.92. A bullish reversal candlestick pattern at the suggested entry price of 62541.92 will trigger the trade. The stop loss is placed at 60860.13, below the higher timeframe support, to invalidate the setup if the price breaks this level. The take profit target is set at the higher timeframe resistance of 63693.69, aligning with the structural target. Without fundamental context, this must be treated as a purely technical setup. Execution Math: Take Profit perfectly aligned at 65905.5 for a guaranteed 1:2.0 Risk:Reward ratio.";

const escaped = escapeMd(aiSummary);
console.log("ESCAPED:", escaped);
