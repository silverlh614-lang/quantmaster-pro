// @responsibility DART 재무 정규화 분류 정정 회귀 테스트 — FIELD_MISSING(OCF 누락)=데이터완전성≠provider장애, '013'=빈정상, alias 확장.

import { describe, expect, it } from 'vitest';
import { normalizeDartFinancials } from './dartFinancialNormalizer.js';
import {
  gate2StatusFromDartProviderStatus,
  providerIssueForDartStatus,
} from '../quant/gate2Diagnostics/externalCoverage.js';

function row(accountId: string, amount: number): Record<string, unknown> {
  return { account_id: accountId, thstrm_amount: String(amount) };
}

// 매출/순이익/영업이익/자본은 있으나 영업활동현금흐름(OCF)·이자비용 없음 → FIELD_MISSING.
const INCOME_ONLY_ROWS = {
  list: [
    row('ifrs-full_Revenue', 5000),
    row('ifrs-full_ProfitLossFromOperatingActivities', 800),
    row('ifrs-full_ProfitLoss', 1000),
    row('ifrs-full_Equity', 4000),
  ],
};

describe('normalizeDartFinancials — FIELD_MISSING 분류 정정', () => {
  it('OCF 누락(roe/opm 가용) → providerStatus=FIELD_MISSING + providerIssue=FALSE (provider 장애 아님)', () => {
    const fin = normalizeDartFinancials({ symbol: '005930', raw: INCOME_ONLY_ROWS });
    expect(fin.providerStatus).toBe('FIELD_MISSING');
    // 핵심: 단순 필드 부재는 provider transport 장애가 아니다.
    expect(fin.providerIssue).toBe(false);
    expect(fin.marketSignal).toBe(false);
    // roe/opm 는 계산됨 (provider 가 정상 응답한 증거).
    expect(fin.roe).toBeCloseTo(0.25, 5);
    expect(fin.opm).toBeCloseTo(0.16, 5);
    // OCF/이자비용 의존 필드는 null.
    expect(fin.operatingCashFlow).toBeNull();
    expect(fin.interestCoverageRatio).toBeNull();
  });

  it('transport/parse 장애(HTTP_ERROR)는 여전히 providerIssue=TRUE', () => {
    const fin = normalizeDartFinancials({ symbol: '005930', raw: INCOME_ONLY_ROWS, providerStatus: 'HTTP_ERROR' });
    expect(fin.providerStatus).toBe('HTTP_ERROR');
    expect(fin.providerIssue).toBe(true);
    expect(fin.marketSignal).toBe(false);
  });

  it("DART status '013'(조회 데이터 없음) → OK_EMPTY + providerIssue=false (provider 오류 아님)", () => {
    const fin = normalizeDartFinancials({
      symbol: '005930',
      raw: { status: '013', message: '조회된 데이터가 없습니다' },
    });
    expect(fin.providerStatus).toBe('OK_EMPTY');
    expect(fin.dataConfidence).toBe('EMPTY_VALID');
    expect(fin.providerIssue).toBe(false);
  });

  it("DART status '020'(요청제한초과) → RATE_LIMITED + providerIssue=true (실제 장애 유지)", () => {
    const fin = normalizeDartFinancials({
      symbol: '005930',
      raw: { status: '020', message: 'API 호출 한도를 초과하셨습니다 (rate limit)' },
    });
    expect(fin.providerStatus).toBe('RATE_LIMITED');
    expect(fin.providerIssue).toBe(true);
  });

  it('OCF alias 확장(dart_ 접두) → OCF 추출 성공 → 모든 필수필드 가용 → OK_WITH_DATA', () => {
    const fin = normalizeDartFinancials({
      symbol: '005930',
      raw: { list: [...INCOME_ONLY_ROWS.list, row('dart_CashFlowsFromUsedInOperatingActivities', 1200)] },
    });
    expect(fin.operatingCashFlow).toBe(1200);
    expect(fin.providerStatus).toBe('OK_WITH_DATA');
    expect(fin.providerIssue).toBe(false);
    expect(fin.ocfRatio).toBeCloseTo(1.2, 5); // 1200/1000
  });

  it('이자비용 alias 확장(dart_InterestExpense) → ICR 산출', () => {
    const fin = normalizeDartFinancials({
      symbol: '005930',
      raw: { list: [...INCOME_ONLY_ROWS.list, row('dart_InterestExpense', 100)] },
    });
    expect(fin.interestExpense).toBe(100);
    expect(fin.interestCoverageRatio).toBeCloseTo(8.0, 5); // 영업이익 800 / 이자비용 100
  });
});

describe('gate2 coverage 매퍼 — FIELD_MISSING → PARTIAL(연결 정상)', () => {
  it('gate2StatusFromDartProviderStatus(FIELD_MISSING, DEGRADED) → PARTIAL (DEGRADED 아님)', () => {
    expect(gate2StatusFromDartProviderStatus('FIELD_MISSING', 'DEGRADED')).toBe('PARTIAL');
  });

  it('진짜 transport 장애는 DEGRADED 유지', () => {
    expect(gate2StatusFromDartProviderStatus('HTTP_ERROR', 'DEGRADED')).toBe('DEGRADED');
    expect(gate2StatusFromDartProviderStatus('RATE_LIMITED', 'DEGRADED')).toBe('DEGRADED');
    expect(gate2StatusFromDartProviderStatus('PARSE_ERROR', null)).toBe('DEGRADED');
  });

  it('providerIssueForDartStatus(required, PARTIAL) → false (연결 정상)', () => {
    expect(providerIssueForDartStatus(true, 'PARTIAL')).toBe(false);
    expect(providerIssueForDartStatus(true, 'DEGRADED')).toBe(true);
    expect(providerIssueForDartStatus(true, 'VERIFIED')).toBe(false);
  });
});
