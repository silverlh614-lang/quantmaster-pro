/**
 * timingSyncEngine.ts — 조건 통과 시점 일치도 스코어 (Timing Sync Score)
 *
 * 핵심 개념:
 *   27조건이 각각 다른 시점에 통과되어도 동일하게 취급하는 현행 문제를 해소한다.
 *   최근 5거래일 이내 통과된 조건에 가중치 1.5배를 부여하고,
 *   Gate 1~3 조건들이 좁은 시간대에 동시에 충족될수록 Sync Score가 올라간다.
 *
 *   Sync Score 높음 = 지금이 진짜 타이밍
 *   Sync Score 낮음 = 조건은 통과했지만 타이밍은 이미 지났음
 *
 * 핵심 통찰: 신선도가 신뢰도다.
 */

import type { ConditionId, TimingSyncResult } from '../../types/quant';

// ─── 상수 ──────────────────────────────────────────────────────────────────────

/** 최신 조건으로 인정하는 거래일 기준 (이 이내이면 가중치 1.5배) */
export const RECENT_TRADING_DAYS = 5;

/** 최신 조건 가중치 배율 */
export const RECENCY_WEIGHT_MULTIPLIER = 1.5;

/** Sync Score 고점 임계값 (이 이상이면 HIGH) */
export const SYNC_HIGH_THRESHOLD = 70;

/** Sync Score 중간 임계값 (이 이상이면 MEDIUM) */
export const SYNC_MEDIUM_THRESHOLD = 40;

// ─── 거래일 계산 유틸리티 ────────────────────────────────────────────────────

/**
 * 두 날짜 사이의 거래일 수를 계산한다 (주말 제외, 공휴일 미고려).
 * from < to일 때 양수를 반환한다.
 */
export function tradingDaysBetween(from: Date, to: Date): number {
  const start = new Date(Math.min(from.getTime(), to.getTime()));
  const end = new Date(Math.max(from.getTime(), to.getTime()));

  let count = 0;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay(); // 0=일, 6=토
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ─── 핵심 공개 API ──────────────────────────────────────────────────────────────

/**
 * 조건 통과 시점 기록과 현재 점수를 받아 Timing Sync Score를 계산한다.
 *
 * @param conditionScores — ConditionId → 점수(0~10) 매핑
 * @param conditionPassTimestamps — ConditionId → 통과 시점 ISO 문자열 (선택, 없으면 해당 조건은 신선도 계산 제외)
 * @param referenceDate — 기준일 (기본: 현재)
 */
export function evaluateTimingSync(
  conditionScores: Record<ConditionId, number>,
  conditionPassTimestamps: Partial<Record<ConditionId, string>> = {},
  referenceDate: Date = new Date(),
): TimingSyncResult {
  const PASS_THRESHOLD = 5;
  const passedIds = Object.keys(conditionScores)
    .map(Number)
    .filter((id) => (conditionScores[id as ConditionId] ?? 0) >= PASS_THRESHOLD) as ConditionId[];

  const totalPassedCount = passedIds.length;

  if (totalPassedCount === 0) {
    return {
      syncScore: 0,
      level: 'LOW',
      recentConditionCount: 0,
      totalPassedCount: 0,
      freshnessWeightedScore: 0,
      conditionFreshness: [],
      message: '통과 조건 없음 — Sync Score 계산 불가.',
      interpretation: '조건이 하나도 통과되지 않아 타이밍 동기화를 측정할 수 없습니다.',
    };
  }

  // 조건별 신선도 계산
  const conditionFreshness: TimingSyncResult['conditionFreshness'] = passedIds.map((id) => {
    const tsStr = conditionPassTimestamps[id];
    if (!tsStr) {
      // 타임스탬프 없음 → 신선도 미적용 (가중치 1.0)
      return {
        conditionId: id,
        passedAt: '',
        tradingDaysAgo: -1, // -1 = unknown
        isFresh: false,
        weight: 1.0,
      };
    }

    const passedAt = new Date(tsStr);
    const daysAgo = tradingDaysBetween(passedAt, referenceDate);
    const isFresh = daysAgo <= RECENT_TRADING_DAYS;

    return {
      conditionId: id,
      passedAt: tsStr,
      tradingDaysAgo: daysAgo,
      isFresh,
      weight: isFresh ? RECENCY_WEIGHT_MULTIPLIER : 1.0,
    };
  });

  const recentConditionCount = conditionFreshness.filter((c) => c.isFresh).length;

  // 신선도 가중 스코어: (각 조건의 가중치 × 점수) 합계
  const rawWeightedScore = conditionFreshness.reduce((sum, c) => {
    const score = conditionScores[c.conditionId] ?? 0;
    return sum + score * c.weight;
  }, 0);

  // 최대 가능 점수: 전체 조건이 모두 10점 + 최신 가중치
  const maxPossibleScore = conditionFreshness.reduce((sum, c) => {
    return sum + 10 * c.weight;
  }, 0);

  const freshnessWeightedScore = maxPossibleScore > 0
    ? parseFloat(((rawWeightedScore / maxPossibleScore) * 100).toFixed(1))
    : 0;

  // Sync Score: 신선도 가중 스코어 + 최신 조건 비율 보너스
  const freshRatio = totalPassedCount > 0 ? recentConditionCount / totalPassedCount : 0;
  // 최신 조건 비율이 높을수록 보너스 (최대 +20점)
  const freshnessBonus = freshRatio * 20;

  const syncScore = Math.min(100, Math.round(freshnessWeightedScore * 0.8 + freshnessBonus));

  const level: TimingSyncResult['level'] =
    syncScore >= SYNC_HIGH_THRESHOLD ? 'HIGH' :
    syncScore >= SYNC_MEDIUM_THRESHOLD ? 'MEDIUM' : 'LOW';

  // 메시지 생성
  const tsKnownCount = conditionFreshness.filter((c) => c.passedAt !== '').length;

  let message: string;
  let interpretation: string;

  if (tsKnownCount === 0) {
    message = `Sync Score: ${syncScore} (타임스탬프 미제공 — 기본 점수)`;
    interpretation =
      '조건 통과 시점이 기록되지 않아 기본 점수가 사용됩니다. ' +
      '조건 통과 시점을 기록하면 더 정확한 타이밍 분석이 가능합니다.';
  } else if (level === 'HIGH') {
    message =
      `🟢 Sync Score: ${syncScore} — 최근 ${recentConditionCount}/${totalPassedCount}개 조건이 ` +
      `최근 ${RECENT_TRADING_DAYS}거래일 이내 통과. 지금이 진짜 타이밍.`;
    interpretation =
      'Gate 1~3 조건들이 좁은 시간대에 동시에 충족되었습니다. ' +
      '신선한 신호의 비중이 높아 현재 진입 타이밍의 신뢰도가 높습니다.';
  } else if (level === 'MEDIUM') {
    message =
      `🟡 Sync Score: ${syncScore} — 최근 ${recentConditionCount}/${totalPassedCount}개 조건이 ` +
      `최근 ${RECENT_TRADING_DAYS}거래일 이내 통과. 일부 조건의 신선도 점검 권장.`;
    interpretation =
      '조건 통과 시점이 혼재합니다. 오래된 조건과 최신 조건이 섞여 있어 ' +
      '진입 타이밍의 신뢰도가 보통 수준입니다. 핵심 기술적 조건의 신선도를 확인하세요.';
  } else {
    message =
      `🔴 Sync Score: ${syncScore} — 최근 ${recentConditionCount}/${totalPassedCount}개 조건만 ` +
      `최근 ${RECENT_TRADING_DAYS}거래일 이내 통과. 타이밍 이미 지났을 가능성.`;
    interpretation =
      '통과된 조건의 대부분이 오래전에 충족된 것입니다. ' +
      '펀더멘털은 좋지만 기술적 타이밍이 지났을 수 있습니다. 신규 진입을 재검토하세요.';
  }

  return {
    syncScore,
    level,
    recentConditionCount,
    totalPassedCount,
    freshnessWeightedScore,
    conditionFreshness,
    message,
    interpretation,
  };
}
