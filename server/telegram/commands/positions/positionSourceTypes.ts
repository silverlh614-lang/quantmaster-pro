// @responsibility Shared position source aggregation contracts.

export type PositionSourceName =
  | 'ShadowPositionRegistry'
  | 'ShadowPositionLedger'
  | 'ShadowTradeRepo'
  | 'VirtualAccount'
  | 'PaperTradeLedger'
  | 'KISLiveHolding';

export type NormalizedPositionSourceTag = 'SHADOW' | 'LIVE' | 'VIRTUAL' | 'PAPER';

export type NormalizedPositionMode = 'SHADOW' | 'LIVE';

type PositionQueryExecutionImpact = 'POSITION_QUERY_DEGRADED';

export interface NormalizedPosition {
  symbol: string;
  name?: string;
  qty: number;
  avgPrice?: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  sourceTag: NormalizedPositionSourceTag;
  mode: NormalizedPositionMode;
  source?: PositionSourceName | string;
  id?: string;
  status?: string;
  diagnostics?: unknown;
  raw?: unknown;
}

export type PositionSourceResult =
  | {
      source: string;
      kind: 'SUCCESS';
      positions: NormalizedPosition[];
      diagnostics?: unknown;
    }
  | {
      source: string;
      kind: 'EMPTY';
      diagnostics?: unknown;
    }
  | {
      source: string;
      kind: 'FAILED';
      reason: string;
      executionImpact: PositionQueryExecutionImpact;
      diagnostics?: unknown;
    };

export interface PositionSourceAggregate {
  positions: NormalizedPosition[];
  results: PositionSourceResult[];
  diagnostics: PositionSourceResult[];
  hasFailure: boolean;
  allFailed: boolean;
}

export function isPositionSourceFailure(result: PositionSourceResult): result is Extract<PositionSourceResult, { kind: 'FAILED' }> {
  return result.kind === 'FAILED';
}

export function isPositionSourceSuccess(result: PositionSourceResult): result is Extract<PositionSourceResult, { kind: 'SUCCESS' }> {
  return result.kind === 'SUCCESS';
}
