// @responsibility signalScanner 매매 엔진 모듈
/**
 * signalScanner.ts — 장중 자동 신호 스캔 오케스트레이터 (Barrel)
 *
 * ADR-0147 Phase B 마이그레이션 완료.
 * 기존의 거대한 1,820줄 로직은 signalScanner/ 폴더 내 6단계 오케스트레이터로
 * 완벽히 이식되었으며, 본 파일은 외부 모듈과의 하위 호환성을 유지하기 위한
 * Barrel re-export 역할만 담당합니다.
 */

export { runAutoSignalScan } from './signalScanner/index.js';

export type {
  StopLossPlan,
  PositionSizingInput,
} from './entryEngine.js';
export {
  EXIT_RULE_PRIORITY_TABLE,
  isOpenShadowStatus,
  buildStopLossPlan,
  calculateOrderQuantity,
  reconcileDayOpen,
  evaluateEntryRevalidation,
  regimeToStopRegime,
} from './entryEngine.js';
export { getRemainingQty } from '../persistence/shadowTradeRepo.js';

export {
  type ScanSummary,
  getLastBuySignalAt,
  getLastScanSummary,
  getLastScanSummaryAt,
  getConsecutiveZeroScans,
} from './signalScanner/scanDiagnostics.js';

export type { SymbolExitContext } from './signalScanner/perSymbolEvaluation.js';
