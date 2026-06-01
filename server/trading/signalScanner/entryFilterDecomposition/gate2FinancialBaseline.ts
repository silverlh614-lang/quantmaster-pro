// @responsibility Gate2 재무 연결 정상 상태를 기준선으로 고정하는 순수 분류·불변식 SSOT (표시 전용, 값/판정/게이팅/외부호출 무변경).

// Patch-GATE2-FINANCIAL-NORMAL-CONNECTION-BASELINE-LOCK-001 (patch-type, ADR 발급 0건).
// 목적: DART/KIS 재무 라인이 "연결 정상"인 현재 상태를 기준선으로 고정하여, 이후 추천·검색 레인 패치가
// (1) DART partial 을 connection failure 로, (2) PER 음수(적자)를 provider failure/DATA_UNAVAILABLE 로,
// (3) PER 미가용을 entry hard block 으로, (4) financialProviderIssue 를 market signal 로 재오염하지 못하게 막는다.
// 본 모듈은 이미 resolve 된 진단 표시값에서 파생만 한다 — Gate2 pass 조건/임계/사이징/주문 코드는 건드리지 않는다.

export type Gate2FinConnectionStatus = 'CONNECTED_OK' | 'CONNECTION_DEGRADED' | 'NOT_ATTEMPTED';
export type Gate2DartDataStatus = 'VERIFIED' | 'PARTIAL' | 'EMPTY_VALID' | 'UNAVAILABLE' | 'NOT_ATTEMPTED';
export type Gate2PerInterpretation =
  | 'PER_MEANINGFUL'
  | 'NOT_MEANINGFUL_DUE_TO_NEGATIVE_EARNINGS'
  | 'PER_FIELD_MISSING';
export type Gate2FinUseScope = 'GATE2_SCORING' | 'HIGH_CONVICTION_ONLY' | 'DISPLAY_AND_SHADOW_ONLY';

export interface Gate2FinancialBaselineInput {
  /** dartLineHealth.status (VERIFIED|PARTIAL|DEGRADED|EMPTY_VALID|NOT_ATTEMPTED). */
  dartLineStatus: string;
  /** dartLineHealth.providerIssue — transport/parse error 일 때만 true. */
  dartProviderIssue: boolean;
  /** kisFinance.financeSource (KIS_PRIMARY|DART_OR_DERIVED|UNAVAILABLE). */
  kisFinanceSource: string;
  /** KIS L1 재무 머지 반영 여부 (currentRatio non-null 신호). */
  kisMergeApplied: boolean;
  /** valuation.per.status (AVAILABLE|VERIFIED|UNAVAILABLE...). */
  perStatus: string;
  /** valuation.per.reason 토큰 (PER_NON_POSITIVE.../PER_MISSING...). */
  perReason: string;
}

export interface Gate2FinancialBaselineView {
  dartConnectionStatus: Gate2FinConnectionStatus;
  dartDataStatus: Gate2DartDataStatus;
  kisFinanceConnectionStatus: Gate2FinConnectionStatus;
  perInterpretation: Gate2PerInterpretation;
  perConnectionStatus: Gate2FinConnectionStatus;
  perProviderIssue: boolean;
  perEntryHardBlock: false;
  perHighConvictionOnly: boolean;
  financialProviderIssue: boolean;
  financialUseScope: Gate2FinUseScope;
  financialBaselineInvariant: 'LOCKED_OK' | 'VIOLATION';
  marketSignal: false;
  executionImpact: 'NONE';
}

export interface Gate2FinancialBaselineInvariant {
  name: string;
  ok: boolean;
}

/** PER 음수/0(적자)에서 비롯한 비가용 사유인지. 적자는 provider 장애가 아니라 데이터 해석이다. */
function isNegativeEarningsReason(reason: string): boolean {
  const upper = (reason ?? '').toUpperCase();
  return upper.includes('NON_POSITIVE') || upper.includes('NEGATIVE');
}

function isPerAvailable(perStatus: string): boolean {
  const upper = (perStatus ?? '').toUpperCase();
  return upper === 'AVAILABLE' || upper === 'VERIFIED';
}

/**
 * 이미 분류된 DART/KIS/PER 표시값으로부터 "재무 연결 정상" 기준선 뷰를 파생한다.
 *
 * 기준선 고정 규칙(이후 패치가 위반하면 invariant=VIOLATION):
 * - DART partial/empty_valid/verified 는 모두 connection=CONNECTED_OK. transport/parse error(providerIssue) 일 때만 DEGRADED.
 * - KIS 재무는 best-effort — KIS_PRIMARY/DART_OR_DERIVED 면 CONNECTED_OK, 부재여도 connection failure 가 아니다.
 * - PER 음수(적자)는 NOT_MEANINGFUL_DUE_TO_NEGATIVE_EARNINGS 로 해석하고 connection=CONNECTED_OK, providerIssue=false.
 * - PER 미가용은 high-conviction(STRONG_BUY 승격) 한정 — entry hard block 으로 승격 금지.
 * - financialProviderIssue 는 실제 DART transport/parse error 일 때만 true 이며 market signal 로 변환되지 않는다.
 */
export function deriveGate2FinancialBaseline(input: Gate2FinancialBaselineInput): Gate2FinancialBaselineView {
  const status = (input.dartLineStatus ?? '').toUpperCase();

  const dartConnectionStatus: Gate2FinConnectionStatus =
    status === 'NOT_ATTEMPTED' || status === ''
      ? 'NOT_ATTEMPTED'
      : status === 'DEGRADED' && input.dartProviderIssue
        ? 'CONNECTION_DEGRADED'
        : 'CONNECTED_OK';

  const dartDataStatus: Gate2DartDataStatus =
    status === 'VERIFIED'
      ? 'VERIFIED'
      : status === 'PARTIAL'
        ? 'PARTIAL'
        : status === 'EMPTY_VALID'
          ? 'EMPTY_VALID'
          : status === 'NOT_ATTEMPTED' || status === ''
            ? 'NOT_ATTEMPTED'
            : status === 'DEGRADED'
              ? // transport error → data unavailable; degraded without providerIssue 는 부분 부재로 본다.
                (input.dartProviderIssue ? 'UNAVAILABLE' : 'PARTIAL')
              : 'UNAVAILABLE';

  const kisConnected =
    input.kisMergeApplied
    || input.kisFinanceSource === 'KIS_PRIMARY'
    || input.kisFinanceSource === 'DART_OR_DERIVED';
  const kisFinanceConnectionStatus: Gate2FinConnectionStatus = kisConnected ? 'CONNECTED_OK' : 'NOT_ATTEMPTED';

  const perAvailable = isPerAvailable(input.perStatus);
  const perInterpretation: Gate2PerInterpretation = perAvailable
    ? 'PER_MEANINGFUL'
    : isNegativeEarningsReason(input.perReason)
      ? 'NOT_MEANINGFUL_DUE_TO_NEGATIVE_EARNINGS'
      : 'PER_FIELD_MISSING';
  // 적자 PER 는 API 가 정상 응답한 것 — connection 정상, provider 장애 아님.
  const perConnectionStatus: Gate2FinConnectionStatus = 'CONNECTED_OK';
  const perProviderIssue = false;
  const perHighConvictionOnly = !perAvailable;

  const financialProviderIssue = dartConnectionStatus === 'CONNECTION_DEGRADED';

  const financialUseScope: Gate2FinUseScope =
    dartDataStatus === 'VERIFIED' && perAvailable
      ? 'GATE2_SCORING'
      : dartConnectionStatus === 'CONNECTED_OK' || kisConnected
        ? 'HIGH_CONVICTION_ONLY'
        : 'DISPLAY_AND_SHADOW_ONLY';

  const view: Gate2FinancialBaselineView = {
    dartConnectionStatus,
    dartDataStatus,
    kisFinanceConnectionStatus,
    perInterpretation,
    perConnectionStatus,
    perProviderIssue,
    perEntryHardBlock: false,
    perHighConvictionOnly,
    financialProviderIssue,
    financialUseScope,
    financialBaselineInvariant: 'LOCKED_OK',
    marketSignal: false,
    executionImpact: 'NONE',
  };
  view.financialBaselineInvariant = evaluateGate2FinancialBaselineInvariants(view).every(inv => inv.ok)
    ? 'LOCKED_OK'
    : 'VIOLATION';
  return view;
}

/**
 * 기준선 불변식 평가 — 이후 패치가 재무 라인을 재오염하면 해당 항목이 ok=false(VIOLATION) 가 된다.
 * 각 항목은 구조적으로 deriveGate2FinancialBaseline 의 규칙과 일관 — 규칙을 깨는 변경에서만 위반이 발생한다.
 */
export function evaluateGate2FinancialBaselineInvariants(
  view: Gate2FinancialBaselineView,
): Gate2FinancialBaselineInvariant[] {
  const negativeEarnings = view.perInterpretation === 'NOT_MEANINGFUL_DUE_TO_NEGATIVE_EARNINGS';
  return [
    // DART 부분/빈 응답은 연결 정상 — DEGRADED 는 실제 provider 장애일 때만 허용.
    { name: 'DART_CONNECTED_OK', ok: view.dartConnectionStatus !== 'CONNECTION_DEGRADED' || view.financialProviderIssue },
    // KIS 재무는 best-effort — connection failure 로 보고하지 않는다.
    { name: 'KIS_FINANCE_CONNECTED_OK', ok: view.kisFinanceConnectionStatus !== 'CONNECTION_DEGRADED' },
    // 적자 PER 는 provider 장애가 아니다.
    { name: 'PER_NON_POSITIVE_IS_NOT_PROVIDER_FAILURE', ok: !(negativeEarnings && view.perProviderIssue) },
    // 적자 PER 비가용은 연결 정상 상태에서의 데이터 해석이다.
    { name: 'PER_UNAVAILABLE_DUE_TO_NEGATIVE_EARNINGS', ok: !negativeEarnings || view.perConnectionStatus === 'CONNECTED_OK' },
    // PER 미가용은 high-conviction(STRONG_BUY 승격) 한정 — entry block 아님.
    { name: 'PER_HIGH_CONVICTION_ONLY', ok: !view.perHighConvictionOnly || view.perEntryHardBlock === false },
    { name: 'ENTRY_HARD_BLOCK_FALSE_FOR_PER_NA', ok: view.perEntryHardBlock === false },
    // financialProviderIssue 는 약세 신호로 변환되지 않는다.
    { name: 'FINANCIAL_PROVIDER_ISSUE_NOT_MARKET_SIGNAL', ok: view.marketSignal === false },
    // Gate1 미달은 Gate2 실패가 아니다 (matrix 에서 별도 표기) — 기준선 차원에서 항상 분리.
    { name: 'GATE1_FAIL_NOT_GATE2_FAIL', ok: true },
    // optional/PER 데이터는 entry 를 막지 않는다.
    { name: 'OPTIONAL_DATA_NOT_BLOCKING', ok: view.perEntryHardBlock === false },
    // 부분 재무로도 Shadow Learning 은 계속된다 (executionImpact=NONE).
    { name: 'SHADOW_LEARNING_CONTINUES_WITH_PARTIAL_FINANCIALS', ok: view.executionImpact === 'NONE' },
  ];
}
