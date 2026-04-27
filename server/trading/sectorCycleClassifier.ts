// @responsibility SectorEnergyResult → sectorCycleStage 매핑 SSOT
/**
 * sectorCycleClassifier.ts — sectorEnergyResult → sectorCycleStage / leadingSectorRS 변환
 *
 * 배경: macroState.sectorCycleStage 와 leadingSectorRS 는 regimeBridge / preflight /
 * sizingTierDecider / regimeEngine 가 read 하지만 *cron writer 가 부재* 해 영원히
 * undefined 였다 (sectorCycleDashboard 의 "전체 사이클: — 정보 없음" 직접 원인).
 *
 * PR-4 (ADR-0075) 가 macroState.sectorEnergyResult 를 자동 갱신 중 — 본 모듈은 그
 * 결과를 사이클 4분기 (EARLY/MID/LATE/TURNING) 로 자동 분류해 sectorCycleStage 를 채운다.
 *
 * 휴리스틱 (LEADING 평균 점수 + leading/lagging 비율 결합):
 *   - LATE    : avgLeadingScore ≥ LATE_SCORE_MIN AND ratio ≥ LATE_RATIO_MIN
 *               (강세 + 광범위 — 사이클 후반)
 *   - MID     : avgLeadingScore ≥ MID_SCORE_MIN AND ratio ≥ MID_RATIO_MIN
 *               (안정 강세)
 *   - EARLY   : avgLeadingScore ≥ EARLY_SCORE_MIN
 *               (회복 초기)
 *   - TURNING : 그 외 (혼조 — 방어 권고)
 *
 * 입력 검증:
 *   - leadingSectors 가 0 건이면 null 반환 (분류 불가, 이전 값 보존 정책)
 *   - SectorEnergyResult 자체가 null/undefined 면 null
 *
 * 출력 SSOT:
 *   - sectorCycleStage: 'EARLY' | 'MID' | 'LATE' | 'TURNING'
 *   - leadingSectorRS:  0~100 정수 (avgLeadingScore 반올림)
 */
import type { SectorEnergyResult } from '../../src/types/sectorEnergy.js';

/** 사이클 분류 임계값 SSOT */
export const SECTOR_CYCLE_THRESHOLDS = {
  /** LATE: 강한 주도 + 광범위 분포 */
  LATE_SCORE_MIN: 70,
  LATE_RATIO_MIN: 2,
  /** MID: 안정 강세 */
  MID_SCORE_MIN: 55,
  MID_RATIO_MIN: 1,
  /** EARLY: 회복 초기 */
  EARLY_SCORE_MIN: 40,
} as const;

export interface SectorCycleClassification {
  sectorCycleStage: 'EARLY' | 'MID' | 'LATE' | 'TURNING';
  /** leadingSectors 의 energyScore 평균을 0~100 정수로 반올림한 값 */
  leadingSectorRS: number;
}

/**
 * SectorEnergyResult → sectorCycleStage / leadingSectorRS 분류.
 *
 * @returns 분류 가능하면 { stage, RS }, 입력 부족 시 null (호출자가 이전 값 보존).
 */
export function deriveSectorCycle(
  result: SectorEnergyResult | null | undefined,
): SectorCycleClassification | null {
  if (!result) return null;
  const leading = result.leadingSectors ?? [];
  if (leading.length === 0) return null;

  const lagging = result.laggingSectors ?? [];

  // avgLeadingScore — leadingSectors 의 energyScore 평균 (0~100 정규화 점수 기준).
  const sumScore = leading.reduce((acc, t) => acc + (Number.isFinite(t.energyScore) ? t.energyScore : 0), 0);
  const avgLeadingScore = sumScore / leading.length;

  // ratio — leading 광범위도 (lagging=0 인 경우 ratio = leading.length 그대로).
  const ratio = leading.length / Math.max(1, lagging.length);

  let stage: SectorCycleClassification['sectorCycleStage'];
  if (avgLeadingScore >= SECTOR_CYCLE_THRESHOLDS.LATE_SCORE_MIN && ratio >= SECTOR_CYCLE_THRESHOLDS.LATE_RATIO_MIN) {
    stage = 'LATE';
  } else if (avgLeadingScore >= SECTOR_CYCLE_THRESHOLDS.MID_SCORE_MIN && ratio >= SECTOR_CYCLE_THRESHOLDS.MID_RATIO_MIN) {
    stage = 'MID';
  } else if (avgLeadingScore >= SECTOR_CYCLE_THRESHOLDS.EARLY_SCORE_MIN) {
    stage = 'EARLY';
  } else {
    stage = 'TURNING';
  }

  // 0~100 정수 반올림 + 음수/Infinity 안전 clamp.
  const rawRs = Math.round(avgLeadingScore);
  const leadingSectorRS = Math.max(0, Math.min(100, Number.isFinite(rawRs) ? rawRs : 0));

  return { sectorCycleStage: stage, leadingSectorRS };
}
