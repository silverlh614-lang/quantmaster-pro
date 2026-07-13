/**
 * @responsibility server/trading/sizing 모듈 공개 API 배럴 — 포지션 사이징 엔진 진입점
 */

export {
  type SignalGrade,
} from './accountSizeTiers.js';
export {
  // 핵심 엔진
  computeFinalPosition,
  type PositionSizingInput,
  type PositionSizingResult,
} from './positionSizingEngine.js';

export {
  calculateShadowRegimeSizing,
  resolveShadowRegimeSizingLevel,
  type ShadowRegimeSizingLevel,
  type ShadowRegimeSizingResult
} from './shadowRegimeSizingPolicy.js';
