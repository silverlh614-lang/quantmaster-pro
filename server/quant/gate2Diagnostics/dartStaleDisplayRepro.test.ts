// @responsibility T3 회귀 잠금 — 캐시 round-trip(projectionToQmpDartFinancials) 을 거친 OCF-누락 재무가
// 스캔-시점 DART 라인 표시 산출(resolveDartStatus/providerIssueForDartStatus)에서 PARTIAL·providerIssue=false 로 나오는지 고정.
// scan_blockers 는 persisted 스캔 결과를 렌더하므로, 표시는 스캔 시점에 본 함수들로 build 된다. 본 테스트가 그 build 경로를 잠근다.

import { describe, expect, it } from 'vitest';
import { normalizeDartFinancials } from '../../clients/dartFinancialNormalizer.js';
import {
  buildGate2ExternalProjection,
  projectionToQmpDartFinancials,
} from '../../trading/gate2/gate2ExternalDataProvider.js';
import { resolveDartStatus, providerIssueForDartStatus, dartProviderStatus } from './externalCoverage.js';

function row(accountId: string, amount: number): Record<string, unknown> {
  return { account_id: accountId, thstrm_amount: String(amount) };
}

// 매출/순이익/영업이익/자본 있으나 OCF 없음 → FIELD_MISSING (스캔 21/39 DEGRADED 케이스 재현).
const OCF_MISSING_RAW = {
  list: [
    row('ifrs-full_Revenue', 5000),
    row('ifrs-full_ProfitLossFromOperatingActivities', 800),
    row('ifrs-full_ProfitLoss', 1000),
    row('ifrs-full_Equity', 4000),
  ],
};

describe('T3 회귀 잠금 — Gate2 DART 캐시 round-trip 후 표시 상태', () => {
  it('cache 서빙 경로(projectionToQmpDartFinancials)를 거친 OCF-누락 재무 → providerStatus=FIELD_MISSING', () => {
    const fresh = normalizeDartFinancials({ symbol: '005930', raw: OCF_MISSING_RAW });
    const projection = buildGate2ExternalProjection({ symbol: '005930', dartFin: fresh });
    const cacheServed = projectionToQmpDartFinancials(projection);
    expect(cacheServed.providerStatus).toBe('FIELD_MISSING');
    expect(dartProviderStatus(cacheServed)).toBe('FIELD_MISSING');
  });

  it('스캔-시점 표시 산출: resolveDartStatus=PARTIAL (DEGRADED 아님)', () => {
    const fresh = normalizeDartFinancials({ symbol: '005930', raw: OCF_MISSING_RAW });
    const projection = buildGate2ExternalProjection({ symbol: '005930', dartFin: fresh });
    const cacheServed = projectionToQmpDartFinancials(projection);
    const status = resolveDartStatus({ required: true, ocfAvailable: false, missing: false, dartFin: cacheServed });
    expect(status).toBe('PARTIAL');
    // PARTIAL → providerIssue=false (DART 부분부재는 provider 장애 아님).
    expect(providerIssueForDartStatus(true, status)).toBe(false);
  });
});
