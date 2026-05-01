/**
 * @responsibility perSymbol 진입 평가 SSOT barrel — 외부 import 경로 호환 보존
 *
 * ADR-0134 (PR-Refactor-2) — 본 파일은 분해 후 barrel re-export 만 유지한다.
 * 1617 LoC 분해 결과:
 *   ./perSymbol/types.ts        — 4 인터페이스 (Context + Mutables)
 *   ./perSymbol/helpers.ts      — getPrice / getAdaptiveProfitTargets / SymbolExitContext / FAILURE_BLOCK_THRESHOLD_PCT
 *   ./perSymbol/buyListLoop.ts  — evaluateBuyList (메인 buyList 루프)
 *   ./perSymbol/intradayLoop.ts — evaluateIntradayList (장중 루프)
 *   ./perSymbol/index.ts        — barrel
 *
 * 외부 importer (signalScanner.ts + 35 회귀 테스트) 경로 변경 0건 — barrel re-export 로 호환.
 * ADR-0001 (signalScanner-decomposition) Phase B 완주.
 */

export {
  getPrice,
  FAILURE_BLOCK_THRESHOLD_PCT,
  getAdaptiveProfitTargets,
  evaluateBuyList,
  evaluateIntradayList,
} from './perSymbol/index.js';

export type {
  SymbolExitContext,
  BuyListLoopContext,
  BuyListLoopMutables,
  IntradayLoopContext,
  IntradayLoopMutables,
} from './perSymbol/index.js';
