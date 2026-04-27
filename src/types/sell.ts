// @responsibility sell 도메인 타입 정의
// ─── 매도 엔진 도메인 타입 (barrel) ──────────────────────────────────────────
//
// Phase 1 리팩토링: types/sell/ 하위 모듈로 분리된 타입들의 재노출 지점.
// 기존 `import { ActivePosition } from '../../types/sell'` 호환성 유지.

export type { ActivePosition } from './sell/position';
export type {
  SellAction,
  SellSignal,
  PreMortemType,
  PreMortemTrigger,
  TakeProfitTarget,
} from './sell/signal';
export type {
  SellContext,
  PreMortemData,
  EuphoriaData,
  OHLCCandle,
  VolumeStats,
} from './sell/context';
export type {
  LifecycleStage,
  LifecycleTransition,
  PositionLifecycleState,
} from './sell/lifecycle';
export type {
  DynamicStopRegime,
  DynamicStopInput,
  DynamicStopResult,
  SellCycleContext,
} from './sell/dynamicStop';
