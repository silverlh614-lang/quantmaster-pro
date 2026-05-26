import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildAdr0488ObservationRows,
  buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
  buildSectorEnergyMasterReportAdr0488,
  buildSupplyUnknownPolicyReportAdr0488,
  classifySupplyUnknownRootCauseAdr0488,
  collectOperatorActionSourcesFromAdr0488,
  formatRuntimePipelineAdr0488EvidenceLine,
  formatSectorEnergySupplyUnknownCompactAdr0488,
  getSectorEnergySupplyUnknownDetailRegistryEntryAdr0488,
  safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488,
} from './sectorEnergyMasterSupplyUnknownPolicyAdr0488.js';
import { buildOperatorActionQueueAdr0480 } from './operatorActionRouterAdr0480.js';
import { buildGate1DryRunObservationRows } from './gate1DryRunObservationLedgerAdr0476.js';

const modulePath = path.resolve('server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts');
const moduleSrc = () => fs.readFileSync(modulePath, 'utf-8');

function diag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    indexCodeCoverageBefore: 27.5,
    indexCodeCoverageAfterAliasCandidate: 42,
    missingIndexCodeCount: 3,
    aggregateIgnoredCount: 1,
    aliasMissingCount: 2,
    aliasCandidateCount: 4,
    unsafeAliasCandidateCount: 0,
    fallbackUsed: 'STOCK_DAILY',
    dataQuality: 'DEGRADED',
    ...overrides,
  };
}

function penaltyReport(overrides: Record<string, unknown> = {}) {
  return {
    originalPenaltyAvg: 23,
    dedupedPenaltyAvg: 10,
    removedPenaltyAvg: 13,
    originalNetScoreAvg: 21.4,
    dedupedNetScoreAvg: 34.4,
    survivorsAfterDedup: 0,
    unknownPenaltyAvg: 10,
    executionImpact: 'NONE',
    ...overrides,
  } as any;
}

function finalCalibration(overrides: Record<string, unknown> = {}) {
  return {
    currentRequiredScore: 70,
    bestRepairedNetAvg: 56.7,
    unknownDiagnosticNetAvg: 69.7,
    providerRecoveryGuard: {
      providerHealth: 'DEGRADED',
      unknownPolicyActive: true,
      shouldAutoDisableUnknownPolicy: false,
      warningIfOverridePersists: true,
      message: 'provider issue diagnostic only',
    },
    unknownPolicyScenarios: [
      {
        scenario: 'CURRENT_RETAIN_10',
        pointPenaltyAvg: 10,
        netScoreAvg: 56.7,
        gate1Survivors: 0,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
      {
        scenario: 'UNKNOWN_DIAGNOSTIC_ONLY',
        pointPenaltyAvg: 0,
        netScoreAvg: 69.7,
        gate1Survivors: 4,
        executionImpact: 'NONE',
        survivorExamples: [{ symbol: '005930', beforeScore: 56.7, afterScore: 69.7, requiredScore: 70, reason: ['SUPPLY_UNKNOWN_DIAGNOSTIC_ONLY'] }],
      },
      {
        scenario: 'UNKNOWN_TO_CONFIDENCE_DOWNGRADE',
        pointPenaltyAvg: 0,
        netScoreAvg: 67.1,
        gate1Survivors: 2,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
      {
        scenario: 'UNKNOWN_TO_SIZING_ONLY',
        pointPenaltyAvg: 0,
        netScoreAvg: 68.3,
        gate1Survivors: 3,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
      {
        scenario: 'BEARISH_ONLY_SUPPLY_PENALTY',
        pointPenaltyAvg: 10,
        netScoreAvg: 56.7,
        gate1Survivors: 0,
        executionImpact: 'NONE',
        survivorExamples: [],
      },
    ],
    liveExecutionAllowed: false,
    executionImpact: 'NONE',
    ...overrides,
  } as any;
}

describe('ADR-0488 SectorEnergy master + supply UNKNOWN policy', () => {
  it('returns DATA_UNAVAILABLE with executionImpact NONE when sector master source is missing', () => {
    const report = buildSectorEnergyMasterReportAdr0488({ generatedAt: '2026-05-09T00:00:00.000Z' });
    expect(report.status).toBe('DATA_UNAVAILABLE');
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('returns partial/degraded sector evidence with sanitized metadata only', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag(),
      sectorMasterRecords: [
        { sectorName: '반도체', indexCode: 'G1010', market: 'KOSPI', source: 'KRX', rawPayload: { secret: true } },
        { sectorName: '제약', indexCode: null, source: 'CACHE', payload: { secret: true } },
      ],
    });
    expect(['PARTIAL', 'DEGRADED']).toContain(report.status);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(report.records[0]).toMatchObject({ sectorName: '반도체', indexCode: 'G1010', normalized: true });
  });

  it('ignores aggregate rows for leadership mapping', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorMasterRecords: [
        { sectorName: '코스피', indexCode: 'KOSPI', source: 'KRX' },
        { sectorName: '반도체', indexCode: 'G1010', source: 'KRX' },
      ],
    });
    expect(report.records.find((row) => row.sectorName === '코스피')?.coverageMetadata.aggregateIgnored).toBe(true);
    expect(report.mappingDiagnostics.sectorToIndexCode).not.toHaveProperty('코스피');
  });

  it('does not unlock leadership confidence for unsafe alias candidates', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({ unsafeAliasCandidateCount: 2, indexCodeCoverageAfterAliasCandidate: 90, fallbackUsed: 'NONE' }),
    });
    expect(report.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.reasonCodes).toContain('UNSAFE_ALIAS_EXCLUDED_FROM_PROMOTION');
  });

  it('keeps STOCK_DAILY fallback from unlocking SectorEnergy boost or STRONG_BUY', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({ indexCodeCoverageAfterAliasCandidate: 95, missingIndexCodeCount: 0, fallbackUsed: 'STOCK_DAILY' }),
    });
    expect(report.fallbackUsed).toBe('STOCK_DAILY');
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
    expect(report.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.leadershipBlockReason).toBe('VERIFIED_INDEX_CODE_COVERAGE_LOW');
  });

  it('keeps leadership shadow-only when internal proxy coverage is high but verified official index coverage is zero', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        indexCodeCoverageAfterAliasCandidate: 100,
        verifiedIndexCodeCoverage: 0,
        internalProxyCoverage: 100,
        stockDailyFallbackCoverage: 100,
        missingIndexCodeCount: 0,
        aliasMissingCount: 0,
        fallbackUsed: 'NONE',
      }),
    });
    const compact = formatSectorEnergySupplyUnknownCompactAdr0488(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        indexCodeCoverageAfterAliasCandidate: 100,
        verifiedIndexCodeCoverage: 0,
        internalProxyCoverage: 100,
        stockDailyFallbackCoverage: 100,
        missingIndexCodeCount: 0,
        aliasMissingCount: 0,
        fallbackUsed: 'NONE',
      }),
    }));

    expect(report.verifiedIndexCodeCoverage).toBe(0);
    expect(report.internalGroupedSnapshotCoverage).toBe(100);
    expect(report.internalProxyCoverage).toBe(100);
    expect(report.stockDailyFallbackCoverage).toBe(100);
    expect(report.officialIndexMasterRecovery.status).toBe('OFFICIAL_MISSING_REPAIR_REQUIRED');
    expect(report.officialIndexMasterRecovery.sourceOfTruth).toBe('INTERNAL_PROXY_OR_BASKET');
    expect(report.officialIndexMasterRecovery.promotionAllowed).toBe(false);
    expect(report.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(report.selectedSectorEnergySourceTier).toBe('INTERNAL_GROUPED_SNAPSHOT');
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.counterfactualAllowed).toBe(true);
    expect(report.leadershipBlockReason).toBe('VERIFIED_INDEX_CODE_COVERAGE_LOW');
    expect(report.sectorBoostAllowed).toBe(false);
    expect(compact).toContain('verifiedIndexCodeCoverage=0%');
    expect(compact).toContain('internalGroupedSnapshotCoverage=100%');
    expect(compact).toContain('internalProxyCoverage=100%');
    expect(compact).toContain('OfficialIndexMasterRecovery: OFFICIAL_MISSING_REPAIR_REQUIRED');
  });

  it('treats INTERNAL_GROUPED_SNAPSHOT coverage as shadow leadership coverage even when official index coverage is zero', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        indexCodeCoverageAfterAliasCandidate: 100,
        verifiedIndexCodeCoverage: 0,
        internalProxyCoverage: 0,
        stockDailyFallbackCoverage: 0,
        missingIndexCodeCount: 12,
        fallbackUsed: 'NONE',
        groupedSectorEnergy: {
          groupedStatus: 'GROUPED_ENERGY_OK',
          groupedValidSectorCount: 12,
          expectedSectorCount: 12,
        },
      }),
    });

    expect(report.verifiedIndexCodeCoverage).toBe(0);
    expect(report.internalGroupedSnapshotCoverage).toBe(100);
    expect(report.internalGroupedValidSectorCount).toBe(12);
    expect(report.internalGroupedExpectedSectorCount).toBe(12);
    expect(report.internalProxyCoverage).toBe(100);
    expect(report.selectedSectorEnergySourceTier).toBe('INTERNAL_GROUPED_SNAPSHOT');
    expect(report.leadershipConfidence).toBe('SHADOW_ONLY');
    expect(report.promotionAllowed).toBe(false);
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.executionImpact).toBe('NONE');
  });

  it('classifies 50% official coverage as PARTIAL and preserves shadow leadership only', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        dataQuality: 'OK',
        officialIndexCoverage: 50,
        verifiedIndexCodeCoverage: 50,
        missingIndexCodeCount: 6,
        fallbackUsed: 'NONE',
      }),
    });
    expect(report.leadershipConfidence).toBe('PARTIAL');
    expect(report.promotionAllowed).toBe(false);
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.executionImpact).toBe('NONE');
  });

  it('keeps official mapped coverage separate from failed API verification', () => {
    const officialName = 'transport-equipment';
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        dataQuality: 'OK',
        officialIndexCoverage: 50,
        verifiedIndexCodeCoverage: 0,
        internalProxyCoverage: 100,
        missingIndexCodeCount: 6,
        fallbackUsed: 'NONE',
      }),
      officialSectorIndexMaster: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: 24,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        rawSampleRows: [{
          idxDiv: '1',
          idxCode: '0012',
          idxName: officialName,
          rawIdxName: officialName,
          normalizedIdxName: officialName,
          canonicalOfficialName: officialName,
          codePrefixRemoved: false,
        }],
        idxNameSampleTop: [officialName, 'electric-electronics', 'steel-metal'],
        aliasDictionaryStatus: {
          loaded: true,
          aliasCount: 3,
          safeAliasCount: 2,
          unsafeAliasCount: 1,
          sampleAliases: [`AUTOMOTIVE -> ${officialName}`, 'SEMICONDUCTOR -> electric-electronics'],
        },
        officialIndexCoverage: 50,
        verifiedIndexCodeCoverage: 0,
        mappedSectorCount: 6,
        verifiedIndexCodeCount: 0,
        targetSectorCount: 12,
        safeAliasCount: 1,
        unsafeAliasCount: 0,
        aliasResolvedCount: 1,
        internalSectorNames: ['AUTOMOTIVE', 'UNRESOLVED_A'],
        normalizedInternalSectorNames: ['automotive', 'unresolved a'],
        mappedSectorPairs: [`AUTOMOTIVE -> ${officialName}(code=0012)`],
        mappingAttempts: [{
          internalSectorName: 'AUTOMOTIVE',
          normalizedInternalName: 'automotive',
          aliasLookupKey: 'automotive',
          candidateOfficialNames: [officialName],
          exactMatch: false,
          safeAliasMatch: officialName,
          safeAliasTarget: officialName,
          unsafeAliasMatch: null,
          unsafeAliasTargets: [],
          rawOfficialCandidates: [officialName],
          normalizedOfficialCandidates: [officialName],
          canonicalOfficialCandidates: [officialName],
          idxDiv: '1',
          idxCode: '0012',
          rawIdxName: officialName,
          canonicalOfficialName: officialName,
          verifyInputCandidates: ['0012', '10012', '1:0012', '1-0012'],
          selectedOfficialIndexName: officialName,
          selectedOfficialIndexCode: '0012',
          selectedOfficialRawName: officialName,
          selectedOfficialCanonicalName: officialName,
          codePrefixRemoved: false,
          includedInOfficialCoverage: true,
          shadowEvidenceOnly: false,
          verifyAttempted: true,
          verified: false,
          reasonCode: 'SAFE_ALIAS_MATCHED',
        }],
        unresolvedSectorNames: ['UNRESOLVED_A'],
        unresolvedSectorDetails: [{
          sector: 'UNRESOLVED_A',
          normalizedInternalName: 'unresolved a',
          reason: 'EN_TO_KR_ALIAS_MISSING',
          candidateOfficialNames: [],
        }],
        topMissingSectorNames: ['UNRESOLVED_A'],
        verifyApiPath: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
        verifyTrId: 'FHPUP02100000',
        verifySuccessCount: 0,
        verifyFailCount: 6,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['OFFICIAL_INDEX_MASTER_LOADED', 'OFFICIAL_INDEX_API_VERIFY_FAILED'],
        mappingRows: [],
        verificationResults: [],
      },
    });

    expect(report.officialIndexCoverage).toBe(50);
    expect(report.verifiedIndexCodeCoverage).toBe(0);
    expect(report.leadershipConfidence).toBe('PARTIAL');
    expect(report.selectedSectorEnergySourceTier).toBe('INTERNAL_GROUPED_SNAPSHOT');
    expect(report.promotionAllowed).toBe(false);
    expect(report.sectorBoostAllowed).toBe(false);
    expect(report.strongBuyAllowed).toBe(false);
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.officialIndexMasterRecovery.officialIndexCoverage).toBe(50);
    expect(report.officialIndexMasterRecovery.verifiedIndexCodeCoverage).toBe(0);
    expect(report.reasonCodes).toContain('OFFICIAL_INDEX_API_VERIFY_FAILED');
    expect(report.executionImpact).toBe('NONE');
    const compact = formatSectorEnergySupplyUnknownCompactAdr0488(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({ dataQuality: 'OK', officialIndexCoverage: 50, verifiedIndexCodeCoverage: 0, internalProxyCoverage: 100, fallbackUsed: 'NONE' }),
      officialSectorIndexMaster: report.officialSectorIndexMaster,
    }));
    expect(compact).toContain('officialIndexCoverage=50%');
    expect(compact).toContain('verifiedIndexCodeCoverage=0%');
    expect(compact).toContain('promotionAllowed=false');
    expect(compact).toContain('Official Sector Index Master Debug');
    expect(compact).toContain('rawSampleRows=1:0012:raw=transport-equipment:normalized=transport-equipment:canonical=transport-equipment:prefixRemoved=false');
    expect(compact).toContain('EN_KR_AliasDictionaryStatus: loaded=true');
    expect(compact).toContain('SectorIndexMappingAttempt: AUTOMOTIVE:normalized=automotive');
    expect(compact).toContain('safeAliasTarget=transport-equipment');
    expect(compact).toContain('selectedCanonical=transport-equipment');
    expect(compact).toContain('SectorIndexUnresolvedDetails: UNRESOLVED_A:reason=EN_TO_KR_ALIAS_MISSING');
  });

  it('uses safe-official verified coverage for promotion with officialTarget verified coverage kept diagnostic-only', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        dataQuality: 'OK',
        officialIndexCoverage: 73.3,
        verifiedIndexCodeCoverage: 73.3,
        internalGroupedSnapshotCoverage: 100,
        internalGroupedValidSectorCount: 12,
        internalGroupedExpectedSectorCount: 12,
        fallbackUsed: 'NONE',
      }),
      officialSectorIndexMaster: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: 485,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        officialIndexCoverage: 73.3,
        verifiedIndexCodeCoverage: 73.3,
        mappedSectorCount: 11,
        verifiedIndexCodeCount: 11,
        targetSectorCount: 15,
        coverageDenominator: {
          officialTargetSectorCount: 15,
          safePromotionEligibleSectorCount: 11,
          unsafeAliasSectorCount: 4,
          unresolvedSectorCount: 0,
          verifiedSuccessCount: 11,
        },
        coverageMetrics: {
          officialIndexCoverageByOfficialTarget: 73.3,
          verifiedCoverageByOfficialTarget: 73.3,
          verifiedCoverageExcludingUnsafeAlias: 100,
          promotionVerifiedCoverage: 73.3,
        },
        unsafeAliasPolicy: {
          includeInPromotionDenominator: false,
          includeInPromotionNumerator: false,
          useForShadowEvidence: true,
          useForLivePromotion: false,
          useForSectorBoost: false,
          useForStrongBuy: false,
          status: 'EXCLUDED_FROM_OFFICIAL_SECTOR_PROMOTION',
          reason: 'NO_OFFICIAL_SINGLE_SECTOR_INDEX_OR_THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS',
          executionImpact: 'NONE',
        },
        promotionCoveragePolicy: {
          selectedMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
          numerator: 11,
          denominator: 11,
          requiredVerifiedCoverage: 80,
          selectedCoverageValue: 100,
          promotionAllowed: true,
          reason: 'VERIFIED_INDEX_CODE_COVERAGE_READY',
          officialTargetVerifiedCoverageDiagnostic: 73.3,
          decisionUsesSafeOfficialOnly: true,
          executionImpact: 'NONE',
        },
        indexValueQuality: {
          apiVerifiedCount: 11,
          apiTransportSuccessCount: 11,
          indexValueUsableCount: 9,
          zeroCurrentIndexCount: 2,
          nonZeroCurrentIndexCount: 9,
          qualityUsableCount: 9,
          qualityUsableCoverageByOfficialTarget: 60,
          qualityUsableCoverageExcludingUnsafeAlias: 81.8,
          zeroCurrentIndexSymbols: ['화학', '철강'],
          zeroCurrentIndexPolicy: 'OBSERVE_ONLY',
          valueQualityStatus: 'VALUE_QUALITY_ZERO',
          qualityImpact: 'BLOCK_LIVE_PROMOTION_ONLY',
          executionImpact: 'NONE',
        },
        sectorIndexQuality: [
          {
            sectorName: '화학',
            verified: true,
            apiTransportSuccess: true,
            indexValueUsable: false,
            valueQualityStatus: 'VALUE_QUALITY_ZERO',
            currentIndex: 0,
            qualityUsable: false,
            qualityReason: 'CURRENT_INDEX_ZERO',
            useForShadowLeadership: true,
            useForLivePromotion: false,
            executionImpact: 'NONE',
          },
          {
            sectorName: '금융',
            verified: true,
            apiTransportSuccess: true,
            indexValueUsable: true,
            valueQualityStatus: 'USABLE',
            currentIndex: 123.4,
            qualityUsable: true,
            qualityReason: 'OK',
            useForShadowLeadership: true,
            useForLivePromotion: true,
            executionImpact: 'NONE',
          },
        ],
        safeAliasCount: 5,
        unsafeAliasCount: 4,
        unsafeAliasSectorNames: ['조선', '방산', '원자력', '이차전지'],
        aliasResolvedCount: 12,
        unresolvedSectorNames: [],
        topMissingSectorNames: [],
        verifyApiPath: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
        verifyTrId: 'FHPUP02100000',
        verifySuccessCount: 11,
        verifyFailCount: 0,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: ['VERIFIED_INDEX_CODE_COVERAGE_LOW'],
        mappingRows: [],
        verificationResults: [],
      },
    });
    const compact = formatSectorEnergySupplyUnknownCompactAdr0488(report);

    // 보고서 레벨 promotionAllowed 는 이 합성 픽스처의 supply-line(after=42%, PARTIAL) + symmetry 미충족 때문에 false 다.
    // 핵심은 coverage block 이 safe-official 100% 로 해소(promotionCoveragePass=true, reason=READY_FOR_PROMOTION)된 점이다.
    expect(report.sectorEnergyMaster.promotionAllowed).toBe(false);
    expect(report.sectorEnergyMaster.leadershipBlockReason).not.toBe('VERIFIED_INDEX_CODE_COVERAGE_LOW');
    expect(compact).toContain('SectorIndexCoverageDenominator: internalGroupedSectorCount=12 officialTargetSectorCount=15 safePromotionEligibleSectorCount=11 unsafeAliasSectorCount=4 unresolvedSectorCount=0 verifiedSuccessCount=11');
    expect(compact).toContain('CoverageMetrics: officialIndexCoverageByOfficialTarget=73.3% verifiedCoverageByOfficialTarget=73.3% verifiedCoverageByInternalGrouped=91.7% verifiedCoverageExcludingUnsafeAlias=100% promotionVerifiedCoverage=100%');
    expect(compact).toContain('UnsafeAliasPolicy: includeInPromotionDenominator=false includeInPromotionNumerator=false useForShadowEvidence=true useForLivePromotion=false useForSectorBoost=false useForStrongBuy=false status=EXCLUDED_FROM_OFFICIAL_SECTOR_PROMOTION reason=NO_OFFICIAL_SINGLE_SECTOR_INDEX_OR_THEME_TO_OFFICIAL_SECTOR_AMBIGUOUS');
    expect(compact).toContain('SectorIndexPromotionReadiness: officialTargetSectorCount=15 internalGroupedSectorCount=12 safePromotionEligibleSectorCount=11 unsafeAliasSectorCount=4 unresolvedSectorCount=0 verifiedSuccessCount=11');
    expect(compact).toContain('selectedPromotionMetric=SAFE_OFFICIAL_VERIFIED_COVERAGE selectedPromotionCoverage=100% requiredPromotionCoverage=80%');
    expect(compact).toContain('safeOfficialTargetCount=11 safeOfficialVerifiedCount=11 safeOfficialVerifiedCoverage=100% unsafeExcludedCount=4 unsafeExcludedNames=조선,방산,원자력,이차전지 officialTargetVerifiedCoverageDiagnostic=73.3% promotionCoveragePass=true promotionAllowedByCoverage=true decisionUsesSafeOfficialOnly=true');
    expect(compact).toContain('PromotionCoveragePolicy: selectedMetric=SAFE_OFFICIAL_VERIFIED_COVERAGE numerator=11 denominator=11 required=80% selectedCoverageValue=100% coveragePromotionAllowed=true promotionAllowed=false reason=VERIFIED_INDEX_CODE_COVERAGE_READY alternativeInternalGroupedCoverage=91.7% officialTargetVerifiedCoverageDiagnostic=73.3% decisionUsesSafeOfficialOnly=true executionImpact=NONE');
    expect(compact).toContain('OfficialSectorEnergy: selectedPromotionMetric=SAFE_OFFICIAL_VERIFIED_COVERAGE safeOfficialVerifiedCoverage=100% requiredPromotionCoverage=80% unsafeExcluded=조선,방산,원자력,이차전지 officialTargetVerifiedCoverageDiagnostic=73.3% decisionUsesSafeOfficialOnly=true promotionCoveragePass=true executionImpact=NONE');
    expect(compact).toContain('apiTransportSuccess=true:indexValueUsable=false:valueQualityStatus=VALUE_QUALITY_ZERO');
    expect(compact).toContain('IndexValueQuality: apiVerifiedCount=11 currentIndexZeroCount=2 zeroCurrentIndexCount=2 currentIndexNonZeroCount=9 nonZeroCurrentIndexCount=9 qualityUsableCount=9 zeroCurrentIndexSymbols=화학,철강 zeroPolicy=OBSERVE_ONLY qualityImpact=BLOCK_LIVE_PROMOTION_ONLY executionImpact=NONE');
    expect(compact).toContain('SectorIndexQuality: 화학:verified=true:currentIndex=0:qualityUsable=false:qualityReason=CURRENT_INDEX_ZERO:useForShadowLeadership=true:useForLivePromotion=false:executionImpact=NONE');
  });

  it('resolves the coverage block via safe-official coverage (100%) even when officialTarget verified coverage is 73.3% (unsafe alias excluded)', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        dataQuality: 'OK',
        indexCodeCoverageAfterAliasCandidate: 100,
        officialIndexCoverage: 73.3,
        verifiedIndexCodeCoverage: 73.3,
        missingIndexCodeCount: 0,
        aliasMissingCount: 0,
        fallbackUsed: 'NONE',
      }),
      sectorMasterRecords: [
        { sectorName: '전기전자', indexCode: '0005', market: 'KOSPI', source: 'KIS', normalized: true },
        { sectorName: '화학', indexCode: '0006', market: 'KOSPI', source: 'KIS', normalized: true },
        { sectorName: '운송장비', indexCode: '0012', market: 'KOSPI', source: 'KIS', normalized: true },
        { sectorName: '금융업', indexCode: '0018', market: 'KOSPI', source: 'KIS', normalized: true },
      ],
      officialSectorIndexMaster: {
        masterSource: 'OFFICIAL_KIS_IDXCODE_MST',
        masterLoaded: true,
        masterRowCount: 485,
        idxcodeMstDownloaded: true,
        cacheFallbackUsed: false,
        parseStatus: 'OK',
        officialIndexCoverage: 73.3,
        verifiedIndexCodeCoverage: 73.3,
        mappedSectorCount: 11,
        verifiedIndexCodeCount: 11,
        targetSectorCount: 15,
        coverageDenominator: {
          officialTargetSectorCount: 15,
          safePromotionEligibleSectorCount: 11,
          unsafeAliasSectorCount: 4,
          unresolvedSectorCount: 0,
          verifiedSuccessCount: 11,
        },
        coverageMetrics: {
          officialIndexCoverageByOfficialTarget: 73.3,
          verifiedCoverageByOfficialTarget: 73.3,
          verifiedCoverageExcludingUnsafeAlias: 100,
          promotionVerifiedCoverage: 100,
        },
        promotionReadiness: {
          officialTargetSectorCount: 15,
          safePromotionEligibleSectorCount: 11,
          unsafeAliasSectorCount: 4,
          unresolvedSectorCount: 0,
          verifiedSuccessCount: 11,
          qualityUsableCount: 11,
          verifiedCoverageByOfficialTarget: 73.3,
          verifiedCoverageExcludingUnsafeAlias: 100,
          qualityUsableCoverageByOfficialTarget: 73.3,
          qualityUsableCoverageExcludingUnsafeAlias: 100,
          selectedPromotionMetric: 'SAFE_OFFICIAL_VERIFIED_COVERAGE',
          selectedPromotionCoverage: 100,
          requiredPromotionCoverage: 80,
          qualityGatePassed: true,
          promotionAllowed: true,
          reason: 'READY_FOR_PROMOTION',
          safeOnlyMetricWouldPass: true,
          safeOfficialTargetCount: 11,
          safeOfficialVerifiedCount: 11,
          safeOfficialVerifiedCoverage: 100,
          unsafeExcludedCount: 4,
          unsafeExcludedNames: ['조선', '방산', '원자력', '이차전지'],
          officialTargetVerifiedCoverageDiagnostic: 73.3,
          promotionCoveragePass: true,
          promotionAllowedByCoverage: true,
          decisionUsesSafeOfficialOnly: true,
          useAlternativeForLivePromotion: false,
          alternativePolicyReason: 'OFFICIAL_TARGET_POLICY_SELECTED_FOR_SAFETY',
          executionImpact: 'NONE',
        },
        safeAliasCount: 5,
        unsafeAliasCount: 4,
        unsafeAliasSectorNames: ['조선', '방산', '원자력', '이차전지'],
        aliasResolvedCount: 12,
        unresolvedSectorNames: [],
        topMissingSectorNames: [],
        verifyApiPath: '/uapi/domestic-stock/v1/quotations/inquire-index-price',
        verifyTrId: 'FHPUP02100000',
        verifySuccessCount: 11,
        verifyFailCount: 0,
        providerIssue: false,
        marketSignal: false,
        executionImpact: 'NONE',
        reasonCodes: [],
        mappingRows: [],
        verificationResults: [],
      },
    });

    // officialTarget verified=73.3% 는 diagnostic-only 로만 남고, promotion 은 safe-official 100% 로 통과한다.
    expect(report.verifiedIndexCodeCoverage).toBe(73.3);
    expect(report.leadershipBlockReason).toBe('NONE');
    expect(report.promotionAllowed).toBe(true);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.counterfactualAllowed).toBe(true);
  });

  it('classifies verified KIS official coverage at 80%+ as promotion-ready without live execution unlock', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        dataQuality: 'OK',
        indexCodeCoverageAfterAliasCandidate: 100,
        verifiedIndexCodeCoverage: 100,
        missingIndexCodeCount: 0,
        aliasMissingCount: 0,
        fallbackUsed: 'NONE',
      }),
      sectorMasterRecords: [
        { sectorName: '전기전자', indexCode: '0005', market: 'KOSPI', source: 'KIS', normalized: true },
        { sectorName: '화학', indexCode: '0006', market: 'KOSPI', source: 'KIS', normalized: true },
        { sectorName: '운송장비', indexCode: '0012', market: 'KOSPI', source: 'KIS', normalized: true },
        { sectorName: '금융업', indexCode: '0018', market: 'KOSPI', source: 'KIS', normalized: true },
      ],
    });
    expect(report.leadershipConfidence).toBe('VERIFIED');
    expect(report.promotionAllowed).toBe(true);
    expect(report.sectorBoostAllowed).toBe(true);
    expect(report.strongBuyAllowed).toBe(true);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
    expect(report.selectedSectorEnergySourceTier).toBe('OFFICIAL_KIS_SECTOR_INDEX');
    expect(report.officialIndexMasterRecovery.sourceOfTruth).toBe('KIS_OFFICIAL_INDEX_MASTER');
  });

  it('recovers official KIS index master coverage from diagnostic sector rows', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: {
        dataQuality: 'OK',
        fallbackUsed: 'NONE',
        coverageBreakdown: {
          sectorRows: [
            { sectorName: 'SEMICONDUCTOR', sectorCode: '2004', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
            { sectorName: 'BATTERY', sectorCode: '2012', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
            { sectorName: 'FINANCE', sectorCode: '0021', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
            { sectorName: 'IT_INTERNET', sectorCode: '0029', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
          ],
        },
      },
    });

    expect(report.verifiedIndexCodeCoverage).toBe(100);
    expect(report.mappingDiagnostics.verifiedIndexCodeCoverage).toBe(100);
    expect(report.selectedSectorEnergySourceTier).toBe('OFFICIAL_KIS_SECTOR_INDEX');
    expect(report.leadershipConfidence).toBe('VERIFIED');
    expect(report.promotionAllowed).toBe(true);
    expect(report.sectorBoostAllowed).toBe(true);
    expect(report.strongBuyAllowed).toBe(true);
    expect(report.executionImpact).toBe('NONE');
    expect(report.reasonCodes).toContain('OFFICIAL_KIS_INDEX_MASTER_LOADED');
    const compact = formatSectorEnergySupplyUnknownCompactAdr0488(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: {
        dataQuality: 'OK',
        fallbackUsed: 'NONE',
        coverageBreakdown: {
          sectorRows: [
            { sectorName: 'SEMICONDUCTOR', sectorCode: '2004', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
            { sectorName: 'BATTERY', sectorCode: '2012', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
            { sectorName: 'FINANCE', sectorCode: '0021', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
            { sectorName: 'IT_INTERNET', sectorCode: '0029', market: 'KOSPI', sourceTier: 'OFFICIAL_KIS_SECTOR_INDEX' },
          ],
        },
      },
    }));
    expect(compact).toContain('officialIndexCoverage=100%');
    expect(compact).toContain('selectedSourceTier=OFFICIAL_KIS_SECTOR_INDEX');
  });

  it('keeps stale official sector index out of promotion but preserves shadow leadership when proxy exists', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag({
        dataQuality: 'STALE',
        indexCodeCoverageAfterAliasCandidate: 100,
        verifiedIndexCodeCoverage: 100,
        internalProxyCoverage: 100,
        missingIndexCodeCount: 0,
        aliasMissingCount: 0,
        fallbackUsed: 'NONE',
      }),
    });
    expect(report.leadershipConfidence).toBe('PARTIAL');
    expect(report.leadershipBlockReason).toBe('SECTOR_INDEX_STALE');
    expect(report.promotionAllowed).toBe(false);
    expect(report.shadowLeadershipAllowed).toBe(true);
    expect(report.executionImpact).toBe('NONE');
  });

  it('computes indexCode coverage percentage', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorMasterRecords: [
        { sectorName: 'A', indexCode: 'A1' },
        { sectorName: 'B', indexCode: null },
      ],
    });
    expect(report.coveragePct).toBe(50);
  });

  it('counts missing indexCode values', () => {
    const report = buildSectorEnergyMasterReportAdr0488({ sectorMasterRecords: [{ sectorName: 'A' }, { sectorName: 'B' }] });
    expect(report.mappingDiagnostics.missingIndexCodeCount).toBe(2);
  });

  it('checks sectorName to indexCode symmetry and reports unresolved names', () => {
    const report = buildSectorEnergyMasterReportAdr0488({
      sectorMasterRecords: [{ sectorName: 'A', indexCode: 'A1' }, { sectorName: 'B' }],
    });
    expect(report.mappingDiagnostics.symmetryPassed).toBe(false);
    expect(report.mappingDiagnostics.unresolvedSectorNames).toContain('B');
  });

  it('classifies provider-side UNKNOWN as provider issue and not market signal', () => {
    const classification = classifySupplyUnknownRootCauseAdr0488({ providerIssue: true, marketSignal: false, providerStatus: 'UNKNOWN' });
    expect(classification.providerIssue).toBe(true);
    expect(classification.marketSignal).toBe(false);
    expect(classification.rootCause).toBe('SUPPLY_PROVIDER_UNKNOWN');
  });

  it('collapses duplicate SUPPLY_UNKNOWN penalties into one root cause group for dry-run', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({
      providerIssue: true,
      marketSignal: false,
      providerStatus: 'DATA_UNAVAILABLE',
      penaltyDeduplicationAdr0469: penaltyReport(),
      finalGate1CalibrationAdr0471: finalCalibration(),
    });
    expect(report.classification.duplicatePenaltyGroupCollapsed).toBe(true);
    expect(report.dedupedPenaltyAvg).toBe(10);
    expect(report.removedPenaltyAvg).toBe(13);
  });

  it('keeps requiredScore at 70 and live execution false', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, finalGate1CalibrationAdr0471: finalCalibration() });
    expect(report.requiredScore).toBe(70);
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.executionImpact).toBe('NONE');
  });

  it('marks dry-run survivors as shadow/counterfactual only', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, finalGate1CalibrationAdr0471: finalCalibration() });
    const unknown = report.dryRunVariants.find((row) => row.variant === 'UNKNOWN_DIAGNOSTIC_ONLY');
    expect(unknown?.survivors).toBe(4);
    expect(unknown?.shadowOnly).toBe(true);
    expect(unknown?.operatorApprovalRequired).toBe(true);
  });

  it('disables UNKNOWN diagnostic relaxation when provider becomes VERIFIED', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, providerStatus: 'VERIFIED', finalGate1CalibrationAdr0471: finalCalibration() });
    expect(report.status).toBe('VERIFIED_DISABLED');
    expect(report.unknownPolicyActive).toBe(false);
    expect(report.providerVerifiedOverrideWarning).toBe(true);
  });

  it('emits requested audit averages and survivor counts', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({
      providerIssue: true,
      marketSignal: false,
      penaltyDeduplicationAdr0469: penaltyReport(),
      finalGate1CalibrationAdr0471: finalCalibration(),
    });
    expect(report.originalPenaltyAvg).toBe(23);
    expect(report.dedupedPenaltyAvg).toBe(10);
    expect(report.diagnosticPolicyNetAvg).toBe(69.7);
    expect(report.survivorsUnknownDiagnosticOnly).toBe(4);
  });

  it('builds a combined report with compact ADR-0488 evidence', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      sectorEnergyDiagnosticAdr0474: diag(),
      providerIssue: true,
      marketSignal: false,
      finalGate1CalibrationAdr0471: finalCalibration(),
      penaltyDeduplicationAdr0469: penaltyReport(),
    });
    const compact = formatSectorEnergySupplyUnknownCompactAdr0488(report);
    expect(compact).toContain('ADR-0488 SectorEnergyMaster');
    expect(compact).toContain('ADR-0488 SupplyUnknownPolicy');
  });

  it('adds ADR-0488 observation rows to ADR-0476 ledger builder', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({
      generatedAt: '2026-05-09T00:00:00.000Z',
      sectorEnergyDiagnosticAdr0474: diag(),
      providerIssue: true,
      marketSignal: false,
      finalGate1CalibrationAdr0471: finalCalibration(),
    });
    const rows = buildGate1DryRunObservationRows({ forDate: '2026-05-09', sectorEnergySupplyUnknownAdr0488: report });
    expect(rows.some((row) => row.source === 'ADR_0488_SECTOR_ENERGY_MASTER_SUPPLY_LINE')).toBe(true);
    expect(rows.some((row) => row.source === 'ADR_0488_SUPPLY_UNKNOWN_POLICY_STABILIZATION')).toBe(true);
  });

  it('builds sanitized standalone ADR-0488 observation rows', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    const rows = buildAdr0488ObservationRows(report);
    expect(JSON.stringify(rows)).not.toContain('rawPayload');
    expect(rows.every((row) => row.executionImpact === 'NONE' && row.liveExecutionAllowed === false)).toBe(true);
  });

  it('creates operator action evidence for sector repair and supply UNKNOWN observe', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    const queue = buildOperatorActionQueueAdr0480({ sectorEnergySupplyUnknownAdr0488: report });
    expect(queue.dedupedRootCauses).toContain('REPAIR_SECTOR_INDEX_MASTER');
    expect(queue.dedupedRootCauses).toContain('IMPROVE_INDEX_CODE_COVERAGE');
    expect(queue.dedupedRootCauses).toContain('SUPPLY_UNKNOWN_POLICY_OBSERVE');
    expect(queue.dedupedRootCauses).toContain('COLLECT_SUPPLY_SAMPLE_BEFORE_PROMOTION');
  });

  it('collects ADR-0488 operator action source codes', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    const codes = collectOperatorActionSourcesFromAdr0488(report).map((source) => source.code);
    expect(codes).toContain('REPAIR_SECTOR_INDEX_MASTER');
    expect(codes).toContain('SUPPLY_UNKNOWN_POLICY_OBSERVE');
  });

  it('exposes ADR-0488 detail registry trace', () => {
    const entry = getSectorEnergySupplyUnknownDetailRegistryEntryAdr0488(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488());
    expect(entry.adrTraceHint).toBe('/adr_trace 0488');
    expect(entry.commandHint).toBe('/fresh_data_status');
  });

  it('emits Runtime Pipeline Audit ADR-0488 evidence', () => {
    const line = formatRuntimePipelineAdr0488EvidenceLine(buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false }));
    expect(line).toContain('ADR-0488');
    expect(line).toContain('diagnosticOnly=true');
    expect(line).toContain('executionImpact=NONE');
  });

  it('keeps policy promotion SHADOW_ONLY with operator approval', () => {
    const report = buildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ sectorEnergyDiagnosticAdr0474: diag(), providerIssue: true, marketSignal: false });
    expect(report.policyPromotionMode).toBe('SHADOW_ONLY');
    expect(report.operatorApprovalRequired).toBe(true);
  });

  it('try/catch isolates ADR-0488 builder failures', () => {
    const report = safeBuildSectorEnergyAndSupplyUnknownPolicyReportAdr0488({ throwForTest: true });
    expect(report.executionImpact).toBe('NONE');
    expect(report.liveExecutionAllowed).toBe(false);
    expect(report.diagnostics.join(' ')).toContain('isolated');
  });

  it('wires ADR-0488 through ScanSummary source and scan blockers command', () => {
    const scanDiagnostics = fs.readFileSync(path.resolve('server/trading/signalScanner/scanDiagnostics.ts'), 'utf-8');
    const scanBlockers = fs.readFileSync(path.resolve('server/telegram/commands/system/scanBlockers.cmd.ts'), 'utf-8');
    expect(scanDiagnostics).toContain('sectorEnergySupplyUnknownAdr0488');
    expect(scanBlockers).toContain('formatSectorEnergySupplyUnknownCompactAdr0488');
  });

  it('wires ADR-0488 through Runtime Pipeline Audit and /fresh_data_status', () => {
    const runtimeAudit = fs.readFileSync(path.resolve('server/diagnostics/runtimePipelineAudit.ts'), 'utf-8');
    const freshDataStatus = fs.readFileSync(path.resolve('server/telegram/commands/system/freshDataStatus.cmd.ts'), 'utf-8');
    expect(runtimeAudit).toContain('formatRuntimePipelineAdr0488EvidenceLine');
    expect(freshDataStatus).toContain('formatSectorEnergySupplyUnknownDetailAdr0488');
  });

  it('does not import KIS order or live execution modules', () => {
    const src = moduleSrc();
    expect(src).not.toMatch(/kisOrder|orderExecutor|trancheExecutor|autoTradeEngine|createLiveOrder/i);
  });

  it('does not allow raw payload persistence', () => {
    const src = moduleSrc();
    expect(src).not.toContain('rawPayloadPersistenceAllowed: true');
    expect(src).not.toContain('rawPayload:');
  });

  it('does not mutate requiredScore or Gate/Kelly policy', () => {
    const src = moduleSrc();
    expect(src).not.toMatch(/setRequiredScore|requiredScoreOverride|currentRequiredScore\s*=/);
    expect(src).not.toMatch(/setGateThreshold|kellyMultiplier|setKelly|GATE_RELAX/i);
  });

  it('never enables SectorEnergy boost or STRONG_BUY', () => {
    const src = moduleSrc();
    expect(src).not.toContain('sectorBoostAllowed: true');
    expect(src).not.toContain('strongBuyAllowed: true');
  });

  it('keeps UNKNOWN as UNKNOWN and provider issue separate from bearish signal', () => {
    const report = buildSupplyUnknownPolicyReportAdr0488({ providerIssue: true, marketSignal: false, providerStatus: 'UNKNOWN' });
    expect(report.classification.rootCause).toBe('SUPPLY_PROVIDER_UNKNOWN');
    expect(report.marketSignal).toBe(false);
    expect(report.diagnostics.join(' ')).toContain('not classified as market signal');
  });
});
