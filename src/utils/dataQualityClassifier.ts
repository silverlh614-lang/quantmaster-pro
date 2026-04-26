// @responsibility 종목 카드 27+1 조건 데이터 출처 분류 — 메타 우선 + 휴리스틱 fallback (ADR-0018 §3 + ADR-0019)

import type { StockRecommendation } from '../services/stockService';
import type { DataQualityCount, DataQualityTier, ConditionSourceTier } from '../types/ui';
import { CONDITION_PASS_THRESHOLD } from '../constants/gateConfig';

type ChecklistKey = keyof StockRecommendation['checklist'];

/** 클라이언트 OHLCV 로 직접 계산되는 기술 지표 그룹. */
const COMPUTED_KEYS: readonly ChecklistKey[] = [
  'ichimokuBreakout',
  'technicalGoldenCross',
  'volumeSurgeVerified',
  'turtleBreakout',
  'fibonacciLevel',
  'vcpPattern',
  'divergenceCheck',
  'momentumRanking',
  'relativeStrength',
];

/** DART/Naver/KIS proxy 가 반환하는 객관 펀더멘털 그룹. */
const API_KEYS: readonly ChecklistKey[] = [
  'roeType3',
  'economicMoatVerified',
  'institutionalBuying',
  'consensusTarget',
  'earningsSurprise',
  'performanceReality',
  'ocfQuality',
  'marginAcceleration',
  'interestCoverage',
  'supplyInflow',
  'mechanicalStop',
];

/** Gemini 가 추론·요약·생성한 항목 그룹. */
const AI_INFERRED_KEYS: readonly ChecklistKey[] = [
  'cycleVerified',
  'riskOnEnvironment',
  'notPreviousLeader',
  'policyAlignment',
  'psychologicalObjectivity',
  'elliottWaveVerified',
  'catalystAnalysis',
];

function isPassed(value: number | null | undefined): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= CONDITION_PASS_THRESHOLD;
}

function deriveTier(computed: number, total: number): DataQualityTier {
  if (total === 0) return 'LOW';
  const ratio = computed / total;
  if (ratio >= 0.6) return 'HIGH';
  if (ratio >= 0.3) return 'MEDIUM';
  return 'LOW';
}

/** 휴리스틱 기본 그룹 분류 (PR-A fallback). */
function classifyByHeuristic(key: ChecklistKey): ConditionSourceTier {
  if (COMPUTED_KEYS.includes(key)) return 'COMPUTED';
  if (API_KEYS.includes(key)) return 'API';
  return 'AI_INFERRED';
}

const ALL_CHECKLIST_KEYS: readonly ChecklistKey[] = [
  ...COMPUTED_KEYS,
  ...API_KEYS,
  ...AI_INFERRED_KEYS,
];

/**
 * StockRecommendation 1건의 데이터 품질을 분류한다.
 *
 * **모드 분기** (ADR-0019):
 * 1. `stock.conditionSourceTiers` 가 있으면 → 메타 우선. 메타 없는 항목은 휴리스틱 fallback.
 *    `sourceMetaAvailable=true` 는 *모든* 27 조건에 메타가 있을 때만.
 * 2. 부재 시 → PR-A 휴리스틱 그룹 분류 (`COMPUTED_KEYS` / `API_KEYS` / `AI_INFERRED_KEYS`).
 *
 * 통과한 항목만 카운팅 (점수 ≥ `CONDITION_PASS_THRESHOLD=5`).
 *
 * 가격 출처 (`dataSourceType`) 1 항목 추가:
 *   REALTIME → computed +1, YAHOO → api +1, AI / STALE / undefined → aiInferred +1
 */
export function classifyDataQuality(stock: StockRecommendation): DataQualityCount {
  let computed = 0;
  let api = 0;
  let aiInferred = 0;

  const checklist = stock.checklist;
  const meta = stock.conditionSourceTiers ?? null;

  for (const key of ALL_CHECKLIST_KEYS) {
    if (!isPassed(checklist[key])) continue;
    const tier = meta?.[key] ?? classifyByHeuristic(key);
    if (tier === 'COMPUTED') computed += 1;
    else if (tier === 'API') api += 1;
    else aiInferred += 1;
  }

  const dataSourceType = stock.dataSourceType;
  if (dataSourceType === 'REALTIME') computed += 1;
  else if (dataSourceType === 'YAHOO') api += 1;
  else aiInferred += 1;

  const total = computed + api + aiInferred;
  const tier = deriveTier(computed, total);

  // 모든 27 키에 메타가 있을 때만 sourceMetaAvailable=true
  const sourceMetaAvailable = meta != null
    && ALL_CHECKLIST_KEYS.every(k => meta[k] != null);

  return {
    computed,
    api,
    aiInferred,
    total,
    tier,
    sourceMetaAvailable,
  };
}
