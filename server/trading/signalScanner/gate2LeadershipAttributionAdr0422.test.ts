/**
 * @responsibility ADR-0422 회귀 — Gate2 / NO_LEADERSHIP Fresh Attribution SSOT
 *
 * 사용자 §I 명시 9 케이스 + 추가 안전 invariant 가드 + /scan_blockers wiring 정적 가드.
 *
 * 핵심 불변식 (사용자 명시 — 본 테스트가 영구 보호):
 *   1. Gate2_PASS_ZERO 는 단일 원인이 아니다 — 조건별 분해 의무 (gate1Pass denominator).
 *   2. NO_LEADERSHIP 은 *진짜 주도주 부재* 와 *섹터/수급/성장 데이터 품질 문제* 를 구분.
 *   3. DATA_UNAVAILABLE 은 failed 가 아니다 — 별도 unavailable 카운터 (ADR-0416 정합).
 *   4. STALE 은 진짜 failed 와 분리 — 별도 stale 카운터.
 *   5. fresh 와 last 7 days 누적 audit 분리.
 *   6. 매매 정책 변경 0 — 진단 only.
 *   7. gate1Pass=0 시 Gate2 분해 무의미 — NO_GATE1_SURVIVORS 진단 + 섹션 미노출.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  type Gate2BlockerBucket,
  type Gate2BlockReasons,
  type SectorEnergyDiagnostic,
  GATE2_DIAGNOSIS_THRESHOLDS,
  accumulateGate2Attribution,
  buildGate2FreshAttribution,
  buildSectorEnergyDiagnostic,
  computeGate2LeadershipDiagnosis,
  describeGate2Diagnosis,
  detailIndicatesStale,
  finalizeGate2BucketRates,
  formatGate2AttributionSection,
  rebindGate2AttributionToSectorEnergyMasterAdr0488,
} from './gate2LeadershipAttribution.js';

function emptyBucket(key: string): Gate2BlockerBucket {
  return {
    conditionKey: key,
    passed: 0,
    failed: 0,
    unavailable: 0,
    error: 0,
    skipped: 0,
    stale: 0,
    wait: 0,
    total: 0,
    failedRate: 0,
    unavailableRate: 0,
    errorRate: 0,
    staleRate: 0,
    waitRate: 0,
  };
}

describe('ADR-0422 §I 사용자 명시 9 케이스', () => {
  it('1. Gate2 attribution 은 Gate1 생존 후보 기준으로 누적된다', () => {
    // 호출자(buyListLoop) 가 gate1Pass survivors 만 accumulator 호출 — 본 SSOT 는
    // *전달된 outputs* 만 누적. denominator=gate1Pass 는 진단 분류 단계에서 적용.
    const acc = new Map<string, Gate2BlockerBucket>();
    accumulateGate2Attribution(acc, [
      { key: 'sector_alignment', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
      { key: 'momentum', output: { score: 7, status: 'FIRED' } },
    ]);
    expect(acc.get('sector_alignment')!.failed).toBe(1);
    expect(acc.get('momentum')!.passed).toBe(1);
    expect(acc.size).toBe(2);

    const attribution = buildGate2FreshAttribution({
      buckets: Array.from(acc.values()),
      candidates: 50,
      gate1Pass: 10,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
    });
    expect(attribution.gate1Pass).toBe(10);
    expect(attribution.gate2Pass).toBe(0);
  });

  it('2. DATA_UNAVAILABLE 은 failed 로 세지 않는다 (핵심 불변식 #3, ADR-0416 정합)', () => {
    const acc = new Map<string, Gate2BlockerBucket>();
    accumulateGate2Attribution(acc, [
      { key: 'supply_confluence', output: { score: 0, status: 'DATA_UNAVAILABLE' } },
      { key: 'earnings_quality', output: null, context: { hadRequiredData: false } },
    ]);
    const supply = acc.get('supply_confluence')!;
    const earnings = acc.get('earnings_quality')!;
    expect(supply.failed).toBe(0);
    expect(supply.unavailable).toBe(1);
    expect(earnings.failed).toBe(0);
    expect(earnings.unavailable).toBe(1);
  });

  it('3. STALE 은 진짜 failed 와 분리해 표시한다 (핵심 불변식 #4)', () => {
    const acc = new Map<string, Gate2BlockerBucket>();
    accumulateGate2Attribution(acc, [
      { key: 'sector_alignment', output: { score: 0, status: 'PROVIDER_DEGRADED', detail: 'sectorEnergy STALE — validSectorCount=11/12' } },
      { key: 'sector_alignment', output: { score: 0, status: 'PROVIDER_DEGRADED', detail: 'dataQuality=STALE' } },
      { key: 'sector_alignment', output: { score: 0, status: 'THRESHOLD_NOT_MET' } },
      { key: 'sector_alignment', output: { score: 0, status: 'PROVIDER_DEGRADED', detail: 'partial coverage — gracefully degraded' } },
    ]);
    const sa = acc.get('sector_alignment')!;
    expect(sa.stale).toBe(2);
    expect(sa.failed).toBe(1);
    expect(sa.unavailable).toBe(1); // PROVIDER_DEGRADED + non-STALE → unavailable
    expect(sa.total).toBe(4);
  });

  it('4. topFailedCondition / topUnavailableCondition / topErrorCondition / topStale / topWait', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('momentum_quality'), failed: 8, total: 10 },
      { ...emptyBucket('supply_confluence'), unavailable: 7, total: 7 },
      { ...emptyBucket('earnings_quality'), error: 3, total: 3 },
      { ...emptyBucket('sector_alignment'), stale: 6, total: 6 },
      { ...emptyBucket('pre_breakout_pattern'), wait: 5, total: 5 },
    ];
    const attribution = buildGate2FreshAttribution({
      buckets,
      candidates: 50,
      gate1Pass: 10,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
    });
    expect(attribution.topFailedCondition?.conditionKey).toBe('momentum_quality');
    expect(attribution.topUnavailableCondition?.conditionKey).toBe('supply_confluence');
    expect(attribution.topErrorCondition?.conditionKey).toBe('earnings_quality');
    expect(attribution.topStaleCondition?.conditionKey).toBe('sector_alignment');
    expect(attribution.topWaitCondition?.conditionKey).toBe('pre_breakout_pattern');
  });

  it('5. SECTOR_DATA_STALE_DOMINANT 진단 — stale 비율 > 0.4 또는 sectorEnergy.isStale', () => {
    // (a) stale 비율 우세
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('sector_alignment'), stale: 5, total: 10 }, // 50% stale
      { ...emptyBucket('momentum'), failed: 3, total: 5 },
    ];
    const diag = computeGate2LeadershipDiagnosis({
      buckets,
      gate1Pass: 10,
    });
    // stale 5 / (5 + 3) = 0.625 > 0.4 → SECTOR_DATA_STALE_DOMINANT
    expect(diag).toBe('SECTOR_DATA_STALE_DOMINANT');

    // (b) sectorEnergy.isStale 명시 (stale 비율 부재해도)
    const diagB = computeGate2LeadershipDiagnosis({
      buckets: [{ ...emptyBucket('momentum'), failed: 1, total: 1 }],
      gate1Pass: 10,
      sectorEnergy: { isStale: true, dataQuality: 'STALE' },
    });
    expect(diagB).toBe('SECTOR_DATA_STALE_DOMINANT');
  });

  it('6. DATA_UNAVAILABLE_DOMINANT 진단 — unavailable 비율 > 0.5', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('supply_confluence'), unavailable: 6, total: 10 }, // 60% unavailable
      { ...emptyBucket('momentum'), failed: 2, total: 5 },
    ];
    const diag = computeGate2LeadershipDiagnosis({
      buckets,
      gate1Pass: 10,
    });
    // unavailable 6 / (6 + 2) = 0.75 > 0.5 → DATA_UNAVAILABLE_DOMINANT
    expect(diag).toBe('DATA_UNAVAILABLE_DOMINANT');
  });

  it('7. PRE_BREAKOUT_WAIT_DOMINANT 진단 — preBreakoutWait/gate1Pass > 0.5', () => {
    const blockReasons: Gate2BlockReasons = {
      gateRecheckMiss: 0,
      preBreakoutWait: 6, // 6 / 10 = 60% > 0.5
      sizingBlocked: 0,
      driftRemove: 0,
    };
    const diag = computeGate2LeadershipDiagnosis({
      buckets: [{ ...emptyBucket('momentum'), failed: 1, total: 5 }],
      gate1Pass: 10,
      blockReasons,
    });
    expect(diag).toBe('PRE_BREAKOUT_WAIT_DOMINANT');
  });

  it('8. TRUE_NO_LEADERSHIP 진단 — failed 비율 > 0.7 + sectorEnergy OK', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 8, total: 10 }, // 80% failed
      { ...emptyBucket('volume_surge'), failed: 2, total: 3 },
    ];
    const diag = computeGate2LeadershipDiagnosis({
      buckets,
      gate1Pass: 10,
      sectorEnergy: { dataQuality: 'OK', isStale: false },
    });
    // failed 10 / 10 = 1.0 > 0.7 → TRUE_NO_LEADERSHIP (sectorEnergy OK)
    expect(diag).toBe('TRUE_NO_LEADERSHIP');
  });

  it('9. /scan_blockers Gate2 섹션 — gate1Pass>0 + gate2Pass=0 시점에만 노출', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('sector_alignment'), stale: 4, total: 10, staleRate: 0.4 },
      { ...emptyBucket('supply_confluence'), unavailable: 3, total: 5, unavailableRate: 0.6 },
    ];
    const attribution = buildGate2FreshAttribution({
      buckets,
      candidates: 50,
      gate1Pass: 10,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
      sectorEnergy: { dataQuality: 'STALE', validSectorCount: 11, expectedSectorCount: 12, isStale: true },
      blockReasons: { gateRecheckMiss: 2, preBreakoutWait: 1, sizingBlocked: 0, driftRemove: 0 },
    });
    const section = formatGate2AttributionSection(attribution);
    expect(section).not.toBeNull();
    expect(section).toContain('Gate2 / Leadership blockers');
    expect(section).toContain('candidates=50');
    expect(section).toContain('gate1Pass=10');
    expect(section).toContain('gate2Pass=0');
    expect(section).toContain('SectorEnergy');
    expect(section).toContain('STALE');
    expect(section).toContain('SECTOR_DATA_STALE_DOMINANT');
    expect(section).toContain('fresh attribution');
    expect(section).toContain('last 7 days');

    // 정상 운영 (gate2Pass>0) 시 미노출
    const normalAttribution = buildGate2FreshAttribution({
      buckets,
      candidates: 50,
      gate1Pass: 10,
      gate2Pass: 5,
      gate3Pass: 3,
      entries: 2,
      lastTriggerPass: 2,
    });
    expect(formatGate2AttributionSection(normalAttribution)).toBeNull();

    // gate1Pass=0 시 미노출 (NO_GATE1_SURVIVORS — ADR-0420 fresh attribution 우선)
    const noSurvivorAttribution = buildGate2FreshAttribution({
      buckets: [],
      candidates: 50,
      gate1Pass: 0,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
    });
    expect(formatGate2AttributionSection(noSurvivorAttribution)).toBeNull();
  });

  it('splits official index absence from breakout momentum failure and preserves shadow leadership', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('breakout_momentum'), failed: 3, total: 3 },
      { ...emptyBucket('earnings_quality'), unavailable: 2, total: 2 },
    ];
    const attribution = buildGate2FreshAttribution({
      buckets,
      candidates: 43,
      gate1Pass: 6,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
      sectorEnergy: buildSectorEnergyDiagnostic({
        dataQuality: 'PARTIAL',
        validSectorCount: 12,
        expectedSectorCount: 12,
        indexCodeCoverage: 0,
        officialIndexCoverage: 0,
        internalProxyCoverage: 1,
        stockBasketCoverage: 1,
        selectedSectorEnergySourceTier: 'KIS_STOCK_BASKET_DERIVED',
        leadershipConfidence: 'SHADOW_ONLY',
        promotionAllowed: false,
        sectorBoostAllowed: false,
        strongBuyAllowed: false,
        shadowLeadershipAllowed: true,
        counterfactualAllowed: true,
      }),
    });

    expect(attribution.leadershipAttribution.blockers).toContain('OFFICIAL_INDEX_UNAVAILABLE');
    expect(attribution.leadershipAttribution.blockers).toContain('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
    expect(attribution.leadershipAttribution.blockers).toContain('BREAKOUT_MOMENTUM_FAIL');
    expect(attribution.leadershipAttribution.officialIndex.status).toBe('UNAVAILABLE');
    expect(attribution.leadershipAttribution.shadowSector.status).toBe('AVAILABLE');
    expect(attribution.leadershipAttribution.final.shadowLeadership).toBe(true);
    expect(attribution.leadershipAttribution.final.liveLeadership).toBe(false);
    expect(attribution.leadershipAttribution.final.noLeadershipReason).toBe('LIVE_PROMOTION_DISABLED_AND_BREAKOUT_NOT_CONFIRMED');

    const section = formatGate2AttributionSection(attribution);
    expect(section).toContain('officialIndex: status=UNAVAILABLE');
    expect(section).toContain('shadowSector: status=AVAILABLE');
    expect(section).toContain('breakoutMomentum: status=NOT_CONFIRMED');
    expect(section).toContain('executionImpact=NONE');
  });

  it('does not keep official coverage blocker when safe official SectorEnergy promotion is allowed', () => {
    const attribution = buildGate2FreshAttribution({
      buckets: [
        { ...emptyBucket('breakout_momentum'), failed: 3, total: 3 },
        { ...emptyBucket('relative_strength'), failed: 1, total: 1 },
      ],
      candidates: 19,
      gate1Pass: 5,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
      sectorEnergy: buildSectorEnergyDiagnostic({
        dataQuality: 'VERIFIED',
        validSectorCount: 12,
        expectedSectorCount: 12,
        indexCodeCoverage: 0.733,
        officialIndexCoverage: 0.733,
        verifiedIndexCodeCoverage: 0.733,
        selectedPromotionMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
        safeOfficialVerifiedCoverage: 1,
        decisionUsesSafeOfficialOnly: true,
        selectedSectorEnergySourceTier: 'OFFICIAL_KIS_SECTOR_INDEX',
        leadershipConfidence: 'VERIFIED',
        promotionAllowed: true,
        sectorBoostAllowed: true,
        strongBuyAllowed: true,
        shadowLeadershipAllowed: true,
        counterfactualAllowed: true,
      }),
    });

    expect(attribution.leadershipAttribution.officialIndex.status).toBe('VERIFIED');
    expect(attribution.leadershipAttribution.officialIndex.blocker).toBe('NONE');
    expect(attribution.leadershipAttribution.blockers).not.toContain('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
    expect(attribution.leadershipAttribution.final.noLeadershipReason).toBe('BREAKOUT_MOMENTUM_NOT_CONFIRMED');
    expect(attribution.leadershipAttribution.final.liveLeadership).toBe(false);
    expect(attribution.leadershipAttribution.final.executionImpact).toBe('NONE');
  });

  it('bridges ADR-0488 SectorEnergyMaster into Gate2 shadow leadership attribution', () => {
    const attribution = buildGate2FreshAttribution({
      buckets: [
        { ...emptyBucket('breakout_momentum'), failed: 3, total: 3 },
        { ...emptyBucket('volume_surge'), failed: 1, total: 1 },
      ],
      candidates: 43,
      gate1Pass: 6,
      gate2Pass: 0,
      gate3Pass: 0,
      entries: 0,
      lastTriggerPass: 0,
      sectorEnergy: {
        dataQuality: 'MISSING',
        selectedSectorEnergySourceTier: 'NONE',
        leadershipConfidence: 'BLOCKED',
        shadowLeadershipAllowed: false,
      },
    });

    const bridged = rebindGate2AttributionToSectorEnergyMasterAdr0488(attribution, {
      generatedAt: '2026-05-23T16:39:00.000Z',
      overallStatus: 'PARTIAL',
      sectorEnergyMaster: {
        generatedAt: '2026-05-23T16:39:00.000Z',
        status: 'PARTIAL',
        records: Array.from({ length: 12 }, (_, index) => ({
          sectorName: `sector-${index}`,
          indexCode: null,
          market: 'KOSPI',
          source: 'INTERNAL',
          normalized: true,
          coverageMetadata: { hasIndexCode: false, aggregateIgnored: false, aliasCandidate: false },
          fetchedAt: null,
          observedAt: '2026-05-23T16:39:00.000Z',
        })),
        mappingDiagnostics: {
          sectorToIndexCode: {},
          indexCodeToSectorName: {},
          missingIndexCodeCount: 12,
          unresolvedSectorNames: [],
          aggregateIgnoredCount: 0,
          aliasMissingCount: 0,
          safeAliasCandidatesCount: 0,
          unsafeAliasCandidatesCount: 0,
          aliasResolvedCount: 0,
          aliasUnsafeCount: 0,
          officialIndexCoverage: 0,
          verifiedIndexCodeCoverage: 0,
          internalGroupedSnapshotCoverage: 100,
          internalGroupedValidSectorCount: 12,
          internalGroupedExpectedSectorCount: 12,
          internalProxyCoverage: 100,
          stockDailyFallbackCoverage: 0,
          unresolvedSectorCount: 12,
          symmetryPassed: true,
          topGaps: [],
        },
        indexCodeCoverageBefore: 0,
        indexCodeCoverageAfter: 100,
        officialIndexCoverage: 0,
        verifiedIndexCodeCoverage: 0,
        internalGroupedSnapshotCoverage: 100,
        internalGroupedValidSectorCount: 12,
        internalGroupedExpectedSectorCount: 12,
        internalProxyCoverage: 100,
        stockDailyFallbackCoverage: 0,
        aliasResolvedCount: 0,
        aliasUnsafeCount: 0,
        unresolvedSectorCount: 12,
        coveragePct: 100,
        fresh: 12,
        stale: 0,
        missing: 0,
        providerError: 0,
        fallbackUsed: 'DIAGNOSTIC_PROXY',
        leadershipConfidence: 'SHADOW_ONLY',
        leadershipBlockReason: 'VERIFIED_INDEX_CODE_COVERAGE_LOW',
        promotionAllowed: false,
        sectorBoostAllowed: false,
        strongBuyAllowed: false,
        shadowLeadershipAllowed: true,
        counterfactualAllowed: true,
        selectedSectorEnergySourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
        reasonCodes: ['OFFICIAL_INDEX_COVERAGE_ZERO', 'INTERNAL_PROXY_AVAILABLE'],
        topMissingSectorNames: [],
        liveExecutionAllowed: false,
        executionImpact: 'NONE',
        operatorApprovalRequired: true,
        officialIndexMasterRecovery: {
          status: 'OFFICIAL_MISSING_REPAIR_REQUIRED',
          sourceOfTruth: 'INTERNAL_PROXY_OR_BASKET',
          selectedSectorEnergySourceTier: 'INTERNAL_GROUPED_SNAPSHOT',
          officialIndexCoverage: 0,
          verifiedIndexCodeCoverage: 0,
          internalGroupedSnapshotCoverage: 100,
          internalGroupedValidSectorCount: 12,
          internalGroupedExpectedSectorCount: 12,
          internalProxyCoverage: 100,
          stockDailyFallbackCoverage: 0,
          requiredVerifiedCoveragePct: 80,
          leadershipConfidence: 'SHADOW_ONLY',
          promotionAllowed: false,
          sectorBoostAllowed: false,
          strongBuyAllowed: false,
          shadowLeadershipAllowed: true,
          counterfactualAllowed: true,
          liveExecutionAllowed: false,
          executionImpact: 'NONE',
          reasonCodes: [],
          nextAction: 'REPAIR_SECTOR_INDEX_MASTER',
        },
        topGaps: [],
        recommendedNextActions: [],
        diagnostics: [],
      },
      supplyUnknownPolicy: {} as never,
      topGaps: [],
      recommendedNextActions: [],
      executionImpact: 'NONE',
      liveExecutionAllowed: false,
      policyPromotionMode: 'SHADOW_ONLY',
      operatorApprovalRequired: true,
      diagnostics: [],
    });

    expect(bridged?.leadershipAttribution.shadowSector.status).toBe('AVAILABLE');
    expect(bridged?.leadershipAttribution.shadowSector.sourceTier).toBe('INTERNAL_GROUPED_SNAPSHOT');
    expect(bridged?.leadershipAttribution.shadowSector.shadowLeadershipAllowed).toBe(true);
    expect(bridged?.leadershipAttribution.shadowSector.confidence).toBe('SHADOW_ONLY');
    expect(bridged?.leadershipAttribution.shadowSector.internalGroupedSnapshotCoverage).toBe(1);
    expect(bridged?.leadershipAttribution.shadowSector.internalGroupedValidSectorCount).toBe(12);
    expect(bridged?.leadershipAttribution.shadowSector.internalProxyCoverage).toBe(1);
    expect(bridged?.leadershipAttribution.final.shadowLeadership).toBe(true);
    expect(bridged?.leadershipAttribution.final.liveLeadership).toBe(false);
    expect(bridged?.leadershipAttribution.officialIndex.status).toBe('UNAVAILABLE');
    expect(bridged?.leadershipAttribution.officialIndex.blocker).toBe('OFFICIAL_INDEX_UNAVAILABLE');
    expect(bridged?.leadershipAttribution.blockers).toContain('OFFICIAL_INDEX_COVERAGE_BELOW_THRESHOLD');
    expect(bridged?.leadershipAttribution.blockers).toContain('BREAKOUT_MOMENTUM_FAIL');

    const section = formatGate2AttributionSection(bridged);
    expect(section).toContain('shadowSector: status=AVAILABLE sourceTier=INTERNAL_GROUPED_SNAPSHOT');
    expect(section).toContain('confidence=SHADOW_ONLY');
    expect(section).toContain('internalGroupedSnapshotCoverage=100.0%');
    expect(section).toContain('groupedValidSectorCount=12/12');
    expect(section).toContain('counterfactualAllowed=true');
    expect(section).toContain('liveLeadership=false shadowLeadership=true');
    expect(section).toContain('executionImpact=NONE');
  });
});

describe('ADR-0422 §E 결정 트리 분기 SSOT', () => {
  it('NO_GATE1_SURVIVORS — gate1Pass=0', () => {
    const diag = computeGate2LeadershipDiagnosis({
      buckets: [{ ...emptyBucket('momentum'), failed: 5, total: 5 }],
      gate1Pass: 0,
    });
    expect(diag).toBe('NO_GATE1_SURVIVORS');
  });

  it('UNKNOWN — totalRelevant=0 + sectorEnergy 부재', () => {
    const diag = computeGate2LeadershipDiagnosis({
      buckets: [{ ...emptyBucket('momentum'), passed: 10, total: 10 }],
      gate1Pass: 10,
    });
    expect(diag).toBe('UNKNOWN');
  });

  it('UNKNOWN → SECTOR_DATA_STALE_DOMINANT — totalRelevant=0 + sectorEnergy.isStale=true', () => {
    const diag = computeGate2LeadershipDiagnosis({
      buckets: [{ ...emptyBucket('momentum'), passed: 5, total: 5 }],
      gate1Pass: 10,
      sectorEnergy: { isStale: true },
    });
    expect(diag).toBe('SECTOR_DATA_STALE_DOMINANT');
  });

  it('GATE_RECHECK_DOMINANT — gateRecheckMiss/gate1Pass > 0.5', () => {
    const diag = computeGate2LeadershipDiagnosis({
      buckets: [{ ...emptyBucket('momentum'), failed: 2, total: 5 }],
      gate1Pass: 10,
      blockReasons: { gateRecheckMiss: 6, preBreakoutWait: 0, sizingBlocked: 0, driftRemove: 0 },
    });
    expect(diag).toBe('GATE_RECHECK_DOMINANT');
  });

  it('EVALUATOR_ERROR_DOMINANT — error 비율 > 0.3', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('earnings_quality'), error: 4, total: 4 },
      { ...emptyBucket('momentum'), failed: 1, total: 5 },
      { ...emptyBucket('supply_confluence'), unavailable: 1, total: 1 },
    ];
    // error 4 / (4 + 1 + 1) = 0.667 > 0.3
    const diag = computeGate2LeadershipDiagnosis({
      buckets,
      gate1Pass: 10,
    });
    expect(diag).toBe('EVALUATOR_ERROR_DOMINANT');
  });

  it('MIXED — 어느 임계도 미충족', () => {
    const buckets: Gate2BlockerBucket[] = [
      { ...emptyBucket('momentum'), failed: 3, total: 10 },
      { ...emptyBucket('supply_confluence'), unavailable: 3, total: 10 },
      { ...emptyBucket('earnings_quality'), error: 2, total: 10 },
      { ...emptyBucket('sector_alignment'), stale: 1, total: 10 },
    ];
    const diag = computeGate2LeadershipDiagnosis({
      buckets,
      gate1Pass: 20,
    });
    // failed 3/9 = 0.33, unavailable 3/9 = 0.33, error 2/9 = 0.22, stale 1/9 = 0.11
    expect(diag).toBe('MIXED');
  });
});

describe('ADR-0422 헬퍼 함수 SSOT 검증', () => {
  it('detailIndicatesStale 가 STALE 패턴을 검출한다', () => {
    expect(detailIndicatesStale(undefined)).toBe(false);
    expect(detailIndicatesStale('')).toBe(false);
    expect(detailIndicatesStale('sectorEnergy STALE — validSectorCount=11')).toBe(true);
    expect(detailIndicatesStale('dataQuality=STALE')).toBe(true);
    expect(detailIndicatesStale('dataQuality: STALE')).toBe(true);
    expect(detailIndicatesStale('stale')).toBe(true); // case-insensitive 정합
    expect(detailIndicatesStale('threshold not met — score=0.3')).toBe(false);
    expect(detailIndicatesStale('PROVIDER_DEGRADED — partial data')).toBe(false);
  });

  it('finalizeGate2BucketRates 가 *Rate 필드 후처리한다', () => {
    const b: Gate2BlockerBucket = {
      ...emptyBucket('test'),
      failed: 4,
      unavailable: 2,
      error: 1,
      stale: 2,
      wait: 1,
      total: 10,
    };
    finalizeGate2BucketRates(b);
    expect(b.failedRate).toBe(0.4);
    expect(b.unavailableRate).toBe(0.2);
    expect(b.errorRate).toBe(0.1);
    expect(b.staleRate).toBe(0.2);
    expect(b.waitRate).toBe(0.1);

    const empty = emptyBucket('empty');
    finalizeGate2BucketRates(empty);
    expect(empty.failedRate).toBe(0);
  });

  it('GATE2_DIAGNOSIS_THRESHOLDS SSOT 정합', () => {
    expect(GATE2_DIAGNOSIS_THRESHOLDS.STALE_DOMINANT_RATIO).toBe(0.4);
    expect(GATE2_DIAGNOSIS_THRESHOLDS.UNAVAILABLE_DOMINANT_RATIO).toBe(0.5);
    expect(GATE2_DIAGNOSIS_THRESHOLDS.ERROR_DOMINANT_RATIO).toBe(0.3);
    expect(GATE2_DIAGNOSIS_THRESHOLDS.WAIT_DOMINANT_RATIO).toBe(0.5);
    expect(GATE2_DIAGNOSIS_THRESHOLDS.GATE_RECHECK_DOMINANT_RATIO).toBe(0.5);
    expect(GATE2_DIAGNOSIS_THRESHOLDS.TRUE_FAIL_DOMINANT_RATIO).toBe(0.7);
  });

  it('buildSectorEnergyDiagnostic 가 isStale 을 정확히 분류한다', () => {
    expect(buildSectorEnergyDiagnostic({ dataQuality: 'OK' }).isStale).toBe(false);
    expect(buildSectorEnergyDiagnostic({ dataQuality: 'STALE' }).isStale).toBe(true);
    expect(buildSectorEnergyDiagnostic({ dataQuality: 'DEGRADED' }).isStale).toBe(true);
    expect(buildSectorEnergyDiagnostic({ dataQuality: 'FAILED' }).isStale).toBe(true);
    expect(buildSectorEnergyDiagnostic({ dataQuality: 'PARTIAL' }).isStale).toBe(false);
    expect(buildSectorEnergyDiagnostic({}).isStale).toBe(false);

    const diag = buildSectorEnergyDiagnostic({
      dataQuality: 'STALE',
      validSectorCount: 11,
      expectedSectorCount: 12,
      reasons: ['indexCode missing for sector A', 'symmetry validation failed'],
      indexCodeCoverage: 0.917,
    });
    expect(diag.isStale).toBe(true);
    expect(diag.validSectorCount).toBe(11);
    expect(diag.expectedSectorCount).toBe(12);
    expect(diag.reason).toContain('indexCode missing');
    expect(diag.indexCodeCoverage).toBe(0.917);
  });

  it('describeGate2Diagnosis 가 모든 분기에 가이드를 반환한다', () => {
    const all = [
      'TRUE_NO_LEADERSHIP',
      'SECTOR_DATA_STALE_DOMINANT',
      'DATA_UNAVAILABLE_DOMINANT',
      'EVALUATOR_ERROR_DOMINANT',
      'PRE_BREAKOUT_WAIT_DOMINANT',
      'GATE_RECHECK_DOMINANT',
      'MIXED',
      'NO_GATE1_SURVIVORS',
      'UNKNOWN',
    ] as const;
    for (const d of all) {
      const guide = describeGate2Diagnosis(d);
      expect(guide).toBeTruthy();
      expect(typeof guide).toBe('string');
    }
  });

  it('SECTOR_DATA_STALE_DOMINANT 가이드는 ADR-0423 후속 PR 명시', () => {
    const guide = describeGate2Diagnosis('SECTOR_DATA_STALE_DOMINANT');
    expect(guide).toContain('sector data');
    expect(guide).toContain('ADR-0423');
  });
});

describe('ADR-0422 매매 정책 변경 0 — 진단 only', () => {
  it('SSOT 모듈은 매매 결정 / 임계 / Gate threshold 변경 코드 없음', () => {
    const src = readFileSync('server/trading/signalScanner/gate2LeadershipAttribution.ts', 'utf8');
    // 매매 결정 함수 호출 없음
    expect(src).not.toMatch(/placeKisOrder|placeKisMarketBuyOrder|placeKisSellOrder/);
    expect(src).not.toMatch(/setGateThreshold|setMinGateScore/);
    // Gate2 임계 변경 권고 문구 없음 (사용자 명시 §E)
    expect(src).not.toMatch(/Gate threshold 완화|threshold 낮추기|MIN_GATE.*완화/);
  });

  it('describeGate2Diagnosis 메시지에 "매매 정책 변경" 권고 없음', () => {
    const all = [
      'TRUE_NO_LEADERSHIP',
      'SECTOR_DATA_STALE_DOMINANT',
      'DATA_UNAVAILABLE_DOMINANT',
      'EVALUATOR_ERROR_DOMINANT',
      'PRE_BREAKOUT_WAIT_DOMINANT',
      'GATE_RECHECK_DOMINANT',
      'MIXED',
      'NO_GATE1_SURVIVORS',
      'UNKNOWN',
    ] as const;
    for (const d of all) {
      const guide = describeGate2Diagnosis(d) || '';
      // SECTOR_DATA_STALE_DOMINANT 는 "Gate2 완화 전 sector data 점검 우선" 표현 — 완화 *권고* 아님
      expect(guide).not.toMatch(/즉시 Gate2 완화|MIN_GATE 임계 낮추기/);
    }
  });
});

describe('ADR-0422 buyListLoop wiring 정적 가드', () => {
  it('buyListLoop.ts 가 accumulateGate2ConditionOutputs 를 import + Gate1 survivor 분기 호출', () => {
    const src = readFileSync('server/trading/signalScanner/perSymbol/buyListLoop.ts', 'utf8');
    expect(src).toMatch(/accumulateGate2ConditionOutputs/);
    expect(src).toMatch(/isGate1Survivor/);
    expect(src).toMatch(/ge2\?\.gate1Passed === true/);
    const forbiddenFallback = new RegExp('gateScore.*5\\\\.0|stock\\\\.gateScore >=' + ' 5');
    expect(src).not.toMatch(forbiddenFallback);
    // try/catch 격리 — Gate2 attribution 실패 시 매수 흐름 차단 안 함
    expect(src).toMatch(/Adr0422Gate2Attribution.*accumulate 실패/);
  });

  it('scanDiagnostics.ts persistScanResults 가 gate1Pass>0 시점에만 freshGate2Attribution 영속', () => {
    const src = readFileSync('server/trading/signalScanner/scanDiagnostics.ts', 'utf8');
    expect(src).toMatch(/freshGate2Attribution/);
    expect(src).toMatch(/buildGate2FreshAttribution/);
    expect(src).toMatch(/buildSectorEnergyDiagnostic/);
    expect(src).toMatch(/formatGate2AttributionSection/);
    // gate1Pass>0 트리거 가드
    expect(src).toMatch(/counters\.gate1Pass\s*>\s*0/);
  });
});

describe('ADR-0422 안전 invariant — STALE 분리 회귀 가드', () => {
  it('PROVIDER_DEGRADED + STALE detail 은 stale 카운터로 분리 (ADR-0388 정합)', () => {
    const acc = new Map<string, Gate2BlockerBucket>();
    accumulateGate2Attribution(acc, [
      { key: 'sector_alignment', output: { score: 0, status: 'PROVIDER_DEGRADED', detail: 'sectorEnergy STALE — validSectorCount=11/12' } },
    ]);
    const sa = acc.get('sector_alignment')!;
    expect(sa.stale).toBe(1);
    expect(sa.failed).toBe(0);
    expect(sa.unavailable).toBe(0);
    expect(sa.error).toBe(0);
  });

  it('waitMarker 우선 — output.status 와 별개로 wait 분류', () => {
    const acc = new Map<string, Gate2BlockerBucket>();
    accumulateGate2Attribution(acc, [
      { key: 'pre_breakout_pattern', output: { score: 0, status: 'THRESHOLD_NOT_MET' }, waitMarker: true },
    ]);
    const pb = acc.get('pre_breakout_pattern')!;
    expect(pb.wait).toBe(1);
    expect(pb.failed).toBe(0); // status 무시 — wait 우선
  });

  it('output null + hadRequiredData=false → unavailable (ADR-0418 정합)', () => {
    const acc = new Map<string, Gate2BlockerBucket>();
    accumulateGate2Attribution(acc, [
      { key: 'supply_confluence', output: null, context: { evaluatorKey: 'supply_confluence', hadRequiredData: false } },
    ]);
    const sc = acc.get('supply_confluence')!;
    expect(sc.unavailable).toBe(1);
    expect(sc.failed).toBe(0);
  });
});
