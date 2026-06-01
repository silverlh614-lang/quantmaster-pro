// @responsibility Gate2 재무 연결 정상 기준선 분류·불변식 순수 함수 단위 테스트 (BASELINE-LOCK-001 시나리오 1~5).

import { describe, expect, it } from 'vitest';
import {
  deriveGate2FinancialBaseline,
  evaluateGate2FinancialBaselineInvariants,
  type Gate2FinancialBaselineInput,
} from './gate2FinancialBaseline.js';

function input(overrides: Partial<Gate2FinancialBaselineInput> = {}): Gate2FinancialBaselineInput {
  return {
    dartLineStatus: 'VERIFIED',
    dartProviderIssue: false,
    kisFinanceSource: 'KIS_PRIMARY',
    kisMergeApplied: true,
    perStatus: 'AVAILABLE',
    perReason: 'PER_ACCEPTABLE',
    ...overrides,
  };
}

function allLocked(view: ReturnType<typeof deriveGate2FinancialBaseline>): boolean {
  return evaluateGate2FinancialBaselineInvariants(view).every(inv => inv.ok);
}

describe('deriveGate2FinancialBaseline', () => {
  // 시나리오 1 — PER 적자: provider 장애가 아니라 데이터 해석.
  it('PER negative earnings → NOT_MEANINGFUL, connection OK, no provider issue, no entry hard block', () => {
    const view = deriveGate2FinancialBaseline(
      input({ perStatus: 'UNAVAILABLE', perReason: 'PER_NON_POSITIVE_OR_UNAVAILABLE' }),
    );
    expect(view.perInterpretation).toBe('NOT_MEANINGFUL_DUE_TO_NEGATIVE_EARNINGS');
    expect(view.perConnectionStatus).toBe('CONNECTED_OK');
    expect(view.perProviderIssue).toBe(false);
    expect(view.perEntryHardBlock).toBe(false);
    expect(view.perHighConvictionOnly).toBe(true);
    expect(view.financialBaselineInvariant).toBe('LOCKED_OK');
    expect(allLocked(view)).toBe(true);
  });

  // 시나리오 2 — DART partial: 연결 정상, provider 장애 아님.
  it('DART partial → connectionStatus CONNECTED_OK, dataStatus PARTIAL, no provider issue', () => {
    const view = deriveGate2FinancialBaseline(input({ dartLineStatus: 'PARTIAL' }));
    expect(view.dartConnectionStatus).toBe('CONNECTED_OK');
    expect(view.dartDataStatus).toBe('PARTIAL');
    expect(view.financialProviderIssue).toBe(false);
    expect(view.financialUseScope).toBe('HIGH_CONVICTION_ONLY');
    expect(allLocked(view)).toBe(true);
  });

  // 시나리오 3 — DART full + PER 유의: full gate2 scoring scope.
  it('DART verified + PER meaningful → dataStatus VERIFIED, useScope GATE2_SCORING', () => {
    const view = deriveGate2FinancialBaseline(input());
    expect(view.dartConnectionStatus).toBe('CONNECTED_OK');
    expect(view.dartDataStatus).toBe('VERIFIED');
    expect(view.perInterpretation).toBe('PER_MEANINGFUL');
    expect(view.financialUseScope).toBe('GATE2_SCORING');
    expect(allLocked(view)).toBe(true);
  });

  // 시나리오 4 — Gate1 미달은 Gate2 실패가 아니다 (기준선 불변식 차원에서 항상 분리).
  it('GATE1_FAIL_NOT_GATE2_FAIL invariant always present and OK', () => {
    const invariants = evaluateGate2FinancialBaselineInvariants(deriveGate2FinancialBaseline(input()));
    const gate1 = invariants.find(inv => inv.name === 'GATE1_FAIL_NOT_GATE2_FAIL');
    expect(gate1?.ok).toBe(true);
  });

  // 시나리오 5 — optional/PER 데이터 미가용은 entry 를 막지 않는다.
  it('PER field missing → OPTIONAL_DATA_NOT_BLOCKING + entry hard block false', () => {
    const view = deriveGate2FinancialBaseline(input({ perStatus: 'UNAVAILABLE', perReason: 'PER_MISSING' }));
    expect(view.perInterpretation).toBe('PER_FIELD_MISSING');
    expect(view.perEntryHardBlock).toBe(false);
    const optional = evaluateGate2FinancialBaselineInvariants(view).find(
      inv => inv.name === 'OPTIONAL_DATA_NOT_BLOCKING',
    );
    expect(optional?.ok).toBe(true);
    expect(allLocked(view)).toBe(true);
  });

  // DART 실제 transport/parse error: DEGRADED + providerIssue 일 때만 CONNECTION_DEGRADED — 그래도 marketSignal=false.
  it('DART real transport error → CONNECTION_DEGRADED + financialProviderIssue true but marketSignal false, baseline OK', () => {
    const view = deriveGate2FinancialBaseline(input({ dartLineStatus: 'DEGRADED', dartProviderIssue: true }));
    expect(view.dartConnectionStatus).toBe('CONNECTION_DEGRADED');
    expect(view.dartDataStatus).toBe('UNAVAILABLE');
    expect(view.financialProviderIssue).toBe(true);
    expect(view.marketSignal).toBe(false);
    expect(view.executionImpact).toBe('NONE');
    // 실제 provider 장애에서도 DART_CONNECTED_OK 불변식은 위반이 아니다(providerIssue 동반).
    expect(allLocked(view)).toBe(true);
  });

  // EMPTY_VALID(미보고/기간): 연결 정상, provider 장애 아님.
  it('DART EMPTY_VALID → CONNECTED_OK, dataStatus EMPTY_VALID, no provider issue', () => {
    const view = deriveGate2FinancialBaseline(input({ dartLineStatus: 'EMPTY_VALID' }));
    expect(view.dartConnectionStatus).toBe('CONNECTED_OK');
    expect(view.dartDataStatus).toBe('EMPTY_VALID');
    expect(view.financialProviderIssue).toBe(false);
    expect(allLocked(view)).toBe(true);
  });

  // KIS 재무 부재여도 connection failure 가 아니다 (best-effort).
  it('KIS finance unavailable → connectionStatus NOT_ATTEMPTED (never CONNECTION_DEGRADED)', () => {
    const view = deriveGate2FinancialBaseline(
      input({ kisFinanceSource: 'UNAVAILABLE', kisMergeApplied: false, dartLineStatus: 'PARTIAL' }),
    );
    expect(view.kisFinanceConnectionStatus).toBe('NOT_ATTEMPTED');
    const kisInv = evaluateGate2FinancialBaselineInvariants(view).find(
      inv => inv.name === 'KIS_FINANCE_CONNECTED_OK',
    );
    expect(kisInv?.ok).toBe(true);
  });

  it('NOT_ATTEMPTED dart → connection NOT_ATTEMPTED, data NOT_ATTEMPTED, display+shadow scope', () => {
    const view = deriveGate2FinancialBaseline(
      input({
        dartLineStatus: 'NOT_ATTEMPTED',
        kisFinanceSource: 'UNAVAILABLE',
        kisMergeApplied: false,
        perStatus: 'UNAVAILABLE',
        perReason: 'PER_MISSING',
      }),
    );
    expect(view.dartConnectionStatus).toBe('NOT_ATTEMPTED');
    expect(view.dartDataStatus).toBe('NOT_ATTEMPTED');
    expect(view.financialUseScope).toBe('DISPLAY_AND_SHADOW_ONLY');
    expect(allLocked(view)).toBe(true);
  });
});

describe('evaluateGate2FinancialBaselineInvariants', () => {
  it('returns all 10 named baseline invariants', () => {
    const names = evaluateGate2FinancialBaselineInvariants(deriveGate2FinancialBaseline(input())).map(i => i.name);
    expect(names).toEqual([
      'DART_CONNECTED_OK',
      'KIS_FINANCE_CONNECTED_OK',
      'PER_NON_POSITIVE_IS_NOT_PROVIDER_FAILURE',
      'PER_UNAVAILABLE_DUE_TO_NEGATIVE_EARNINGS',
      'PER_HIGH_CONVICTION_ONLY',
      'ENTRY_HARD_BLOCK_FALSE_FOR_PER_NA',
      'FINANCIAL_PROVIDER_ISSUE_NOT_MARKET_SIGNAL',
      'GATE1_FAIL_NOT_GATE2_FAIL',
      'OPTIONAL_DATA_NOT_BLOCKING',
      'SHADOW_LEARNING_CONTINUES_WITH_PARTIAL_FINANCIALS',
    ]);
  });
});
