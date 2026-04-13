// src/services/quant/fibonacciTimeZoneEngine.ts
// ─── 피보나치 타임존 엔진 — 시간축 피보나치로 변곡점 예측 ──────────────────────
//
// 기존 피보나치(조건19)는 *가격* 되돌림 비율에만 적용.
// 이 엔진은 *시간* 축에 피보나치 비율을 적용하여
// "언제 변곡이 오는가"를 예측한다.
//
// 핵심: 직전 주요 저점→고점까지의 기간(N일) 기준으로
//   N×0.382, N×0.618, N×1.0, N×1.618, N×2.618 시점에 캔들 감시.
//   이 타임존이 가격 피보나치 지지선과 겹치는 구간
//   = 시공간 피보나치 교점 → 최고 확률 매수 타점.

/** 피보나치 타임존 비율 상수 */
const FIB_TIME_RATIOS = [0.382, 0.618, 1.0, 1.618, 2.618] as const;

/** 타임존 허용 오차 (거래일 기준, ±TOLERANCE 이내면 타임존 내로 판단) */
const TIMEZONE_TOLERANCE_DAYS = 1;

/** 개별 타임존 분석 결과 */
export interface FibTimeZone {
  /** 피보나치 비율 (0.382, 0.618, 1.0, 1.618, 2.618) */
  ratio: number;
  /** 기준 기간(N) × ratio 로 산출된 목표 거래일 수 */
  targetDay: number;
  /** 현재 조정 경과 거래일과의 거리 (절대값, 거래일) */
  distanceFromCurrent: number;
  /** 현재 시점이 이 타임존 범위 내에 있는지 */
  isActive: boolean;
}

/** 시공간 피보나치 교점 (가격 + 시간 동시 피보나치) */
export interface SpaceTimeConfluence {
  /** 교점 발생 여부 */
  detected: boolean;
  /** 가격 되돌림 레벨 (e.g., 0.382, 0.618) */
  priceLevel: number | null;
  /** 시간 타임존 비율 (e.g., 0.618, 1.0) */
  timeRatio: number | null;
  /** 교점 설명 */
  description: string;
}

/** 피보나치 타임존 엔진 전체 결과 */
export interface FibonacciTimeZoneResult {
  /** 기준 스윙 기간 (저점→고점 거래일 수, N) */
  swingPeriodDays: number;
  /** 고점 이후 현재까지 경과 조정 거래일 수 */
  correctionDaysElapsed: number;
  /** 각 타임존별 분석 결과 */
  timeZones: FibTimeZone[];
  /** 현재 활성화된 타임존 수 */
  activeZoneCount: number;
  /** 가장 근접한 타임존 */
  nearestZone: FibTimeZone | null;
  /** 시공간 피보나치 교점 (가격+시간 동시 발생) */
  spaceTimeConfluence: SpaceTimeConfluence;
  /** 타임존 점수 (0~10) — Gate 3 피보나치 조건 보강용 */
  timeZoneScore: number;
  /** 매수 신호 격상 여부 (시공간 교점 발생 시 true) */
  buySignalBoost: boolean;
  /** 해석 메시지 */
  message: string;
}

/**
 * 두 날짜 사이의 거래일 수를 계산한다.
 * 간이 방식: 주말(토/일)을 제외한 영업일 수.
 * 한국 공휴일은 포함하지 않으므로 근사치이다.
 */
export function tradingDaysBetweenDates(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    current.setDate(current.getDate() + 1);
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/**
 * 현재 가격 되돌림 비율을 계산한다.
 * @param swingHigh 스윙 고점 가격
 * @param swingLow  스윙 저점 가격
 * @param currentPrice 현재 가격
 * @returns 되돌림 비율 (0 = 고점, 1 = 저점까지 완전 되돌림)
 */
function computeRetracementRatio(swingHigh: number, swingLow: number, currentPrice: number): number {
  const range = swingHigh - swingLow;
  if (range <= 0) return 0;
  return Math.max(0, Math.min(1, (swingHigh - currentPrice) / range));
}

/** 가격 되돌림이 피보나치 핵심 레벨 근처인지 판별 (±3% 허용) */
const PRICE_FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
const PRICE_FIB_TOLERANCE = 0.03;

function findNearestPriceFibLevel(retracementRatio: number): { level: number; distance: number } | null {
  let nearest: { level: number; distance: number } | null = null;
  for (const level of PRICE_FIB_LEVELS) {
    const distance = Math.abs(retracementRatio - level);
    if (distance <= PRICE_FIB_TOLERANCE) {
      if (!nearest || distance < nearest.distance) {
        nearest = { level, distance };
      }
    }
  }
  return nearest;
}

/**
 * 피보나치 타임존 분석 실행.
 *
 * @param swingLowDate  직전 주요 저점 날짜 (ISO 문자열 또는 Date)
 * @param swingHighDate 직전 주요 고점 날짜
 * @param currentDate   현재 날짜 (기본: 오늘)
 * @param swingHigh     고점 가격
 * @param swingLow      저점 가격
 * @param currentPrice  현재 가격
 * @param existingFibScore 기존 피보나치 조건(19번) 점수 (0~10)
 */
export function evaluateFibonacciTimeZone(
  swingLowDate: string | Date,
  swingHighDate: string | Date,
  currentDate: string | Date = new Date(),
  swingHigh: number,
  swingLow: number,
  currentPrice: number,
  existingFibScore: number = 0,
): FibonacciTimeZoneResult {
  const lowDate = new Date(swingLowDate);
  const highDate = new Date(swingHighDate);
  const now = new Date(currentDate);

  // N = 저점→고점 거래일 수
  const swingPeriodDays = tradingDaysBetweenDates(lowDate, highDate);
  // 고점 이후 경과 거래일
  const correctionDaysElapsed = tradingDaysBetweenDates(highDate, now);

  // 기간이 너무 짧으면 의미 없음 (최소 5거래일)
  if (swingPeriodDays < 5) {
    return {
      swingPeriodDays,
      correctionDaysElapsed,
      timeZones: [],
      activeZoneCount: 0,
      nearestZone: null,
      spaceTimeConfluence: { detected: false, priceLevel: null, timeRatio: null, description: '스윙 기간 부족 (5거래일 미만)' },
      timeZoneScore: 0,
      buySignalBoost: false,
      message: `스윙 기간 ${swingPeriodDays}일 — 피보나치 타임존 분석 불가 (최소 5일 필요)`,
    };
  }

  // 각 타임존 계산
  const timeZones: FibTimeZone[] = FIB_TIME_RATIOS.map(ratio => {
    const targetDay = Math.round(swingPeriodDays * ratio);
    const distanceFromCurrent = Math.abs(correctionDaysElapsed - targetDay);
    const isActive = distanceFromCurrent <= TIMEZONE_TOLERANCE_DAYS;
    return { ratio, targetDay, distanceFromCurrent, isActive };
  });

  const activeZoneCount = timeZones.filter(tz => tz.isActive).length;

  // 가장 근접한 타임존
  const nearestZone = timeZones.reduce<FibTimeZone | null>((nearest, tz) => {
    if (!nearest || tz.distanceFromCurrent < nearest.distanceFromCurrent) return tz;
    return nearest;
  }, null);

  // 가격 피보나치 레벨 검사
  const retracementRatio = computeRetracementRatio(swingHigh, swingLow, currentPrice);
  const nearestPriceFib = findNearestPriceFibLevel(retracementRatio);

  // 시공간 피보나치 교점 판별
  const activeTimeZone = timeZones.find(tz => tz.isActive);
  const spaceTimeConfluence: SpaceTimeConfluence = (activeTimeZone && nearestPriceFib)
    ? {
        detected: true,
        priceLevel: nearestPriceFib.level,
        timeRatio: activeTimeZone.ratio,
        description:
          `시공간 교점 발생: ${swingPeriodDays}일 상승 후 ` +
          `${correctionDaysElapsed}일째(${swingPeriodDays}×${activeTimeZone.ratio})에 ` +
          `${(nearestPriceFib.level * 100).toFixed(1)}% 가격 되돌림 동시 발생 → 즉시 매수 신호`,
      }
    : {
        detected: false,
        priceLevel: nearestPriceFib?.level ?? null,
        timeRatio: activeTimeZone?.ratio ?? null,
        description: activeTimeZone
          ? `타임존 활성(×${activeTimeZone.ratio}) but 가격 피보나치 미합치`
          : nearestPriceFib
            ? `가격 ${(nearestPriceFib.level * 100).toFixed(1)}% 되돌림 but 타임존 비활성`
            : '가격·시간 모두 피보나치 레벨 밖',
      };

  // 타임존 점수 (0~10)
  let timeZoneScore = 0;

  // 기본: 활성 타임존 존재 시 +3
  if (activeZoneCount > 0) timeZoneScore += 3;

  // 근접도 보너스: 가장 가까운 타임존까지 거리 기반 (0일=+3, 1일=+2, 2~3일=+1)
  if (nearestZone) {
    if (nearestZone.distanceFromCurrent === 0) timeZoneScore += 3;
    else if (nearestZone.distanceFromCurrent <= 1) timeZoneScore += 2;
    else if (nearestZone.distanceFromCurrent <= 3) timeZoneScore += 1;
  }

  // 시공간 교점 보너스: +4 (최고 확률 매수 타점)
  if (spaceTimeConfluence.detected) timeZoneScore += 4;

  timeZoneScore = Math.min(10, timeZoneScore);

  // 매수 신호 격상: 시공간 교점 + 기존 피보나치 점수 5 이상
  const buySignalBoost = spaceTimeConfluence.detected && existingFibScore >= 5;

  // 해석 메시지
  let message: string;
  if (spaceTimeConfluence.detected) {
    message = `★ 시공간 피보나치 교점 — ` +
      `${swingPeriodDays}일 스윙 기준, ${correctionDaysElapsed}일째 ` +
      `타임존(×${spaceTimeConfluence.timeRatio}) + ` +
      `가격 ${((spaceTimeConfluence.priceLevel ?? 0) * 100).toFixed(1)}% 되돌림 동시 충족. ` +
      `최고 확률 매수 타점 (점수: ${timeZoneScore}/10)`;
  } else if (activeZoneCount > 0) {
    message = `피보나치 타임존 활성 — ${correctionDaysElapsed}일째, ` +
      `${activeZoneCount}개 타임존 범위 내. 가격 피보나치 합치 대기 중 (점수: ${timeZoneScore}/10)`;
  } else {
    const nextZone = timeZones
      .filter(tz => tz.targetDay > correctionDaysElapsed)
      .sort((a, b) => a.targetDay - b.targetDay)[0];
    message = nextZone
      ? `다음 타임존: ${nextZone.targetDay}일째(×${nextZone.ratio}), ` +
        `${nextZone.targetDay - correctionDaysElapsed}거래일 후 (점수: ${timeZoneScore}/10)`
      : `모든 타임존 경과. 새로운 스윙 기준 필요 (점수: ${timeZoneScore}/10)`;
  }

  return {
    swingPeriodDays,
    correctionDaysElapsed,
    timeZones,
    activeZoneCount,
    nearestZone,
    spaceTimeConfluence,
    timeZoneScore,
    buySignalBoost,
    message,
  };
}
