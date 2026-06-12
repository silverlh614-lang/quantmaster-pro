// @responsibility ADR-0609 Gate1 상수블록을 eligibility 게이트로 재해석한 shadow 판정 순수 산출 — LIVE 점수·통과 미소비, 관측 전용 (불변식 #6 결손≠탈락).

/**
 * Phase 0 (관측 전용 — 설계 track-b §0/§2 B-1). LIVE 의 minimumSignalScoreTrace
 * (computedScore/actualScore/passed/requiredScore)을 읽지도 쓰지도 않는다. 산출물
 * (eligible/marketOnlyPassed/percentilePassed)은 ScanSummary 집계 + 관측 ledger stamp
 * 에만 기록되고 buyList 정렬·Gate hard-block·entry·Kelly 어디서도 소비되지 않는다.
 *
 * 잠정 임계는 GATE1_ELIGIBILITY_SHADOW_THRESHOLDS 단일 상수 SSOT — Phase 1 dry-run
 * 보정 대상 (ADR-0609 본문 명시). canonical LEGACY_GATE1_REQUIRED_SCORE=70 과 분리된
 * shadow 전용 값으로, requiredScore 70 은 읽지 않는다 (3중 분리, 설계 §B-3).
 */

/** 상수/맥락 블록 컴포넌트 코드 — 적격성 재해석 대상 (시장 신호 6종과 분리, 설계 §1.2). */
export const GATE1_ELIGIBILITY_COMPONENT_CODES = {
  WATCHLIST_PRIORITY: 'WATCHLIST_PRIORITY',
  MARKET_REGIME: 'MARKET_REGIME',
  INVESTOR_FLOW: 'INVESTOR_FLOW',
} as const;

/** 잠정 임계 SSOT (Phase 1 dry-run 보정 대상 — ADR-0609). */
export const GATE1_ELIGIBILITY_SHADOW_THRESHOLDS = {
  /** market-only shadow 통과 임계 (76 스케일, 설계 §1.2 "70 도달 = 시장블록 42+/76" 재사용). */
  marketOnlyMinScore: 42,
  /** percentile shadow 통과 임계 (스캔 내 상위 ~30%, totalPercentile 0~100). */
  percentileMinPercentile: 70,
} as const;

/** ADR-0597 산출물에서 끌어오는 입력 (신규 fetch 0). */
export interface Gate1EligibilityShadowInputRow {
  symbol: string;
  name?: string;
  /** ADR-0597 marketBlockScore — null = 시장 컴포넌트 결손 (0점 아님, 불변식 #6). */
  marketBlockScore: number | null;
  /** ADR-0597 totalPercentile — 스캔 내 midrank 0~100. */
  totalPercentile: number;
  /**
   * 상수 블록 컴포넌트 weightedScore + providerIssue 목록. WATCHLIST_PRIORITY/MARKET_REGIME/
   * INVESTOR_FLOW 가 여기 없거나 providerIssue=true 인 음수면 "판정 보류" — 결손·provider 장애를
   * 탈락/bearish 로 변환 절대 금지 (불변식 #6).
   */
  eligibilityComponents?: ReadonlyArray<{ code: string; weightedScore: number; providerIssue?: boolean }>;
}

export interface Gate1EligibilityShadowSymbolJudgment {
  symbol: string;
  name?: string;
  /**
   * 상수 블록 적격성 재해석. 잠정 규칙: WATCHLIST_PRIORITY>0 && MARKET_REGIME>=0(비emergency)
   * && INVESTOR_FLOW>=0(비bearish). 컴포넌트 부재/UNKNOWN 은 bearish 변환 없이 "판정 보류"
   * = 보수 통과(eligible 유지) — 결손→탈락 금지 (불변식 #6).
   */
  eligible: boolean;
  /** 판정에 사용 가능한 상수 컴포넌트가 하나라도 결손이라 보수 통과로 처리됐는지 (관측 라벨). */
  eligibilityDegraded: boolean;
  /**
   * marketBlockScore >= marketOnlyMinScore. marketBlockScore=null(결손) → null(미평가) —
   * false 아님 (결손≠탈락, 불변식 #6).
   */
  marketOnlyPassed: boolean | null;
  /** totalPercentile >= percentileMinPercentile. */
  percentilePassed: boolean;
}

export interface Gate1EligibilityShadowReportAdr0609 {
  candidates: number;
  judgments: Gate1EligibilityShadowSymbolJudgment[];
  eligibleCount: number;
  /** 결손으로 보수 통과 처리된 종목 수 (불변식 #6 관측). */
  eligibilityDegradedCount: number;
  marketOnlyPassCount: number;
  /** marketBlockScore 결손으로 marketOnlyPassed 미평가(null)된 종목 수. */
  marketOnlyUnevaluatedCount: number;
  percentilePassCount: number;
  executionImpact: 'NONE';
  thresholdAutoChanged: false;
  operatorApprovalRequired: true;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function componentOf(
  components: ReadonlyArray<{ code: string; weightedScore: number; providerIssue?: boolean }> | undefined,
  code: string,
): { weightedScore: number; providerIssue: boolean } | null {
  const found = (components ?? []).find((c) => c.code === code);
  if (!found || !finite(found.weightedScore)) return null;
  return { weightedScore: found.weightedScore, providerIssue: found.providerIssue === true };
}

/**
 * 단일 종목 적격성 판정 (순수). 불변식 #6: 상수 컴포넌트 부재/비유한(provider 결손·
 * UNKNOWN)은 bearish 로 변환하지 않고 "판정 보류 = 보수 통과"로 처리한다. 결손 컴포넌트는
 * 통과 여부에 영향을 주지 않으며, 존재하는 컴포넌트가 명시적 음수(emergency/bearish)일
 * 때만 탈락시킨다.
 */
export function judgeGate1EligibilityAdr0609(
  row: Gate1EligibilityShadowInputRow,
): Gate1EligibilityShadowSymbolJudgment {
  const codes = GATE1_ELIGIBILITY_COMPONENT_CODES;
  const watchlist = componentOf(row.eligibilityComponents, codes.WATCHLIST_PRIORITY);
  const regime = componentOf(row.eligibilityComponents, codes.MARKET_REGIME);
  const investor = componentOf(row.eligibilityComponents, codes.INVESTOR_FLOW);

  // 불변식 #6: 결손(null) + providerIssue(UNKNOWN/STALE) 음수는 "판정 보류"(fail 아님) — provider
  // 장애를 bearish/부적격으로 변환 금지. providerIssue=false 인 명시적 음수(MARKET_REGIME
  // emergencyStop=marketSignal 등)만 부적격. INVESTOR_FLOW UNKNOWN -8 은 providerIssue=true 라 보류
  // (minimumSignalScoreTrace.ts:90,260 — "provider issue, NOT_MARKET_WEAKNESS").
  const watchlistFails = watchlist !== null && watchlist.weightedScore <= 0 && !watchlist.providerIssue;
  const regimeFails = regime !== null && regime.weightedScore < 0 && !regime.providerIssue;
  const investorFails = investor !== null && investor.weightedScore < 0 && !investor.providerIssue;
  const eligible = !(watchlistFails || regimeFails || investorFails);
  const heldByProviderIssue = Boolean(
    (watchlist !== null && watchlist.weightedScore <= 0 && watchlist.providerIssue) ||
      (regime !== null && regime.weightedScore < 0 && regime.providerIssue) ||
      (investor !== null && investor.weightedScore < 0 && investor.providerIssue),
  );
  const eligibilityDegraded =
    watchlist === null || regime === null || investor === null || heldByProviderIssue;

  const marketOnlyPassed =
    row.marketBlockScore === null
      ? null
      : row.marketBlockScore >= GATE1_ELIGIBILITY_SHADOW_THRESHOLDS.marketOnlyMinScore;

  const percentilePassed =
    finite(row.totalPercentile) &&
    row.totalPercentile >= GATE1_ELIGIBILITY_SHADOW_THRESHOLDS.percentileMinPercentile;

  return {
    symbol: row.symbol,
    ...(row.name ? { name: row.name } : {}),
    eligible,
    eligibilityDegraded,
    marketOnlyPassed,
    percentilePassed,
  };
}

/**
 * 스캔 단위 적격성 shadow 판정 집계 (순수, 관측 전용). LIVE 점수·통과·정렬·requiredScore
 * 0 접촉. executionImpact='NONE' (소비처 0 — Phase 0 DoD).
 */
export function buildGate1EligibilityShadowReportAdr0609(
  rows: readonly Gate1EligibilityShadowInputRow[],
): Gate1EligibilityShadowReportAdr0609 {
  const valid = rows.filter((row) => Boolean(row.symbol));
  const judgments = valid.map(judgeGate1EligibilityAdr0609);
  return {
    candidates: judgments.length,
    judgments,
    eligibleCount: judgments.filter((j) => j.eligible).length,
    eligibilityDegradedCount: judgments.filter((j) => j.eligibilityDegraded).length,
    marketOnlyPassCount: judgments.filter((j) => j.marketOnlyPassed === true).length,
    marketOnlyUnevaluatedCount: judgments.filter((j) => j.marketOnlyPassed === null).length,
    percentilePassCount: judgments.filter((j) => j.percentilePassed).length,
    executionImpact: 'NONE',
    thresholdAutoChanged: false,
    operatorApprovalRequired: true,
  };
}
