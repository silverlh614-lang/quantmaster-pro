/**
 * synergyBootstrap.ts — 아이디어 3: 시너지 탐지 초기 데이터 부족 해결.
 *
 * attributionAnalyzer.findSynergies() 는 조건당 3~5건의 교차 데이터를
 * 필요로 하지만 초기 운용 단계에는 27조건 스냅샷이 극소수다(클라이언트
 * 귀인 레코드는 실제 종가 사건부터 축적). 이 모듈은 이미 결산된
 * RecommendationRecord 를 바탕으로 27개 조건 점수를 소급 평가한
 * "가상 ServerAttributionRecord" 를 생성하여 attribution-records.json 에
 * 주입한다. 이를 통해 시스템 런칭 직후에도 시너지 분석이 부분적으로 작동한다.
 *
 * 역산 규칙:
 *   - rec.conditionKeys 에 포함된 서버 ConditionKey → 해당 conditionId 7점(high)
 *   - 서버 매핑 없는 21개 clientConditionId → 5점(중립)
 *   - rec.entryRegime, rec.actualReturn 그대로 전사
 *
 * 식별자: tradeId = `bootstrap-${rec.id}` — 실제 귀인과 구별되며 중복 삽입 방지.
 * 재실행 멱등 — 이미 부트스트랩된 rec.id 는 건너뛴다.
 */

import { getRecommendations, type RecommendationRecord } from './recommendationTracker.js';
import {
  loadAttributionRecords,
  saveAttributionRecords,
  type ServerAttributionRecord,
} from '../persistence/attributionRepo.js';
import { conditionIdFromServerKey } from './attributionAnalyzer.js';

const BOOTSTRAP_PREFIX = 'bootstrap-';
const NEUTRAL_SCORE = 5;
const HIGH_SCORE = 7; // attributionAnalyzer HIGH_SCORE_THRESHOLD(6) 위
const CONDITION_IDS = Array.from({ length: 27 }, (_, i) => i + 1);

function buildConditionScores(rec: RecommendationRecord): Record<number, number> {
  const scores: Record<number, number> = {};
  for (const id of CONDITION_IDS) scores[id] = NEUTRAL_SCORE;

  for (const key of rec.conditionKeys ?? []) {
    const id = conditionIdFromServerKey(key);
    if (id != null) scores[id] = HIGH_SCORE;
  }
  return scores;
}

function toVirtualRecord(rec: RecommendationRecord): ServerAttributionRecord | null {
  if (rec.status === 'PENDING') return null;
  if (!rec.conditionKeys || rec.conditionKeys.length === 0) return null;

  const closedAt = rec.resolvedAt ?? rec.signalTime;
  const holdingDays = Math.max(
    0,
    Math.floor((new Date(closedAt).getTime() - new Date(rec.signalTime).getTime()) / 86_400_000),
  );

  return {
    tradeId:         `${BOOTSTRAP_PREFIX}${rec.id}`,
    stockCode:       rec.stockCode,
    stockName:       rec.stockName,
    closedAt,
    returnPct:       rec.actualReturn ?? 0,
    isWin:           rec.status === 'WIN',
    entryRegime:     rec.entryRegime,
    conditionScores: buildConditionScores(rec),
    holdingDays,
    sellReason:      `bootstrap:${rec.status.toLowerCase()}`,
    // 아이디어 5 (Phase 3): LATE_WIN 플래그를 부트스트랩 경로에도 전사
    lateWin:         rec.lateWin,
  };
}

/**
 * 결산된 추천 이력을 가상 귀인 레코드로 변환하여 attribution-records.json 에 주입.
 *
 * @returns 신규로 추가된 레코드 수 (기존 bootstrap 은 건너뜀)
 */
export function bootstrapAttributionFromRecommendations(): number {
  const existing = loadAttributionRecords();
  const existingIds = new Set(existing.map((r) => r.tradeId));

  const recs = getRecommendations().filter((r) => r.status !== 'PENDING');
  const additions: ServerAttributionRecord[] = [];

  for (const rec of recs) {
    const tradeId = `${BOOTSTRAP_PREFIX}${rec.id}`;
    if (existingIds.has(tradeId)) continue;
    const virt = toVirtualRecord(rec);
    if (virt) additions.push(virt);
  }

  if (additions.length === 0) return 0;

  const merged = [...existing, ...additions].slice(-500); // 500건 보관 한도 유지
  saveAttributionRecords(merged);
  console.log(
    `[SynergyBootstrap] 가상 Attribution Record ${additions.length}건 주입 ` +
    `(총 ${merged.length}건, 보관 한도 500)`,
  );
  return additions.length;
}
