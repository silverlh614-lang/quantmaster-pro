// @responsibility 종목 카드 27+1 조건 데이터 출처 휴리스틱 분류 (ADR-0018 §3 fallback)

import type { StockRecommendation } from '../services/stockService';
import type { DataQualityCount, DataQualityTier } from '../types/ui';
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

/**
 * StockRecommendation 1건의 데이터 품질을 휴리스틱으로 카운팅한다.
 *
 * - 27 조건은 그룹별 분류 (`COMPUTED_KEYS` / `API_KEYS` / `AI_INFERRED_KEYS`).
 * - 통과한 항목만 카운팅 (점수 ≥ `CONDITION_PASS_THRESHOLD=5`).
 * - 가격 출처 (`dataSourceType`) 1 항목 추가:
 *   REALTIME → computed +1
 *   YAHOO    → api +1
 *   AI / STALE / undefined → aiInferred +1
 *
 * `sourceMetaAvailable` 는 PR-A 단계에선 항상 false. PR-B 에서 서버 sourceTier 메타가
 * 들어오면 true 로 격상하고 그룹 분류도 메타 기반으로 정확화한다.
 */
export function classifyDataQuality(stock: StockRecommendation): DataQualityCount {
  let computed = 0;
  let api = 0;
  let aiInferred = 0;

  const checklist = stock.checklist;
  for (const key of COMPUTED_KEYS) {
    if (isPassed(checklist[key])) computed += 1;
  }
  for (const key of API_KEYS) {
    if (isPassed(checklist[key])) api += 1;
  }
  for (const key of AI_INFERRED_KEYS) {
    if (isPassed(checklist[key])) aiInferred += 1;
  }

  const dataSourceType = stock.dataSourceType;
  if (dataSourceType === 'REALTIME') computed += 1;
  else if (dataSourceType === 'YAHOO') api += 1;
  else aiInferred += 1;

  const total = computed + api + aiInferred;
  const tier = deriveTier(computed, total);

  return {
    computed,
    api,
    aiInferred,
    total,
    tier,
    sourceMetaAvailable: false,
  };
}
