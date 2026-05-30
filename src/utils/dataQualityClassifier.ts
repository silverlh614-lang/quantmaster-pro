// @responsibility 종목 카드 27+1 조건 데이터 출처 분류 — 메타 우선 + 휴리스틱 fallback + 5-tier 자동 사다리 (ADR-0028 §3 + ADR-0029 + ADR-0095)

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

/** 휴리스틱 기본 그룹 분류 (PR-A fallback). 5-tier 신규 값 (DELAYED/MANUAL) 은 메타 모드 전용 — 휴리스틱이 추론 불가능. */
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
 * **모드 분기** (ADR-0029):
 * 1. `stock.conditionSourceTiers` 가 있으면 → 메타 우선. 메타 없는 항목은 휴리스틱 fallback.
 *    `sourceMetaAvailable=true` 는 *모든* 27 조건에 메타가 있을 때만.
 * 2. 부재 시 → PR-A 휴리스틱 그룹 분류 (`COMPUTED_KEYS` / `API_KEYS` / `AI_INFERRED_KEYS`).
 *
 * **5-tier 자동 사다리** (ADR-0095 PR-Phase-A-2):
 * - 메타가 'DELAYED' / 'MANUAL' 값을 포함하면 자동으로 더 정확한 분류로 격상
 * - 휴리스틱 모드는 신규 5-tier 값 (DELAYED/MANUAL) 추론 불가능 — 결정적 입력 부재
 * - 단, 가격 출처 `dataSourceType === 'STALE'` 시 휴리스틱도 DELAYED 카운트로 분류 (자동 사다리)
 *
 * 통과한 항목만 카운팅 (점수 ≥ `CONDITION_PASS_THRESHOLD=5`).
 *
 * 가격 출처 (`dataSourceType`) 1 항목 추가:
 *   REALTIME → computed +1 (VERIFIED), YAHOO → api +1 (EXTERNAL), STALE → delayed +1 (DELAYED, 신규),
 *   AI / undefined → aiInferred +1 (ESTIMATED, 보수적)
 */
export function classifyDataQuality(stock: StockRecommendation): DataQualityCount {
  let computed = 0;
  let api = 0;
  let aiInferred = 0;
  let delayed = 0;
  let manual = 0;

  const checklist = stock.checklist;
  const meta = stock.conditionSourceTiers ?? null;

  for (const key of ALL_CHECKLIST_KEYS) {
    if (!isPassed(checklist[key])) continue;
    const tier = meta?.[key] ?? classifyByHeuristic(key);
    if (tier === 'COMPUTED') computed += 1;
    else if (tier === 'API') api += 1;
    else if (tier === 'DELAYED') delayed += 1;
    else if (tier === 'MANUAL') manual += 1;
    else aiInferred += 1; // AI_INFERRED + 알 수 없는 값 fallback
  }

  // 가격 출처 1 항목 — 5-tier 자동 사다리 (STALE 분리)
  // NAVER 는 L3(KRX 시세 직접 fetch) 로 YAHOO 와 동일한 'api' 등급으로 분류한다.
  const dataSourceType = stock.dataSourceType;
  if (dataSourceType === 'REALTIME') computed += 1;
  else if (dataSourceType === 'YAHOO' || dataSourceType === 'NAVER') api += 1;
  else if (dataSourceType === 'STALE') delayed += 1;
  else aiInferred += 1; // AI / undefined → 보수적 estimated

  const total = computed + api + aiInferred + delayed + manual;
  const tier = deriveTier(computed, total);

  // 모든 27 키에 메타가 있을 때만 sourceMetaAvailable=true
  const sourceMetaAvailable = meta != null
    && ALL_CHECKLIST_KEYS.every(k => meta[k] != null);

  // delayed / manual 은 옵셔널 — 0 일 때도 명시 노출 (DataQualityBadge 가 0 자동 생략)
  return {
    computed,
    api,
    aiInferred,
    delayed,
    manual,
    total,
    tier,
    sourceMetaAvailable,
  };
}
