/**
 * @responsibility Patch-UNIFIED-GATE-SCORE-KERNEL-AUDIT-001 (ADR-0509) 회귀 SSOT.
 *
 * 사용자 명시 8 핵심 케이스 + 안전 invariant 회귀 가드.
 *
 * 사용자 명시 8 케이스 (모두 PASS 의무):
 *   1. 동일 symbol 에 Shadow rawGate + Live minSignal 함께 snapshot 기록
 *   2. Shadow approval=true + liveMinSignalPass=false → shadowAllowedButLiveFailed=true
 *   3. missing watchlist/RS/breakout → divergence reason 분류 (WATCHLIST_NOT_IMPORTED /
 *      RS_NOT_USABLE / BREAKOUT_NOT_USABLE / LIVE_MIN_SIGNAL_FEATURE_MISSING)
 *   4. rawGateScore ≥ gateBandNormal + minSignal < required → SHADOW_GATE_USES_RAW_SCORE
 *   5. /scan_blockers runtime → Shadow/Live Gate Comparison 섹션 표시
 *   6. 점수/threshold/penalty 변경 없음 (정적 grep 가드)
 *   7. KIS order import 0건 (정적 grep 가드)
 *   8. npm run lint + vitest 통과
 *
 * 추가 invariant:
 *   - executionImpact: 'NONE' / liveOrderPlaced: false / liveExecutionAllowed: false /
 *     policyPromotionMode: 'SHADOW_ONLY' literal type 강제
 *   - ENV `UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED` (default OFF, ADR-0157 정확 비교)
 *   - 12 component SSOT + 7 dataQuality + 8 divergence reason union
 *   - autoTradeEngine / orderExecutor / trancheExecutor import 0건
 *   - 외부 API (fetch / axios / node-fetch) 0건
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildUnifiedGateScoreSnapshot,
  buildUnifiedSnapshotsFromCurrentState,
  summarizeUnifiedGateScoreSnapshots,
  formatUnifiedGateComparisonSection,
  formatUnifiedGateCompactLine,
  isUnifiedGateScoreKernelDisabled,
  UNIFIED_COMPONENT_KEYS,
  type UnifiedGateScoreSnapshot,
  type UnifiedDivergenceReason,
  type UnifiedComponentKey,
} from './unifiedGateScoreKernelAdr0509.js';

import type { ShadowGateAuditRecord } from '../../telegram/shadowGateAuditStore.js';
import type {
  Gate1MinimumSignalForensicAuditAdr0505,
  ComponentForensicDetail,
} from './gate1MinimumSignalForensicAuditAdr0505.js';

// ────────────────────────────────────────────────────────────────────────────
// Factory helpers
// ────────────────────────────────────────────────────────────────────────────

function makeShadowAuditRecord(overrides?: Partial<ShadowGateAuditRecord>): ShadowGateAuditRecord {
  return {
    symbol: '394280',
    name: '오픈엣지테크놀로지',
    tradeDate: '2026-05-13',
    marketSession: 'REGULAR',
    dedupeKey: 'SHADOW_APPROVAL:2026-05-13:REGULAR:394280:SHADOW:BUY_APPROVAL',
    shadow: {
      scoreSystem: 'SHADOW_GATE_RAW',
      rawGateScore: 8.4,
      availableMaxScore: null,
      gateLayerSummary: null,
      gateBandNormal: 6.0,
      gateBandStrong: 8.0,
      signalType: 'BUY',
      mtas: 9,
      compressionScore: null,
      rrr: 2.6,
      approvalCardEmitted: true,
      approvalState: 'PENDING',
      shadowRecorded: false,
      liveOrderPlaced: false,
      triggerSource: 'SHADOW_APPROVAL_CARD',
    },
    liveMinimum: {
      scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
      requiredScore: null,
      actualScore: null,
      scoreGap: null,
      gate1Pass: null,
      minSignalPass: null,
      missingPositiveSources: [],
      penaltyTop: [],
    },
    divergence: { shadowAllowedButLiveFailed: false, reason: 'UNKNOWN', severity: 'INFO' },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    createdAtIso: '2026-05-13T03:00:00.000Z',
    updatedAtIso: '2026-05-13T03:00:00.000Z',
    ...overrides,
  };
}

function makeForensicDetail(overrides?: Partial<ComponentForensicDetail>): ComponentForensicDetail {
  return {
    weightedScore: 0,
    maxScore: 10,
    confidence: 'VERIFIED' as ComponentForensicDetail['confidence'],
    providerIssue: false,
    marketSignal: false,
    penaltyApplied: false,
    message: 'test',
    ...overrides,
  };
}

function makeForensic(
  overrides?: Partial<Gate1MinimumSignalForensicAuditAdr0505>,
): Gate1MinimumSignalForensicAuditAdr0505 {
  return {
    symbol: '394280',
    name: '오픈엣지테크놀로지',
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: 70,
    actualScore: 3,
    scoreGap: -67,
    passed: false,
    positiveComponents: {},
    penaltyComponents: {},
    missingPositiveSources: [
      'WATCHLIST_UPSTREAM_SCORE_MISSING',
      'RELATIVE_STRENGTH_MISSING',
      'BREAKOUT_STRUCTURE_MISSING',
    ] as Gate1MinimumSignalForensicAuditAdr0505['missingPositiveSources'],
    dominantFailureReason: 'POSITIVE_SCORE_STARVATION' as Gate1MinimumSignalForensicAuditAdr0505['dominantFailureReason'],
    supplyScopeAudit: {
      expectedScope: 'SYMBOL_LEVEL_INVESTOR_FLOW',
      candidateSymbol: '394280',
      kisFlowSymbol: '394280',
      symbolMatched: true,
      semanticAvailable: false,
      foreignNetBuy: null,
      institutionalNetBuy: null,
      warning: 'NONE',
    } as Gate1MinimumSignalForensicAuditAdr0505['supplyScopeAudit'],
    sectorEnergyAudit: {
      registeredInEvaluateServerGateRegistry: false,
      layer: 'SECTOR_BOOST_PROMOTION_MINIMUM_SCORE_LAYER',
      directRawGateScoreImpact: 0,
    },
    wouldPassIf: {
      unknownNeutral: false,
      providerPenaltyRemoved: false,
      sectorPenaltyRemoved: false,
      softFailPenaltyRemoved: false,
      watchlistImportedPlus5: false,
      relativeStrengthRestoredPlus7: false,
      breakoutStructureRestoredPlus5: false,
      allPositiveSourcesRestored: false,
    },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED;
});

afterEach(() => {
  delete process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED;
});

// ════════════════════════════════════════════════════════════════════════════
// Group A — ENV gate (ADR-0157 정확 비교)
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — ENV gate (default OFF, ADR-0157 정확 비교)', () => {
  it('A1. default (ENV 미설정) → false (audit 활성)', () => {
    delete process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED;
    expect(isUnifiedGateScoreKernelDisabled()).toBe(false);
  });

  it('A2. ENV=true → true (audit 비활성)', () => {
    process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED = 'true';
    expect(isUnifiedGateScoreKernelDisabled()).toBe(true);
  });

  it('A3. ADR-0157 정확 비교 — "1" / "TRUE" / "yes" / "Yes" / "on" / 빈값 모두 false', () => {
    for (const v of ['1', 'TRUE', 'yes', 'Yes', 'on', '']) {
      process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED = v;
      expect(isUnifiedGateScoreKernelDisabled()).toBe(false);
    }
  });

  it('A4. ENV=false 명시 → false', () => {
    process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED = 'false';
    expect(isUnifiedGateScoreKernelDisabled()).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group B — SSOT 상수 정합
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — SSOT 상수 정합', () => {
  it('B1. UNIFIED_COMPONENT_KEYS 12 component 정확 매트릭스', () => {
    expect(UNIFIED_COMPONENT_KEYS).toHaveLength(12);
    const expected: UnifiedComponentKey[] = [
      'priceMomentum', 'volumeLiquidity', 'technicalTrend',
      'relativeStrength', 'breakoutStructure', 'watchlistUpstream',
      'supplyConfluence', 'investorFlow', 'sectorEnergy',
      'earningsQuality', 'per', 'trendAcceleration',
    ];
    for (const key of expected) {
      expect(UNIFIED_COMPONENT_KEYS).toContain(key);
    }
  });

  it('B2. UNIFIED_COMPONENT_KEYS frozen (drift 차단)', () => {
    expect(Object.isFrozen(UNIFIED_COMPONENT_KEYS)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group C — Case 1: 동일 symbol Shadow + Live 함께 기록
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — Case 1: 동일 symbol Shadow + Live 함께 기록', () => {
  it('C1. shadowAudit + liveForensic → unified snapshot 단일 객체에 둘 다 보존', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });

    expect(snapshot.symbol).toBe('394280');
    expect(snapshot.name).toBe('오픈엣지테크놀로지');
    expect(snapshot.rawGateScore).toBe(8.4);
    expect(snapshot.mtas).toBe(9);
    expect(snapshot.rrr).toBe(2.6);
    expect(snapshot.minSignalScore100).toBe(3);
    expect(snapshot.requiredMinSignalScore).toBe(70);
    expect(snapshot.scoreGap).toBe(-67);
  });

  it('C2. liveForensic 부재 → warning=LIVE_FORENSIC_NOT_FOUND', () => {
    const shadow = makeShadowAuditRecord();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow });
    expect(snapshot.warning).toBe('LIVE_FORENSIC_NOT_FOUND');
    expect(snapshot.minSignalScore100).toBeNull();
    expect(snapshot.requiredMinSignalScore).toBeNull();
    expect(snapshot.liveGate1Pass).toBeNull();
    expect(snapshot.liveMinSignalPass).toBeNull();
  });

  it('C3. normalizedGateScore — rawGate * 10 (0..100 scale 진단용)', () => {
    const shadow = makeShadowAuditRecord({
      shadow: { ...makeShadowAuditRecord().shadow, rawGateScore: 8.4 },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow });
    expect(snapshot.normalizedGateScore).toBe(84);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group D — Case 2: shadowApproval=true + liveMinSignalPass=false → divergence
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — Case 2: shadowApproval=true + liveMinSignalPass=false', () => {
  it('D1. shadowApproval=true + passed=false → shadowAllowedButLiveFailed=true', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({ passed: false });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.shadowApprovalAllowed).toBe(true);
    expect(snapshot.liveMinSignalPass).toBe(false);
    expect(snapshot.divergence.shadowAllowedButLiveFailed).toBe(true);
  });

  it('D2. shadowApproval=true + passed=true → shadowAllowedButLiveFailed=false', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({ passed: true, actualScore: 75, scoreGap: 5 });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.shadowAllowedButLiveFailed).toBe(false);
    expect(snapshot.divergence.reason).toBe('NO_DIVERGENCE');
  });

  it('D3. shadowApproval=false → shadowAllowedButLiveFailed=false (Shadow 자체 거부)', () => {
    const shadow = makeShadowAuditRecord({
      shadow: {
        ...makeShadowAuditRecord().shadow,
        approvalCardEmitted: false,
        approvalState: 'REJECTED',
      },
    });
    const forensic = makeForensic({ passed: false });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.shadowAllowedButLiveFailed).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group E — Case 3: missing watchlist/RS/breakout → divergence reason 분류
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — Case 3: missing watchlist/RS/breakout divergence', () => {
  it('E1. watchlist missing → primary reason WATCHLIST_NOT_IMPORTED', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({
      passed: false,
      hydrationAuditAdr0509: {
        rsAvailable: true, breakoutAvailable: true,
        rsScoreUsable: true, breakoutScoreUsable: true,
        rsSource: 'QUOTE_RETURN', breakoutSource: 'QUOTE_OHLCV',
        rsMissingReasons: [], breakoutMissingReasons: [],
        rsMissingFields: [], breakoutMissingFields: [], missingFields: [],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: false,
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: false, sourceField: null, scoreImported: false, missingReason: 'NULL' },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.shadowAllowedButLiveFailed).toBe(true);
    expect(snapshot.divergence.reason).toBe('WATCHLIST_NOT_IMPORTED');
    expect(snapshot.dataQuality.watchlistScoreAvailable).toBe(false);
  });

  it('E2. RS not usable → RS_NOT_USABLE 분류', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({
      passed: false,
      hydrationAuditAdr0509: {
        rsAvailable: false, breakoutAvailable: true,
        rsScoreUsable: false, breakoutScoreUsable: true,
        rsSource: 'MISSING', breakoutSource: 'QUOTE_OHLCV',
        rsMissingReasons: ['FIELD_MISSING'], breakoutMissingReasons: [],
        rsMissingFields: ['return20d'], breakoutMissingFields: [], missingFields: ['return20d'],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: true,  // watchlist 정상 → WATCHLIST_NOT_IMPORTED 회피
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: true, sourceField: 'score', scoreImported: true },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.reason).toBe('RS_NOT_USABLE');
    expect(snapshot.components.relativeStrength.available).toBe(false);
    expect(snapshot.components.relativeStrength.missingReason).toMatch(/^RS_NOT_USABLE/);
  });

  it('E3. Breakout not usable → BREAKOUT_NOT_USABLE 분류', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({
      passed: false,
      missingPositiveSources: ['BREAKOUT_STRUCTURE_MISSING'] as Gate1MinimumSignalForensicAuditAdr0505['missingPositiveSources'],
      supplyScopeAudit: {
        ...makeForensic().supplyScopeAudit,
        semanticAvailable: true,  // supply 정상 → SUPPLY_SEMANTIC_UNAVAILABLE 회피
      },
      hydrationAuditAdr0509: {
        rsAvailable: true, breakoutAvailable: false,
        rsScoreUsable: true, breakoutScoreUsable: false,
        rsSource: 'QUOTE_RETURN', breakoutSource: 'MISSING',
        rsMissingReasons: [], breakoutMissingReasons: ['FIELD_MISSING'],
        rsMissingFields: [], breakoutMissingFields: ['high60'], missingFields: ['high60'],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: true,
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: true, sourceField: 'score', scoreImported: true },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.reason).toBe('BREAKOUT_NOT_USABLE');
    expect(snapshot.components.breakoutStructure.available).toBe(false);
    expect(snapshot.components.breakoutStructure.missingReason).toMatch(/^BREAKOUT_NOT_USABLE/);
  });

  it('E4. supply semantic unavailable → SUPPLY_SEMANTIC_UNAVAILABLE 분류', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({
      passed: false,
      missingPositiveSources: [] as Gate1MinimumSignalForensicAuditAdr0505['missingPositiveSources'],
      supplyScopeAudit: {
        ...makeForensic().supplyScopeAudit,
        symbolMatched: true,
        semanticAvailable: false,
      },
      hydrationAuditAdr0509: {
        rsAvailable: true, breakoutAvailable: true,
        rsScoreUsable: true, breakoutScoreUsable: true,
        rsSource: 'QUOTE_RETURN', breakoutSource: 'QUOTE_OHLCV',
        rsMissingReasons: [], breakoutMissingReasons: [],
        rsMissingFields: [], breakoutMissingFields: [], missingFields: [],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: true,
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: true, sourceField: 'score', scoreImported: true },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.reason).toBe('SUPPLY_SEMANTIC_UNAVAILABLE');
    expect(snapshot.dataQuality.supplySemanticAvailable).toBe(false);
  });

  it('E5. 모든 데이터 정상인데 분기 → POLICY_DIFFERENCE_ONLY', () => {
    // rawGate < gateBandNormal 로 SHADOW_GATE_USES_RAW_SCORE 분기 제거,
    // 모든 데이터 사용 가능 → 오직 정책 차이 (Shadow allow vs Live require) 만 발산 원인
    const shadow = makeShadowAuditRecord({
      shadow: { ...makeShadowAuditRecord().shadow, rawGateScore: 4.0, gateBandNormal: 6.0 },
    });
    const forensic = makeForensic({
      passed: false,
      missingPositiveSources: [] as Gate1MinimumSignalForensicAuditAdr0505['missingPositiveSources'],
      supplyScopeAudit: {
        ...makeForensic().supplyScopeAudit,
        semanticAvailable: true,
      },
      hydrationAuditAdr0509: {
        rsAvailable: true, breakoutAvailable: true,
        rsScoreUsable: true, breakoutScoreUsable: true,
        rsSource: 'QUOTE_RETURN', breakoutSource: 'QUOTE_OHLCV',
        rsMissingReasons: [], breakoutMissingReasons: [],
        rsMissingFields: [], breakoutMissingFields: [], missingFields: [],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: true,
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: true, sourceField: 'score', scoreImported: true },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.reason).toBe('POLICY_DIFFERENCE_ONLY');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group F — Case 4: rawGate ≥ band + minSignal < required → SHADOW_GATE_USES_RAW_SCORE
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — Case 4: SHADOW_GATE_USES_RAW_SCORE 분류', () => {
  it('F1. rawGate=8.4 (≥ band 6.0) + minSignal=3.0 (< required 70) — primary 가 더 specific 한 reason 있을 때 secondaryReasons 에 포함', () => {
    const shadow = makeShadowAuditRecord();  // rawGate=8.4 / gateBandNormal=6.0
    const forensic = makeForensic({ passed: false, actualScore: 3, requiredScore: 70 });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    // missingPositiveSources 3개 있으므로 primary = WATCHLIST_NOT_IMPORTED 또는 LIVE_MIN_SIGNAL_FEATURE_MISSING
    // SHADOW_GATE_USES_RAW_SCORE 는 secondaryReasons 에 포함될 가능성
    expect(snapshot.divergence.shadowAllowedButLiveFailed).toBe(true);
    const allReasons = [snapshot.divergence.reason, ...snapshot.divergence.secondaryReasons];
    expect(allReasons).toContain('SHADOW_GATE_USES_RAW_SCORE');
  });

  it('F2. 데이터 정상 + rawGate ≥ band + minSignal < required → primary=SHADOW_GATE_USES_RAW_SCORE', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({
      passed: false,
      actualScore: 30,
      requiredScore: 70,
      missingPositiveSources: [] as Gate1MinimumSignalForensicAuditAdr0505['missingPositiveSources'],
      supplyScopeAudit: { ...makeForensic().supplyScopeAudit, semanticAvailable: true },
      hydrationAuditAdr0509: {
        rsAvailable: true, breakoutAvailable: true,
        rsScoreUsable: true, breakoutScoreUsable: true,
        rsSource: 'QUOTE_RETURN', breakoutSource: 'QUOTE_OHLCV',
        rsMissingReasons: [], breakoutMissingReasons: [],
        rsMissingFields: [], breakoutMissingFields: [], missingFields: [],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: true,
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: true, sourceField: 'score', scoreImported: true },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    expect(snapshot.divergence.reason).toBe('SHADOW_GATE_USES_RAW_SCORE');
  });

  it('F3. rawGate < band → SHADOW_GATE_USES_RAW_SCORE 미발화', () => {
    const shadow = makeShadowAuditRecord({
      shadow: { ...makeShadowAuditRecord().shadow, rawGateScore: 5.0, gateBandNormal: 6.0 },
    });
    const forensic = makeForensic({
      passed: false,
      actualScore: 30,
      requiredScore: 70,
      missingPositiveSources: [] as Gate1MinimumSignalForensicAuditAdr0505['missingPositiveSources'],
      supplyScopeAudit: { ...makeForensic().supplyScopeAudit, semanticAvailable: true },
      hydrationAuditAdr0509: {
        rsAvailable: true, breakoutAvailable: true,
        rsScoreUsable: true, breakoutScoreUsable: true,
        rsSource: 'QUOTE_RETURN', breakoutSource: 'QUOTE_OHLCV',
        rsMissingReasons: [], breakoutMissingReasons: [],
        rsMissingFields: [], breakoutMissingFields: [], missingFields: [],
        candidateTraceHasQuote: true,
        candidateTraceHasSymbolFeatures: true,
        candidateTraceHasConditionResults: true,
        candidateTraceHasWatchlistScore: true,
        candidateTraceHasSupplyContext: true,
        candidateTraceHasMinSignalScoreTrace: true,
        watchlist: { sourceAvailable: true, sourceField: 'score', scoreImported: true },
      },
    });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    const allReasons = [snapshot.divergence.reason, ...snapshot.divergence.secondaryReasons];
    expect(allReasons).not.toContain('SHADOW_GATE_USES_RAW_SCORE');
    // 정상 데이터 → POLICY_DIFFERENCE_ONLY
    expect(snapshot.divergence.reason).toBe('POLICY_DIFFERENCE_ONLY');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group G — Case 5: /scan_blockers runtime 출력
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — Case 5: formatUnifiedGateComparisonSection (runtime)', () => {
  it('G1. 빈 snapshots → null', () => {
    expect(formatUnifiedGateComparisonSection([])).toBeNull();
  });

  it('G2. 단일 snapshot → Shadow/Live Gate Comparison 섹션 + 모든 필드 노출', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    const section = formatUnifiedGateComparisonSection([snapshot]);
    expect(section).not.toBeNull();
    expect(section).toContain('Shadow/Live Gate Comparison');
    expect(section).toContain('[PATCH-RUNTIME]');
    expect(section).toContain('ADR-0509');
    expect(section).toContain('394280');
    expect(section).toContain('Shadow: rawGate 8.4');
    expect(section).toContain('MTAS 9');
    expect(section).toContain('RRR 2.60');
    expect(section).toContain('minSignal 3.0');
    expect(section).toContain('70.0');
    expect(section).toContain('Gate1=false');
    expect(section).toContain('gap: -67.0');
    expect(section).toContain('liveOrderPlaced=false');
    expect(section).toContain('executionImpact=NONE');
  });

  it('G3. divergence reason + secondaryReasons 노출', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    const section = formatUnifiedGateComparisonSection([snapshot]);
    expect(section).toContain('divergence:');
  });

  it('G4. data quality 라인 — watchlist/rs/breakout/supplySymbol/supplySemantic yn 표시', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    const section = formatUnifiedGateComparisonSection([snapshot]);
    expect(section).toContain('data:');
    expect(section).toMatch(/watchlist=(yes|no)/);
    expect(section).toMatch(/rs=(yes|no)/);
    expect(section).toMatch(/breakout=(yes|no)/);
    expect(section).toMatch(/supplySymbol=(yes|no)/);
    expect(section).toMatch(/supplySemantic=(yes|no)/);
  });

  it('G5. warning=LIVE_FORENSIC_NOT_FOUND 노출', () => {
    const shadow = makeShadowAuditRecord();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow });
    const section = formatUnifiedGateComparisonSection([snapshot]);
    expect(section).toContain('LIVE_FORENSIC_NOT_FOUND');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group H — Compact line (/scan_blockers gate)
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — formatUnifiedGateCompactLine (gate compact)', () => {
  it('H1. 빈 snapshots → null', () => {
    expect(formatUnifiedGateCompactLine([])).toBeNull();
  });

  it('H2. 단일 snapshot — shadowSignals + shadowAllowedButLiveFailed 노출', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic();
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    const line = formatUnifiedGateCompactLine([snapshot]);
    expect(line).not.toBeNull();
    expect(line).toContain('ADR-0509');
    expect(line).toContain('shadowSignals=1');
    expect(line).toContain('shadowAllowedButLiveFailed=1');
    expect(line).toContain('latest divergence:');
  });

  it('H3. divergence 없으면 latest divergence 라인 미노출', () => {
    const shadow = makeShadowAuditRecord();
    const forensic = makeForensic({ passed: true, actualScore: 80, scoreGap: 10 });
    const snapshot = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow, liveForensic: forensic });
    const line = formatUnifiedGateCompactLine([snapshot]);
    expect(line).toContain('shadowAllowedButLiveFailed=0');
    expect(line).not.toContain('latest divergence:');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group I — Summary aggregator
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — summarizeUnifiedGateScoreSnapshots', () => {
  it('I1. 빈 배열 → 모든 카운트 0', () => {
    const summary = summarizeUnifiedGateScoreSnapshots([]);
    expect(summary.totalSnapshots).toBe(0);
    expect(summary.shadowSignals).toBe(0);
    expect(summary.shadowAllowedButLiveFailed).toBe(0);
    expect(summary.executionImpact).toBe('NONE');
    expect(summary.liveOrderPlaced).toBe(false);
  });

  it('I2. divergenceReasonBreakdown 카운트 정확', () => {
    const shadow1 = makeShadowAuditRecord({ symbol: '111111' });
    const shadow2 = makeShadowAuditRecord({ symbol: '222222' });
    const forensic1 = makeForensic({ symbol: '111111', passed: false });
    const forensic2 = makeForensic({ symbol: '222222', passed: false });
    const snap1 = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow1, liveForensic: forensic1 });
    const snap2 = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow2, liveForensic: forensic2 });
    const summary = summarizeUnifiedGateScoreSnapshots([snap1, snap2]);
    expect(summary.totalSnapshots).toBe(2);
    const total = Object.values(summary.divergenceReasonBreakdown).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
  });

  it('I3. liveForensic 부재 시 liveForensicMissing 카운트', () => {
    const shadow = makeShadowAuditRecord();
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: shadow });
    const summary = summarizeUnifiedGateScoreSnapshots([snap]);
    expect(summary.liveForensicMissing).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group J — literal type invariant (사용자 §H 안전 invariant)
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — literal type invariant 강제', () => {
  it('J1. executionImpact === "NONE" 항상', () => {
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: makeShadowAuditRecord() });
    expect(snap.executionImpact).toBe('NONE');
  });

  it('J2. liveOrderPlaced === false 항상', () => {
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: makeShadowAuditRecord() });
    expect(snap.liveOrderPlaced).toBe(false);
  });

  it('J3. liveExecutionAllowed === false 항상', () => {
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: makeShadowAuditRecord() });
    expect(snap.liveExecutionAllowed).toBe(false);
  });

  it('J4. policyPromotionMode === "SHADOW_ONLY" 항상', () => {
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: makeShadowAuditRecord() });
    expect(snap.policyPromotionMode).toBe('SHADOW_ONLY');
  });

  it('J5. 12 component 모두 결과에 포함', () => {
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: makeShadowAuditRecord() });
    for (const key of UNIFIED_COMPONENT_KEYS) {
      expect(snap.components[key]).toBeDefined();
      expect(snap.components[key]).toHaveProperty('available');
      expect(snap.components[key]).toHaveProperty('score');
      expect(snap.components[key]).toHaveProperty('source');
      expect(snap.components[key]).toHaveProperty('confidence');
      expect(snap.components[key]).toHaveProperty('missingReason');
    }
  });

  it('J6. dataQuality 7 axes 모두 boolean', () => {
    const snap = buildUnifiedGateScoreSnapshot({ shadowAudit: makeShadowAuditRecord() });
    expect(typeof snap.dataQuality.quoteAvailable).toBe('boolean');
    expect(typeof snap.dataQuality.symbolFeaturesAvailable).toBe('boolean');
    expect(typeof snap.dataQuality.conditionResultsAvailable).toBe('boolean');
    expect(typeof snap.dataQuality.watchlistScoreAvailable).toBe('boolean');
    expect(typeof snap.dataQuality.supplySymbolMatched).toBe('boolean');
    expect(typeof snap.dataQuality.supplySemanticAvailable).toBe('boolean');
    expect(typeof snap.dataQuality.sectorEnergyUsable).toBe('boolean');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group K — 정적 grep 가드 (사용자 §G 금지 항목)
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — 정적 grep 가드 (사용자 §G 금지 항목)', () => {
  const ssotPath = resolve(import.meta.dirname, './unifiedGateScoreKernelAdr0509.ts');

  function codeOnly(src: string): string {
    return src
      .replace(/\/\/.*$/gm, '')        // 라인 주석 제거
      .replace(/\/\*[\s\S]*?\*\//g, ''); // 블록 주석 제거
  }

  it('K1. KIS 주문 함수 5종 import 0건 (주석 strip 후)', () => {
    const src = codeOnly(readFileSync(ssotPath, 'utf-8'));
    expect(src).not.toMatch(/placeKisMarketOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
  });

  it('K2. autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = codeOnly(readFileSync(ssotPath, 'utf-8'));
    expect(src).not.toMatch(/from.*['"].*autoTradeEngine/);
    expect(src).not.toMatch(/from.*['"].*orderExecutor/);
    expect(src).not.toMatch(/from.*['"].*trancheExecutor/);
  });

  it('K3. 외부 fetch / axios / node-fetch import 0건', () => {
    const src = codeOnly(readFileSync(ssotPath, 'utf-8'));
    expect(src).not.toMatch(/from.*['"](axios|node-fetch)['"]/);
    expect(src).not.toMatch(/global\s+fetch/);
  });

  it('K4. Gate threshold / requiredScore / STRONG_BUY 직접 변경 패턴 0건', () => {
    const src = codeOnly(readFileSync(ssotPath, 'utf-8'));
    expect(src).not.toMatch(/setGateThreshold/);
    expect(src).not.toMatch(/setRequiredScore/);
    expect(src).not.toMatch(/STRONG_BUY_OVERRIDE/);
    expect(src).not.toMatch(/GATE_RELAX/);
  });

  it('K5. ADR-0509 추적 주석 + ADR-0157 정확 비교 명시', () => {
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).toMatch(/ADR-0509/);
    expect(src).toMatch(/UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED/);
    expect(src).toMatch(/UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED\s*===\s*['"]true['"]/);
  });

  it('K6. literal type 강제 (executionImpact NONE / liveOrderPlaced false 표기)', () => {
    const src = readFileSync(ssotPath, 'utf-8');
    expect(src).toMatch(/executionImpact:\s*'NONE'/);
    expect(src).toMatch(/liveOrderPlaced:\s*false/);
    expect(src).toMatch(/liveExecutionAllowed:\s*false/);
    expect(src).toMatch(/policyPromotionMode:\s*'SHADOW_ONLY'/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Group L — Wiring helper (buildUnifiedSnapshotsFromCurrentState)
// ════════════════════════════════════════════════════════════════════════════

describe('ADR-0509 — buildUnifiedSnapshotsFromCurrentState (wiring helper)', () => {
  it('L1. 빈 shadowAudits → 빈 배열', () => {
    const result = buildUnifiedSnapshotsFromCurrentState({ shadowAudits: [] });
    expect(result).toEqual([]);
  });

  it('L2. ENV DISABLED → 빈 배열 (shadowAudits 있어도)', () => {
    const original = process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED;
    try {
      process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED = 'true';
      const shadow = makeShadowAuditRecord();
      const result = buildUnifiedSnapshotsFromCurrentState({ shadowAudits: [shadow] });
      expect(result).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED;
      else process.env.UNIFIED_GATE_SCORE_KERNEL_AUDIT_DISABLED = original;
    }
  });

  it('L3. forensic trace entry 매칭 → snapshot 에 liveForensic 사용', () => {
    const shadow = makeShadowAuditRecord({ symbol: '005930' });
    const forensic = makeForensic({ symbol: '005930' });
    const entries = [{ capturedAtIso: '2026-05-13T00:00:00Z', audit: forensic }];
    const result = buildUnifiedSnapshotsFromCurrentState({
      shadowAudits: [shadow],
      forensicTraceEntries: entries,
    });
    expect(result.length).toBe(1);
    expect(result[0].minSignalScore100).toBe(forensic.actualScore);
    expect(result[0].warning).toBeUndefined();
  });

  it('L4. 매칭 forensic 부재 → warning=LIVE_FORENSIC_NOT_FOUND', () => {
    const shadow = makeShadowAuditRecord({ symbol: '005930' });
    const forensic = makeForensic({ symbol: '999999' });
    const entries = [{ capturedAtIso: '2026-05-13T00:00:00Z', audit: forensic }];
    const result = buildUnifiedSnapshotsFromCurrentState({
      shadowAudits: [shadow],
      forensicTraceEntries: entries,
    });
    expect(result.length).toBe(1);
    expect(result[0].minSignalScore100).toBeNull();
    expect(result[0].warning).toBe('LIVE_FORENSIC_NOT_FOUND');
  });

  it('L5. 다중 symbol → symbol 별 가장 최신 forensic 매칭', () => {
    const shadow1 = makeShadowAuditRecord({ symbol: '005930' });
    const shadow2 = makeShadowAuditRecord({ symbol: '000660' });
    const old = makeForensic({ symbol: '005930', actualScore: 10 });
    const recent = makeForensic({ symbol: '005930', actualScore: 50 });
    const other = makeForensic({ symbol: '000660', actualScore: 30 });
    const entries = [
      { capturedAtIso: '2026-05-12T00:00:00Z', audit: old },
      { capturedAtIso: '2026-05-13T12:00:00Z', audit: recent },
      { capturedAtIso: '2026-05-13T00:00:00Z', audit: other },
    ];
    const result = buildUnifiedSnapshotsFromCurrentState({
      shadowAudits: [shadow1, shadow2],
      forensicTraceEntries: entries,
    });
    expect(result.length).toBe(2);
    const map = new Map(result.map((s) => [s.symbol, s]));
    expect(map.get('005930')?.minSignalScore100).toBe(50);
    expect(map.get('000660')?.minSignalScore100).toBe(30);
  });
});
