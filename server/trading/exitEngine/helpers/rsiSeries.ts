// @responsibility Wilder 평활화 RSI 시계열 + 하락 다이버전스 판정 순수 함수
/**
 * exitEngine/helpers/rsiSeries.ts — RSI 14 Wilder + bearish divergence (ADR-0028).
 */

/** Wilder 평활화 RSI 시계열 반환. period+1 미만이면 빈 배열. */
export function rsiSeries(closes: number[], period: number = 14): number[] {
  if (closes.length < period + 1) return [];
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  let avgGain = deltas.slice(0, period).filter(d => d > 0).reduce((s, d) => s + d, 0) / period;
  let avgLoss = deltas.slice(0, period).filter(d => d < 0).reduce((s, d) => s - d, 0) / period;
  const out: number[] = [];
  const rsiAt = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out.push(rsiAt(avgGain, avgLoss));
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(rsiAt(avgGain, avgLoss));
  }
  return out;
}

/**
 * 하락 다이버전스 감지 — 주가 신고가 갱신 + RSI 고점 낮아짐.
 * 최근 5일/이전 5일 두 구간을 비교해 가짜 돌파·상투를 조기 포착.
 *
 * @param prices 최근 N(≥10)일 종가 배열
 * @param rsi    prices와 정렬된 N일 RSI 배열
 */
export function detectBearishDivergence(prices: number[], rsi: number[]): boolean {
  if (prices.length < 10 || rsi.length < 10) return false;
  const recentHigh = Math.max(...prices.slice(-5));
  const prevHigh   = Math.max(...prices.slice(-10, -5));
  const recentRSI  = Math.max(...rsi.slice(-5));
  const prevRSI    = Math.max(...rsi.slice(-10, -5));
  // 주가 신고가 갱신 + RSI 고점 낮아짐 → 하락 다이버전스
  return recentHigh > prevHigh && recentRSI < prevRSI;
}
