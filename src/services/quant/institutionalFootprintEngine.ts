// @responsibility quant institutionalFootprintEngine 엔진 모듈
// src/services/quant/institutionalFootprintEngine.ts
// ─── 기관 매집 발자국 탐지기 — 5가지 시그니처로 역추적 ─────────────────────────
//
// 기관의 매집은 가격을 크게 움직이지 않으면서 이루어지기 때문에
// 거래량 패턴에 '발자국'을 남긴다.
//
// 5가지 시그니처:
//   ① 장중 하락 후 오후 회복 패턴 3일+ 연속 (가격 지키기)
//   ② 하단 꼬리가 긴 캔들 연속 발생 (하방 테스팅 후 방어)
//   ③ 거래량 평균인데 변동폭 급격 축소 (매도 물량 흡수)
//   ④ 전일 종가 대비 시가 소폭 하락 but 종가 회복 (저가 매집)
//   ⑤ 지수 대비 상대강도 상승인데 주가 횡보 (베타 분리)
//
// 3개 이상 동시 발생 → institutionalAccumulation = true
// → 매수 타점 우선순위 1위로 격상

/** 단일 일봉 캔들 데이터 */
export interface DailyCandle {
  date: string;        // ISO 날짜
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 장중 저점 시간대 (선택): 'AM' | 'PM' — 장중 하락 후 회복 패턴 판별용 */
  intradayLowPeriod?: 'AM' | 'PM';
  /** 장중 고점 시간대 (선택) */
  intradayHighPeriod?: 'AM' | 'PM';
}

/** 개별 시그니처 분석 결과 */
export interface FootprintSignature {
  id: number;
  name: string;
  detected: boolean;
  /** 연속 발생 일수 (해당되는 경우) */
  consecutiveDays: number;
  /** 수치적 강도 (0~1, 높을수록 강함) */
  strength: number;
  description: string;
}

/** 기관 매집 발자국 탐지 전체 결과 */
export interface InstitutionalFootprintResult {
  /** 5가지 시그니처 개별 결과 */
  signatures: FootprintSignature[];
  /** 감지된 시그니처 수 (0~5) */
  detectedCount: number;
  /** 기관 매집 판정 (3개 이상 동시 발생 시 true) */
  institutionalAccumulation: boolean;
  /** 매집 강도 점수 (0~10) */
  accumulationScore: number;
  /** 매수 우선순위 격상 여부 */
  priorityElevation: boolean;
  /** Gate 3 보너스 점수 */
  gate3Bonus: number;
  /** 해석 메시지 */
  message: string;
}

// ─── 시그니처 ①: 장중 하락 후 오후 회복 패턴 ────────────────────────────────────

/**
 * 장중 하락 시도 후 오후에 반드시 회복하는 패턴이 3일 이상 연속.
 * intradayLowPeriod='AM' + close > open 조합으로 판별.
 * intradayLowPeriod가 없으면 fallback: close > (open+low)/2 으로 오후 회복 추정.
 */
function detectIntradayRecovery(candles: DailyCandle[]): FootprintSignature {
  let consecutiveDays = 0;
  let maxConsecutive = 0;

  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const bodySize = c.close - c.open;
    const lowerWick = c.open > c.close ? c.close - c.low : c.open - c.low;
    const range = c.high - c.low;

    let isRecovery = false;
    if (c.intradayLowPeriod) {
      // 장중 저점이 오전에 발생하고, 종가가 시가 이상으로 회복
      isRecovery = c.intradayLowPeriod === 'AM' && c.close >= c.open;
    } else {
      // Fallback: 하단 꼬리가 실체보다 크고, 종가가 일봉 중심 이상
      const midPoint = (c.high + c.low) / 2;
      isRecovery = range > 0 && lowerWick > Math.abs(bodySize) && c.close > midPoint;
    }

    if (isRecovery) {
      consecutiveDays++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveDays);
    } else {
      consecutiveDays = 0;
    }
  }

  // 최근 연속일로 재계산 (뒤에서부터)
  let recentConsecutive = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const bodySize = c.close - c.open;
    const lowerWick = c.open > c.close ? c.close - c.low : c.open - c.low;
    const range = c.high - c.low;
    let isRecovery = false;
    if (c.intradayLowPeriod) {
      isRecovery = c.intradayLowPeriod === 'AM' && c.close >= c.open;
    } else {
      const midPoint = (c.high + c.low) / 2;
      isRecovery = range > 0 && lowerWick > Math.abs(bodySize) && c.close > midPoint;
    }
    if (isRecovery) recentConsecutive++;
    else break;
  }

  const detected = recentConsecutive >= 3;
  const strength = Math.min(1, recentConsecutive / 5);

  return {
    id: 1,
    name: '장중 하락 후 오후 회복',
    detected,
    consecutiveDays: recentConsecutive,
    strength,
    description: detected
      ? `${recentConsecutive}일 연속 장중 하락 시도 후 종가 회복 — 기관 가격 방어 의심`
      : `최근 연속 회복 ${recentConsecutive}일 (3일 미만)`,
  };
}

// ─── 시그니처 ②: 하단 꼬리 긴 캔들 연속 ──────────────────────────────────────

/**
 * 일봉 기준 하단 꼬리가 긴 캔들(하방 테스팅 후 방어)이 연속 발생.
 * 하단꼬리 비율 = (min(open,close) - low) / (high - low) ≥ 0.6
 */
function detectLongLowerShadow(candles: DailyCandle[]): FootprintSignature {
  const SHADOW_RATIO_THRESHOLD = 0.6;
  let recentConsecutive = 0;

  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const range = c.high - c.low;
    if (range <= 0) break;

    const body = Math.min(c.open, c.close);
    const lowerShadowRatio = (body - c.low) / range;

    if (lowerShadowRatio >= SHADOW_RATIO_THRESHOLD) {
      recentConsecutive++;
    } else {
      break;
    }
  }

  const detected = recentConsecutive >= 2;
  const strength = Math.min(1, recentConsecutive / 4);

  return {
    id: 2,
    name: '하단 꼬리 긴 캔들 연속',
    detected,
    consecutiveDays: recentConsecutive,
    strength,
    description: detected
      ? `${recentConsecutive}일 연속 긴 하단 꼬리 — 하방 테스팅 후 강력 방어`
      : `하단꼬리 캔들 연속 ${recentConsecutive}일 (2일 미만)`,
  };
}

// ─── 시그니처 ③: 거래량 평균 + 변동폭 급격 축소 ──────────────────────────────

/**
 * 거래량은 평균 수준인데 주가 변동폭만 급격히 축소.
 * 최근 5일 평균 거래량 vs 20일 평균 거래량: 0.7~1.3 범위(평균 수준)
 * 최근 5일 ATR vs 20일 ATR: ≤ 0.5 (변동폭 절반 이하로 축소)
 */
function detectVolumeRangeCompression(candles: DailyCandle[]): FootprintSignature {
  if (candles.length < 20) {
    return {
      id: 3, name: '거래량 정상 + 변동폭 축소', detected: false,
      consecutiveDays: 0, strength: 0,
      description: '데이터 부족 (20일 미만)',
    };
  }

  // 20일 평균 거래량
  const vol20 = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  // 5일 평균 거래량
  const recent5 = candles.slice(-5);
  const vol5 = recent5.reduce((s, c) => s + c.volume, 0) / 5;

  // 20일 ATR
  const atr20 = candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;
  // 5일 ATR
  const atr5 = recent5.reduce((s, c) => s + (c.high - c.low), 0) / 5;

  const volumeRatio = vol20 > 0 ? vol5 / vol20 : 0;
  const atrRatio = atr20 > 0 ? atr5 / atr20 : 1;

  // 거래량 정상(0.7~1.3) + 변동폭 축소(≤0.5)
  const volumeNormal = volumeRatio >= 0.7 && volumeRatio <= 1.3;
  const rangeCompressed = atrRatio <= 0.5;
  const detected = volumeNormal && rangeCompressed;

  const strength = detected ? Math.min(1, (0.5 - atrRatio) / 0.3 + 0.5) : atrRatio <= 0.7 ? 0.3 : 0;

  return {
    id: 3,
    name: '거래량 정상 + 변동폭 축소',
    detected,
    consecutiveDays: detected ? 5 : 0,
    strength,
    description: detected
      ? `거래량 ${(volumeRatio * 100).toFixed(0)}%(정상범위) but ATR ${(atrRatio * 100).toFixed(0)}%(축소) — 매도물량 흡수 중`
      : `거래량비 ${(volumeRatio * 100).toFixed(0)}%, ATR비 ${(atrRatio * 100).toFixed(0)}%`,
  };
}

// ─── 시그니처 ④: 갭다운 시가 후 종가 회복 (저가 매집) ──────────────────────────

/**
 * 전일 종가 대비 시가가 지속적으로 소폭 하락하지만 종가는 회복.
 * 최근 5일 중 3일 이상: open < prevClose AND close >= prevClose
 */
function detectLowOpenHighClose(candles: DailyCandle[]): FootprintSignature {
  if (candles.length < 6) {
    return {
      id: 4, name: '저가 매집 (갭다운→회복)', detected: false,
      consecutiveDays: 0, strength: 0,
      description: '데이터 부족 (6일 미만)',
    };
  }

  const recent = candles.slice(-6); // 마지막 5일 + 전일 기준 1일
  let patternDays = 0;
  let totalGapDown = 0;

  for (let i = 1; i < recent.length; i++) {
    const prevClose = recent[i - 1].close;
    const curr = recent[i];

    // 시가가 전일 종가보다 하락
    const gapDown = curr.open < prevClose;
    // 종가가 전일 종가 이상으로 회복
    const closeRecovered = curr.close >= prevClose * 0.998; // 0.2% 허용 오차

    if (gapDown && closeRecovered) {
      patternDays++;
      totalGapDown += (prevClose - curr.open) / prevClose;
    }
  }

  const detected = patternDays >= 3;
  const strength = Math.min(1, patternDays / 5);

  return {
    id: 4,
    name: '저가 매집 (갭다운→회복)',
    detected,
    consecutiveDays: patternDays,
    strength,
    description: detected
      ? `최근 5일 중 ${patternDays}일 갭다운 시가 → 종가 회복 — 저가 매집 패턴`
      : `갭다운 후 회복 ${patternDays}일 (3일 미만)`,
  };
}

// ─── 시그니처 ⑤: 상대강도 상승 + 주가 횡보 (베타 분리) ─────────────────────────

/**
 * 코스피/코스닥 지수 대비 상대강도가 상승하는데 주가는 횡보.
 * @param candles      종목 일봉 데이터
 * @param indexReturns 동기간 지수 일간 수익률 배열 (길이 ≥ candles)
 */
function detectBetaSeparation(
  candles: DailyCandle[],
  indexReturns: number[],
): FootprintSignature {
  if (candles.length < 10 || indexReturns.length < 10) {
    return {
      id: 5, name: '베타 분리 (RS↑ + 횡보)', detected: false,
      consecutiveDays: 0, strength: 0,
      description: '데이터 부족 (10일 미만)',
    };
  }

  const recent = candles.slice(-10);
  const recentIdx = indexReturns.slice(-10);

  // 종목 10일 수익률
  const stockReturn = (recent[recent.length - 1].close - recent[0].close) / recent[0].close;
  // 지수 10일 누적 수익률
  const indexReturn = recentIdx.reduce((acc, r) => acc * (1 + r), 1) - 1;

  // 주가 횡보: 10일 수익률 절대값 ≤ 3%
  const priceFlat = Math.abs(stockReturn) <= 0.03;

  // 상대강도 상승: 종목 수익률 > 지수 수익률 + 2%p (아웃퍼폼)
  const rsRising = stockReturn > indexReturn + 0.02;

  // 또는 지수 하락인데 종목은 횡보 유지 → 방어적 상대강도
  const defensiveRS = indexReturn < -0.02 && Math.abs(stockReturn) <= 0.03;

  const detected = priceFlat && (rsRising || defensiveRS);
  const outperformance = stockReturn - indexReturn;
  const strength = detected ? Math.min(1, outperformance / 0.05 + 0.5) : 0;

  return {
    id: 5,
    name: '베타 분리 (RS↑ + 횡보)',
    detected,
    consecutiveDays: detected ? 10 : 0,
    strength,
    description: detected
      ? `종목 ${(stockReturn * 100).toFixed(1)}% vs 지수 ${(indexReturn * 100).toFixed(1)}% — ` +
        `상대강도 아웃퍼폼(${(outperformance * 100).toFixed(1)}%p)하면서 횡보 = 베타 분리`
      : `종목 ${(stockReturn * 100).toFixed(1)}%, 지수 ${(indexReturn * 100).toFixed(1)}% — 베타 분리 미충족`,
  };
}

// ─── 메인: 기관 매집 발자국 탐지 ──────────────────────────────────────────────

/**
 * 기관 매집 발자국 5가지 시그니처를 종합 분석한다.
 *
 * @param candles       최근 20일+ 일봉 데이터 (오래된→최신)
 * @param indexReturns  동기간 지수 일간 수익률 배열 (베타 분리 계산용)
 * @returns InstitutionalFootprintResult
 */
export function detectInstitutionalFootprint(
  candles: DailyCandle[],
  indexReturns: number[] = [],
): InstitutionalFootprintResult {
  if (candles.length < 5) {
    return {
      signatures: [],
      detectedCount: 0,
      institutionalAccumulation: false,
      accumulationScore: 0,
      priorityElevation: false,
      gate3Bonus: 0,
      message: '데이터 부족 — 기관 매집 분석 불가 (최소 5일 필요)',
    };
  }

  // 5가지 시그니처 감지
  const sig1 = detectIntradayRecovery(candles);
  const sig2 = detectLongLowerShadow(candles);
  const sig3 = detectVolumeRangeCompression(candles);
  const sig4 = detectLowOpenHighClose(candles);
  const sig5 = detectBetaSeparation(candles, indexReturns);

  const signatures = [sig1, sig2, sig3, sig4, sig5];
  const detectedCount = signatures.filter(s => s.detected).length;
  const institutionalAccumulation = detectedCount >= 3;

  // 매집 강도 점수 (0~10)
  // 기본: 감지된 시그니처당 2점 (최대 10)
  // 강도 가중: 각 시그니처 strength 평균으로 보정
  const avgStrength = signatures
    .filter(s => s.detected)
    .reduce((s, sig) => s + sig.strength, 0) / Math.max(1, detectedCount);
  let accumulationScore = Math.min(10, detectedCount * 2 + Math.round(avgStrength * 2));

  // 3개 미만이면 최대 4점으로 제한
  if (!institutionalAccumulation) {
    accumulationScore = Math.min(4, accumulationScore);
  }

  // 매수 우선순위 격상: 기관 매집 판정 시
  const priorityElevation = institutionalAccumulation;

  // Gate 3 보너스: 매집 판정 시 +5, 2개 시그니처 시 +2
  const gate3Bonus = institutionalAccumulation ? 5 : detectedCount >= 2 ? 2 : 0;

  // 메시지
  const detectedNames = signatures.filter(s => s.detected).map(s => s.name);
  let message: string;
  if (institutionalAccumulation) {
    message = `★ 기관 매집 발자국 감지 (${detectedCount}/5 시그니처) — ` +
      `[${detectedNames.join(', ')}] → 매수 타점 우선순위 1위 격상 (점수: ${accumulationScore}/10)`;
  } else if (detectedCount > 0) {
    message = `기관 매집 부분 감지 (${detectedCount}/5) — ` +
      `[${detectedNames.join(', ')}]. 3개 이상 시 확정 (점수: ${accumulationScore}/10)`;
  } else {
    message = '기관 매집 시그니처 미감지 — 일반 시장 패턴';
  }

  return {
    signatures,
    detectedCount,
    institutionalAccumulation,
    accumulationScore,
    priorityElevation,
    gate3Bonus,
    message,
  };
}
