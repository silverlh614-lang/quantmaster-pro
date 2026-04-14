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

export function calculateSMA(data: number[], period: number): number[] {
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

// ─── 멀티타임프레임 확인 함수 ─────────────────────────────────────────────────

/**
 * 월봉: 12개월 EMA 위에서 우상향 중인지 확인
 * @param monthlyCloses - 최근 24개월 이상 월봉 종가
 */
export function isAboveMonthlyEMA12(monthlyCloses: number[]): boolean {
  if (monthlyCloses.length < 13) return false;
  const ema12 = calculateEMA(monthlyCloses, 12);
  const lastClose = monthlyCloses[monthlyCloses.length - 1];
  const lastEma = ema12[ema12.length - 1];
  const prevEma = ema12[ema12.length - 2];
  return lastClose > lastEma && lastEma > prevEma; // 위에 있고 + EMA 우상향
}

/**
 * 주봉: 일목 구름대 위 안착 확인
 * @param weeklyHighs/Lows/Closes - 최근 52주 이상 주봉 데이터
 */
export function isWeeklyAboveCloud(weeklyHighs: number[], weeklyLows: number[], weeklyCloses: number[]): boolean {
  const ichimoku = calculateIchimoku(weeklyHighs, weeklyLows, weeklyCloses);
  return ichimoku.status === 'ABOVE_CLOUD';
}

/**
 * 멀티타임프레임 종합 판단
 */
export function evaluateMultiTimeframe(
  monthlyCloses: number[],
  weeklyHighs: number[], weeklyLows: number[], weeklyCloses: number[],
  dailyHighs: number[], dailyLows: number[], dailyCloses: number[],
): { monthly: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; weekly: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; daily: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; consistency: boolean } {
  // 월봉
  const monthlyBull = isAboveMonthlyEMA12(monthlyCloses);
  const monthly = monthlyBull ? 'BULLISH' as const : monthlyCloses.length >= 13 ? 'BEARISH' as const : 'NEUTRAL' as const;

  // 주봉
  const weeklyBull = isWeeklyAboveCloud(weeklyHighs, weeklyLows, weeklyCloses);
  const weekly = weeklyBull ? 'BULLISH' as const : weeklyCloses.length >= 52 ? 'BEARISH' as const : 'NEUTRAL' as const;

  // 일봉
  const dailyIchimoku = calculateIchimoku(dailyHighs, dailyLows, dailyCloses);
  const dailyMACD = calculateMACD(dailyCloses);
  const dailyRSI = calculateRSI(dailyCloses);
  const dailyBull = dailyIchimoku.status === 'ABOVE_CLOUD' && dailyMACD.status !== 'DEAD_CROSS' && dailyRSI > 40 && dailyRSI < 75;
  const dailyBear = dailyIchimoku.status === 'BELOW_CLOUD' || dailyMACD.status === 'DEAD_CROSS' || dailyRSI < 30;
  const daily = dailyBull ? 'BULLISH' as const : dailyBear ? 'BEARISH' as const : 'NEUTRAL' as const;

  const consistency = monthly === 'BULLISH' && weekly === 'BULLISH' && daily === 'BULLISH';

  return { monthly, weekly, daily, consistency };
}

/**
 * TMA (추세 모멘텀 가속도 측정기) — 수익률의 2차 미분(가속도)
 *
 * 물리학 원리 적용: 가격이 최고점이어도 가속도(2차 미분)가 먼저 꺾인다.
 * 가격보다 1~2주 선행하는 수학적 선행 지표.
 *
 * TMA = (오늘 수익률 - N일 전 수익률) / N
 *   TMA < 0   → 감속 경보
 *   TMA < -0.5 → 즉각 대응
 *
 * @param closes - 일봉 종가 배열 (최소 period+2 개)
 * @param period - 가속도 측정 기간 (기본 5일)
 * @returns { tma, returns, alert }
 */
export function calculateTMA(
  closes: number[],
  period = 5,
): { tma: number; returnToday: number; returnNAgo: number; alert: 'NONE' | 'DECELERATION' | 'IMMEDIATE' } {
  if (closes.length < period + 2) {
    return { tma: 0, returnToday: 0, returnNAgo: 0, alert: 'NONE' };
  }

  // 일별 수익률(%) 계산
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }

  const returnToday = returns[returns.length - 1];
  const returnNAgo = returns[returns.length - 1 - period];
  const tma = (returnToday - returnNAgo) / period;

  let alert: 'NONE' | 'DECELERATION' | 'IMMEDIATE' = 'NONE';
  if (tma < -0.5) alert = 'IMMEDIATE';
  else if (tma < 0) alert = 'DECELERATION';

  return { tma, returnToday, returnNAgo, alert };
}

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
