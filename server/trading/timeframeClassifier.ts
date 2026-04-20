/**
 * timeframeClassifier.ts — Phase 4-⑧ 시간축 재분류.
 *
 * 기존 SWING/CATALYST/MOMENTUM/INTRADAY 분류는 "신호 축" 이다. Kelly 배율
 * 분해 공식은 모든 포지션에 동일 레짐 가중치를 적용하고, 손절 정책도 프로파일별로만
 * 차등하여 스캘핑·데이·스윙 보유 기간별 리스크 특성을 반영하지 못했다.
 *
 * 이 모듈은 "시간 축" (SCALPING / DAY / SWING) 을 추가해 슬롯·Kelly·손절 규칙을
 * 독립적으로 관리한다. 기존 section 필드는 유지(신호 축)하고 timeframe 은 부가적.
 *
 *   SCALPING — 수초~수분 회전. 슬롯 3, Kelly ×0.2, 손절 -1%
 *   DAY      — 당일 청산. 슬롯 3, Kelly ×0.4, 손절 -3%
 *   SWING    — 수일~수주 보유. 슬롯 6, Kelly ×1.0, 손절 -5~-7%
 */

import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

export type Timeframe = 'SCALPING' | 'DAY' | 'SWING';

export interface TimeframeConfig {
  /** 동시 보유 최대 포지션 수 */
  maxPositions: number;
  /** Kelly 추가 배율 (regimeConfig.kellyMultiplier × 이 값) */
  kellyFactor: number;
  /** 손절 절대 비율 (음수) — 기본 손절 폭 */
  stopLossPct: number;
  /** 손절 상한 폭 (SWING 은 -7% 까지 허용) */
  stopLossMaxPct: number;
  /** 목표 수익률 범위 (%) — 추천 사유 및 경보 스케일링용 */
  targetPctRange: [number, number];
}

export const TIMEFRAME_CONFIGS: Record<Timeframe, TimeframeConfig> = {
  SCALPING: {
    maxPositions: 3,
    kellyFactor: 0.2,
    stopLossPct: -0.01,
    stopLossMaxPct: -0.01,
    targetPctRange: [0.3, 1.0],
  },
  DAY: {
    maxPositions: 3,
    kellyFactor: 0.4,
    stopLossPct: -0.03,
    stopLossMaxPct: -0.03,
    targetPctRange: [1.5, 5.0],
  },
  SWING: {
    maxPositions: 6,
    kellyFactor: 1.0,
    stopLossPct: -0.05,
    stopLossMaxPct: -0.07,
    targetPctRange: [5.0, 20.0],
  },
};

/** 총 동시 보유 한도 — 기본 12 슬롯 (3+3+6). */
export const TIMEFRAME_TOTAL_SLOTS =
  TIMEFRAME_CONFIGS.SCALPING.maxPositions +
  TIMEFRAME_CONFIGS.DAY.maxPositions +
  TIMEFRAME_CONFIGS.SWING.maxPositions;

/**
 * Watchlist 엔트리에서 timeframe 을 추론.
 *  - 명시적 timeframe 필드가 있으면 그 값
 *  - section=CATALYST → DAY (단기 이벤트 회전)
 *  - profileType=C (소형 모멘텀) 또는 CATALYST 가 아닌 INTRADAY 출처 → DAY
 *  - 그 외 기본 SWING
 *
 * SCALPING 은 외부에서 명시적으로 지정해야 한다 (자동 판별은 안정성 확보 후).
 */
export function classifyTimeframe(entry: Pick<WatchlistEntry, 'timeframe' | 'section' | 'profileType'>): Timeframe {
  if (entry.timeframe) return entry.timeframe;
  if (entry.section === 'CATALYST') return 'DAY';
  if (entry.profileType === 'C') return 'DAY';
  return 'SWING';
}

export function getTimeframeConfig(tf: Timeframe): TimeframeConfig {
  return TIMEFRAME_CONFIGS[tf];
}

/**
 * timeframe 별 보유 포지션 수를 집계 — signalScanner 슬롯 체크용.
 */
export function countByTimeframe<T extends { timeframe?: Timeframe }>(
  items: T[],
): Record<Timeframe, number> {
  const out: Record<Timeframe, number> = { SCALPING: 0, DAY: 0, SWING: 0 };
  for (const it of items) {
    const tf = it.timeframe ?? 'SWING';
    out[tf]++;
  }
  return out;
}

/**
 * timeframe 의 신규 진입 슬롯 여유가 있는지. activeCount 는 timeframe 기준 보유 수.
 */
export function hasTimeframeSlot(tf: Timeframe, activeCount: number, reserved = 0): boolean {
  return (activeCount + reserved) < TIMEFRAME_CONFIGS[tf].maxPositions;
}
