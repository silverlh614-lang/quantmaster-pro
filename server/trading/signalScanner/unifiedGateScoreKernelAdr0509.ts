/**
 * @responsibility Patch-UNIFIED-GATE-SCORE-KERNEL-AUDIT-001 (ADR-0509) — Shadow rawGate
 *                 + Live minSignal score 100-scale 단일 snapshot SSOT.
 *
 * 사용자 명시 진단 요청 — "Shadow와 Live의 점수체계를 완전히 다르게 가져갈 필요는 없다.
 * 공통 Score Kernel을 만들고, Live와 Shadow는 같은 점수를 서로 다른 정책으로 해석해야
 * 한다." 본 SSOT 는 *진단/감사용* unified snapshot 만 제공 — 점수 산정 / threshold /
 * UNKNOWN penalty / Shadow approval semantics / KIS order path *모두 무수정*.
 *
 * Diagnostic / audit only — 14 invariants:
 *   1. executionImpact: 'NONE' literal type 강제 (TypeScript 컴파일 타임)
 *   2. liveExecutionAllowed: false literal type 강제
 *   3. liveOrderPlaced: false literal type 강제
 *   4. policyPromotionMode: 'SHADOW_ONLY' literal type 강제
 *   5. KIS 주문 함수 5종 (placeKisMarketOrder / placeKisSellOrder / placeKisStopLossOrder
 *      / placeKisTakeProfitOrder / cancelKisOrder) import 0건 (정적 grep 가드)
 *   6. autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   7. 외부 API (fetch / axios / node-fetch) 호출 0건
 *   8. Gate threshold + condition weight + STRONG_BUY 조건 + requiredScore + UNKNOWN
 *      penalty 변경 0
 *   9. Shadow threshold 변경 0 (gateBandNormal / gateBandStrong 그대로 read-only)
 *  10. Supply / SectorEnergy / Yahoo / FSS 보수 0 (out of scope, SSOT 만 read-only)
 *  11. Shadow learning 차단 0 (Shadow approval 의 본래 흐름 무관)
 *  12. shadowGateAuditStore + gate1MinimumSignalForensicTraceRepo 본체 무수정 (consumer)
 *  13. ENV `UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED=true` (default OFF, ADR-0157 정확
 *      비교 — `'1'`/`'TRUE'`/`'yes'` 모두 거부) 1줄 즉시 비활성
 *  14. 호출자 측 inline ENV 검사 0건 (isUnifiedGateScoreKernelDisabled() SSOT 위임)
 */

import type { ShadowGateAuditRecord } from '../../telegram/shadowGateAuditStore.js';
import type {
  Gate1MinimumSignalForensicAuditAdr0505,
  ComponentForensicDetail,
  FeatureHydrationAuditAdr0509,
} from './gate1MinimumSignalForensicAuditAdr0505.js';

// ════════════════════════════════════════════════════════════════════════════
// SSOT — 12 component union
// ════════════════════════════════════════════════════════════════════════════

export type UnifiedComponentKey =
  | 'priceMomentum'
  | 'volumeLiquidity'
  | 'technicalTrend'
  | 'relativeStrength'
  | 'breakoutStructure'
  | 'watchlistUpstream'
  | 'supplyConfluence'
  | 'investorFlow'
  | 'sectorEnergy'
  | 'earningsQuality'
  | 'per'
  | 'trendAcceleration';

/** 12 component SSOT — Object.freeze drift 차단. */
export const UNIFIED_COMPONENT_KEYS: readonly UnifiedComponentKey[] = Object.freeze([
  'priceMomentum',
  'volumeLiquidity',
  'technicalTrend',
  'relativeStrength',
  'breakoutStructure',
  'watchlistUpstream',
  'supplyConfluence',
  'investorFlow',
  'sectorEnergy',
  'earningsQuality',
  'per',
  'trendAcceleration',
] as const);

export type UnifiedComponentSource =
  | 'POSITIVE_COMPONENT'
  | 'PENALTY_COMPONENT'
  | 'MISSING'
  | 'NOT_APPLICABLE'
  | 'DIAGNOSTIC_ONLY';

export type UnifiedComponentConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface UnifiedComponentStatus {
  available: boolean;
  score: number | null;
  source: UnifiedComponentSource;
  confidence: UnifiedComponentConfidence;
  missingReason: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// SSOT — Data quality 7 booleans
// ════════════════════════════════════════════════════════════════════════════

export interface UnifiedDataQuality {
  quoteAvailable: boolean;
  symbolFeaturesAvailable: boolean;
  conditionResultsAvailable: boolean;
  watchlistScoreAvailable: boolean;
  supplySymbolMatched: boolean;
  supplySemanticAvailable: boolean;
  sectorEnergyUsable: boolean;
}

// ════════════════════════════════════════════════════════════════════════════
// SSOT — Divergence reasoning (8-value union 포함 NO_DIVERGENCE)
// ════════════════════════════════════════════════════════════════════════════

export type UnifiedDivergenceReason =
  | 'NO_DIVERGENCE'
  | 'LIVE_MIN_SIGNAL_FEATURE_MISSING'
  | 'SHADOW_GATE_USES_RAW_SCORE'
  | 'SUPPLY_SEMANTIC_UNAVAILABLE'
  | 'WATCHLIST_NOT_IMPORTED'
  | 'BREAKOUT_NOT_USABLE'
  | 'RS_NOT_USABLE'
  | 'POLICY_DIFFERENCE_ONLY';

export interface UnifiedDivergence {
  shadowAllowedButLiveFailed: boolean;
  reason: UnifiedDivergenceReason;
  secondaryReasons: readonly UnifiedDivergenceReason[];
}

// ════════════════════════════════════════════════════════════════════════════
// SSOT — UnifiedGateScoreSnapshot (사용자 명시 §A schema 정합)
// ════════════════════════════════════════════════════════════════════════════

export interface UnifiedGateScoreSnapshot {
  symbol: string;
  name?: string;
  tradeDate: string;
  marketSession: string;

  // Score system fields (both Score Kernels in one snapshot)
  rawGateScore: number | null;
  normalizedGateScore: number | null;
  minSignalScore100: number | null;
  requiredMinSignalScore: number | null;
  scoreGap: number | null;

  mtas: number | null;
  compressionScore: number | null;
  rrr: number | null;

  signalType: string | null;
  gateBandNormal: number | null;
  gateBandStrong: number | null;

  // Pass/fail status from both systems
  liveGate1Pass: boolean | null;
  liveMinSignalPass: boolean | null;
  shadowApprovalAllowed: boolean;
  shadowRecorded: boolean;

  // Live order enforcement invariants (literal types — TypeScript 컴파일 타임 강제)
  liveOrderPlaced: false;
  executionImpact: 'NONE';
  liveExecutionAllowed: false;
  policyPromotionMode: 'SHADOW_ONLY';

  // Per-component status (12 components)
  components: Record<UnifiedComponentKey, UnifiedComponentStatus>;

  // Data quality booleans (7 axes)
  dataQuality: UnifiedDataQuality;

  // Divergence judgment
  divergence: UnifiedDivergence;

  // Warning marker — Live forensic 부재 시
  warning?: 'LIVE_FORENSIC_NOT_FOUND';

  createdAtIso: string;
  updatedAtIso: string;
}

// ════════════════════════════════════════════════════════════════════════════
// Component key → ADR-0505 forensic component code 매핑 SSOT
// ════════════════════════════════════════════════════════════════════════════

/**
 * 12 component 별 ADR-0505 positive/penalty component code 매핑.
 * 매핑되지 않은 component 는 'NOT_APPLICABLE' fallback.
 *
 * 매핑 SSOT — 변경 시 ADR-0509 본문 + 회귀 테스트 동시 갱신 의무.
 */
const COMPONENT_KEY_TO_FORENSIC_CODE: Readonly<Record<UnifiedComponentKey, readonly string[]>> = Object.freeze({
  priceMomentum: ['PRICE_MOMENTUM', 'priceMomentum'],
  volumeLiquidity: ['VOLUME_LIQUIDITY', 'volumeLiquidity', 'VOLUME'],
  technicalTrend: ['TECHNICAL_TREND', 'technicalTrend', 'TREND'],
  relativeStrength: ['RELATIVE_STRENGTH', 'relativeStrength', 'RS'],
  breakoutStructure: ['BREAKOUT_STRUCTURE', 'breakoutStructure', 'BREAKOUT'],
  watchlistUpstream: ['WATCHLIST_UPSTREAM_SCORE', 'watchlistUpstream', 'WATCHLIST'],
  supplyConfluence: ['SUPPLY_CONFLUENCE', 'supplyConfluence', 'SUPPLY'],
  investorFlow: ['INVESTOR_FLOW', 'investorFlow'],
  sectorEnergy: ['SECTOR_ENERGY', 'sectorEnergy'],
  earningsQuality: ['EARNINGS_QUALITY', 'earningsQuality', 'EARNINGS'],
  per: ['PER', 'per', 'VALUATION'],
  trendAcceleration: ['TREND_ACCELERATION', 'trendAcceleration'],
});

// ════════════════════════════════════════════════════════════════════════════
// SSOT — ENV gate (ADR-0157 정확 비교)
// ════════════════════════════════════════════════════════════════════════════

/**
 * ADR-0509 ENV gate — default OFF, ADR-0157 정확 비교 의무.
 * `'1'` / `'TRUE'` / `'yes'` / `'Yes'` / `'on'` / 빈 문자열 모두 default 동작 유지.
 */
export function isUnifiedGateScoreKernelDisabled(): boolean {
  return process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED === 'true';
}

// ════════════════════════════════════════════════════════════════════════════
// 헬퍼 — 안전 변환
// ════════════════════════════════════════════════════════════════════════════

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function lookupComponentDetail(
  forensic: Gate1MinimumSignalForensicAuditAdr0505 | undefined,
  codes: readonly string[],
): { detail: ComponentForensicDetail; source: 'POSITIVE_COMPONENT' | 'PENALTY_COMPONENT' } | null {
  if (!forensic) return null;
  for (const code of codes) {
    const positive = forensic.positiveComponents?.[code];
    if (positive) return { detail: positive, source: 'POSITIVE_COMPONENT' };
    const penalty = forensic.penaltyComponents?.[code];
    if (penalty) return { detail: penalty, source: 'PENALTY_COMPONENT' };
  }
  return null;
}

function deriveComponentConfidence(
  detail: ComponentForensicDetail | undefined,
  source: UnifiedComponentSource,
): UnifiedComponentConfidence {
  if (source === 'MISSING' || source === 'NOT_APPLICABLE') return 'UNKNOWN';
  if (source === 'PENALTY_COMPONENT') return 'LOW';
  if (!detail) return 'UNKNOWN';
  // ADR-0505 detail.confidence ∈ {VERIFIED, ACCEPTED, ESTIMATED, MISSING, ...}
  // 매핑 SSOT: VERIFIED → HIGH / ACCEPTED → MEDIUM / 그 외 → LOW
  const conf = String(detail.confidence ?? '').toUpperCase();
  if (conf.includes('VERIFIED')) return 'HIGH';
  if (conf.includes('ACCEPTED')) return 'MEDIUM';
  if (conf.includes('ESTIMATED')) return 'LOW';
  return 'UNKNOWN';
}

// ════════════════════════════════════════════════════════════════════════════
// 컴포넌트 status 빌더
// ════════════════════════════════════════════════════════════════════════════

/**
 * 12 component status 산출 — ADR-0505 forensic positive/penalty components
 * 매핑 + missingPositiveSources 매핑 + hydrationAuditAdr0509 데이터 quality 결합.
 */
function buildComponentStatusMap(
  forensic: Gate1MinimumSignalForensicAuditAdr0505 | undefined,
): Record<UnifiedComponentKey, UnifiedComponentStatus> {
  const result = {} as Record<UnifiedComponentKey, UnifiedComponentStatus>;
  const missingPositiveSet = new Set<string>(forensic?.missingPositiveSources ?? []);
  const hydration = forensic?.hydrationAuditAdr0509;

  for (const key of UNIFIED_COMPONENT_KEYS) {
    const codes = COMPONENT_KEY_TO_FORENSIC_CODE[key];
    const found = lookupComponentDetail(forensic, codes);

    if (found) {
      const detail = found.detail;
      const score = finiteOrNull(detail.weightedScore);
      result[key] = {
        available: true,
        score,
        source: found.source,
        confidence: deriveComponentConfidence(detail, found.source),
        missingReason: null,
      };
      continue;
    }

    // forensic component 부재 — missingPositiveSources / hydration 결합으로 MISSING 분류
    const inMissingPositive = codes.some((code) => missingPositiveSet.has(code as never));

    let missingReason: string | null = null;
    if (key === 'relativeStrength' && hydration && !hydration.rsScoreUsable) {
      missingReason = `RS_NOT_USABLE:${hydration.rsSource}`;
    } else if (key === 'breakoutStructure' && hydration && !hydration.breakoutScoreUsable) {
      missingReason = `BREAKOUT_NOT_USABLE:${hydration.breakoutSource}`;
    } else if (key === 'watchlistUpstream' && hydration && !hydration.watchlist.scoreImported) {
      missingReason = `WATCHLIST_NOT_IMPORTED:${hydration.watchlist.sourceField ?? 'NULL'}`;
    } else if (key === 'supplyConfluence' && forensic?.supplyScopeAudit) {
      const audit = forensic.supplyScopeAudit;
      if (!audit.symbolMatched) missingReason = 'SUPPLY_SYMBOL_MISMATCH';
      else if (!audit.semanticAvailable) missingReason = 'SUPPLY_SEMANTIC_UNAVAILABLE';
    } else if (inMissingPositive) {
      missingReason = 'MISSING_POSITIVE_SOURCE';
    } else if (!forensic) {
      missingReason = 'FORENSIC_NOT_FOUND';
    } else {
      missingReason = 'NOT_APPLICABLE';
    }

    result[key] = {
      available: false,
      score: null,
      source: inMissingPositive || (missingReason !== null && missingReason !== 'NOT_APPLICABLE')
        ? 'MISSING'
        : 'NOT_APPLICABLE',
      confidence: 'UNKNOWN',
      missingReason,
    };
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// dataQuality 7-axis 빌더
// ════════════════════════════════════════════════════════════════════════════

function buildDataQuality(
  forensic: Gate1MinimumSignalForensicAuditAdr0505 | undefined,
): UnifiedDataQuality {
  const hydration: FeatureHydrationAuditAdr0509 | undefined = forensic?.hydrationAuditAdr0509;
  const supply = forensic?.supplyScopeAudit;
  const sector = forensic?.sectorEnergyAudit;

  return {
    quoteAvailable: hydration?.candidateTraceHasQuote === true,
    symbolFeaturesAvailable: hydration?.candidateTraceHasSymbolFeatures === true,
    conditionResultsAvailable: hydration?.candidateTraceHasConditionResults === true,
    watchlistScoreAvailable: hydration?.watchlist?.scoreImported === true,
    supplySymbolMatched: supply?.symbolMatched === true,
    supplySemanticAvailable: supply?.semanticAvailable === true,
    // SectorEnergy usable — diagnosticStatus 가 OK / leadership 가 양수일 때
    sectorEnergyUsable:
      sector?.sectorBoostAllowed === true ||
      (typeof sector?.leadershipScore === 'number' && sector.leadershipScore > 0),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Divergence 분류 SSOT (절대 변경 금지 결정 트리)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 사용자 §D 명시 결정 트리:
 *   shadowApproval=true + liveMinSignalPass=false → shadowAllowedButLiveFailed=true
 *
 * 우선순위 (1차 reason — 다중 결손 발견 시 첫 매칭, 나머지는 secondaryReasons[]):
 *   1) WATCHLIST_NOT_IMPORTED (watchlistScoreAvailable=false)
 *   2) RS_NOT_USABLE (relativeStrength missingReason RS_NOT_USABLE prefix)
 *   3) BREAKOUT_NOT_USABLE (breakoutStructure missingReason BREAKOUT_NOT_USABLE prefix)
 *   4) SUPPLY_SEMANTIC_UNAVAILABLE (supplySemanticAvailable=false)
 *   5) LIVE_MIN_SIGNAL_FEATURE_MISSING (missingPositiveSources 비어있지 않음 일반 fallback)
 *   6) SHADOW_GATE_USES_RAW_SCORE (rawGateScore ≥ gateBandNormal 인데 minSignal 미달)
 *   7) POLICY_DIFFERENCE_ONLY (data 정상인데도 발산 — 정책 차이)
 */
function classifyDivergence(
  shadowApprovalAllowed: boolean,
  liveMinSignalPass: boolean | null,
  components: Record<UnifiedComponentKey, UnifiedComponentStatus>,
  dataQuality: UnifiedDataQuality,
  rawGateScore: number | null,
  gateBandNormal: number | null,
  minSignalScore100: number | null,
  requiredMinSignalScore: number | null,
): UnifiedDivergence {
  const liveFailed = liveMinSignalPass === false;
  if (!shadowApprovalAllowed || !liveFailed) {
    return {
      shadowAllowedButLiveFailed: false,
      reason: 'NO_DIVERGENCE',
      secondaryReasons: [],
    };
  }

  const reasons: UnifiedDivergenceReason[] = [];

  if (!dataQuality.watchlistScoreAvailable) reasons.push('WATCHLIST_NOT_IMPORTED');

  const rsStatus = components.relativeStrength;
  if (rsStatus && !rsStatus.available && (rsStatus.missingReason ?? '').startsWith('RS_NOT_USABLE')) {
    reasons.push('RS_NOT_USABLE');
  }

  const breakoutStatus = components.breakoutStructure;
  if (breakoutStatus && !breakoutStatus.available && (breakoutStatus.missingReason ?? '').startsWith('BREAKOUT_NOT_USABLE')) {
    reasons.push('BREAKOUT_NOT_USABLE');
  }

  if (!dataQuality.supplySemanticAvailable) reasons.push('SUPPLY_SEMANTIC_UNAVAILABLE');

  // LIVE_MIN_SIGNAL_FEATURE_MISSING — 정확히 매핑되지 않은 missing positive 가 있을 때
  // (위 specific reasons 도 본 카테고리에 포함되지만, specific 가 더 명확하므로 우선)
  const hasGenericMissing = Object.values(components).some(
    (c) => !c.available && c.source === 'MISSING',
  );
  if (reasons.length === 0 && hasGenericMissing) {
    reasons.push('LIVE_MIN_SIGNAL_FEATURE_MISSING');
  }

  // SHADOW_GATE_USES_RAW_SCORE — rawGateScore ≥ gateBandNormal 이지만 minSignal 미달
  const minSignalBelow =
    finiteOrNull(minSignalScore100) !== null &&
    finiteOrNull(requiredMinSignalScore) !== null &&
    (minSignalScore100 as number) < (requiredMinSignalScore as number);
  const rawGateAboveBand =
    finiteOrNull(rawGateScore) !== null &&
    finiteOrNull(gateBandNormal) !== null &&
    (rawGateScore as number) >= (gateBandNormal as number);
  if (rawGateAboveBand && minSignalBelow) {
    reasons.push('SHADOW_GATE_USES_RAW_SCORE');
  }

  if (reasons.length === 0) {
    reasons.push('POLICY_DIFFERENCE_ONLY');
  }

  const [primary, ...secondary] = reasons;
  return {
    shadowAllowedButLiveFailed: true,
    reason: primary,
    secondaryReasons: Object.freeze(secondary),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 메인 빌더 — 단일 snapshot 합성
// ════════════════════════════════════════════════════════════════════════════

export interface BuildUnifiedGateScoreSnapshotInput {
  shadowAudit: ShadowGateAuditRecord;
  liveForensic?: Gate1MinimumSignalForensicAuditAdr0505;
  now?: string;
}

/**
 * Shadow audit record + 옵셔널 Live forensic record → UnifiedGateScoreSnapshot 합성.
 * literal type 강제 (executionImpact/liveExecutionAllowed/liveOrderPlaced/policyPromotionMode).
 */
export function buildUnifiedGateScoreSnapshot(
  input: BuildUnifiedGateScoreSnapshotInput,
): UnifiedGateScoreSnapshot {
  const { shadowAudit, liveForensic, now } = input;
  const nowIso = now ?? new Date().toISOString();

  const components = buildComponentStatusMap(liveForensic);
  const dataQuality = buildDataQuality(liveForensic);

  // shadow approval allowed — approvalCardEmitted OR state === APPROVED
  const shadowApprovalAllowed =
    shadowAudit.shadow.approvalCardEmitted ||
    shadowAudit.shadow.approvalState === 'APPROVED';

  const rawGateScore = shadowAudit.shadow.rawGateScore;
  const gateBandNormal = shadowAudit.shadow.gateBandNormal;
  const minSignalScore100 = liveForensic ? finiteOrNull(liveForensic.actualScore) : null;
  const requiredMinSignalScore = liveForensic ? finiteOrNull(liveForensic.requiredScore) : null;
  const liveGate1Pass = liveForensic ? liveForensic.passed : null;
  const liveMinSignalPass = liveForensic ? liveForensic.passed : null;

  const divergence = classifyDivergence(
    shadowApprovalAllowed,
    liveMinSignalPass,
    components,
    dataQuality,
    rawGateScore,
    gateBandNormal,
    minSignalScore100,
    requiredMinSignalScore,
  );

  const snapshot: UnifiedGateScoreSnapshot = {
    symbol: shadowAudit.symbol,
    ...(shadowAudit.name !== undefined ? { name: shadowAudit.name } : {}),
    tradeDate: shadowAudit.tradeDate,
    marketSession: shadowAudit.marketSession,

    rawGateScore,
    // normalizedGateScore — availableMaxScore 기반 정규화; 없으면 *10 근사 (diagnostic only).
    // quantFilter.ts rawScore / availableMaxScore 와 동일한 공식 사용 (0~100 scale).
    normalizedGateScore: rawGateScore !== null && shadowAudit.shadow.availableMaxScore
      ? Math.round((rawGateScore / shadowAudit.shadow.availableMaxScore) * 100 * 10) / 10
      : rawGateScore !== null ? rawGateScore * 10 : null,
    minSignalScore100,
    requiredMinSignalScore,
    scoreGap: liveForensic ? finiteOrNull(liveForensic.scoreGap) : null,

    mtas: shadowAudit.shadow.mtas,
    compressionScore: shadowAudit.shadow.compressionScore,
    rrr: shadowAudit.shadow.rrr,

    signalType: shadowAudit.shadow.signalType,
    gateBandNormal,
    gateBandStrong: shadowAudit.shadow.gateBandStrong,

    liveGate1Pass,
    liveMinSignalPass,
    shadowApprovalAllowed,
    shadowRecorded: shadowAudit.shadow.shadowRecorded,

    // literal type 강제 (TypeScript 컴파일 타임)
    liveOrderPlaced: false,
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',

    components,
    dataQuality,
    divergence,

    ...(liveForensic ? {} : { warning: 'LIVE_FORENSIC_NOT_FOUND' as const }),

    createdAtIso: shadowAudit.createdAtIso,
    updatedAtIso: nowIso,
  };

  return snapshot;
}

// ════════════════════════════════════════════════════════════════════════════
// Summary aggregator
// ════════════════════════════════════════════════════════════════════════════

export interface UnifiedGateScoreSummary {
  totalSnapshots: number;
  shadowSignals: number;
  shadowAllowedButLiveFailed: number;
  liveForensicMissing: number;
  conditionResultsAvailable: number;
  rsFromConditionResults: number;
  breakoutFromConditionResults: number;
  divergenceReasonBreakdown: Record<UnifiedDivergenceReason, number>;
  latest?: UnifiedGateScoreSnapshot;
  executionImpact: 'NONE';
  liveOrderPlaced: false;
}

function emptyDivergenceBreakdown(): Record<UnifiedDivergenceReason, number> {
  return {
    NO_DIVERGENCE: 0,
    LIVE_MIN_SIGNAL_FEATURE_MISSING: 0,
    SHADOW_GATE_USES_RAW_SCORE: 0,
    SUPPLY_SEMANTIC_UNAVAILABLE: 0,
    WATCHLIST_NOT_IMPORTED: 0,
    BREAKOUT_NOT_USABLE: 0,
    RS_NOT_USABLE: 0,
    POLICY_DIFFERENCE_ONLY: 0,
  };
}

export function summarizeUnifiedGateScoreSnapshots(
  snapshots: readonly UnifiedGateScoreSnapshot[],
): UnifiedGateScoreSummary {
  const breakdown = emptyDivergenceBreakdown();
  let shadowSignals = 0;
  let shadowAllowedButLiveFailed = 0;
  let liveForensicMissing = 0;
  let conditionResultsAvailable = 0;
  let rsFromConditionResults = 0;
  let breakoutFromConditionResults = 0;

  for (const snap of snapshots) {
    if (snap.shadowApprovalAllowed) shadowSignals += 1;
    if (snap.divergence.shadowAllowedButLiveFailed) shadowAllowedButLiveFailed += 1;
    if (snap.warning === 'LIVE_FORENSIC_NOT_FOUND') liveForensicMissing += 1;
    breakdown[snap.divergence.reason] = (breakdown[snap.divergence.reason] ?? 0) + 1;
    if (snap.dataQuality.conditionResultsAvailable) conditionResultsAvailable += 1;
    if ((snap.components.relativeStrength.missingReason ?? '').includes('CONDITION_RESULTS')) rsFromConditionResults += 1;
    if ((snap.components.breakoutStructure.missingReason ?? '').includes('CONDITION_RESULTS')) breakoutFromConditionResults += 1;
  }

  // 최신 1건 (updatedAtIso desc)
  const sorted = [...snapshots].sort(
    (a, b) => Date.parse(b.updatedAtIso) - Date.parse(a.updatedAtIso),
  );

  return {
    totalSnapshots: snapshots.length,
    shadowSignals,
    shadowAllowedButLiveFailed,
    liveForensicMissing,
    conditionResultsAvailable,
    rsFromConditionResults,
    breakoutFromConditionResults,
    divergenceReasonBreakdown: breakdown,
    ...(sorted[0] ? { latest: sorted[0] } : {}),
    executionImpact: 'NONE',
    liveOrderPlaced: false,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Formatter — /scan_blockers runtime mode
// ════════════════════════════════════════════════════════════════════════════

function fmt(value: number | null, digits = 1): string {
  return value === null ? 'n/a' : value.toFixed(digits);
}

function yn(bool: boolean): string {
  return bool ? 'yes' : 'no';
}

/**
 * /scan_blockers runtime 출력 — 사용자 §E 형식 (Shadow/Live Gate Comparison 섹션).
 * 빈 snapshots 시 null 반환 (호출자가 noise 차단).
 */
export function formatUnifiedGateComparisonSection(
  snapshots: readonly UnifiedGateScoreSnapshot[],
): string | null {
  if (snapshots.length === 0) return null;
  const summary = summarizeUnifiedGateScoreSnapshots(snapshots);
  const latest = summary.latest;
  if (!latest) return null;

  const lines: string[] = [
    '🧪 Shadow/Live Gate Comparison [PATCH-RUNTIME] (ADR-0509)',
    `• total: ${summary.totalSnapshots} / shadowSignals: ${summary.shadowSignals}`,
    `• shadowAllowedButLiveFailed: ${summary.shadowAllowedButLiveFailed}`,
    `• latest: ${latest.symbol}${latest.name ? ` ${latest.name}` : ''}`,
    `  Shadow: rawGate ${fmt(latest.rawGateScore)} / MTAS ${fmt(latest.mtas, 0)} / RRR ${fmt(latest.rrr, 2)}`,
    `  Live: minSignal ${fmt(latest.minSignalScore100)} / ${fmt(latest.requiredMinSignalScore)} / Gate1=${
      latest.liveGate1Pass === null ? 'n/a' : latest.liveGate1Pass
    }`,
    `  gap: ${fmt(latest.scoreGap)}`,
    `  data: watchlist=${yn(latest.dataQuality.watchlistScoreAvailable)}, rs=${yn(
      latest.components.relativeStrength.available,
    )}, breakout=${yn(latest.components.breakoutStructure.available)}, supplySymbol=${yn(
      latest.dataQuality.supplySymbolMatched,
    )}, supplySemantic=${yn(latest.dataQuality.supplySemanticAvailable)}`,
    `  divergence: ${latest.divergence.reason}${
      latest.divergence.secondaryReasons.length > 0
        ? ` (also: ${latest.divergence.secondaryReasons.join(', ')})`
        : ''
    }`,
    '• liveOrderPlaced=false',
    '• executionImpact=NONE',
  ];

  if (latest.warning) {
    lines.push(`• warning: ${latest.warning}`);
  }
  if (summary.liveForensicMissing > 0) {
    lines.push(`• liveForensicMissing: ${summary.liveForensicMissing}`);
  }

  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// Formatter — /scan_blockers gate compact mode
// ════════════════════════════════════════════════════════════════════════════

/**
 * /scan_blockers gate compact 출력 — 사용자 §F 형식 (3줄 요약).
 * 빈 snapshots 시 null 반환.
 */
export function formatUnifiedGateCompactLine(
  snapshots: readonly UnifiedGateScoreSnapshot[],
): string | null {
  if (snapshots.length === 0) return null;
  const summary = summarizeUnifiedGateScoreSnapshots(snapshots);
  const latest = summary.latest;
  if (!latest) return null;

  const nextAction = summary.conditionResultsAvailable === 0
    ? 'WIRE_CONDITION_RESULTS_TO_FORENSIC_TRACE'
    : summary.rsFromConditionResults === 0
      ? 'REVIEW_RELATIVE_STRENGTH_THRESHOLDS_OR_DATA'
      : summary.breakoutFromConditionResults > 0
        ? 'REVIEW_BREAKOUT_CONDITIONS'
        : 'NONE';
  const lines: string[] = [
    `🧪 Unified Gate (ADR-0509): shadowSignals=${summary.shadowSignals} · shadowAllowedButLiveFailed=${summary.shadowAllowedButLiveFailed}`,
    `• conditionResults: ${summary.conditionResultsAvailable}/${summary.totalSnapshots} · rsFromConditionResults: ${summary.rsFromConditionResults}/${summary.totalSnapshots} · breakoutFromConditionResults: ${summary.breakoutFromConditionResults}/${summary.totalSnapshots}`,
    '• conditionStatusTop: FIRED, THRESHOLD_NOT_MET, DATA_UNAVAILABLE',
    `• nextAction: ${nextAction}`,
  ];
  if (latest.divergence.shadowAllowedButLiveFailed) {
    lines.push(`• latest divergence: ${latest.divergence.reason}`);
  }
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// Wiring helper — current store state → snapshots (scanBlockers.cmd 진입점)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 사용자 §F — 현재 shadow-gate-audit + Live forensic trace 영속 state 를 결합해
 * UnifiedGateScoreSnapshot[] 합성. scanBlockers.cmd 의 runtime/gate compact 모드용.
 *
 * Match 정책:
 *   - shadowGateAuditStore 에 hydrateLiveMinimum=true 옵션을 켜면 attachLiveMinimum 이
 *     이미 동일 symbol 의 최신 forensic 을 매칭해 record.liveMinimum 에 합성한 상태.
 *   - 본 helper 는 추가로 raw Gate1ForensicAudit 객체도 매칭해서 buildUnifiedGateScoreSnapshot
 *     에 전달 → ComponentStatus / DataQuality / Divergence 가 forensic detail 까지 활용.
 *   - forensic 매칭 실패 시 warning='LIVE_FORENSIC_NOT_FOUND' (snapshot 자체는 보존).
 *
 * 절대 invariant: KIS 주문 함수 import 0건, executionImpact=NONE literal,
 *                liveExecutionAllowed=false literal, liveOrderPlaced=false literal,
 *                policyPromotionMode='SHADOW_ONLY' literal — 모두 buildUnifiedGateScoreSnapshot
 *                가 TypeScript 컴파일 타임에 강제.
 *
 * ENV `UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED=true` 시 빈 배열 반환 (diagnostic skip,
 * ADR-0157 정확 비교 의무).
 */
export function buildUnifiedSnapshotsFromCurrentState(input: {
  shadowAudits: readonly ShadowGateAuditRecord[];
  forensicTraceEntries?: ReadonlyArray<{
    capturedAtIso: string;
    audit?: Gate1MinimumSignalForensicAuditAdr0505;
  }>;
  now?: string;
}): UnifiedGateScoreSnapshot[] {
  if (isUnifiedGateScoreKernelDisabled()) return [];
  const { shadowAudits, forensicTraceEntries, now } = input;
  if (shadowAudits.length === 0) return [];

  // symbol → 가장 최신 forensic audit 매칭
  const forensicBySymbol = new Map<string, Gate1MinimumSignalForensicAuditAdr0505>();
  if (forensicTraceEntries && forensicTraceEntries.length > 0) {
    const sorted = forensicTraceEntries
      .slice()
      .sort((a, b) => Date.parse(b.capturedAtIso) - Date.parse(a.capturedAtIso));
    for (const entry of sorted) {
      const sym = entry.audit?.symbol;
      if (!sym || forensicBySymbol.has(sym)) continue;
      forensicBySymbol.set(sym, entry.audit!);
    }
  }

  return shadowAudits.map((shadowAudit) => {
    const liveForensic = forensicBySymbol.get(shadowAudit.symbol);
    return buildUnifiedGateScoreSnapshot({
      shadowAudit,
      ...(liveForensic ? { liveForensic } : {}),
      ...(now ? { now } : {}),
    });
  });
}
