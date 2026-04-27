// @responsibility kellyDriftFailurePromotion 학습 엔진 모듈
/**
 * kellyDriftFailurePromotion.ts — Idea 10: Kelly Drift × invalidation 패턴 승급.
 *
 * 기존 promoteInvalidationPatternIfRepeated 는 "동일 invalidation id 3회 손절" 을
 * 트리거로 썼다. 이 모듈은 더 나아가 **"invalidation id × Kelly decay 심도"** 의
 * 2차원 조합을 키로 삼아 FailurePatternDB 로 승급한다.
 *
 * 가정:
 *   - 진입 시점 entryKellySnapshot 이 있는 포지션은 entryKelly 를 알 수 있다.
 *   - 청산 시점 의 "effective Kelly" 는 entryKelly × exp(-λ × holdingBusinessDays).
 *   - decay = 1 - (effectiveAtExit / entryKelly) = 1 - exp(-λt).
 *
 * 승급 규칙:
 *   - 최근 HORIZON_DAYS(기본 90일) 이내 손절 (status=HIT_STOP 또는 returnPct<0)
 *   - 동일 invalidation id 그룹
 *   - decay ≥ HIGH_DECAY_THRESHOLD (0.5) 조건을 만족하는 건수가
 *     KELLY_DRIFT_PROMOTION_THRESHOLD (3) 이상이면 "decay-assisted 패턴" 으로 승급
 *
 * 이 엔트리는 기존 invalidation 승급과 별개의 id prefix ("kdrift_") 로 구분되어
 * 조회 가능하며, checkFailurePattern 의 cosine 매칭에는 동등하게 참여한다.
 *
 * 페르소나 원칙 6 "다중 신호 합치" 의 종단 간 순환: 보유 Kelly 경고가 진입 Kelly
 * 필터로 역류한다.
 */

import {
  loadShadowTrades,
  type ServerShadowTrade,
} from '../persistence/shadowTradeRepo.js';
import { appendFailurePattern } from '../persistence/failurePatternRepo.js';
import { businessDaysSince, computePositionRiskWeight, REGIME_HALF_LIFE_DAYS, DEFAULT_HALF_LIFE_DAYS } from '../trading/kellyHalfLife.js';
import { buildEntryConditionScores } from './entryConditionScores.js';

export const HIGH_DECAY_THRESHOLD = 0.5;
export const KELLY_DRIFT_PROMOTION_THRESHOLD = 3;
export const HORIZON_DAYS = 90;

export interface KellyDriftPromotionResult {
  promoted: boolean;
  invalidationId?: string;
  decayInstances?: number;
  rationale: string;
}

function exitDateOf(t: ServerShadowTrade): string {
  return t.exitTime ?? t.exitInvalidationMatch?.matchedAt ?? t.signalTime;
}

function holdingBusinessDays(t: ServerShadowTrade): number {
  const exit = exitDateOf(t);
  if (!t.signalTime || !exit) return 0;
  return businessDaysSince(t.signalTime, new Date(exit));
}

/**
 * 단일 closed trade 의 decay = 1 - exp(-λ × holdingDays).
 * entryKelly 유무와 관계없이 decay 는 "시간 기반" 만 측정. Kelly 스냅샷 부재 시에는
 * decay 측정 가능 (시간만 있으면 됨). 단 entryKelly 가 없으면 "decay × Kelly" 곱이
 * 무효하므로 승급에서 제외.
 */
function computeExitDecay(t: ServerShadowTrade): number | null {
  const snap = t.entryKellySnapshot;
  if (!snap) return null;
  const halfLife = REGIME_HALF_LIFE_DAYS[snap.regimeAtEntry] ?? DEFAULT_HALF_LIFE_DAYS;
  const days = holdingBusinessDays(t);
  const weight = computePositionRiskWeight(days, halfLife);
  return 1 - weight;
}

/**
 * 특정 trade 가 막 청산됐을 때 호출. 이 invalidation id 그룹 내에서 decay ≥ threshold
 * 손절이 몇 건인지 세고, 임계 이상이면 승급.
 */
export function promoteKellyDriftPattern(
  justClosedTrade: ServerShadowTrade,
): KellyDriftPromotionResult {
  const id = justClosedTrade.exitInvalidationMatch?.id;
  if (!id) return { promoted: false, rationale: 'no invalidation id' };
  if (justClosedTrade.exitRuleTag === 'MANUAL_EXIT') {
    return { promoted: false, rationale: 'manual exit — 학습 신호에서 격리' };
  }

  const trades = loadShadowTrades();
  const horizonStart = Date.now() - HORIZON_DAYS * 24 * 3600 * 1000;

  const decayLosses: ServerShadowTrade[] = [];
  for (const t of trades) {
    if (t.exitRuleTag === 'MANUAL_EXIT') continue;
    if (t.exitInvalidationMatch?.id !== id) continue;
    const isLoss = t.status === 'HIT_STOP' || (t.returnPct ?? 0) < 0;
    if (!isLoss) continue;
    const exitTime = new Date(exitDateOf(t)).getTime();
    if (!Number.isFinite(exitTime) || exitTime < horizonStart) continue;
    const decay = computeExitDecay(t);
    if (decay === null) continue;
    if (decay >= HIGH_DECAY_THRESHOLD) decayLosses.push(t);
  }

  if (decayLosses.length < KELLY_DRIFT_PROMOTION_THRESHOLD) {
    return {
      promoted: false,
      invalidationId: id,
      decayInstances: decayLosses.length,
      rationale: `decay ≥ ${HIGH_DECAY_THRESHOLD} 손절 ${decayLosses.length}건 < 임계 ${KELLY_DRIFT_PROMOTION_THRESHOLD}`,
    };
  }

  const recent = decayLosses[decayLosses.length - 1];
  const recentKeys = recent.entryKellySnapshot ? [] : [];
  // 대표 벡터 — 가장 최근 샘플의 conditionKeys 를 27조건 벡터로 변환.
  // (현재 ServerShadowTrade 에 conditionKeys 가 직접 저장되지 않는 경우 빈 벡터 → 유사도는
  // 섹터/regime 등 메타만으로 평가됨. 향후 trade 에 conditionKeys 스냅샷 저장 시 정밀도↑.)
  const scores = buildEntryConditionScores(recentKeys);

  appendFailurePattern({
    id: `kdrift_${id}_${Date.now()}`,
    stockCode: recent.stockCode,
    stockName: `${id} × decay≥${HIGH_DECAY_THRESHOLD} 반복 (${decayLosses.length}회)`,
    entryDate: recent.signalTime ?? new Date().toISOString(),
    exitDate: exitDateOf(recent),
    returnPct: recent.returnPct ?? 0,
    conditionScores: scores,
    gate1Score: 0, gate2Score: 0, gate3Score: 0, finalScore: 0,
    marketRegime: recent.entryRegime ?? null,
    sector: null,
    savedAt: new Date().toISOString(),
  });

  console.log(
    `[KellyDrift] invalidation × decay 패턴 자동 승급: ${id} ${decayLosses.length}건 → FailurePatternDB`,
  );

  return {
    promoted: true,
    invalidationId: id,
    decayInstances: decayLosses.length,
    rationale: `decay ≥ ${HIGH_DECAY_THRESHOLD} × invalidation=${id} 반복 ${decayLosses.length}회 → 승급`,
  };
}
