// @responsibility Followup①: legacy Gate2 Wiring Diagnostic emitter 배선 회귀 테스트 (표시 전용).

import { describe, expect, it } from 'vitest';
import {
  formatGate2DartFinancialsCompactDiagnostic,
  formatGate2KisInvestorFlowCompactDiagnostic,
} from './formatters.js';
import { isDartPartialAvailability } from './consolidatedDiagnostic.js';
import { KIS_INVESTOR_FLOW_CANONICAL } from '../../trading/signalScanner/gate2KisFlowTraceMetadata.js';
import type { Gate2ExternalDataCoverage } from './types.js';

type KisFlowCoverage = Gate2ExternalDataCoverage['kisInvestorFlow'];
type DartCoverage = Gate2ExternalDataCoverage['dartFinancials'];

function kisFlow(patch: Partial<KisFlowCoverage>): Gate2ExternalDataCoverage {
  const base: KisFlowCoverage = {
    required: true,
    available: false,
    provider: 'KIS_API',
    endpointKey: 'UNKNOWN',
    endpoint: null,
    trId: null,
    providerStatus: null,
    dataConfidence: null,
    status: 'VERIFIED',
    fields: { foreignNetBuy: true, institutionalNetBuy: true, individualNetBuy: false },
    foreignNetBuy: -5173125,
    institutionalNetBuy: -1613562,
    individualNetBuy: null,
    missingFields: [],
    rawFieldCoverage: {} as KisFlowCoverage['rawFieldCoverage'],
    driftDiagnostics: [],
    stageNotFetched: false,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
  };
  return { kisInvestorFlow: { ...base, ...patch } } as unknown as Gate2ExternalDataCoverage;
}

function dart(patch: Partial<DartCoverage>): Gate2ExternalDataCoverage {
  const base: DartCoverage = {
    required: true,
    available: false,
    provider: 'DART',
    providerStatus: null,
    dataConfidence: null,
    status: 'DEGRADED',
    fields: {
      operatingCashFlow: false,
      netIncome: false,
      ocfRatio: false,
      roe: true,
      opm: true,
      opmYoYDelta: false,
      marginAcceleration: false,
      interestCoverageRatio: false,
    },
    ocfRatio: null,
    roe: 19.16,
    opm: 43.94,
    opmYoYDelta: null,
    marginAcceleration: null,
    interestCoverageRatio: null,
    missingFields: ['ocfRatio', 'interestCoverageRatio', 'earningsQuality'],
    rawFieldCoverage: {} as DartCoverage['rawFieldCoverage'],
    earningsQuality: undefined,
    stageNotFetched: false,
    providerIssue: false,
    marketSignal: false,
    executionImpact: 'DIAGNOSTIC_ONLY',
  } as DartCoverage;
  return { dartFinancials: { ...base, ...patch } } as unknown as Gate2ExternalDataCoverage;
}

describe('§A kisFlow apiPath/trId metadata-not-carried 배선', () => {
  it('endpoint/trId 미carry + endpointKey UNKNOWN → UNKNOWN_METADATA_NOT_CARRIED + canonical 참조값', () => {
    const text = formatGate2KisInvestorFlowCompactDiagnostic(
      kisFlow({ endpoint: null, trId: null, endpointKey: 'UNKNOWN' }),
    );
    expect(text).toContain('apiPath=UNKNOWN_METADATA_NOT_CARRIED');
    expect(text).toContain('trId=UNKNOWN_METADATA_NOT_CARRIED');
    expect(text).toContain('traceBreakPoint=PROVIDER_METADATA_DROPPED_AFTER_ROUTER');
    expect(text).toContain(`canonicalApiPath=${KIS_INVESTOR_FLOW_CANONICAL.apiPath}`);
    expect(text).toContain(`canonicalTrId=${KIS_INVESTOR_FLOW_CANONICAL.trId}`);
    // 옛 UNRESOLVED/UNKNOWN 단순 표기로 회귀하지 않는다.
    expect(text).not.toContain('apiPath=UNRESOLVED');
    expect(text).not.toContain('trId=UNKNOWN |');
    // providerIssue→marketSignal 변환 금지.
    expect(text).toContain('marketSignal=false');
  });

  it('실제 carry 된 endpoint/trId 가 있으면 그 값 표기(기존 동작 유지), canonical 미출력', () => {
    const text = formatGate2KisInvestorFlowCompactDiagnostic(
      kisFlow({
        endpoint: '/uapi/domestic-stock/v1/quotations/inquire-investor',
        trId: 'FHKST01010900',
        endpointKey: 'INQUIRE_INVESTOR' as KisFlowCoverage['endpointKey'],
      }),
    );
    expect(text).toContain('apiPath=/uapi/domestic-stock/v1/quotations/inquire-investor');
    expect(text).toContain('trId=FHKST01010900');
    expect(text).not.toContain('UNKNOWN_METADATA_NOT_CARRIED');
    expect(text).not.toContain('traceBreakPoint=');
    expect(text).toContain('marketSignal=false');
  });
});

describe('§C dart PARTIAL + availableFields/missingFields 배선', () => {
  it('ROE/OPM available · OCF/NI·ICR·earningsQuality null → PARTIAL + 필드 라벨 + primaryIssue', () => {
    const text = formatGate2DartFinancialsCompactDiagnostic(
      dart({ status: 'DEGRADED', providerStatus: 'FIELD_MISSING' }),
    );
    expect(text).toContain('Gate2 DART: PARTIAL');
    expect(text).toContain('ROE=19.16');
    expect(text).toContain('OPM=43.94');
    expect(text).toContain('availableFields=roe,opm');
    expect(text).toContain('missingFields=ocfToNi,icr,earningsQuality');
    expect(text).toContain('primaryIssue=DATA_UNAVAILABLE:earnings_quality');
    // 단순 부재 → providerIssue=false, marketSignal 불변.
    expect(text).toContain('providerIssue=false');
    expect(text).toContain('marketSignal=false');
    // 옛 coarse DEGRADED 단정으로 회귀하지 않는다.
    expect(text).not.toContain('Gate2 DART: DEGRADED');
  });

  it('transport/parse error(providerStatus=HTTP_ERROR) → DEGRADED + providerIssue=true', () => {
    const text = formatGate2DartFinancialsCompactDiagnostic(
      dart({ status: 'DEGRADED', providerStatus: 'HTTP_ERROR' }),
    );
    expect(text).toContain('Gate2 DART: DEGRADED');
    expect(text).toContain('providerIssue=true');
    expect(text).toContain('marketSignal=false');
  });

  it('전체 필드 부재(MISSING) → coarse status 유지(기존 출력 필드 보존)', () => {
    const text = formatGate2DartFinancialsCompactDiagnostic(
      dart({ status: 'MISSING', roe: null, opm: null }),
    );
    expect(text).toContain('Gate2 DART: MISSING');
    expect(text).toContain('issue=DART_FINANCIALS_MISSING');
    expect(text).toContain('earnings_quality=unavailable');
    expect(text).toContain('marketSignal=false');
  });
});

describe('§C consolidatedDiagnostic primaryIssue 정합 (isDartPartialAvailability)', () => {
  it('일부 필드 존재 + 단순 부재 → PARTIAL 판정(true)', () => {
    const { dartFinancials } = dart({ status: 'DEGRADED', providerStatus: 'FIELD_MISSING' });
    expect(isDartPartialAvailability(dartFinancials)).toBe(true);
  });

  it('transport/parse error 면 PARTIAL 아님(false) — DART_FINANCIALS_UNAVAILABLE 단정 유지', () => {
    const { dartFinancials } = dart({ status: 'DEGRADED', providerStatus: 'HTTP_ERROR' });
    expect(isDartPartialAvailability(dartFinancials)).toBe(false);
  });

  it('전체 핵심 필드 부재 면 PARTIAL 아님(false)', () => {
    const { dartFinancials } = dart({
      status: 'MISSING',
      providerStatus: 'FIELD_MISSING',
      roe: null,
      opm: null,
      ocfRatio: null,
      interestCoverageRatio: null,
    });
    expect(isDartPartialAvailability(dartFinancials)).toBe(false);
  });

  it('전체 핵심 필드 가용 면 PARTIAL 아님(false)', () => {
    const { dartFinancials } = dart({
      status: 'VERIFIED',
      providerStatus: 'OK_WITH_DATA',
      roe: 19.16,
      opm: 43.94,
      ocfRatio: 1.4,
      interestCoverageRatio: 8.4,
    });
    expect(isDartPartialAvailability(dartFinancials)).toBe(false);
  });
});
