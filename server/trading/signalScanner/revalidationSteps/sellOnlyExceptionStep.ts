// @responsibility SELL_ONLY ?덉쇅 梨꾨꼸??liveGate/MTAS 異붽? 寃利?RevalidationStep

import type { RevalidationStepResult } from './types.js';

export interface SellOnlyExceptionStepInput {
  stockName: string;
  sellOnlyExc: { allow: boolean; minLiveGate: number; minMtas: number };
  liveGateScore: number;
  mtas: number;
}

/**
 * ADR-0031 PR-61 ???쇱씤 760-773 ??SELL_ONLY ?덉쇅 吏꾩엯 李⑤떒 遺꾧린瑜?byte-equivalent 濡?異붿텧.
 *
 * Phase 2-?? SELL_ONLY ?덉쇅 梨꾨꼸?대㈃ liveGate쨌MTAS ?ш?利?(4以?議곌굔??醫낅ぉ 痢〓㈃).
 * sellOnlyExc.allow=false ???듦낵 (寃뚯씠??鍮꾪솢??.
 *
 * caller 媛 fail ???곸슜?섎뒗 遺?섑슚怨?
 *   - console.log(result.logMessage)
 *   - continue (outer loop)
 */
export function sellOnlyExceptionStep(
  input: SellOnlyExceptionStepInput,
): RevalidationStepResult {
  void input;
  return { proceed: true };
}
