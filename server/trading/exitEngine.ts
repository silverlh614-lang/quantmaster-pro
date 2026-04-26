// @responsibility ExitEngine 외부 import 호환 유지용 barrel re-export
/**
 * exitEngine.ts — barrel re-export (ADR-0028).
 *
 * 본체는 `server/trading/exitEngine/` 디렉토리로 분해됐다 (ADR-0028).
 * 이 파일은 외부 importer 4개 (signalScanner / signalScanner/preflight /
 * shadowResolverJob / exitEngine.atrIntegration test) 가 기존 import 경로
 * (`'./exitEngine.js'`) 를 그대로 사용할 수 있도록 호환만 유지한다.
 */

export {
  updateShadowResults,
  emitPartialAttributionForSell,
  detectBearishDivergence,
  isMA60Death,
  kstBusinessDateStr,
  type ReserveSellResult,
} from './exitEngine/index.js';
