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
  /**
   * ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점.
   * 호출자가 macroState.sectorEnergyResult + stock.sector 로 applySectorScoreBoost
   * 결과를 미리 계산해 전달. step 은 단순히 `gateScore + sectorBoost` 로 보정 후
   * evaluateEntryRevalidation 호출. 미전달 시 0 — 동작 변경 없음 (후방호환).
   *
   * 효과: LEADING 섹터 +2 보너스로 진입 직전 재검증의 minGate 임계 통과 유리.
   */
  sectorBoost?: number;
  /** sectorBoost 진단 텍스트 — describeSectorBoost() 결과. 진단 메시지에만 사용. */
  sectorBoostReason?: string;
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
  // ADR-0075 PR-4 wiring: gateScore 에 sectorBoost 가산 후 minGate 비교.
  const rawGateScore = input.reCheckGate?.gateScore;
  const boost = input.sectorBoost ?? 0;
  const boostedGateScore = typeof rawGateScore === 'number' ? rawGateScore + boost : rawGateScore;

  const revalidation = evaluateEntryRevalidation({
    currentPrice: input.currentPrice,
    entryPrice: input.entryPrice,
    quoteGateScore: boostedGateScore,
    quoteSignalType: input.reCheckGate?.signalType,
    dayOpen: input.reCheckQuote?.dayOpen,
    prevClose: input.reCheckQuote?.prevClose,
    volume: input.reCheckQuote?.volume,
    avgVolume: input.reCheckQuote?.avgVolume,
    minGateScore: getMinGateScore(input.regime),
    marketElapsedMinutes: input.marketElapsedMinutes,
  });

  if (revalidation.ok) return { proceed: true };

  // sectorBoost 가 적용되어도 탈락한 경우 — 진단 메시지에 boost 효과 명시.
  const reasons = revalidation.reasons;
  const boostNote = boost !== 0 && input.sectorBoostReason
    ? ` [${input.sectorBoostReason}]`
    : '';
  return {
    proceed: false,
    logMessage: `[AutoTrade] ${input.stockName} 진입 직전 재검증 탈락: ${reasons.join(', ')}${boostNote}`,
    failReasons: reasons,
    stageLogValue: `FAIL(${reasons.join(',')})`,
  };
}
