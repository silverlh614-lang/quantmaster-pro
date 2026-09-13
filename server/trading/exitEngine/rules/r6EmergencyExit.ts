// @responsibility 과거 통합용 R6 청산 훅을 실행 부작용 없이 종료한다.
import type { ExitContext, ExitRuleResult } from '../types.js';
import { NO_OP } from '../types.js';

/** Regime liquidation was removed from LIVE and PAPER. Existing historical tags remain readable. */
export async function r6EmergencyExit(_ctx: ExitContext): Promise<ExitRuleResult> {
  return NO_OP;
}
