// @responsibility 차단된 BUY 후보를 counterfactual Shadow 학습 case 로 전환
import { BLOCKED_LOOKUP_DAYS } from './shadowConstants.js';
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import type { EngineMode, OutcomeLabel, ProviderHealth, ShadowCase, SourceConfidence } from './shadowTypes.js';

export interface BlockedBuyInput {
  caseId: string; signalId: string; symbol: string; symbolName: string; engineMode: EngineMode; blockedReason: string;
  entryPriceVirtual: number; stopPriceVirtual: number; targetPriceVirtual: number; positionSizeVirtual?: number; now?: Date;
}

export interface PricePoint { day: typeof BLOCKED_LOOKUP_DAYS[number]; high?: number; low?: number; close?: number; providerHealth?: ProviderHealth; sourceConfidence?: SourceConfidence; }

function baseCase(input: BlockedBuyInput): ShadowCase {
  const now = (input.now ?? new Date()).toISOString();
  return {
    caseId: input.caseId, signalId: input.signalId, symbol: input.symbol, symbolName: input.symbolName,
    detectedAt: now, marketSession: 'REGULAR', engineMode: input.engineMode, blockedReason: input.blockedReason,
    dataHealth: 'OK', providerHealth: 'OK', confidenceLevel: 'CALCULATED', expectedDecision: 'BUY', actualDecision: 'BLOCKED', shadowDecision: 'COUNTERFACTUAL_BUY',
    executionImpact: 'NONE', entryPriceVirtual: input.entryPriceVirtual, stopPriceVirtual: input.stopPriceVirtual, targetPriceVirtual: input.targetPriceVirtual,
    positionSizeVirtual: input.positionSizeVirtual, outcomeLabel: 'ACTIVE', sourceConfidence: 'CALCULATED', createdAt: now, updatedAt: now,
    state: 'LIVE_BLOCKED_SHADOW_ALLOWED', counterfactualRecorded: true,
  };
}

export function recordBlockedBuy(ledger: ShadowCaseLedgerStore, input: BlockedBuyInput): ShadowCase {
  return ledger.upsertCase(baseCase(input));
}

export function resolveBlockedOutcome(ledger: ShadowCaseLedgerStore, caseId: string, prices: PricePoint[]): OutcomeLabel {
  const c = ledger.getCase(caseId);
  if (!c || !c.entryPriceVirtual || !c.stopPriceVirtual || !c.targetPriceVirtual) return 'QUARANTINED';
  if (!prices.length || prices.some((p) => p.providerHealth === 'PROVIDER_ERROR')) {
    ledger.updateCase(caseId, { outcomeLabel: 'DATA_CORRUPTED', dataHealth: 'CORRUPTED', providerHealth: 'PROVIDER_ERROR' });
    return 'DATA_CORRUPTED';
  }
  const targetHit = prices.some((p) => (p.high ?? p.close ?? 0) >= c.targetPriceVirtual!);
  const stopHit = prices.some((p) => (p.low ?? p.close ?? Number.POSITIVE_INFINITY) <= c.stopPriceVirtual!);
  const label: OutcomeLabel = targetHit ? (c.blockedReason ? 'MISSED_WIN' : 'BAD_BLOCK') : stopHit ? (c.blockedReason ? 'AVOIDED_LOSS' : 'GOOD_BLOCK') : 'NEUTRAL_BLOCK';
  const last = prices.at(-1);
  const finalReturnPct = last?.close ? ((last.close - c.entryPriceVirtual) / c.entryPriceVirtual) * 100 : undefined;
  ledger.updateCase(caseId, { outcomeLabel: label, finalReturnPct, currentReturnPct: finalReturnPct, labelUpdatedAt: new Date().toISOString(), sourceConfidence: last?.sourceConfidence ?? c.sourceConfidence });
  return label;
}
