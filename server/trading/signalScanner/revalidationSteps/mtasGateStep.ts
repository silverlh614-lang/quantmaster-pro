// @responsibility MTAS 점수 임계값 진입 차단 — RevalidationStep

import type { RevalidationStepResult } from './types.js';

export interface MtasGateStepInput {
  stockName: string;
  mtas: number;
}

const MTAS_BLOCK_THRESHOLD = 3;

/**
 * ADR-0031 PR-61 — 라인 752-757 의 MTAS 진입 차단 분기를 byte-equivalent 로 추출.
 *
 * MTAS 기반 진입 차단: 타임프레임 불일치 시 진입 금지 (mtas <= 3).
 * caller 가 fail 시 적용하는 부수효과:
 *   - console.log(result.logMessage)
 *   - continue (outer loop)
 *
 * 본 step 은 MTAS 차단을 단순 게이트로 다루므로 stageLog 갱신·counter 증가는 없다 (원본 동작 동일).
 */
export function mtasGateStep(input: MtasGateStepInput): RevalidationStepResult {
  if (input.mtas > MTAS_BLOCK_THRESHOLD) {
    return { proceed: true };
  }
  return {
    proceed: false,
    logMessage: `[AutoTrade] ${input.stockName} MTAS ${input.mtas.toFixed(1)}/10 진입 금지 — 타임프레임 불일치`,
    failReasons: [`mtas_below_threshold(${input.mtas.toFixed(1)})`],
    stageLogValue: `FAIL(mtas:${input.mtas.toFixed(1)})`,
  };
}
