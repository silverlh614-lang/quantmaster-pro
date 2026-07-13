// @responsibility counterfacture_gate Phase G — Gate2 confluence outcome seed 빌더(learning-only forward-return 성숙 대상; 주문/provider 호출 0).
/**
 * gate2OutcomeSeed.ts (counterfacture_gate Phase G)
 *
 * Gate2 confluence 평가(coverageAdjustedScore)를 forward-return 성숙 대상 seed 로 만든다.
 * Gate3 outcome seed(gate3OutcomeSeed.ts)의 Gate2 판본 — 동일 패턴(scalar + entryReferencePrice
 * + regime + forwardReturns 슬롯). 성숙 후 projectGate2ScoredOutcomes 가 (scalar, WIN/LOSS, regime)
 * 로 투영해 ROC 권고에 사용. SKIPPED_BY_GATE1(미평가)은 제외 — Gate2 는 Gate1 생존자만 본다(정합).
 */

import type {
  Gate2ConfluenceLevel,
  Gate2EvaluationResult,
  Gate2Status,
} from './gate2ConfluenceScore.js';

interface Gate2OutcomeForwardReturns {
  d1: number | null;
  d3: number | null;
  d5: number | null;
  d10: number | null;
}

type Gate2OutcomeStatus = 'PENDING' | 'PARTIAL' | 'LABELED' | 'DATA_INSUFFICIENT';

export interface Gate2OutcomeSeed {
  id: string;
  symbol: string;
  name?: string;
  sourceSnapshotId: string;
  tradeDate: string;
  asOf: string;
  regime?: string;
  gate2Status: Gate2Status;
  /** ROC 스칼라 — gate2 coverageAdjustedScore(0~100). */
  gate2CoverageAdjustedScore: number | null;
  gate2ConfluenceLevel: Gate2ConfluenceLevel;
  entryReferencePrice: number | null;
  forwardReturns: Gate2OutcomeForwardReturns;
  outcomeStatus: Gate2OutcomeStatus;
  executionImpact: 'NONE';
  marketSignal: false;
  providerIssue: false;
}

export interface Gate2OutcomeSeedContext {
  sourceSnapshotId?: string;
  tradeDate?: string;
  asOf?: string;
  regime?: string;
}

function safeKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'UNKNOWN';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildGate2OutcomeSeedId(input: { symbol: string; tradeDate: string; sourceSnapshotId: string }): string {
  return ['gate2-outcome', safeKey(input.tradeDate), safeKey(input.symbol), safeKey(input.sourceSnapshotId)].join(':').slice(0, 220);
}

export function gate2OutcomeDuplicateKey(seed: Pick<Gate2OutcomeSeed, 'symbol' | 'tradeDate' | 'sourceSnapshotId'>): string {
  return `${seed.symbol}|${seed.tradeDate}|${seed.sourceSnapshotId}`;
}

/**
 * Gate2 평가 결과 + 종목별 가격 → outcome seed. SKIPPED_BY_GATE1(Gate1 미통과)은 제외.
 * entryReferencePrice 부재 시 outcomeStatus=DATA_INSUFFICIENT(성숙 불가, 투영 제외).
 */
export function buildGate2OutcomeSeeds(
  results: readonly Gate2EvaluationResult[],
  priceBySymbol: ReadonlyMap<string, number | null | undefined>,
  context: Gate2OutcomeSeedContext = {},
): Gate2OutcomeSeed[] {
  const sourceSnapshotId = context.sourceSnapshotId ?? 'UNKNOWN_SOURCE_SNAPSHOT';
  const asOf = context.asOf ?? new Date().toISOString();
  const tradeDate = context.tradeDate ?? asOf.slice(0, 10);
  const seeds: Gate2OutcomeSeed[] = [];
  for (const result of results) {
    if (result.gate2Status === 'SKIPPED_BY_GATE1') continue;
    const entryReferencePrice = finiteNumber(priceBySymbol.get(result.symbol));
    seeds.push({
      id: buildGate2OutcomeSeedId({ symbol: result.symbol, tradeDate, sourceSnapshotId }),
      symbol: result.symbol,
      ...(result.name ? { name: result.name } : {}),
      sourceSnapshotId,
      tradeDate,
      asOf,
      ...(context.regime ? { regime: context.regime } : {}),
      gate2Status: result.gate2Status,
      gate2CoverageAdjustedScore: finiteNumber(result.coverageAdjustedScore),
      gate2ConfluenceLevel: result.confluenceLevel,
      entryReferencePrice,
      forwardReturns: { d1: null, d3: null, d5: null, d10: null },
      outcomeStatus: entryReferencePrice === null ? 'DATA_INSUFFICIENT' : 'PENDING',
      executionImpact: 'NONE',
      marketSignal: false,
      providerIssue: false,
    });
  }
  return seeds;
}
