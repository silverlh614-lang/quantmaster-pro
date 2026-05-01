/**
 * @responsibility perSymbol 모듈 barrel — buyListLoop·intradayLoop·helpers·types 단일 진입점
 *
 * ADR-0134 (PR-Refactor-2) — perSymbolEvaluation.ts 분해 후 barrel re-export.
 * 외부 import 경로는 `signalScanner/perSymbolEvaluation.js` 그대로 유지 (signalScanner.ts
 * 의 barrel 에서 본 모듈을 경유 re-export).
 */

export { getPrice, FAILURE_BLOCK_THRESHOLD_PCT, getAdaptiveProfitTargets } from './helpers.js';
export type { SymbolExitContext } from './helpers.js';
export { evaluateBuyList } from './buyListLoop.js';
export { evaluateIntradayList } from './intradayLoop.js';
export type {
  BuyListLoopContext,
  BuyListLoopMutables,
  IntradayLoopContext,
  IntradayLoopMutables,
} from './types.js';
