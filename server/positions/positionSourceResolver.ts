/**
 * @responsibility 포지션 출처 결정기 — 엔진 모드·보유 건수로 신뢰할 포지션 데이터 소스를 선택한다.
 */

export type PositionSourceMode =
  | 'SHADOW_FIRST'
  | 'LIVE_FIRST'
  | 'SHADOW_ONLY'
  | 'LIVE_ONLY'
  | 'COMBINED';

export interface PositionSourceResolution {
  mode: PositionSourceMode;
  engineMode?: string;
  liveCount: number;
  shadowCount: number;
  paperCount: number;
  virtualCount: number;
  selectedSource:
    | 'SHADOW_POSITION_REGISTRY'
    | 'PAPER_TRADE_LEDGER'
    | 'VIRTUAL_ACCOUNT'
    | 'LIVE_KIS_HOLDINGS'
    | 'COMBINED'
    | 'NONE';
  reason: string;
}

export interface ResolvePositionSourceInput {
  engineMode?: string;
  liveCount: number;
  shadowCount: number;
  paperCount: number;
  virtualCount: number;
}

const SHADOW_MODES = new Set(['SHADOW_ONLY', 'R6_DEFENSE', 'SELL_ONLY', 'OBSERVE_ONLY', 'DEGRADED', 'HARD_BLOCK']);

export function resolvePositionSource(input: ResolvePositionSourceInput): PositionSourceResolution {
  const engineMode = String(input.engineMode ?? '').toUpperCase();
  const shadowTotal = input.shadowCount + input.paperCount + input.virtualCount;
  const mode: PositionSourceMode = SHADOW_MODES.has(engineMode)
    ? 'SHADOW_FIRST'
    : engineMode === 'LIVE'
      ? 'LIVE_FIRST'
      : shadowTotal > 0
        ? 'SHADOW_FIRST'
        : 'COMBINED';

  if (input.shadowCount > 0) return { ...input, engineMode, mode, selectedSource: 'SHADOW_POSITION_REGISTRY', reason: 'Shadow positions available; prefer shadow source for query commands.' };
  if (input.paperCount > 0) return { ...input, engineMode, mode, selectedSource: 'PAPER_TRADE_LEDGER', reason: 'Shadow registry empty; fallback to paper trade ledger.' };
  if (input.virtualCount > 0) return { ...input, engineMode, mode, selectedSource: 'VIRTUAL_ACCOUNT', reason: 'Shadow and paper empty; fallback to virtual account holdings.' };
  if (input.liveCount > 0) return { ...input, engineMode, mode, selectedSource: 'LIVE_KIS_HOLDINGS', reason: 'No shadow holdings available; use live holdings.' };
  return { ...input, engineMode, mode, selectedSource: 'NONE', reason: 'No available holdings in shadow/paper/virtual/live sources.' };
}

export function isEngineBlockQueryException(engineMode?: string): boolean {
  return SHADOW_MODES.has(String(engineMode ?? '').toUpperCase());
}
