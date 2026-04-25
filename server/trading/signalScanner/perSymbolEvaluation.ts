/**
 * @responsibility 종목 단위 진입 검증 — Gate·RRR·liveGate·failure·corr·sizing·cooldown 평가
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 중 종목 단위 평가 단계. 가장 거대한 단일
 * 책임으로, 기존 signalScanner.ts L652~1268 (메인 루프) + L1313~1490 (intraday 루프)
 * 본체가 이 모듈로 이동한다:
 *   - fetchYahooQuote / KIS fallback / enrichQuoteWithKisMTAS
 *   - evaluateEntryRevalidation / Gate / RRR / liveGate
 *   - checkFailurePattern / evaluateCorrelationGate
 *   - classifySizingTier / banditDecision / kelly 누적
 *   - getAccountRiskBudget / computeRiskAdjustedSize
 *   - checkSectorExposureBefore / preBreakoutAccumulationDetector
 *   - checkCooldownRelease / volumeClock
 *   - SymbolExitContext / getAdaptiveProfitTargets
 *
 * 평가 결과는 `EvaluatedSymbol` 로 표현되며, 진입 가능한 후보만 다음 단계
 * (`approvalQueue` → `orderDispatch`) 로 전달된다. 본 모듈은 큐 푸시 자체는 하지 않는다
 * — 큐 푸시는 approvalQueue.ts 의 책임이다.
 */

export interface SymbolExitContext {
  profileType?: 'LEADER' | 'CATALYST' | 'OVERHEATED' | 'DIVERGENT';
  sector?: string;
  watchlistSource?: string;
}

export interface EvaluatedSymbol {
  /** 진입 가능 여부 — false 면 reason 에 차단 사유. */
  shouldEnter: boolean;
  reason?: string;
  /** 진입 시 approvalQueue 가 createBuyTask 인자로 사용할 페이로드. */
  payload?: unknown;
}

export interface PerSymbolEvaluationContext {
  /** Phase 3 에서 구체 타입 (ScanContext) 으로 교체. */
  shadowMode: boolean;
  totalAssets: number;
  orderableCash: number;
  effectiveMaxPositions: number;
}

/**
 * 단일 종목 진입 검증 본체. Phase 3 에서 메인 루프 / intraday 루프 분기를 갖는다.
 */
export async function evaluateSymbol(
  _stock: unknown,
  _ctx: PerSymbolEvaluationContext,
): Promise<EvaluatedSymbol> {
  throw new Error(
    'TODO: migrate from signalScanner.ts (ADR-0001 Phase 3 — perSymbolEvaluation)',
  );
}
