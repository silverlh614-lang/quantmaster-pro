/**
 * @responsibility ADR-454b Near-Miss Outcome Evaluation wiring — ledger refresh + summary composition.
 *
 * 운영 루프에서 Near-Miss Outcome Ledger 의 due horizon 을 갱신하고 요약을 반환한다.
 * 이 모듈은 DATA_BLOCKED_NEAR_MISS / PROBING / SHADOW_ONLY 후보의 사후 성과를
 * 학습/진단용으로만 평가하며, live decision/Kelly/Gate threshold/KIS 주문/entryEngine 에
 * 어떤 side effect 도 만들지 않는다.
 */
import {
  refreshNearMissOutcomeLedger,
  summarizeNearMissOutcomeLedger,
  type NearMissOutcomeSummary,
} from '../persistence/nearMissOutcomeLedger.js';

export interface NearMissOutcomeEvaluationResult {
  updated: number;
  skipped: number;
  closed: number;
  summary: NearMissOutcomeSummary;
  executionImpact: 'NONE';
  diagnosticOnly: true;
}

export interface NearMissOutcomeEvaluationOptions {
  now?: Date;
  priceFetcher?: (code: string) => Promise<number | null>;
}

/**
 * Due horizon 을 현재가로 관측하고 ledger summary 를 반환한다.
 * priceFetcher 는 테스트/호출자 quota 제어를 위한 의존성 주입이며 주문 API 와 무관하다.
 */
export async function evaluateNearMissOutcomes(
  opts: NearMissOutcomeEvaluationOptions = {},
): Promise<NearMissOutcomeEvaluationResult> {
  const refreshed = await refreshNearMissOutcomeLedger({
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.priceFetcher ? { priceFetcher: opts.priceFetcher } : {}),
  });

  return {
    ...refreshed,
    summary: summarizeNearMissOutcomeLedger(),
    executionImpact: 'NONE',
    diagnosticOnly: true,
  };
}

/**
 * 유지보수 cron 진입점 별칭 — 의도 명확화를 위해 evaluateNearMissOutcomes 를 감싼다.
 */
export async function runNearMissOutcomeEvaluationJob(
  opts: NearMissOutcomeEvaluationOptions = {},
): Promise<NearMissOutcomeEvaluationResult> {
  return evaluateNearMissOutcomes(opts);
}
