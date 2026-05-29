// @responsibility followup ② carry 회귀 — projection dartLineHealth 가 Gate2 external coverage 레코드로 전달되는지 검증.

import { describe, expect, it } from 'vitest';
import { buildGate2ExternalDataCoverage } from './externalCoverage.js';
import {
  buildGate2ExternalProjection,
  buildMissingGate2FinancialSnapshot,
} from '../../trading/gate2/gate2ExternalDataProvider.js';

// followup ②: 실전 출력은 `DART_FINANCIALS: DEGRADED availableFields=NONE missingFields=NONE`
// — projection.dartLineHealth 가 candidate trace 가 읽는 gate2 external coverage 레코드로 carry
// 되지 않았다. buildGate2ExternalDataCoverage 반환에 dartLineHealth 가 포함되어, 그것이
// gateLayerSummary.gate2.externalDataCoverage → candidate trace 의 external 스냅샷으로 흐른다.
describe('followup ② — dartLineHealth carry into Gate2 external coverage', () => {
  it('coverage 레코드가 projection 의 dartLineHealth 를 그대로 carry 한다 (availableFields/missingFields 실값)', () => {
    const asOf = '2026-05-28T00:30:00.000Z';
    // 동일 입력으로 projection 을 직접 계산 — coverage 내부 projection 과 동일 값이어야 한다.
    const projection = buildGate2ExternalProjection({
      symbol: '005930',
      financialSnapshot: buildMissingGate2FinancialSnapshot(
        '005930',
        'DART_FINANCIALS_MISSING',
        asOf,
      ),
      asOf,
    });

    const coverage = buildGate2ExternalDataCoverage([], {
      dartFin: null,
      quote: { symbol: '005930' },
    });

    // 핵심: carry 누락 시 dartLineHealth 는 undefined → DART_FINANCIALS NONE/NONE 로 표기됐다.
    expect(coverage.dartLineHealth).toBeDefined();
    const carried = coverage.dartLineHealth as Record<string, unknown>;

    // availableFields / missingFields 가 projection 산출값과 동일하게 carry 된다.
    expect(carried.availableFields).toEqual(projection.dartLineHealth.availableFields);
    expect(carried.missingFields).toEqual(projection.dartLineHealth.missingFields);
    expect(carried.status).toBe(projection.dartLineHealth.status);

    // carry wiring 불변식 보존 — executionImpact=NONE, marketSignal=false.
    expect(carried.executionImpact).toBe('NONE');
    expect(carried.marketSignal).toBe(false);
    // providerIssue 는 projection 값 그대로 (변환 0).
    expect(carried.providerIssue).toBe(projection.dartLineHealth.providerIssue);

    // coverage 전체 executionImpact 도 NONE 유지 (Gate2 external 은 진단 전용).
    expect(coverage.executionImpact).toBe('NONE');
  });

  it('§B dartFin 존재(VERIFIED) 시 dartLineHealth.status 가 NOT_ATTEMPTED 가 아니다 (합성 refreshTrace)', () => {
    // 실전 회귀: external.dartFinancials.status=VERIFIED 인데 dartLineHealth=NOT_ATTEMPTED 로 표시됨.
    // 합성 refreshTrace(dartRequestAttempted=true) 로 실제 상태를 반영한다.
    const dartFin = {
      symbol: '005930',
      corpCode: '00126380',
      reportDate: '2026-03-31',
      revenue: 1000,
      operatingIncome: 200,
      netIncome: 150,
      operatingCashFlow: 180,
      interestExpense: 10,
      totalEquity: 1500,
      totalAssets: 3000,
      ocfRatio: 1.2,
      roe: 0.1,
      opm: 0.2,
      opmYoYDelta: 0.01,
      revenueYoYGrowth: 0.05,
      operatingIncomeYoYGrowth: 0.06,
      marginAcceleration: 0.01,
      interestCoverageRatio: 20,
      source: 'DART' as const,
      providerStatus: 'OK_WITH_DATA' as const,
      dataConfidence: 'VERIFIED' as const,
      providerIssue: false,
      marketSignal: false as const,
      executionImpact: 'NONE' as const,
    };
    const coverage = buildGate2ExternalDataCoverage([], {
      dartFin,
      quote: { symbol: '005930' },
    });
    const carried = coverage.dartLineHealth as Record<string, unknown> | undefined;
    expect(carried).toBeDefined();
    expect(carried?.status).not.toBe('NOT_ATTEMPTED');
    // 불변식 — 표시 정합 패치라 시장 신호/실행 영향 0.
    expect(carried?.marketSignal).toBe(false);
    expect(carried?.executionImpact).toBe('NONE');
  });

  it('dartLineHealth missingFields 가 비어있지 않다 — DART 부재 시 실제 미가용 필드 노출 (NONE 갭 해소)', () => {
    const coverage = buildGate2ExternalDataCoverage([], {
      dartFin: null,
      quote: { symbol: '000660' },
    });
    const carried = coverage.dartLineHealth as Record<string, unknown> | undefined;
    expect(carried).toBeDefined();
    // DART 전부 부재이므로 missingFields 가 실값(roe/opm/icr/earnings 등)을 담는다 — 'NONE' 회귀 방지.
    expect(Array.isArray(carried?.missingFields)).toBe(true);
    expect((carried?.missingFields as unknown[]).length).toBeGreaterThan(0);
  });
});
