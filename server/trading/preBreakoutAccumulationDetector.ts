// @responsibility preBreakoutAccumulationDetector 매매 엔진 모듈
/**
 * preBreakoutAccumulationDetector.ts — 돌파 전 매집 징후 사전 감지
 *
 * Pre-Breakout Accumulation Detector (돌파 설계 참여 전략)
 *
 * 돌파가 일어나기 3~10일 전에 5대 매집 징후를 포착하여 포지션의 30% 선취매 구축.
 *
 * 5대 매집 징후:
 *   1. 주가가 좁은 범위(±1.5%)에서 횡보 (VCP 구조)
 *   2. 거래량이 20일 평균의 40% 이하로 3일 이상 연속 감소
 *   3. 일중 고가·저가 범위(High-Low Range)가 점진적으로 축소
 *   4. 호가창 매수 2~5호가 대량 지정가 지지 (ATR/가격 비율로 근사)
 *   5. 외국인/기관이 소량이지만 연속으로 순매수 유지
 *
 * 4개 이상 충족 시: 포지션의 30% 선취매, 돌파 확인 시 나머지 70% 추가 집행.
 */

// ─── 임계값 상수 ──────────────────────────────────────────────────────────────

/** 징후 1: 횡보 범위 임계값 — 최근 5일 종가 최대·최소 폭 ÷ 중간값 ≤ 3% (±1.5%) */
export const SIGN1_PRICE_RANGE_MAX_PCT = 0.03;

/** 징후 2: 거래량 임계값 — 20일 평균 대비 이 비율 이하 */
export const SIGN2_VOLUME_RATIO_THRESHOLD = 0.40;

/** 징후 2: 연속 감소 최소 일수 */
export const SIGN2_CONSECUTIVE_DAYS = 3;

/** 징후 3: HL 범위 축소 — 최근 3일 평균 HL 범위가 이전 3일 대비 이 비율 이하 */
export const SIGN3_HL_SHRINK_RATIO = 0.85;

/** 징후 4: ATR / 가격 비율 임계값 — 일중 변동성이 이 이하면 강한 매수 지지 추정 */
export const SIGN4_ATR_RATIO_THRESHOLD = 0.015;

/** 매집 판단 최소 징후 수 */
export const PRE_BREAKOUT_MIN_SIGNS = 4;

/** VCP: 거래량 5일 최대값이 20일 평균의 이 비율 이하 = 거래량 마름 */
export const VCP_VOLUME_DRYUP_RATIO = 0.5;

/** VCP: 현재 BB 폭이 최근 20봉 BB 폭 최소값의 이 배수 이하 = 볼밴 수축 */
export const VCP_BB_SQUEEZE_RATIO = 1.1;

/** VCP: 최근 10일 고저 범위가 현재가 대비 이 비율 이하 = 타이트 박스 */
export const VCP_TIGHT_BOX_RATIO = 0.05;

// ─── 인터페이스 ───────────────────────────────────────────────────────────────

export interface PreBreakoutInput {
  /** 최근 N일 종가 배열 (징후 1 — 최소 5일) */
  recentCloses: number[];
  /** 최근 N일 거래량 배열 (징후 2 — 최소 4일) */
  recentVolumes: number[];
  /** 20일 평균 거래량 (징후 2) */
  avgVolume20d: number;
  /** 최근 N일 일중 고가 배열 (징후 3 — 최소 6일) */
  recentHighs: number[];
  /** 최근 N일 일중 저가 배열 (징후 3 — 최소 6일) */
  recentLows: number[];
  /** ATR(14일) / 현재가 비율 — 징후 4 호가창 지지 근사 */
  atrRatio: number;
  /** 외국인 순매수 5일 누적 (억원 또는 주수) — 징후 5 */
  foreignNetBuy5d: number;
  /** 기관 순매수 5일 누적 (억원 또는 주수) — 징후 5 */
  institutionalNetBuy5d: number;
  /** 최근 N봉 볼린저밴드 폭 시계열 (VCP — 최소 20봉 권장) */
  bbWidthSeries?: number[];
}

export interface PreBreakoutSignDetail {
  /** 징후 1: 좁은 범위 횡보 (VCP 구조) */
  narrowPriceRange: boolean;
  /** 징후 2: 거래량 3일+ 연속 감소 & 20일 평균의 40% 이하 */
  volumeDryDown: boolean;
  /** 징후 3: 일중 HL Range 점진적 축소 */
  hlRangeNarrowing: boolean;
  /** 징후 4: 호가 매수 지지 (ATR 비율 근사) */
  bidSupportApprox: boolean;
  /** 징후 5: 외국인/기관 연속 순매수 */
  continuousNetBuy: boolean;
  /** 징후 6 (확장): VCP 에너지 응축 (BB 수축 + 거래량 마름 + 타이트 박스) */
  vcpEnergyCompression: boolean;
}

export interface PreBreakoutResult {
  /** 감지된 징후 수 (0~6) */
  detectedSigns: number;
  /** 각 징후별 상세 */
  signDetail: PreBreakoutSignDetail;
  /** 매집 중 여부 — true = 4개 이상 충족 → 30% 선취매 권고 */
  isAccumulating: boolean;
  /** VCP 감지 시 gateScore 가산 포인트 (징후 6 충족 시 +1.5, 그 외 0) */
  gateScoreBonus: number;
  /** 요약 설명 */
  summary: string;
}

// ─── 서브 징후 검사 함수 ──────────────────────────────────────────────────────

/**
 * 징후 1: 주가가 좁은 범위(±1.5%)에서 횡보 중 (VCP 구조).
 * 최근 5일 종가의 최대·최소 폭 ÷ 중간값 ≤ 3%.
 */
export function checkNarrowPriceRange(recentCloses: number[]): boolean {
  if (recentCloses.length < 5) return false;
  const last5 = recentCloses.slice(-5);
  const maxClose = Math.max(...last5);
  const minClose = Math.min(...last5);
  const mid = (maxClose + minClose) / 2;
  if (mid <= 0) return false;
  return (maxClose - minClose) / mid <= SIGN1_PRICE_RANGE_MAX_PCT;
}

/**
 * 징후 2: 거래량이 20일 평균의 40% 이하로 3일 이상 연속 감소.
 * 마지막 3일 각각이 avgVolume20d * 0.40 이하이고, 매일 감소 추세여야 한다.
 */
export function checkVolumeDryDown(
  recentVolumes: number[],
  avgVolume20d: number,
): boolean {
  if (recentVolumes.length < SIGN2_CONSECUTIVE_DAYS + 1 || avgVolume20d <= 0) return false;
  const lastN = recentVolumes.slice(-SIGN2_CONSECUTIVE_DAYS);
  // 각 날이 20일 평균의 40% 이하
  if (!lastN.every(v => v <= avgVolume20d * SIGN2_VOLUME_RATIO_THRESHOLD)) return false;
  // 연속 감소 (각 날이 이전 날보다 크지 않아야 함)
  for (let i = 1; i < lastN.length; i++) {
    if (lastN[i] > lastN[i - 1]) return false;
  }
  return true;
}

/**
 * 징후 3: 일중 High-Low Range가 점진적으로 축소.
 * 최근 3일 평균 HL 범위가 이전 3일 평균의 85% 이하.
 */
export function checkHlRangeNarrowing(
  recentHighs: number[],
  recentLows: number[],
): boolean {
  const n = Math.min(recentHighs.length, recentLows.length);
  if (n < 6) return false;
  const ranges = Array.from({ length: n }, (_, i) => recentHighs[i] - recentLows[i]);
  const recent3 = ranges.slice(-3);
  const prev3   = ranges.slice(-6, -3);
  const avgRecent = recent3.reduce((a, b) => a + b, 0) / recent3.length;
  const avgPrev   = prev3.reduce((a, b) => a + b, 0) / prev3.length;
  if (avgPrev <= 0) return false;
  return avgRecent <= avgPrev * SIGN3_HL_SHRINK_RATIO;
}

/**
 * 징후 4: 호가창 매수 2~5호가 대량 지정가 지지 (ATR/가격 비율로 근사).
 * ATR/가격 비율이 1.5% 이하이면 일중 변동성이 극도로 낮아진 것으로,
 * 강한 매수 지정가 물량이 하방을 지지하고 있다고 추정한다.
 */
export function checkBidSupportApprox(atrRatio: number): boolean {
  return atrRatio > 0 && atrRatio <= SIGN4_ATR_RATIO_THRESHOLD;
}

/**
 * 징후 5: 외국인/기관이 소량이지만 연속으로 순매수 유지.
 * 외국인 또는 기관 중 하나라도 5일 누적 순매수가 양수이면 충족.
 */
export function checkContinuousNetBuy(
  foreignNetBuy5d: number,
  institutionalNetBuy5d: number,
): boolean {
  return foreignNetBuy5d > 0 || institutionalNetBuy5d > 0;
}

/**
 * 징후 6 (VCP + 거래량 마름): 돌파 직전 에너지 응축 감지.
 *
 * 3개 조건을 동시에 충족해야 한다:
 *   - 거래량 마름: 최근 5일 거래량 최댓값이 20일 평균의 50% 이하
 *   - 볼린저밴드 수축: 현재 BB 폭이 최근 20봉 BB 폭 최솟값 × 1.1 이하
 *   - 타이트 박스: 최근 10일 고저 범위가 현재가의 5% 이내
 */
export function detectVCP(
  prices: number[],
  volumes: number[],
  bbWidth: number[],
): boolean {
  if (prices.length < 10 || volumes.length < 20 || bbWidth.length < 20) return false;

  const vol5d    = volumes.slice(-5);
  const vol20avg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  if (vol20avg <= 0) return false;
  const volDryup = Math.max(...vol5d) < vol20avg * VCP_VOLUME_DRYUP_RATIO;

  const bbMin  = Math.min(...bbWidth.slice(-20));
  const bbLast = bbWidth[bbWidth.length - 1];
  if (bbMin <= 0) return false;
  const bbSquz = bbLast < bbMin * VCP_BB_SQUEEZE_RATIO;

  const last10     = prices.slice(-10);
  const lastPrice  = prices[prices.length - 1];
  if (lastPrice <= 0) return false;
  const highRange  = (Math.max(...last10) - Math.min(...last10)) / lastPrice;
  const tightBox   = highRange < VCP_TIGHT_BOX_RATIO;

  return volDryup && bbSquz && tightBox;
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 5대 매집 징후를 종합 평가하여 Pre-Breakout 매집 여부를 판단한다.
 *
 * 4개 이상 충족 시 isAccumulating = true → signalScanner가 30% 선취매 집행.
 */
export function detectPreBreakoutAccumulation(
  input: PreBreakoutInput,
): PreBreakoutResult {
  const sign1 = checkNarrowPriceRange(input.recentCloses);
  const sign2 = checkVolumeDryDown(input.recentVolumes, input.avgVolume20d);
  const sign3 = checkHlRangeNarrowing(input.recentHighs, input.recentLows);
  const sign4 = checkBidSupportApprox(input.atrRatio);
  const sign5 = checkContinuousNetBuy(input.foreignNetBuy5d, input.institutionalNetBuy5d);
  const sign6 = input.bbWidthSeries != null
    ? detectVCP(input.recentCloses, input.recentVolumes, input.bbWidthSeries)
    : false;

  const signDetail: PreBreakoutSignDetail = {
    narrowPriceRange: sign1,
    volumeDryDown:    sign2,
    hlRangeNarrowing: sign3,
    bidSupportApprox: sign4,
    continuousNetBuy: sign5,
    vcpEnergyCompression: sign6,
  };

  const detectedSigns = [sign1, sign2, sign3, sign4, sign5, sign6].filter(Boolean).length;
  const isAccumulating = detectedSigns >= PRE_BREAKOUT_MIN_SIGNS;
  const gateScoreBonus = sign6 ? 1.5 : 0;

  const detectedNames = [
    sign1 && '①횡보VCP',
    sign2 && '②거래량감소',
    sign3 && '③HL축소',
    sign4 && '④호가지지',
    sign5 && '⑤수급순매수',
    sign6 && '⑥VCP응축',
  ].filter(Boolean).join(' / ');

  const summary = isAccumulating
    ? `매집 감지 — ${detectedSigns}/6 징후 충족 (${detectedNames}) → 30% 선취매 권고`
    : `매집 미감지 — ${detectedSigns}/6 징후 (${detectedNames || '없음'})`;

  return { detectedSigns, signDetail, isAccumulating, gateScoreBonus, summary };
}
