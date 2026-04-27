// @responsibility 강세 섹터 Gate Score 가산점 SSOT — sectorEnergyEngine.tier × Gate 보너스 매트릭스
/**
 * sectorScoreBoost.ts — 강세 섹터 Gate Score 가산점 (ADR-0075).
 *
 * 사용자 운영 보고 (2026-04-27):
 *   "선행지표를 가져오나 활용이 약하다. 원자재, 석유, 금, soxx, ewt등 참고자료는 충분하다.
 *    매수추천은 gate위주라 그런지 관계없는 종목이 보인다.
 *    그날의 강세섹터는 gate에 가산점을 주는건 어떨까"
 *
 * 기존 sectorEnergyEngine.ts 가 이미 12 KRX 섹터 4주 수익률 + 거래량 + 외국인 집중도
 * 합성으로 LEADING/NEUTRAL/LAGGING 3 tier 분류 + `gate2Adjustment: -1` (LEADING 만)
 * 까지 산출 중. 다만 이 결과가 entryEngine 의 *Gate Score 산출* 경로에 wiring
 * 미적용 — `getSectorGate2Adjustment` 호출자 0건.
 *
 * 본 모듈: sectorEnergyResult + 종목 섹터 라벨 → Gate 점수 보너스 SSOT.
 *
 * 보너스 매트릭스 (ADR-0075 §Decision):
 *   LEADING (Top 3 강세 섹터)  → +2점 (사용자 명시 "Gate 가산점")
 *   NEUTRAL                    → 0
 *   LAGGING (Bottom 3 소외)    → -1점 (Bear regime 만, BULL/EARLY 에선 0 — 후속 PR 분기)
 *   섹터 라벨 부재             → 0 (안전 fallback)
 *   sectorEnergyResult 부재    → 0 (안전 fallback)
 *
 * 환경 변수 롤백: `SECTOR_SCORE_BOOST_DISABLED=true` 시 항상 0.
 *
 * 적용 경로 (후속 PR):
 *   - entryEngine.evaluateBuy / Gate Score 산출 시점에 호출
 *   - macroStateRepo.sectorEnergyResult 영속 후 read
 *   - marketDataRefresh 가 매크로 갱신 시 evaluateSectorEnergy 동시 호출
 */

import type { SectorEnergyResult, SectorTier } from '../../src/types/sectorEnergy.js';

/** LEADING 섹터 종목에 부여하는 Gate Score 가산점 (양수 = 진입 유리) */
export const SECTOR_BOOST_LEADING = 2;

/** LAGGING 섹터 종목에 부여하는 Gate Score 차감점 (Bear/Caution regime 만) */
export const SECTOR_BOOST_LAGGING_BEAR = -1;

/** Bear regime 식별자 — LAGGING 차감 적용 대상 */
const BEAR_REGIMES = new Set(['R5_CAUTION', 'R6_DEFENSE']);

/**
 * 종목의 섹터 라벨 + sectorEnergyResult + 현재 레짐을 입력받아 Gate Score 보너스 반환.
 *
 * @param sectorName 종목 섹터 라벨 (예: '반도체', '이차전지'). undefined 면 0.
 * @param sectorResult evaluateSectorEnergy() 결과. null 면 0.
 * @param regime 현재 RegimeLevel (예: 'R2_BULL'). LAGGING 차감 분기에 사용.
 * @returns Gate Score 보너스 (정수). +2 / 0 / -1 분기.
 */
export function applySectorScoreBoost(
  sectorName: string | undefined | null,
  sectorResult: SectorEnergyResult | null,
  regime?: string,
): number {
  // ENV 롤백 스위치
  if (process.env.SECTOR_SCORE_BOOST_DISABLED === 'true') return 0;

  if (!sectorName) return 0;
  if (!sectorResult) return 0;

  const tier = classifySectorTier(sectorName, sectorResult);

  if (tier === 'LEADING') return SECTOR_BOOST_LEADING;

  if (tier === 'LAGGING') {
    // Bear/Caution regime 에서만 차감 — BULL/EARLY/NEUTRAL 에서는 보너스 없음 (회귀 위험 격리)
    if (regime && BEAR_REGIMES.has(regime)) return SECTOR_BOOST_LAGGING_BEAR;
    return 0;
  }

  // NEUTRAL or 미매칭
  return 0;
}

/**
 * 종목 섹터 라벨이 sectorEnergyResult 의 어느 tier 에 속하는지 분류.
 * 섹터 라벨이 leading/lagging 어디에도 없으면 'NEUTRAL' (안전 fallback).
 */
export function classifySectorTier(
  sectorName: string,
  sectorResult: SectorEnergyResult,
): SectorTier {
  if (sectorResult.leadingSectors.some((t) => t.name === sectorName)) return 'LEADING';
  if (sectorResult.laggingSectors.some((t) => t.name === sectorName)) return 'LAGGING';
  return 'NEUTRAL';
}

/**
 * 진단 헬퍼 — Gate Score 보너스 적용 결과를 사람이 읽을 수 있는 사유로 반환.
 * Telegram 알림 / 텔레메트리 로그에 사용.
 *
 * @example
 *   "반도체 +2 (LEADING)"
 *   "유통/소비재 -1 (LAGGING, R6_DEFENSE)"
 *   "에너지/화학 0 (NEUTRAL)"
 */
export function describeSectorBoost(
  sectorName: string | undefined | null,
  boost: number,
  tier: SectorTier | 'UNKNOWN',
  regime?: string,
): string {
  if (!sectorName) return '섹터 미상 0';
  if (tier === 'UNKNOWN') {
    const unkSign = boost > 0 ? '+' : '';
    return `${sectorName} ${unkSign}${boost}`;
  }
  const sign = boost > 0 ? '+' : boost < 0 ? '' : '';
  const tierLabel = tier === 'LEADING'
    ? 'LEADING'
    : tier === 'LAGGING' && regime
      ? `LAGGING, ${regime}`
      : tier;
  return `${sectorName} ${sign}${boost} (${tierLabel})`;
}
