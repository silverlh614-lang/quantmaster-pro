// @responsibility L3-a 트레일링 고점 갱신 규칙 (mutation only)
/**
 * exitEngine/rules/trailingPeakUpdate.ts — L3-a 트레일링 고점 갱신 (ADR-0028).
 * 부수효과 없는 단순 mutation. 후속 트레일링 스톱 규칙이 사용한다.
 */

import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';

export async function trailingPeakUpdate(ctx: ExitContext): Promise<ExitRuleResult> {
  const { shadow, currentPrice } = ctx;
  if (shadow.trailingEnabled && currentPrice > (shadow.trailingHighWaterMark ?? 0)) {
    shadow.trailingHighWaterMark = currentPrice;
  }
  return NO_OP;
}
