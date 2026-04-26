// @responsibility Yahoo·KIS 어댑터 공용 RSI MACD EMA 지표 순수 계산 헬퍼
/**
 * adapters/_indicators.ts — 어댑터 공용 기술적 지표 계산 (ADR-0029).
 *
 * Yahoo (`fetchYahooQuote`) 와 KIS (`buildExtendedFromKisDaily`) 가 동일 산식을
 * 공유해야 산출값이 호환된다 — 본 모듈을 양쪽 어댑터가 import 한다.
 * 산식 변경 시 본 파일만 수정하면 양쪽이 자동 동기화.
 */

/** Wilder 평활화 RSI — period 파라미터화. */
export function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  let avgGain = deltas.slice(0, period).filter(d => d > 0).reduce((s, d) => s + d, 0) / period;
  let avgLoss = deltas.slice(0, period).filter(d => d < 0).reduce((s, d) => s - d, 0) / period;
  for (let i = period; i < deltas.length; i++) {
    const gain = deltas[i] > 0 ? deltas[i] : 0;
    const loss = deltas[i] < 0 ? -deltas[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** RSI(14) — 하위 호환 래퍼. */
export function calcRSI14(closes: number[]): number { return calcRSI(closes, 14); }

/** EMA 배열 반환. */
export function calcEMAArr(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[out.length - 1] * (1 - k));
  return out;
}

/** MACD(12, 26, 9) — 최종 봉의 라인/신호/히스토그램. */
export function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const zero = { macd: 0, signal: 0, histogram: 0 };
  if (closes.length < 27) return zero;
  const ema12 = calcEMAArr(closes, 12);
  const ema26 = calcEMAArr(closes, 26);
  const macdLine = ema12.slice(25).map((v, i) => v - ema26[25 + i]);
  if (macdLine.length < 9) return zero;
  const signalLine = calcEMAArr(macdLine, 9);
  const last  = macdLine[macdLine.length - 1];
  const sig   = signalLine[signalLine.length - 1];
  return { macd: last, signal: sig, histogram: last - sig };
}
