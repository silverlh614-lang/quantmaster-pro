// @responsibility ExitEngine 청산 규칙 공용 ctx·result 타입 정의
/**
 * exitEngine/types.ts — 청산 규칙 시그니처 SSOT (ADR-0028).
 *
 * ExitContext 는 한 shadow 의 한 tick 평가에 필요한 모든 입력을 묶는다.
 * Rule 함수는 부수효과(KIS 주문/텔레그램/attribution) 를 직접 수행하고
 * `skipRest=true` 로 orchestrator 의 `continue` 를 신호한다.
 *
 * ATR 등 hardStopLoss 를 갱신하는 규칙은 `hardStopLossUpdate` 필드로
 * 후속 규칙(하드 스톱 / RRR / 손절 접근) 에 새 임계값을 전파한다.
 */

import type { ServerShadowTrade } from '../../persistence/shadowTradeRepo.js';
import type { RegimeLevel } from '../../../src/types/core.js';

export interface ExitContext {
  shadow: ServerShadowTrade;
  currentPrice: number;
  returnPct: number;
  currentRegime: RegimeLevel;
  initialStopLoss: number;
  regimeStopLoss: number;
  /** ATR 동적 갱신 후 값. 후속 규칙은 이 값을 손절 임계로 사용. */
  hardStopLoss: number;
  /** L1 학습 훅 — orchestrator 가 HIT_TARGET/HIT_STOP 전이 후 mutate. */
  resolvedNow: Set<string>;
}

export interface ExitRuleResult {
  /** true 면 orchestrator 가 이 shadow 의 후속 규칙 평가를 중단하고 다음 shadow 로 넘어간다. */
  skipRest: boolean;
  /** ATR 등이 hardStopLoss 를 갱신했을 때 후속 규칙으로 전파. */
  hardStopLossUpdate?: number;
}

export type ExitRule = (ctx: ExitContext) => Promise<ExitRuleResult>;

/** Rule 함수가 매번 빈 결과를 만들 때 쓰는 sentinel. */
export const NO_OP: ExitRuleResult = { skipRest: false };
