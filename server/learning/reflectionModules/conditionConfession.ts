// @responsibility conditionConfession 학습 엔진 모듈
/**
 * conditionConfession.ts — Condition Confession Log (#6).
 *
 * "27개 조건 중 오늘 기여도 vs 실제 성과 괴리가 큰 조건" 자동 식별.
 *
 * 지표:
 *   - passedCount     : 조건 score ≥ 7 로 통과한 오늘 거래 수
 *   - winCount        : passed & WIN (returnPct > 0)
 *   - lossCount       : passed & LOSS (returnPct < 0)
 *   - expiredCount    : passed & EXPIRED 또는 중립
 *   - falseSignalScore: lossCount / passedCount (0~1). 1 에 가까울수록 허위신호.
 *
 * 산출: Today 에 falseSignalScore ≥ 0.6 이고 passedCount ≥ 3 인 조건은 "참회록" 후보.
 *       연속 3일 동일 조건 발견 시 weeklySharpeMonitor 에 PROBATION 제안 시그널 feed.
 *
 * 저장: ReflectionReport.conditionConfession 로 직접 기록 — 별도 파일 없음.
 *       3일 연속 판정은 loadRecentReflections(3) 로 후처리 집계한다.
 */

import type { ServerAttributionRecord } from '../../persistence/attributionRepo.js';
import type { ConditionConfessionEntry } from '../reflectionTypes.js';

export const HIGH_SCORE_THRESHOLD = 7;
export const MIN_PASSED_COUNT = 3;
export const FALSE_SIGNAL_THRESHOLD = 0.6;

/**
 * 오늘의 attribution 레코드에서 조건별 참회록 후보를 추출한다.
 *
 * @param todayRecords 오늘 closedAt 인 attribution 레코드
 * @returns falseSignalScore 높은 순으로 정렬된 조건 참회록 엔트리
 */
export function buildConditionConfession(
  todayRecords: ServerAttributionRecord[],
): ConditionConfessionEntry[] {
  if (todayRecords.length === 0) return [];

  type Bucket = { passed: number; win: number; loss: number; expired: number };
  const buckets: Record<number, Bucket> = {};

  for (const r of todayRecords) {
    if (!r.conditionScores) continue;
    const outcome: 'WIN' | 'LOSS' | 'EXPIRED' =
      r.isWin ? 'WIN' : r.returnPct < 0 ? 'LOSS' : 'EXPIRED';
    for (const [condIdStr, score] of Object.entries(r.conditionScores)) {
      if (typeof score !== 'number' || score < HIGH_SCORE_THRESHOLD) continue;
      const condId = Number(condIdStr);
      if (!Number.isFinite(condId)) continue;
      const b = (buckets[condId] ??= { passed: 0, win: 0, loss: 0, expired: 0 });
      b.passed++;
      if (outcome === 'WIN') b.win++;
      else if (outcome === 'LOSS') b.loss++;
      else b.expired++;
    }
  }

  const entries: ConditionConfessionEntry[] = [];
  for (const [condIdStr, b] of Object.entries(buckets)) {
    if (b.passed < MIN_PASSED_COUNT) continue;
    const falseSignalScore = b.loss / b.passed;
    if (falseSignalScore < FALSE_SIGNAL_THRESHOLD) continue;
    entries.push({
      conditionId:    Number(condIdStr),
      passedCount:    b.passed,
      winCount:       b.win,
      lossCount:      b.loss,
      expiredCount:   b.expired,
      falseSignalScore: Number(falseSignalScore.toFixed(3)),
    });
  }
  entries.sort((a, b) => b.falseSignalScore - a.falseSignalScore);
  return entries;
}

/**
 * 최근 3일간 반성 리포트의 conditionConfession 을 스캔하여
 * "연속 3일 동일 조건이 참회록에 올라온 conditionId" 목록을 반환한다.
 *
 * 이 목록은 weeklySharpeMonitor 가 PROBATION 자동 제안 시그널로 사용한다.
 */
export function findChronicConfessions(
  recent3Days: Array<{ conditionConfession?: ConditionConfessionEntry[] }>,
): number[] {
  if (recent3Days.length < 3) return [];
  const sets = recent3Days.map(
    (r) => new Set((r.conditionConfession ?? []).map((c) => c.conditionId)),
  );
  const first = sets[0];
  const chronic: number[] = [];
  for (const id of first) {
    if (sets.every((s) => s.has(id))) chronic.push(id);
  }
  return chronic.sort((a, b) => a - b);
}
