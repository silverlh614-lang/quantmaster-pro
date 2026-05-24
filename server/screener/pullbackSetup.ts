// @responsibility Lightweight pullback setup predicate shared by screener and condition evaluators.

interface PullbackSetupQuote {
  high60d: number;
  price: number;
  ma60: number;
  atr: number;
  atr20avg: number;
  dailyVolumeDrying?: boolean;
  rsi14: number;
}

/**
 * Pullback setup:
 * 1. 60d high drawdown is a controlled 3~20%.
 * 2. Price stays above MA60.
 * 3. Volatility is compressed or daily volume is drying.
 * 4. RSI is in the 30~62 recovery/first-pullback zone.
 */
export function isPullbackSetup(q: PullbackSetupQuote): boolean {
  if (q.high60d <= 0) return false;
  const drawdown = (q.high60d - q.price) / q.high60d * 100;
  if (drawdown < 3 || drawdown > 20) return false;
  if (q.ma60 <= 0 || q.price < q.ma60) return false;
  const isVCP = q.atr > 0 && q.atr20avg > 0 && q.atr < q.atr20avg * 0.75;
  if (!isVCP && !q.dailyVolumeDrying) return false;
  if (q.rsi14 < 30 || q.rsi14 > 62) return false;
  return true;
}
