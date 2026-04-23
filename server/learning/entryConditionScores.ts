/**
 * entryConditionScores.ts — 진입 시점 27조건 스코어 벡터 빌더.
 *
 * synergyBootstrap 과 Idea 7 (진입 전 실패 패턴 필터) 가 공유하는 단일 로직.
 *
 * 규칙:
 *   - 27개 condition id (1~27) 의 기본값 = NEUTRAL_SCORE (5).
 *   - candidate.conditionKeys 에 포함된 서버 ConditionKey 는 HIGH_SCORE (7) 로 승격.
 *   - 서버 매핑 없는 조건(예: 질적 Gemini 조건) 은 중립값 유지.
 *
 * 출력 벡터는 failurePatternDB.checkFailurePattern() / attribution 집계가 모두
 * 소비할 수 있다 (Record<number,number>, 키 1..27).
 */

import { conditionIdFromServerKey } from './attributionAnalyzer.js';

export const ENTRY_CONDITION_NEUTRAL_SCORE = 5;
export const ENTRY_CONDITION_HIGH_SCORE = 7;
const CONDITION_IDS = Array.from({ length: 27 }, (_, i) => i + 1);

export function buildEntryConditionScores(conditionKeys: readonly string[] | undefined | null): Record<number, number> {
  const scores: Record<number, number> = {};
  for (const id of CONDITION_IDS) scores[id] = ENTRY_CONDITION_NEUTRAL_SCORE;
  if (!conditionKeys || conditionKeys.length === 0) return scores;
  for (const key of conditionKeys) {
    const id = conditionIdFromServerKey(key);
    if (id != null) scores[id] = ENTRY_CONDITION_HIGH_SCORE;
  }
  return scores;
}
