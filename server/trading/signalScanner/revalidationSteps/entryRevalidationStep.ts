// @responsibility liveGate 재검증 결과를 RevalidationStep 시그니처로 분기하는 PoC 단계

import { evaluateEntryRevalidation, getMinGateScore } from '../../entryEngine.js';
import type { RevalidationStepResult } from './types.js';

export interface EntryRevalidationStepInput {
  stockName: string;
  currentPrice: number;
  entryPrice: number;
  reCheckQuote: {
    dayOpen?: number;
    prevClose?: number;
    volume?: number;
    avgVolume?: number;
  } | null;
  reCheckGate: {
    gateScore?: number;
    signalType?: 'STRONG' | 'NORMAL' | 'SKIP';
  } | null;
  regime: string;
  marketElapsedMinutes: number;
}

/**
 * ADR-0031 PoC — 라인 692-732 의 entry-revalidation 분기를 byte-equivalent 로 추출.
 *
 * 호출 시점: EntryGate Chain (PR-57/58) 통과 직후 reCheckQuote/reCheckGate 가
 * 이미 계산된 상태. 이 step 은 evaluateEntryRevalidation 결과를 받아 caller 가
 * 그대로 사용할 수 있는 진단 데이터로 변환만 한다 (외부 mutation 0건).
 *
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.log(result.logMessage)
 *   - stock.entryFailCount = (stock.entryFailCount ?? 0) + 1
 *   - mutables.watchlistMutated.value = true
 *   - scanCounters.gateMisses++
 *   - stageLog.gate = result.stageLogValue
 *   - pushTrace()
 *   - recordCounterfactual({ ..., skipReason: `entryRevalidation:${result.failReasons.join(',')}` })
 */
export function entryRevalidationStep(input: EntryRevalidationStepInput): RevalidationStepResult {
  const revalidation = evaluateEntryRevalidation({
    currentPrice: input.currentPrice,
    entryPrice: input.entryPrice,
    quoteGateScore: input.reCheckGate?.gateScore,
    quoteSignalType: input.reCheckGate?.signalType,
    dayOpen: input.reCheckQuote?.dayOpen,
    prevClose: input.reCheckQuote?.prevClose,
    volume: input.reCheckQuote?.volume,
    avgVolume: input.reCheckQuote?.avgVolume,
    minGateScore: getMinGateScore(input.regime),
    marketElapsedMinutes: input.marketElapsedMinutes,
  });

  if (revalidation.ok) {
    return { proceed: true };
  }

  const reasons = revalidation.reasons;
  return {
    proceed: false,
    logMessage: `[AutoTrade] ${input.stockName} 진입 직전 재검증 탈락: ${reasons.join(', ')}`,
    failReasons: reasons,
    stageLogValue: `FAIL(${reasons.join(',')})`,
  };
}
