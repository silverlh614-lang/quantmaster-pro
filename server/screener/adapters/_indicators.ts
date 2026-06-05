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

/**
 * 단순이동평균(SMA) — 최근 n개 종가 평균. n개 미만이면 0.
 * `closes` 는 과거→최신 오름차순 가정 (`slice(-n)` = 최근 n개).
 * kisQuoteAdapter `buildExtendedFromKisDaily` 의 로컬 `avg(closes,n)` 과 동일 산식 — 향후 그쪽도 본 헬퍼로 통합 권장(현재는 중복이나 산식 일치).
 */
export function calcSMA(closes: number[], n: number): number {
  const slice = closes.slice(-n);
  return slice.length >= n ? slice.reduce((a, b) => a + b, 0) / n : 0;
}

/**
 * ATR(period) — True Range 의 period 단순이평. highs/lows/closes 는 과거→최신 오름차순·동일 인덱스 정합.
 * TR_i = max(high_i - low_i, |high_i - close_{i-1}|, |low_i - close_{i-1}|).
 * 표본이 period 미만이면 가용 표본 평균, True Range 가 전무하면 0.
 * kisQuoteAdapter ATR 블록과 동일 산식(표본 ≥ period 분기 기준).
 */
export function calcATR(highs: number[], lows: number[], closes: number[], period: number): number {
  const trueRanges: number[] = [];
  const minLen = Math.min(closes.length, highs.length, lows.length);
  for (let i = 1; i < minLen; i++) {
    trueRanges.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  if (trueRanges.length === 0) return 0;
  return trueRanges.length >= period
    ? trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period
    : trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
}
