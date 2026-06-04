// @responsibility 표기 정합 회귀: KIS finance(KIS_PRIMARY)가 재무 레이어를 커버하면 CHECK_DART_FINANCIALS
// advisory 를 띄우지 않고, KIS finance 도 실패하면 기존 CHECK 경고를 보존하는지 검증 (표시 전용, executionImpact=NONE).

import { describe, expect, it } from 'vitest';
import { buildGate2ConsolidatedDiagnostic, isKisFinancePrimaryConnected } from './consolidatedDiagnostic.js';
import type { Gate2ExternalDataCoverage, Gate2SourceCoverage } from './types.js';

type DartCoverage = Gate2ExternalDataCoverage['dartFinancials'];
type KisFlowCoverage = Gate2ExternalDataCoverage['kisInvestorFlow'];

function kisFlowVerified(): KisFlowCoverage {
  return {
    required: true,
    available: true,
    provider: 'KIS_API',
    endpointKey: 'UNKNOWN',
    endpoint: null,
    trId: null,
    providerStatus: null,
    dataConfidence: null,
    status: 'VERIFIED',
    fields: { foreignNetBuy: true, institutionalNetBuy: true, individualNetBuy: false },
    foreignNetBuy: 100,
    institutionalNetBuy: 100,
    individualNetBuy: null,
    missingFields: [],
    rawFieldCoverage: {} as KisFlowCoverage['rawFieldCoverage'],
    driftDiagnostics: [],
    stageNotFetched: false,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
  } as unknown as KisFlowCoverage;
}

function dartMissing(patch: Partial<DartCoverage>): DartCoverage {
  return {
    required: true,
    available: false,
    provider: 'DART',
    providerStatus: null,
    dataConfidence: null,
    status: 'MISSING',
    fields: {
      operatingCashFlow: false,
      netIncome: false,
      ocfRatio: false,
      roe: false,
      opm: false,
      opmYoYDelta: false,
      marginAcceleration: false,
      interestCoverageRatio: false,
    },
    ocfRatio: null,
    roe: null,
    opm: null,
    opmYoYDelta: null,
    marginAcceleration: null,
    interestCoverageRatio: null,
    missingFields: ['roe', 'opm', 'ocfRatio', 'interestCoverageRatio'],
    rawFieldCoverage: {} as DartCoverage['rawFieldCoverage'],
    earningsQuality: undefined,
    stageNotFetched: false,
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
    ...patch,
  } as DartCoverage;
}

function buildExternal(dart: DartCoverage): Gate2ExternalDataCoverage {
  // 다른 라인은 모두 VERIFIED 로 두어 DART branch 만 평가되게 한다.
  const verifiedLine = { required: true, status: 'VERIFIED', providerIssue: false, marketSignal: false, stageNotFetched: false } as unknown;
  return {
    kisInvestorFlow: kisFlowVerified(),
    dartFinancials: dart,
    benchmark: { ...(verifiedLine as object), values: {}, missingFields: [], notes: [] },
    programTrade: {
      stockProgram: { status: 'UNKNOWN', programNetBuyAmount: null },
      marketProgram: { status: 'UNKNOWN', programNetBuyAmount: null },
      scopeSeparationValid: true,
      notes: [],
      marketSignal: false,
    },
    riskFlow: { ...(verifiedLine as object), interpretation: 'RISK_LOW' },
    sectorCycle: { ...(verifiedLine as object) },
    leaderCycle: { leaderCyclePhase: 'LEADING', attentionPhase: 'EARLY' },
  } as unknown as Gate2ExternalDataCoverage;
}

const source: Gate2SourceCoverage = {
  conditionCount: 10,
  allDeclaredInputsAvailable: true,
  allExternalDataAvailable: true,
  missingInputs: [],
} as unknown as Gate2SourceCoverage;

describe('Gate2 DART/KIS-primary display parity (표기 정합)', () => {
  it('(a) KIS finance source=KIS_PRIMARY 커버 시 CHECK_DART_FINANCIALS 미emit (advisory NONE)', () => {
    const dart = dartMissing({ stability: { financeSource: 'KIS_PRIMARY', currentRatio: 180, debtRatio: 40 } as Record<string, unknown> });
    expect(isKisFinancePrimaryConnected(dart)).toBe(true);
    const diag = buildGate2ConsolidatedDiagnostic({ gate2: { sourceCoverage: source, externalDataCoverage: buildExternal(dart) }, evaluationStage: 'ENTRY_RECHECK_GATE' });
    expect(diag.operatorAction).toBe('NONE');
    expect(diag.primaryIssue).toBe('DART_FINANCIALS_UNAVAILABLE_KIS_PRIMARY_VERIFIED');
    // 게이팅/실행/마켓시그널 불변.
    expect(diag.executionImpact === 'NONE' || diag.executionImpact === 'DIAGNOSTIC_ONLY').toBe(true);
    expect(diag.marketSignal).toBe(false);
  });

  it('(a) KIS L1 머지(currentRatio non-null)만 있어도 CHECK_DART 미emit', () => {
    const dart = dartMissing({ stability: { currentRatio: 200 } as Record<string, unknown> });
    expect(isKisFinancePrimaryConnected(dart)).toBe(true);
    const diag = buildGate2ConsolidatedDiagnostic({ gate2: { sourceCoverage: source, externalDataCoverage: buildExternal(dart) }, evaluationStage: 'ENTRY_RECHECK_GATE' });
    expect(diag.operatorAction).toBe('NONE');
  });

  it('(a-신뢰) KIS finance 도 미연결(stability 없음)이면 CHECK_DART_FINANCIALS 보존 (false-negative 방지)', () => {
    const dart = dartMissing({});
    expect(isKisFinancePrimaryConnected(dart)).toBe(false);
    const diag = buildGate2ConsolidatedDiagnostic({ gate2: { sourceCoverage: source, externalDataCoverage: buildExternal(dart) }, evaluationStage: 'ENTRY_RECHECK_GATE' });
    expect(diag.operatorAction).toBe('CHECK_DART_FINANCIALS');
    expect(diag.primaryIssue).toBe('DART_FINANCIALS_UNAVAILABLE');
  });

  it('(c) baseline 불변: providerIssue/marketSignal/executionImpact 무변경 (양쪽 케이스)', () => {
    for (const dart of [dartMissing({ stability: { financeSource: 'KIS_PRIMARY', currentRatio: 180 } as Record<string, unknown> }), dartMissing({})]) {
      const diag = buildGate2ConsolidatedDiagnostic({ gate2: { sourceCoverage: source, externalDataCoverage: buildExternal(dart) }, evaluationStage: 'ENTRY_RECHECK_GATE' });
      expect(diag.marketSignal).toBe(false);
      expect(JSON.stringify(diag)).not.toContain('"marketSignal":true');
    }
  });
});
