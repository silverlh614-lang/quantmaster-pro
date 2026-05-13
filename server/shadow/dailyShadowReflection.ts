// @responsibility 장마감 Shadow reflection — 자동 파라미터 변경 없이 recommendation 만 생성
import type { ShadowCaseLedgerStore } from './shadowCaseLedger.js';
import type { PromotionReport } from './shadowTypes.js';

export interface DailyShadowReflectionReport {
  date: string;
  bestEntry?: string;
  worstEntry?: string;
  blockedButRose: string[];
  avoidedLoss: string[];
  duplicateSignals: number;
  paperFillMissing: number;
  exitLabelMissing: number;
  returnFlow: { hits: number; misses: number; hitRate: number };
  gateRecommendation: 'OBSERVE_ONLY' | 'REVIEW_GATE';
  promotionStatus: PromotionReport['promotionStatus'];
  recommendation: string;
  parameterChangesApplied: false;
  createdAt: string;
}

export function createDailyShadowReflection(input: {
  ledger: ShadowCaseLedgerStore;
  promotion: PromotionReport;
  returnFlow: { hits: number; misses: number; hitRate: number };
  date?: string;
}): DailyShadowReflectionReport {
  const cases = input.ledger.listCases();
  const closed = cases.filter((c) => c.finalReturnPct !== undefined);
  const sorted = [...closed].sort((a, b) => (b.finalReturnPct ?? 0) - (a.finalReturnPct ?? 0));
  const duplicateSignals = cases.length - new Set(cases.map((c) => c.signalId)).size;
  const paperFillMissing = cases.filter((c) => c.shadowDecision?.includes('BUY') && !['SHADOW_PAPER_FILLED', 'SHADOW_POSITION_OPENED', 'SHADOW_POSITION_CLOSED', 'OUTCOME_LABELED'].includes(c.state ?? '')).length;
  const exitLabelMissing = cases.filter((c) => c.state === 'SHADOW_POSITION_CLOSED' && !c.outcomeLabel).length;
  const shouldReview = input.promotion.blockers.some((b) => ['returnFlowHitRate', 'labelCompletionRate', 'paperFillRate', 'duplicateSignalRate'].includes(b));
  return {
    date: input.date ?? new Date().toISOString().slice(0, 10),
    bestEntry: sorted[0] ? `${sorted[0].symbol} ${sorted[0].finalReturnPct?.toFixed(2)}%` : undefined,
    worstEntry: sorted.at(-1) ? `${sorted.at(-1)!.symbol} ${sorted.at(-1)!.finalReturnPct?.toFixed(2)}%` : undefined,
    blockedButRose: cases.filter((c) => c.outcomeLabel === 'MISSED_WIN' || c.outcomeLabel === 'BAD_BLOCK').map((c) => c.symbol),
    avoidedLoss: cases.filter((c) => c.outcomeLabel === 'AVOIDED_LOSS' || c.outcomeLabel === 'GOOD_BLOCK').map((c) => c.symbol),
    duplicateSignals, paperFillMissing, exitLabelMissing, returnFlow: input.returnFlow,
    gateRecommendation: shouldReview ? 'REVIEW_GATE' : 'OBSERVE_ONLY', promotionStatus: input.promotion.promotionStatus,
    recommendation: shouldReview ? '진단 blocker를 검토하되 자동 파라미터 변경은 금지합니다.' : '승격 전 관찰을 지속합니다.',
    parameterChangesApplied: false, createdAt: new Date().toISOString(),
  };
}
