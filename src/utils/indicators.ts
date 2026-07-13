// @responsibility indicators 유틸 함수 모듈
/**
 * Technical Indicator Calculation Utilities
 */

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const k = 2 / (period + 1);
  let emaValue = data[0];
  ema.push(emaValue);

  for (let i = 1; i < data.length; i++) {
    emaValue = data[i] * k + emaValue * (1 - k);
    ema.push(emaValue);
  }
  return ema;
}

export function calculateMACD(closes: number[]) {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);

  const lastMACD = macdLine[macdLine.length - 1];
  const lastSignal = signalLine[signalLine.length - 1];
  const prevMACD = macdLine[macdLine.length - 2];
  const prevSignal = signalLine[signalLine.length - 2];

  let status: 'GOLDEN_CROSS' | 'DEAD_CROSS' | 'NEUTRAL' = 'NEUTRAL';
  if (prevMACD <= prevSignal && lastMACD > lastSignal) status = 'GOLDEN_CROSS';
  else if (prevMACD >= prevSignal && lastMACD < lastSignal) status = 'DEAD_CROSS';

  return {
    macdLine: lastMACD,
    signalLine: lastSignal,
    histogram: histogram[histogram.length - 1],
    status
  };
}

export function calculateBollingerBands(closes: number[], period = 20, stdDev = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  const upper = sma + stdDev * std;
  const lower = sma - stdDev * std;
  const lastClose = closes[closes.length - 1];

  let status: 'LOWER_TOUCH' | 'CENTER_REVERSION' | 'EXPANSION' | 'NEUTRAL' = 'NEUTRAL';
  if (lastClose <= lower) status = 'LOWER_TOUCH';
  else if (lastClose >= sma && lastClose < upper) status = 'CENTER_REVERSION';
  
  // Expansion check (simplified: if current width is significantly larger than previous)
  const prevSlice = closes.slice(-period - 1, -1);
  const prevSma = prevSlice.reduce((a, b) => a + b, 0) / period;
  const prevVariance = prevSlice.reduce((a, b) => a + Math.pow(b - prevSma, 2), 0) / period;
  const prevStd = Math.sqrt(prevVariance);
  const currentWidth = upper - lower;
  const prevWidth = (prevSma + stdDev * prevStd) - (prevSma - stdDev * prevStd);
  
  if (currentWidth > prevWidth * 1.1) status = 'EXPANSION';

  return {
    upper,
    middle: sma,
    lower,
    width: (upper - lower) / sma,
    status
  };
}

export function calculateStochastic(highs: number[], lows: number[], closes: number[], period = 14, kPeriod = 3, dPeriod = 3) {
  if (closes.length < period) return null;

  const kValues: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const highSlice = highs.slice(i - period + 1, i + 1);
    const lowSlice = lows.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    const currentClose = closes[i];
    
    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
    kValues.push(k);
  }

  const slowK = calculateSMA(kValues, kPeriod);
  const slowD = calculateSMA(slowK, dPeriod);

  const lastK = slowK[slowK.length - 1];
  const lastD = slowD[slowD.length - 1];

  let status: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL' = 'NEUTRAL';
  if (lastK < 20) status = 'OVERSOLD';
  else if (lastK > 80) status = 'OVERBOUGHT';

  return { k: lastK, d: lastD, status };
}

function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

export function calculateIchimoku(highs: number[], lows: number[], closes: number[]) {
  const calculatePeriodHighLow = (h: number[], l: number[], period: number) => {
    const res = [];
    for (let i = period - 1; i < h.length; i++) {
      const hSlice = h.slice(i - period + 1, i + 1);
      const lSlice = l.slice(i - period + 1, i + 1);
      res.push((Math.max(...hSlice) + Math.min(...lSlice)) / 2);
    }
    return res;
  };

  const tenkanSen = calculatePeriodHighLow(highs, lows, 9);
  const kijunSen = calculatePeriodHighLow(highs, lows, 26);
  
  const senkouSpanA = tenkanSen.map((v, i) => {
    const kIdx = i - (26 - 9);
    if (kIdx < 0) return null;
    return (v + kijunSen[kIdx]) / 2;
  }).filter(v => v !== null) as number[];

  const senkouSpanB = calculatePeriodHighLow(highs, lows, 52);

  const lastClose = closes[closes.length - 1];
  // Spans are projected 26 periods ahead, so we look at the values "now"
  // which were calculated 26 periods ago.
  const spanA = senkouSpanA[senkouSpanA.length - 26];
  const spanB = senkouSpanB[senkouSpanB.length - 26];

  let status: 'ABOVE_CLOUD' | 'INSIDE_CLOUD' | 'BELOW_CLOUD' = 'INSIDE_CLOUD';
  if (lastClose > Math.max(spanA, spanB)) status = 'ABOVE_CLOUD';
  else if (lastClose < Math.min(spanA, spanB)) status = 'BELOW_CLOUD';

  return { status, spanA, spanB };
}

export function detectVCP(closes: number[], volumes: number[]) {
  // Mark Minervini's Volatility Contraction Pattern
  // Simplified detection: 
  // 1. Price is in an uptrend (above 200MA)
  // 2. Volatility (high-low range) is decreasing over several "tightening" cycles
  // 3. Volume is drying up during the tightening
  
  if (closes.length < 200) return false;
  
  const sma200 = calculateSMA(closes, 200);
  const lastClose = closes[closes.length - 1];
  if (lastClose < sma200[sma200.length - 1]) return false;

  // Check for 2-4 contractions
  // This is a complex pattern to detect perfectly, but we can look for:
  // - Recent high is lower than previous high
  // - Recent low is higher than previous low (or at least not much lower)
  // - Volume decreasing
  
  const recentCloses = closes.slice(-60);
  const recentVolumes = volumes.slice(-60);
  
  // Check if volume is generally decreasing in the last 20 days
  const volSMA = calculateSMA(recentVolumes, 20);
  const isVolumeDrying = volSMA[volSMA.length - 1] < volSMA[0] * 0.8;
  
  // Check for price tightening (standard deviation decreasing)
  const std10 = calculateBollingerBands(recentCloses.slice(-10), 10)?.width || 1;
  const std30 = calculateBollingerBands(recentCloses.slice(-30), 20)?.width || 1;
  const isTightening = std10 < std30 * 0.7;

  return isVolumeDrying && isTightening;
}

/**
 * ATR (Average True Range) 계산 — 종목 변동성 측정.
 *
 * True Range = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
 * ATR = SMA(True Range, period)
 *
 * @param highs  - 일봉 고가 배열 (과거→최신)
 * @param lows   - 일봉 저가 배열
 * @param closes - 일봉 종가 배열
 * @param period - ATR 기간 (기본 14)
 * @returns 최신 ATR 값 (0 if 데이터 부족)
 */
export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number {
  const minLen = Math.min(highs.length, lows.length, closes.length);
  if (minLen < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < minLen; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length === 0) return 0;

  if (trueRanges.length < period) {
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  // Wilder 평활화 방식: 첫 period개는 SMA, 이후 EMA 방식
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return atr;
}

export function calculateDisparity(closes: number[], period = 20): number {
  const sma = calculateSMA(closes, period);
  const lastSMA = sma[sma.length - 1];
  const lastClose = closes[closes.length - 1];
  return (lastClose / lastSMA) * 100;
}

// ─── 객관 계산 검증 헬퍼 (ADR-0582) ───────────────────────────────────────────
// checklist 의 기술 조건을 Gemini 추정 대신 OHLCV 로 **결정적** 판정한다. 단순화된
// 규칙이지만 입력이 같으면 결과가 같은(deterministic) 객관 신호이므로 '검증(COMPUTED)'
// tier 자격이 있다. 데이터 부족 시 false (호출측에서 AI 값 보존).

/** 골든크로스(정배열) — SMA5 > SMA20 > SMA60 단기 상위 정렬. ≥60 종가 필요. */
export function detectGoldenCross(closes: number[]): boolean {
  if (closes.length < 60) return false;
  const sma5 = calculateSMA(closes, 5);
  const sma20 = calculateSMA(closes, 20);
  const sma60 = calculateSMA(closes, 60);
  const a = sma5[sma5.length - 1];
  const b = sma20[sma20.length - 1];
  const c = sma60[sma60.length - 1];
  return a > b && b > c;
}

/** 거래량 급증 — 최근 종가일 거래량 ≥ 직전 20일 평균 × 1.5. ≥21 표본 필요. */
export function detectVolumeSurge(volumes: number[]): boolean {
  if (volumes.length < 21) return false;
  const last = volumes[volumes.length - 1];
  const prev20 = volumes.slice(-21, -1);
  const avg = prev20.reduce((s, v) => s + v, 0) / prev20.length;
  return avg > 0 && last >= avg * 1.5;
}

/** 터틀 돌파 — 종가가 직전 20일 최고가를 상향 돌파(Donchian). ≥21 표본 필요. */
export function detectTurtleBreakout(highs: number[], closes: number[]): boolean {
  if (highs.length < 21 || closes.length < 1) return false;
  const prior20High = Math.max(...highs.slice(-21, -1));
  const lastClose = closes[closes.length - 1];
  return prior20High > 0 && lastClose >= prior20High;
}

/**
 * 피보나치 지지 — 최근 60일 스윙(고-저) 대비 현재가가 23.6~61.8% 되돌림 구간.
 * 상승 추세 눌림목 매수 지지대. ≥60 표본 필요.
 */
export function detectFibonacciSupport(highs: number[], lows: number[], closes: number[]): boolean {
  if (highs.length < 60 || lows.length < 60 || closes.length < 1) return false;
  const swingHigh = Math.max(...highs.slice(-60));
  const swingLow = Math.min(...lows.slice(-60));
  const range = swingHigh - swingLow;
  if (range <= 0) return false;
  const retr = (swingHigh - closes[closes.length - 1]) / range;
  return retr >= 0.236 && retr <= 0.618;
}

/** 종가 배열의 롤링 RSI 시계열 (period 이후 인덱스부터). */
function calculateRSISeries(closes: number[], period = 14): number[] {
  const out: number[] = [];
  for (let i = period; i < closes.length; i++) {
    out.push(calculateRSI(closes.slice(0, i + 1), period));
  }
  return out;
}

/**
 * 상승 다이버전스 — 최근 구간 가격은 더 낮은 저점(LL)인데 RSI 는 더 높은 저점(HL).
 * 단순화: 최근 20일을 전반/후반 10일로 나눠 가격 최저점과 그 시점 RSI 를 비교. ≥34 표본.
 */
export function detectBullishDivergence(closes: number[]): boolean {
  if (closes.length < 34) return false;
  const rsi = calculateRSISeries(closes, 14); // 길이 = closes.length - 14
  if (rsi.length < 20) return false;
  const win = closes.slice(-20);
  const rsiWin = rsi.slice(-20);
  const firstHalf = win.slice(0, 10);
  const secondHalf = win.slice(10);
  const idxLow1 = firstHalf.indexOf(Math.min(...firstHalf));
  const idxLow2 = 10 + secondHalf.indexOf(Math.min(...secondHalf));
  const priceLow1 = win[idxLow1];
  const priceLow2 = win[idxLow2];
  const rsiLow1 = rsiWin[idxLow1];
  const rsiLow2 = rsiWin[idxLow2];
  return priceLow2 < priceLow1 && rsiLow2 > rsiLow1;
}

// ─── 멀티타임프레임 확인 함수 ─────────────────────────────────────────────────

/**
 * RSI 모멘텀 가속도 — 최근 n주간 RSI 추이
 * @param weeklyCloses - 주봉 종가 배열 (최소 20주)
 * @param weeks - 확인할 주 수 (기본 3)
 */
export function calculateRSIMomentumAcceleration(weeklyCloses: number[], weeks = 3): { values: number[]; accelerating: boolean } {
  if (weeklyCloses.length < 14 + weeks) return { values: [], accelerating: false };
  const values: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const slice = weeklyCloses.slice(0, weeklyCloses.length - i); // 주봉 데이터이므로 1주 단위
    if (slice.length >= 14) values.push(calculateRSI(slice));
  }
  const accelerating = values.length >= 3 && values.every((v, i) => i === 0 || v > values[i - 1]);
  return { values, accelerating };
}
